"""Where things live in the built repository, and how long each role lasts."""

from __future__ import annotations

from datetime import timedelta
from pathlib import Path

#: The ``registry/`` directory of this checkout. Defaults are relative to it.
REGISTRY_DIR = Path(__file__).resolve().parents[1]
_PACKAGED_SCHEMA_DIR = Path(__file__).resolve().parent / "schema"
#: The schemas: beside the package in a checkout, inside it in a wheel.
SCHEMA_DIR = (
    _PACKAGED_SCHEMA_DIR if _PACKAGED_SCHEMA_DIR.is_dir() else REGISTRY_DIR / "schema"
)
DEFAULT_METADATA_DIR = REGISTRY_DIR / "metadata"
DEFAULT_PUBLISHERS_DIR = REGISTRY_DIR / "publishers"

ROOT = "root"
TARGETS = "targets"
SNAPSHOT = "snapshot"
TIMESTAMP = "timestamp"
TOP_LEVEL_ROLES = (ROOT, TARGETS, SNAPSHOT, TIMESTAMP)

#: How long each role's signature is good for.
EXPIRY = {
    ROOT: timedelta(days=365),
    TARGETS: timedelta(days=365),
    "publisher": timedelta(days=90),
    SNAPSHOT: timedelta(days=7),
    TIMESTAMP: timedelta(days=1),
}

#: Reserved for listings built into Initiative. Never delegated.
RESERVED_PREFIX = "core"

#: Characters a publisher prefix may use: the ``public_id`` alphabet without the
#: dot that separates the prefix from the slug.
PREFIX_CHARS = frozenset("abcdefghijklmnopqrstuvwxyz0123456789-_")
PREFIX_MAX_LENGTH = 120

#: File extensions an avatar or image may have.
IMAGE_EXTENSIONS = frozenset(
    {".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".svg"}
)

METADATA_SUBDIR = "metadata"
TARGETS_SUBDIR = "targets"


def prefix_problem(prefix: str) -> str | None:
    """Why ``prefix`` cannot be a publisher prefix, or ``None`` if it can."""
    if not prefix or len(prefix) > PREFIX_MAX_LENGTH:
        return f"publisher prefix must be 1 to {PREFIX_MAX_LENGTH} characters"
    if any(char not in PREFIX_CHARS for char in prefix):
        return f"publisher prefix {prefix!r} uses characters outside [a-z0-9_-]"
    if prefix == RESERVED_PREFIX:
        return f"the {RESERVED_PREFIX!r} prefix is reserved and never delegated"
    if prefix in TOP_LEVEL_ROLES:
        return f"{prefix!r} is the name of a top-level role"
    return None


def publisher_record_target(prefix: str) -> str:
    """The publisher's record, signed by the top-level ``targets`` role."""
    return f"publishers/{prefix}.json"


def listing_target(prefix: str, uid: str) -> str:
    return f"publishers/{prefix}/{uid}/listing.json"


def manifest_target(prefix: str, uid: str, version: str) -> str:
    return f"publishers/{prefix}/{uid}/{version}/manifest.json"


def asset_target(prefix: str, uid: str, sha256: str, extension: str) -> str:
    return f"publishers/{prefix}/{uid}/assets/{sha256}{extension}"


def delegation_paths(prefix: str) -> list[str]:
    """The target paths a publisher's delegated role may sign.

    TUF matches a delegation pattern one path segment at a time, so each depth
    of the listing layout gets its own pattern.
    """
    return [
        f"publishers/{prefix}/*/listing.json",
        f"publishers/{prefix}/*/*/manifest.json",
        f"publishers/{prefix}/*/assets/*",
    ]


def served_target_path(target_path: str, sha256: str) -> str:
    """Where a target's bytes are served under consistent snapshots."""
    directory, _, name = target_path.rpartition("/")
    return f"{directory}/{sha256}.{name}" if directory else f"{sha256}.{name}"


def publisher_key_env(prefix: str) -> str:
    """The environment variable holding a publisher's private key."""
    return "REGISTRY_PUBLISHER_KEY_" + "".join(
        char.upper() if char.isalnum() else "_" for char in prefix
    )


def role_key_env(role: str) -> str:
    """The environment variable holding an online top-level role's key."""
    return f"REGISTRY_{role.upper()}_KEY"
