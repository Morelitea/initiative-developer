"""Reading publisher records and listing sources into the targets they publish."""

from __future__ import annotations

import copy
import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any

from securesystemslib.signer import SSlibKey

from . import layout, schemas
from .errors import RegistryError
from .keys import key_from_dict


def dumps(document: Any) -> bytes:
    """How the builder writes a JSON document it generates."""
    return (json.dumps(document, indent=2, ensure_ascii=False) + "\n").encode()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@dataclass(frozen=True)
class Publisher:
    prefix: str
    record: dict[str, Any]
    #: The record file's bytes, published as ``publishers/<prefix>.json``.
    data: bytes
    key: SSlibKey
    path: Path

    @property
    def target_path(self) -> str:
        return layout.publisher_record_target(self.prefix)


@dataclass(frozen=True)
class Blob:
    """One target: its path in the repository and its bytes."""

    path: str
    data: bytes

    @property
    def sha256(self) -> str:
        return sha256(self.data)


@dataclass
class Listing:
    uid: str
    publisher: str
    public_id: str
    source: Path
    entry: dict[str, Any]
    #: Every target this listing publishes, ``listing.json`` included.
    targets: dict[str, Blob] = field(default_factory=dict)

    @property
    def priced(self) -> bool:
        return self.entry.get("price") is not None

    @property
    def reference_sectors(self) -> list[str]:
        registration = self.entry.get("registration") or {}
        return list(registration.get("reference_sectors") or [])


def _read_json(path: Path, *, what: str) -> tuple[bytes, Any]:
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise RegistryError(f"cannot read {what} {path}: {exc.strerror}") from exc
    try:
        return data, json.loads(data)
    except ValueError as exc:
        raise RegistryError(f"{what} {path} is not valid JSON: {exc}") from exc


def load_publisher(path: Path) -> Publisher:
    data, record = _read_json(path, what="publisher record")
    prefix = path.stem
    if isinstance(record, dict) and isinstance(record.get("key"), str):
        raise RegistryError(
            f"publisher record {path}: the key is still a placeholder. Run "
            f"'initiative-registry keygen --role {prefix} --out <dir outside the "
            f"repository>' and paste the {prefix}.pub.json it writes as 'key'."
        )
    schemas.validate(schemas.PUBLISHER, record, what=f"publisher record {path}")
    if record["prefix"] != prefix:
        raise RegistryError(
            f"publisher record {path} says prefix {record['prefix']!r}; "
            f"the file must be named {record['prefix']}.json"
        )
    problem = layout.prefix_problem(prefix)
    if problem:
        raise RegistryError(f"publisher record {path}: {problem}")
    key = key_from_dict(record["key"], what=f"publisher record {path}: key")
    return Publisher(prefix=prefix, record=record, data=data, key=key, path=path)


def load_publishers(directories: list[Path]) -> dict[str, Publisher]:
    publishers: dict[str, Publisher] = {}
    for directory in directories:
        if not directory.is_dir():
            raise RegistryError(f"publishers directory {directory} does not exist")
        for path in sorted(directory.glob("*.json")):
            publisher = load_publisher(path)
            if publisher.prefix in publishers:
                raise RegistryError(
                    f"publisher {publisher.prefix!r} has two records: "
                    f"{publishers[publisher.prefix].path} and {path}"
                )
            publishers[publisher.prefix] = publisher
    return publishers


def _listing_file(listing_dir: Path, relative: str, *, what: str) -> bytes:
    """The bytes of a file a listing names, which must lie inside its directory."""
    parts = PurePosixPath(relative).parts
    if PurePosixPath(relative).is_absolute() or any(
        p in ("", ".", "..") for p in parts
    ):
        raise RegistryError(
            f"{what}: {relative!r} must be a relative path inside the listing"
        )
    root = listing_dir.resolve()
    path = (listing_dir / relative).resolve()
    if not path.is_relative_to(root):
        raise RegistryError(
            f"{what}: {relative!r} leads outside the listing's directory"
        )
    if not path.is_file():
        raise RegistryError(f"{what}: {relative!r} does not exist")
    return path.read_bytes()


def _check_digest(declared: str | None, data: bytes, *, what: str) -> str:
    actual = sha256(data)
    if declared is not None and declared != actual:
        raise RegistryError(
            f"{what}: the listing says sha256 {declared} "
            f"but the file hashes to {actual}"
        )
    return actual


def _publish_asset(
    listing: Listing, asset: dict[str, Any], *, what: str
) -> dict[str, Any]:
    relative = asset["path"]
    extension = PurePosixPath(relative).suffix.lower()
    if extension not in layout.IMAGE_EXTENSIONS:
        allowed = ", ".join(sorted(layout.IMAGE_EXTENSIONS))
        raise RegistryError(f"{what}: {relative!r} is not an image ({allowed})")
    data = _listing_file(listing.source, relative, what=what)
    digest = _check_digest(asset.get("sha256"), data, what=f"{what} {relative!r}")
    target = layout.asset_target(listing.publisher, listing.uid, digest, extension)
    listing.targets[target] = Blob(target, data)
    published = {"path": f"assets/{digest}{extension}", "sha256": digest}
    if "alt" in asset:
        published["alt"] = asset["alt"]
    return published


