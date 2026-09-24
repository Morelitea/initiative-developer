"""Helpers shared by the offline and online signing steps."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from securesystemslib.signer import Signer
from tuf.api.exceptions import UnsignedMetadataError
from tuf.api.metadata import (
    DelegatedRole,
    Delegations,
    Metadata,
    Root,
    TargetFile,
    Targets,
)
from tuf.api.serialization.json import JSONSerializer

from . import layout
from .errors import RegistryError
from .sources import Publisher

_ROOT_FILE = re.compile(r"^([1-9][0-9]*)\.root\.json$")
_SERIALIZER = JSONSerializer(compact=False)

#: The committed top-level targets metadata, beside the root versions.
TARGETS_FILE = "targets.json"


def utc_now() -> datetime:
    return datetime.now(UTC).replace(microsecond=0)


def to_bytes(metadata: Metadata) -> bytes:
    return metadata.to_bytes(_SERIALIZER) + b"\n"


def online_version(previous: int | None, now: datetime) -> int:
    """The version of a role an online build signs.

    The build time in seconds, so each build supersedes the one before it
    without carrying state between runs; never lower than ``previous + 1``.
    """
    stamp = int(now.timestamp())
    return stamp if previous is None else max(previous + 1, stamp)


@dataclass(frozen=True)
class RootVersion:
    version: int
    data: bytes
    metadata: Metadata[Root]


def load_root_chain(metadata_dir: Path) -> list[RootVersion]:
    """Every ``<N>.root.json`` in ``metadata_dir``, each checked against the one
    before it, as a client walking the chain would."""
    found: dict[int, Path] = {}
    if metadata_dir.is_dir():
        for path in metadata_dir.iterdir():
            match = _ROOT_FILE.match(path.name)
            if match:
                found[int(match.group(1))] = path
    if not found:
        raise RegistryError(f"{metadata_dir} holds no signed root; run init-root first")
    expected = list(range(1, max(found) + 1))
    if sorted(found) != expected:
        missing = sorted(set(expected) - set(found))
        raise RegistryError(f"{metadata_dir} is missing root versions {missing}")

    chain: list[RootVersion] = []
    for version in expected:
        data = found[version].read_bytes()
        try:
            metadata = Metadata[Root].from_bytes(data)
        except Exception as exc:
            raise RegistryError(
                f"{found[version]} is not root metadata: {exc}"
            ) from exc
        if metadata.signed.version != version:
            raise RegistryError(
                f"{found[version]} holds root version {metadata.signed.version}"
            )
        signers = [chain[-1].metadata] if chain else []
        try:
            for trusted in [*signers, metadata]:
                trusted.signed.verify_delegate(
                    layout.ROOT, metadata.signed_bytes, metadata.signatures
                )
        except UnsignedMetadataError as exc:
            raise RegistryError(
                f"{found[version]} is not signed by the root: {exc}"
            ) from exc
        chain.append(RootVersion(version, data, metadata))
    return chain


def load_targets(metadata_dir: Path, root: Root) -> tuple[bytes, Metadata[Targets]]:
    path = metadata_dir / TARGETS_FILE
    if not path.is_file():
        raise RegistryError(f"{path} does not exist; run init-root first")
    data = path.read_bytes()
    try:
        metadata = Metadata[Targets].from_bytes(data)
        root.verify_delegate(layout.TARGETS, metadata.signed_bytes, metadata.signatures)
    except UnsignedMetadataError as exc:
        raise RegistryError(
            f"{path} is not signed by the targets key in root: {exc}"
        ) from exc
    except Exception as exc:
        raise RegistryError(f"{path} is not targets metadata: {exc}") from exc
    return data, metadata


def require_role_key(root: Root, role: str, signer: Signer) -> None:
    """Refuse to sign ``role`` with a key the root does not name for it."""
    keyid = signer.public_key.keyid
    if keyid not in root.roles[role].keyids:
        raise RegistryError(
            f"the {role} key given ({keyid[:12]}…) is not the one root names for {role}"
        )


def check_not_expired(metadata: Metadata, what: str, now: datetime) -> None:
    if metadata.signed.is_expired(now):
        raise RegistryError(
            f"{what} expired on {metadata.signed.expires:%Y-%m-%d}; "
            "re-sign it with sign-offline"
        )


def top_level_targets(
    publishers: dict[str, Publisher], *, version: int, now: datetime
) -> Targets:
    """The top-level targets role: one delegation per publisher, bound to its key
    and limited to its own prefix, plus each publisher's record as a target."""
    keys = {}
    roles = {}
    records = {}
    for prefix in sorted(publishers):
        publisher = publishers[prefix]
        problem = layout.prefix_problem(prefix)
        if problem:
            raise RegistryError(problem)
        keys[publisher.key.keyid] = publisher.key
        roles[prefix] = DelegatedRole(
            name=prefix,
            keyids=[publisher.key.keyid],
            threshold=1,
            terminating=True,
            paths=layout.delegation_paths(prefix),
        )
        records[publisher.target_path] = TargetFile.from_data(
            publisher.target_path, publisher.data, ["sha256"]
        )
    return Targets(
        version=version,
        expires=now + layout.EXPIRY[layout.TARGETS],
        targets=records,
        delegations=Delegations(keys=keys, roles=roles),
    )
