"""The online build: listings into a complete, static TUF repository.

The offline metadata (every root version and the top-level targets) is copied
in as it was signed. The build then signs each publisher's delegated role over
that publisher's listing targets, and the snapshot and timestamp over those.
"""

from __future__ import annotations

import os
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from securesystemslib.signer import Signer
from tuf.api.metadata import (
    Metadata,
    MetaFile,
    Snapshot,
    TargetFile,
    Targets,
    Timestamp,
)

from . import layout
from .errors import RegistryError
from .repo import (
    RootVersion,
    check_not_expired,
    load_root_chain,
    load_targets,
    online_version,
    require_role_key,
    to_bytes,
    utc_now,
)
from .sources import Blob, Listing, Publisher, load_listings, load_publishers, sha256

PUBLIC = "public"
HOSTED = "hosted"
BUILD_TARGETS = (PUBLIC, HOSTED)

#: Offline metadata closer than this to expiry is reported on every build.
EXPIRY_WARNING_DAYS = 30

#: Looks up an online key by name: ``snapshot``, ``timestamp`` or a prefix.
KeyLookup = Callable[[str], Signer]


@dataclass
class BuildResult:
    out: Path
    listings: list[Listing]
    root_version: int
    targets_version: int
    snapshot_version: int
    timestamp_version: int
    role_versions: dict[str, int] = field(default_factory=dict)


def _write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def _write_target(out: Path, blob: Blob) -> None:
    served = layout.served_target_path(blob.path, blob.sha256)
    _write(out / layout.TARGETS_SUBDIR / served, blob.data)


def refuse_for_target(target: str, listings: list[Listing]) -> None:
    """The public target excludes priced and sectored listings, and refuses to run
    over input that contains one; other targets take them."""
    if target not in BUILD_TARGETS:
        raise RegistryError(
            f"unknown target {target!r}; expected one of {BUILD_TARGETS}"
        )
    if target != PUBLIC:
        return
    offenders = []
    for listing in listings:
        reasons = []
        if listing.priced:
            reasons.append("a price")
        if listing.reference_sectors:
            reasons.append("reference sectors " + ", ".join(listing.reference_sectors))
        if reasons:
            offenders.append(f"{listing.source} has {' and '.join(reasons)}")
    if offenders:
        raise RegistryError(
            "the public target takes no priced or sectored listing:\n  "
            + "\n  ".join(offenders)
        )


def _check_delegations(targets: Targets, publishers: dict[str, Publisher]) -> None:
    """The signed targets must delegate exactly the publisher records given,
    each to the key and the record bytes those records hold now."""
    delegations = targets.delegations
    roles = delegations.roles if delegations and delegations.roles else {}
    if layout.RESERVED_PREFIX in roles:
        raise RegistryError(f"targets.json delegates {layout.RESERVED_PREFIX!r}")
    stale = "; run sign-offline to re-sign targets.json"
    for prefix in sorted(set(roles) | set(publishers)):
        if prefix not in publishers:
            raise RegistryError(
                f"targets.json delegates {prefix!r}, which has no record"
            )
        if prefix not in roles:
            raise RegistryError(
                f"publisher {prefix!r} is not delegated in targets.json{stale}"
            )
        role = roles[prefix]
        publisher = publishers[prefix]
        if role.keyids != [publisher.key.keyid]:
            raise RegistryError(
                f"publisher {prefix!r}: its key is not the delegated one{stale}"
            )
        if role.paths != layout.delegation_paths(prefix):
            raise RegistryError(
                f"publisher {prefix!r}: the delegated paths differ{stale}"
            )
        record = targets.targets.get(publisher.target_path)
        if record is None or record.hashes.get("sha256") != sha256(publisher.data):
            raise RegistryError(f"publisher record {publisher.path} changed{stale}")


def _warn_expiring(metadata: Metadata, what: str, now: datetime) -> None:
    days = (metadata.signed.expires - now).days
    if days < EXPIRY_WARNING_DAYS:
        message = f"{what} expires in {days} days; renew it with sign-offline"
        if os.environ.get("GITHUB_ACTIONS") == "true":
            print(f"::warning::{message}", file=sys.stderr)
        else:
            print(f"warning: {message}", file=sys.stderr)


def _publisher_role(
    listings: list[Listing],
    signer: Signer,
    *,
    version: int,
    now: datetime,
) -> Metadata[Targets]:
    targets: dict[str, TargetFile] = {}
    for listing in listings:
        for blob in listing.targets.values():
            targets[blob.path] = TargetFile.from_data(blob.path, blob.data, ["sha256"])
    role = Targets(
        version=version,
        expires=now + layout.EXPIRY["publisher"],
        targets=dict(sorted(targets.items())),
    )
    metadata = Metadata(role)
    metadata.sign(signer)
    return metadata


def sign_timestamp(
    snapshot_bytes: bytes,
    snapshot_version: int,
    signer: Signer,
    *,
    version: int,
    now: datetime,
) -> Metadata[Timestamp]:
    timestamp = Timestamp(
        version=version,
        expires=now + layout.EXPIRY[layout.TIMESTAMP],
        snapshot_meta=MetaFile(
            version=snapshot_version,
            length=len(snapshot_bytes),
            hashes={"sha256": sha256(snapshot_bytes)},
        ),
    )
    metadata = Metadata(timestamp)
    metadata.sign(signer)
    return metadata


