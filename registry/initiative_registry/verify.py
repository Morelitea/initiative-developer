"""Consume a built repository the way a client does, with python-tuf's ngclient.

Starting from a trusted root, the updater walks the root chain, then timestamp,
snapshot and targets. Each publisher's delegated role is loaded through its
delegation, every ``listing.json`` it signs is downloaded and checked, and so is
every file the listing names.
"""

from __future__ import annotations

import json
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote, urlparse

from tuf.api import exceptions
from tuf.api.metadata import DelegatedRole, Metadata, TargetFile, Targets
from tuf.ngclient import Updater
from tuf.ngclient.fetcher import FetcherInterface

from . import layout, schemas
from .build import PUBLIC
from .errors import RegistryError
from .sources import service_public_id, sha256

#: A uid no listing can have: it probes a delegation without naming a target.
_PROBE_UID = "_"


class DirectoryFetcher(FetcherInterface):
    """Serves ``file://`` URLs from disk, answering 404 for a missing file."""

    def _fetch(self, url: str) -> Iterator[bytes]:
        path = Path(unquote(urlparse(url).path))
        try:
            data = path.read_bytes()
        except FileNotFoundError:
            raise exceptions.DownloadHTTPError(f"{path} not found", 404) from None
        yield data


def _base_urls(repo: str) -> tuple[str, str, FetcherInterface | None]:
    if repo.startswith(("http://", "https://")):
        base = repo.rstrip("/")
        return f"{base}/metadata/", f"{base}/targets/", None
    root = Path(repo).resolve()
    if not (root / layout.METADATA_SUBDIR).is_dir():
        raise RegistryError(f"{root} has no metadata/ directory")
    metadata = (root / layout.METADATA_SUBDIR).as_uri() + "/"
    targets = (root / layout.TARGETS_SUBDIR).as_uri() + "/"
    return metadata, targets, DirectoryFetcher()


@contextmanager
def open_updater(
    repo: str | Path, trusted_root: Path
) -> Iterator[tuple[Updater, Path]]:
    """An updater for ``repo`` (a directory or an http(s) URL) that trusts
    ``trusted_root``, with its metadata cache in a temporary directory."""
    metadata_url, targets_url, fetcher = _base_urls(str(repo))
    with tempfile.TemporaryDirectory(prefix="initiative-registry-") as scratch:
        work = Path(scratch)
        (work / "metadata").mkdir()
        (work / "targets").mkdir()
        updater = Updater(
            metadata_dir=str(work / "metadata"),
            metadata_base_url=metadata_url,
            target_dir=str(work / "targets"),
            target_base_url=targets_url,
            fetcher=fetcher,
            bootstrap=trusted_root.read_bytes(),
        )
        yield updater, work


@dataclass
class VerifyResult:
    root_version: int = 0
    timestamp_version: int = 0
    snapshot_version: int = 0
    targets_version: int = 0
    publishers: dict[str, int] = field(default_factory=dict)
    listings: list[str] = field(default_factory=list)
    files: int = 0


def _download(
    updater: Updater, work: Path, path: str, *, signer: str
) -> tuple[TargetFile, bytes]:
    info = updater.get_targetinfo(path)
    if info is None:
        raise RegistryError(
            f"{path}, signed by {signer!r}, is not a target a client can reach"
        )
    local = work / "downloads" / sha256(path.encode())
    local.parent.mkdir(exist_ok=True)
    updater.download_target(info, filepath=str(local))
    return info, local.read_bytes()


def _persisted_role(work: Path, name: str) -> Metadata[Targets]:
    """The copy of a role the updater verified and kept."""
    return Metadata[Targets].from_file(str(work / "metadata" / f"{name}.json"))