def _document(listing: Listing, value: Any, *, what: str) -> dict[str, Any]:
    """A JSON object a version gives: inline, or a path to a file holding one."""
    if not isinstance(value, str):
        return value
    data = _listing_file(listing.source, value, what=what)
    try:
        parsed = json.loads(data)
    except ValueError as exc:
        raise RegistryError(f"{what} {value!r} is not valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise RegistryError(f"{what} {value!r} must be a JSON object")
    return parsed


def service_public_id(definition: dict[str, Any]) -> str | None:
    """The app service a kit manifest names, if it is a service app."""
    if definition.get("app_kind") != "service":
        return None
    service = definition.get("service")
    if not isinstance(service, dict):
        return None
    public_id = service.get("public_id")
    return public_id if isinstance(public_id, str) and public_id else None


def manifest_document(
    listing: Listing,
    kind: str,
    definition: dict[str, Any],
    example: dict[str, Any] | None,
) -> dict[str, Any]:
    """The manifest target a version publishes."""
    manifest: dict[str, Any] = {
        "uid": listing.uid,
        "public_id": listing.public_id,
        "kind": kind,
        "definition": definition,
    }
    if example is not None:
        manifest["example"] = example
    return manifest


def _publish_version(
    listing: Listing, version: dict[str, Any], *, kind: str, what: str
) -> dict[str, Any]:
    number = version["version"]
    definition = _document(listing, version["definition"], what=f"{what} definition")
    example = None
    if "example" in version:
        example = _document(listing, version["example"], what=f"{what} example")
    if "registration" in listing.entry:
        named = service_public_id(definition)
        if named != listing.public_id:
            raise RegistryError(
                f"{what} definition: a listing with a registration is a service "
                f"app, and its service.public_id must be {listing.public_id!r} "
                f"(it is {named!r})"
            )
    manifest = manifest_document(listing, kind, definition, example)
    schemas.validate(schemas.MANIFEST, manifest, what=f"{what} manifest")
    data = dumps(manifest)
    target = layout.manifest_target(listing.publisher, listing.uid, number)
    listing.targets[target] = Blob(target, data)
    published = {
        key: value
        for key, value in version.items()
        if key not in ("definition", "example")
    }
    published["manifest"] = f"{number}/manifest.json"
    published["sha256"] = sha256(data)
    return published


def load_listing(
    listing_dir: Path, *, publisher_dir: str, publishers: dict[str, Publisher]
) -> Listing:
    path = listing_dir / "listing.json"
    what = f"listing {path}"
    if not path.is_file():
        raise RegistryError(f"{listing_dir} has no listing.json")
    _, document = _read_json(path, what="listing")
    schemas.validate(schemas.LISTING, document, what=what)

    uid = document["uid"]
    publisher = document["publisher"]
    public_id = document["public_id"]
    if (
        publisher == layout.RESERVED_PREFIX
        or public_id.split(".", 1)[0] == layout.RESERVED_PREFIX
    ):
        raise RegistryError(
            f"{what}: the {layout.RESERVED_PREFIX!r} prefix is reserved"
        )
    if public_id.split(".", 1)[0] != publisher:
        raise RegistryError(
            f"{what}: public_id {public_id!r} must start with "
            f"its publisher {publisher!r}"
        )
    if publisher_dir != publisher:
        raise RegistryError(
            f"{what}: it is under {publisher_dir}/ but names publisher {publisher!r}"
        )
    if listing_dir.name != uid:
        raise RegistryError(f"{what}: its directory must be named after its uid {uid}")
    if publisher not in publishers:
        raise RegistryError(f"{what}: publisher {publisher!r} has no record")

    listing = Listing(
        uid=uid,
        publisher=publisher,
        public_id=public_id,
        source=listing_dir,
        entry=copy.deepcopy(document),
    )
    entry = listing.entry
    entry["avatar"] = _publish_asset(listing, document["avatar"], what=f"{what} avatar")
    if "images" in document:
        entry["images"] = [
            _publish_asset(listing, image, what=f"{what} images[{index}]")
            for index, image in enumerate(document["images"])
        ]
    seen: set[str] = set()
    versions = []
    for index, version in enumerate(document["versions"]):
        if version["version"] in seen:
            raise RegistryError(f"{what}: version {version['version']} is listed twice")
        seen.add(version["version"])
        versions.append(
            _publish_version(
                listing,
                version,
                kind=document["kind"],
                what=f"{what} versions[{index}]",
            )
        )
    entry["versions"] = versions

    schemas.validate(schemas.ENTRY, entry, what=f"{what} (as published)")
    target = layout.listing_target(publisher, uid)
    listing.targets[target] = Blob(target, dumps(entry))
    return listing


def _children(directory: Path) -> list[Path]:
    return sorted(
        child
        for child in directory.iterdir()
        if child.is_dir() and not child.name.startswith(".")
    )


def load_listings(
    directories: list[Path], publishers: dict[str, Publisher]
) -> list[Listing]:
    """Every listing in every source tree. A uid or public_id appears once."""
    listings: list[Listing] = []
    by_uid: dict[str, Listing] = {}
    by_public_id: dict[str, Listing] = {}
    for directory in directories:
        if not directory.is_dir():
            raise RegistryError(f"sources directory {directory} does not exist")
        for publisher_dir in _children(directory):
            for listing_dir in _children(publisher_dir):
                listing = load_listing(
                    listing_dir, publisher_dir=publisher_dir.name, publishers=publishers
                )
                for index, key in (
                    (by_uid, listing.uid),
                    (by_public_id, listing.public_id),
                ):
                    if key in index:
                        raise RegistryError(
                            f"{key} is used by two listings: {index[key].source} "
                            f"and {listing.source}"
                        )
                    index[key] = listing
                listings.append(listing)
    return listings