def build(
    *,
    target: str,
    sources: list[Path],
    out: Path,
    keys: KeyLookup,
    metadata_dir: Path = layout.DEFAULT_METADATA_DIR,
    publisher_dirs: list[Path] | None = None,
    now: datetime | None = None,
) -> BuildResult:
    now = now or utc_now()
    if out.exists() and any(out.iterdir()):
        raise RegistryError(f"{out} is not empty; the build writes a fresh repository")

    chain: list[RootVersion] = load_root_chain(metadata_dir)
    root_metadata = chain[-1].metadata
    root = root_metadata.signed
    check_not_expired(root_metadata, "root", now)
    targets_bytes, targets_metadata = load_targets(metadata_dir, root)
    check_not_expired(targets_metadata, "targets.json", now)
    _warn_expiring(root_metadata, "root", now)
    _warn_expiring(targets_metadata, "targets.json", now)

    publishers = load_publishers(publisher_dirs or [layout.DEFAULT_PUBLISHERS_DIR])
    _check_delegations(targets_metadata.signed, publishers)
    listings = load_listings(sources, publishers)
    refuse_for_target(target, listings)

    snapshot_signer = keys(layout.SNAPSHOT)
    timestamp_signer = keys(layout.TIMESTAMP)
    require_role_key(root, layout.SNAPSHOT, snapshot_signer)
    require_role_key(root, layout.TIMESTAMP, timestamp_signer)
    publisher_signers = {}
    for prefix, publisher in sorted(publishers.items()):
        signer = keys(prefix)
        if signer.public_key.keyid != publisher.key.keyid:
            raise RegistryError(
                f"the key given for publisher {prefix!r} is not the one "
                f"its record names ({publisher.key.keyid[:12]}…)"
            )
        publisher_signers[prefix] = signer

    metadata_out = out / layout.METADATA_SUBDIR
    for version in chain:
        _write(metadata_out / f"{version.version}.root.json", version.data)
    targets_version = targets_metadata.signed.version
    _write(metadata_out / f"{targets_version}.{layout.TARGETS}.json", targets_bytes)
    for publisher in publishers.values():
        _write_target(out, Blob(publisher.target_path, publisher.data))

    online = online_version(None, now)
    snapshot_meta = {f"{layout.TARGETS}.json": MetaFile(version=targets_version)}
    role_versions: dict[str, int] = {}
    for prefix, signer in publisher_signers.items():
        owned = [listing for listing in listings if listing.publisher == prefix]
        role = _publisher_role(owned, signer, version=online, now=now)
        _write(metadata_out / f"{online}.{prefix}.json", to_bytes(role))
        for listing in owned:
            for blob in listing.targets.values():
                _write_target(out, blob)
        snapshot_meta[f"{prefix}.json"] = MetaFile(version=online)
        role_versions[prefix] = online

    snapshot = Metadata(
        Snapshot(
            version=online,
            expires=now + layout.EXPIRY[layout.SNAPSHOT],
            meta=snapshot_meta,
        )
    )
    snapshot.sign(snapshot_signer)
    snapshot_bytes = to_bytes(snapshot)
    _write(metadata_out / f"{online}.{layout.SNAPSHOT}.json", snapshot_bytes)

    timestamp = sign_timestamp(
        snapshot_bytes, online, timestamp_signer, version=online, now=now
    )
    _write(metadata_out / f"{layout.TIMESTAMP}.json", to_bytes(timestamp))

    return BuildResult(
        out=out,
        listings=listings,
        root_version=chain[-1].version,
        targets_version=targets_version,
        snapshot_version=online,
        timestamp_version=online,
        role_versions=role_versions,
    )


def refresh_timestamp(
    repo: Path, signer: Signer, *, now: datetime | None = None
) -> Metadata[Timestamp]:
    """Re-sign ``timestamp`` over the snapshot the repository already serves."""
    now = now or utc_now()
    metadata_dir = repo / layout.METADATA_SUBDIR
    chain = load_root_chain(metadata_dir)
    root = chain[-1].metadata.signed
    require_role_key(root, layout.TIMESTAMP, signer)
    path = metadata_dir / f"{layout.TIMESTAMP}.json"
    try:
        current = Metadata[Timestamp].from_bytes(path.read_bytes())
    except OSError as exc:
        raise RegistryError(
            f"{path} does not exist; build the repository first"
        ) from exc
    snapshot_version = current.signed.snapshot_meta.version
    snapshot_path = metadata_dir / f"{snapshot_version}.{layout.SNAPSHOT}.json"
    if not snapshot_path.is_file():
        raise RegistryError(f"{snapshot_path}, which timestamp names, does not exist")
    timestamp = sign_timestamp(
        snapshot_path.read_bytes(),
        snapshot_version,
        signer,
        version=online_version(current.signed.version, now),
        now=now,
    )
    _write(path, to_bytes(timestamp))
    return timestamp