def _check_entry(
    updater: Updater,
    work: Path,
    *,
    prefix: str,
    path: str,
    target: str | None,
) -> int:
    """Download a listing and every file it names. The number of files."""
    _, data = _download(updater, work, path, signer=prefix)
    try:
        entry = json.loads(data)
    except ValueError as exc:
        raise RegistryError(f"{path} is not valid JSON: {exc}") from exc
    schemas.validate(schemas.ENTRY, entry, what=path)
    uid = path.split("/")[2]
    if entry["uid"] != uid:
        raise RegistryError(f"{path} holds uid {entry['uid']}")
    if entry["publisher"] != prefix or entry["public_id"].split(".", 1)[0] != prefix:
        raise RegistryError(
            f"{path} is signed by {prefix!r} but names another publisher"
        )
    if target == PUBLIC and (
        entry.get("price") is not None
        or (entry.get("registration") or {}).get("reference_sectors")
    ):
        raise RegistryError(
            f"{path} is priced or sectored, which the public target excludes"
        )

    base = f"publishers/{prefix}/{uid}/"
    named = [entry["avatar"], *entry.get("images", [])]
    files = [(base + item["path"], item["sha256"]) for item in named]
    manifests = {base + v["manifest"] for v in entry["versions"]}
    files += [(base + v["manifest"], v["sha256"]) for v in entry["versions"]]
    for file_path, expected in files:
        _, content = _download(updater, work, file_path, signer=prefix)
        if sha256(content) != expected:
            raise RegistryError(
                f"{file_path} does not match the sha256 {path} gives it"
            )
        if file_path in manifests:
            _check_manifest(file_path, content, entry)
    return 1 + len(files)


def _check_manifest(path: str, data: bytes, entry: dict) -> None:
    """A version's manifest names its listing and carries its definition."""
    try:
        manifest = json.loads(data)
    except ValueError as exc:
        raise RegistryError(f"{path} is not valid JSON: {exc}") from exc
    schemas.validate(schemas.MANIFEST, manifest, what=path)
    for key in ("uid", "public_id", "kind"):
        if manifest[key] != entry[key]:
            raise RegistryError(f"{path} names a different {key}")
    if "registration" in entry and (
        service_public_id(manifest["definition"]) != entry["public_id"]
    ):
        raise RegistryError(
            f"{path}: its definition is not the service app {entry['public_id']!r}"
        )


def verify(
    repo: str | Path, trusted_root: Path, *, target: str | None = None
) -> VerifyResult:
    """Refresh from ``trusted_root`` and walk every listing. Raises on any failure."""
    result = VerifyResult()
    try:
        with open_updater(repo, trusted_root) as (updater, work):
            updater.refresh()
            top = _persisted_role(work, layout.TARGETS)
            result.root_version = Metadata.from_file(
                str(work / "metadata" / "root.json")
            ).signed.version
            result.timestamp_version = Metadata.from_file(
                str(work / "metadata" / "timestamp.json")
            ).signed.version
            result.snapshot_version = Metadata.from_file(
                str(work / "metadata" / "snapshot.json")
            ).signed.version
            result.targets_version = top.signed.version

            delegations = top.signed.delegations
            roles: dict[str, DelegatedRole] = (
                dict(delegations.roles) if delegations and delegations.roles else {}
            )
            if layout.RESERVED_PREFIX in roles:
                raise RegistryError(f"targets delegates {layout.RESERVED_PREFIX!r}")
            for prefix, role in roles.items():
                if role.paths != layout.delegation_paths(prefix):
                    raise RegistryError(
                        f"the delegation to {prefix!r} covers other paths"
                    )
                _, record_bytes = _download(
                    updater,
                    work,
                    layout.publisher_record_target(prefix),
                    signer="targets",
                )
                record = json.loads(record_bytes)
                schemas.validate(
                    schemas.PUBLISHER, record, what=f"publisher record {prefix}"
                )
                if record["prefix"] != prefix:
                    raise RegistryError(
                        f"publisher record {prefix} names {record['prefix']!r}"
                    )

                # Loading the role goes through its delegation from targets.
                updater.get_targetinfo(layout.listing_target(prefix, _PROBE_UID))
                delegated = _persisted_role(work, prefix)
                result.publishers[prefix] = delegated.signed.version
                for path in sorted(delegated.signed.targets):
                    if not role.is_delegated_path(path):
                        raise RegistryError(
                            f"{prefix!r} signs {path}, which is outside its delegation"
                        )
                    if path.endswith("/listing.json"):
                        result.files += _check_entry(
                            updater, work, prefix=prefix, path=path, target=target
                        )
                        result.listings.append(path)
    except exceptions.ExpiredMetadataError as exc:
        raise RegistryError(f"expired metadata: {exc}") from exc
    except exceptions.RepositoryError as exc:
        raise RegistryError(f"the repository failed verification: {exc}") from exc
    except exceptions.DownloadError as exc:
        raise RegistryError(f"a file could not be fetched: {exc}") from exc
    return result
