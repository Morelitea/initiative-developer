"""The offline roles: ``root`` and the top-level ``targets``.

Both are signed on the owner's machine with keys that never reach CI. Only the
signed metadata is written, into ``registry/metadata/``: every root version as
``<N>.root.json`` (a client walks them in order) and the current ``targets.json``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from securesystemslib.signer import Signer, SSlibKey
from tuf.api.metadata import Metadata, Root

from . import layout
from .errors import RegistryError
from .repo import (
    TARGETS_FILE,
    load_root_chain,
    require_role_key,
    to_bytes,
    top_level_targets,
    utc_now,
)
from .sources import load_publishers


@dataclass
class OfflineResult:
    root_version: int | None
    targets_version: int | None
    written: list[Path]


def _write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def init_root(
    metadata_dir: Path,
    *,
    root_signer: Signer,
    targets_signer: Signer,
    snapshot_key: SSlibKey,
    timestamp_key: SSlibKey,
    publisher_dirs: list[Path],
    now: datetime | None = None,
) -> OfflineResult:
    """Create version 1 of ``root`` and the first ``targets``."""
    now = now or utc_now()
    if metadata_dir.is_dir() and any(metadata_dir.glob("*.root.json")):
        raise RegistryError(
            f"{metadata_dir} already holds a root; use sign-offline to change it"
        )
    publishers = load_publishers(publisher_dirs)

    root = Root(
        version=1, expires=now + layout.EXPIRY[layout.ROOT], consistent_snapshot=True
    )
    root.add_key(root_signer.public_key, layout.ROOT)
    root.add_key(targets_signer.public_key, layout.TARGETS)
    root.add_key(snapshot_key, layout.SNAPSHOT)
    root.add_key(timestamp_key, layout.TIMESTAMP)
    root_metadata = Metadata(root)
    root_metadata.sign(root_signer)

    targets_metadata = Metadata(top_level_targets(publishers, version=1, now=now))
    targets_metadata.sign(targets_signer)

    root_path = metadata_dir / "1.root.json"
    targets_path = metadata_dir / TARGETS_FILE
    _write(root_path, to_bytes(root_metadata))
    _write(targets_path, to_bytes(targets_metadata))
    return OfflineResult(1, 1, [root_path, targets_path])


def _targets_version(metadata_dir: Path) -> int:
    path = metadata_dir / TARGETS_FILE
    if not path.is_file():
        return 0
    try:
        return Metadata.from_bytes(path.read_bytes()).signed.version
    except Exception as exc:
        raise RegistryError(f"{path} is not TUF metadata: {exc}") from exc


def _replace_role_key(root: Root, role: str, key: SSlibKey) -> bool:
    """Make ``key`` the only key for ``role``. Whether anything changed."""
    if root.roles[role].keyids == [key.keyid]:
        return False
    for keyid in list(root.roles[role].keyids):
        root.revoke_key(keyid, role)
    root.add_key(key, role)
    return True


def sign_offline(
    metadata_dir: Path,
    *,
    root_signer: Signer | None = None,
    new_root_signer: Signer | None = None,
    targets_signer: Signer | None = None,
    snapshot_key: SSlibKey | None = None,
    timestamp_key: SSlibKey | None = None,
    publisher_dirs: list[Path] | None = None,
    renew_root: bool = False,
    now: datetime | None = None,
) -> OfflineResult:
    """Rotate keys, renew expiry and re-sign ``root`` and ``targets``.

    State the keys each role should have. Whatever differs from the current root
    (or ``renew_root``) makes a new root version, signed by the current root key
    and, when the root key itself rotates, by the new one as well. Giving the
    targets key re-signs ``targets`` from the publisher records.
    """
    now = now or utc_now()
    chain = load_root_chain(metadata_dir)
    current = chain[-1].metadata
    root = Metadata[Root].from_bytes(chain[-1].data).signed

    changed = renew_root
    if new_root_signer is not None:
        changed |= _replace_role_key(root, layout.ROOT, new_root_signer.public_key)
    if targets_signer is not None:
        changed |= _replace_role_key(root, layout.TARGETS, targets_signer.public_key)
    if snapshot_key is not None:
        changed |= _replace_role_key(root, layout.SNAPSHOT, snapshot_key)
    if timestamp_key is not None:
        changed |= _replace_role_key(root, layout.TIMESTAMP, timestamp_key)

    written: list[Path] = []
    new_root_version = None
    if changed:
        if root_signer is None:
            raise RegistryError(
                "changing the root needs the current root key (--root-key)"
            )
        require_role_key(current.signed, layout.ROOT, root_signer)
        root.version = current.signed.version + 1
        root.expires = now + layout.EXPIRY[layout.ROOT]
        metadata = Metadata(root)
        metadata.sign(root_signer)
        if new_root_signer is not None and new_root_signer.public_key.keyid != (
            root_signer.public_key.keyid
        ):
            metadata.sign(new_root_signer, append=True)
        current.signed.verify_delegate(
            layout.ROOT, metadata.signed_bytes, metadata.signatures
        )
        root.verify_delegate(layout.ROOT, metadata.signed_bytes, metadata.signatures)
        path = metadata_dir / f"{root.version}.root.json"
        _write(path, to_bytes(metadata))
        written.append(path)
        new_root_version = root.version

    new_targets_version = None
    if targets_signer is not None:
        require_role_key(root, layout.TARGETS, targets_signer)
        publishers = load_publishers(publisher_dirs or [layout.DEFAULT_PUBLISHERS_DIR])
        previous = _targets_version(metadata_dir)
        targets = Metadata(top_level_targets(publishers, version=previous + 1, now=now))
        targets.sign(targets_signer)
        path = metadata_dir / TARGETS_FILE
        _write(path, to_bytes(targets))
        written.append(path)
        new_targets_version = previous + 1

    if not written:
        raise RegistryError(
            "nothing to sign: give --targets-key to re-sign targets, "
            "or a key to rotate or --renew-root to re-sign root"
        )
    return OfflineResult(new_root_version, new_targets_version, written)
