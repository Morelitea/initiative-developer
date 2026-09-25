"""An offline bundle: a built repository packed for a deployment to upload.

A deployment that cannot reach the published repository uploads a tarball of
its ``metadata/`` and ``targets/`` and reads it with an ordinary TUF client. The
published timestamp lasts a day and the snapshot a week, so the bundle carries
its own: a new snapshot over the same roles and a new timestamp over that, with
the next version numbers and a longer expiry, signed with the online snapshot
and timestamp keys. The built repository is only read.

A bundle is usable until the first of its metadata expires. The publisher roles
last 90 days from the build that signed them, and root and targets from their
offline signing, so the new snapshot and timestamp never outlast those: a longer
request is capped at the earliest of them, and the result says which it was.
"""

from __future__ import annotations

import io
import tarfile
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from securesystemslib.signer import Signer
from tuf.api.metadata import Metadata, Snapshot, Targets, Timestamp

from . import layout
from .build import sign_timestamp
from .errors import RegistryError
from .repo import load_root_chain, online_version, require_role_key, to_bytes, utc_now

DEFAULT_BUNDLE_DAYS = 90
MAX_BUNDLE_DAYS = 365

SNAPSHOT_FILE = f"{layout.SNAPSHOT}.json"
TIMESTAMP_FILE = f"{layout.TIMESTAMP}.json"


@dataclass
class BundleResult:
    out: Path
    snapshot_version: int
    timestamp_version: int
    #: When the bundle's snapshot and timestamp expire.
    expires: datetime
    #: The role whose earlier expiry cut the request short by a day or more.
    limited_by: str | None
    files: int


def _read(path: Path, what: str) -> bytes:
    try:
        return path.read_bytes()
    except OSError as exc:
        raise RegistryError(
            f"{path} ({what}) cannot be read; is this a built repository?"
        ) from exc


def _carried_name(name: str, version: int) -> str:
    """The versioned file a snapshot entry such as ``acme.json`` names."""
    return f"{version}.{name}"


def _tar_member(tar: tarfile.TarFile, name: str, data: bytes, mtime: int) -> None:
    info = tarfile.TarInfo(name)
    info.size = len(data)
    info.mode = 0o644
    info.mtime = mtime
    tar.addfile(info, io.BytesIO(data))


def export_bundle(
    repo: Path,
    out: Path,
    *,
    snapshot_signer: Signer,
    timestamp_signer: Signer,
    expires_days: int = DEFAULT_BUNDLE_DAYS,
    now: datetime | None = None,
) -> BundleResult:
    """Write ``out``, a gzipped tar of ``repo``'s metadata and targets with a new
    snapshot and timestamp that expire ``expires_days`` from ``now``, or when
    the first other role in the bundle does, whichever is sooner."""
    now = now or utc_now()
    if not 1 <= expires_days <= MAX_BUNDLE_DAYS:
        raise RegistryError(
            f"--expires-days must be 1 to {MAX_BUNDLE_DAYS}, got {expires_days}"
        )
    repo = repo.resolve()
    if out.exists():
        raise RegistryError(f"{out} already exists")
    if out.resolve().is_relative_to(repo):
        raise RegistryError(f"{out} is inside {repo}; the bundle is written elsewhere")

    metadata_dir = repo / layout.METADATA_SUBDIR
    targets_dir = repo / layout.TARGETS_SUBDIR
    chain = load_root_chain(metadata_dir)
    root = chain[-1].metadata.signed
    require_role_key(root, layout.SNAPSHOT, snapshot_signer)
    require_role_key(root, layout.TIMESTAMP, timestamp_signer)

    timestamp_data = _read(metadata_dir / TIMESTAMP_FILE, "timestamp")
    current_timestamp = Metadata[Timestamp].from_bytes(timestamp_data).signed
    snapshot_file = _carried_name(
        SNAPSHOT_FILE, current_timestamp.snapshot_meta.version
    )
    snapshot_data = _read(metadata_dir / snapshot_file, "the snapshot timestamp names")
    current_snapshot = Metadata[Snapshot].from_bytes(snapshot_data).signed

    metadata_files: dict[str, bytes] = {
        f"{version.version}.root.json": version.data for version in chain
    }
    expiries: dict[str, datetime] = {layout.ROOT: root.expires}
    for name, meta in current_snapshot.meta.items():
        file_name = _carried_name(name, meta.version)
        data = _read(metadata_dir / file_name, "a role the snapshot names")
        metadata_files[file_name] = data
        expiries[name.removesuffix(".json")] = (
            Metadata[Targets].from_bytes(data).signed.expires
        )

    first_role = min(expiries, key=lambda role: expiries[role])
    if expiries[first_role] <= now:
        raise RegistryError(
            f"{first_role} in {repo} expired on {expiries[first_role]:%Y-%m-%d}; "
            "build the repository again"
        )
    requested = now + timedelta(days=expires_days)
    expires = min(requested, expiries[first_role])
    # A bundle made right after its build is capped by the seconds between the
    # two; only a cap worth a day is reported.
    limited_by = first_role if requested - expires >= timedelta(days=1) else None

    snapshot = Metadata(
        Snapshot(
            version=online_version(current_snapshot.version, now),
            expires=expires,
            meta=dict(current_snapshot.meta),
        )
    )
    snapshot.sign(snapshot_signer)
    snapshot_bytes = to_bytes(snapshot)
    metadata_files[_carried_name(SNAPSHOT_FILE, snapshot.signed.version)] = (
        snapshot_bytes
    )
    timestamp = sign_timestamp(
        snapshot_bytes,
        snapshot.signed.version,
        timestamp_signer,
        version=online_version(current_timestamp.version, now),
        now=now,
        expires=expires,
    )
    metadata_files[TIMESTAMP_FILE] = to_bytes(timestamp)

    mtime = int(now.timestamp())
    count = 0
    out.parent.mkdir(parents=True, exist_ok=True)
    partial = out.with_name(out.name + ".part")
    try:
        with tarfile.open(partial, "w:gz") as tar:
            for name in sorted(metadata_files):
                _tar_member(
                    tar, f"{layout.METADATA_SUBDIR}/{name}", metadata_files[name], mtime
                )
                count += 1
            if targets_dir.is_dir():
                for path in sorted(targets_dir.rglob("*")):
                    if path.is_file():
                        relative = path.relative_to(repo).as_posix()
                        _tar_member(tar, relative, path.read_bytes(), mtime)
                        count += 1
        partial.replace(out)
    finally:
        partial.unlink(missing_ok=True)

    return BundleResult(
        out=out,
        snapshot_version=snapshot.signed.version,
        timestamp_version=timestamp.signed.version,
        expires=expires,
        limited_by=limited_by,
        files=count,
    )
