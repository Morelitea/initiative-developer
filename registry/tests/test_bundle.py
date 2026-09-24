"""The offline bundle: a built repository with its own long-lived snapshot and
timestamp, read by the same client as the published one."""

from __future__ import annotations

import hashlib
import tarfile
from datetime import timedelta
from pathlib import Path

import pytest
from tuf.api.metadata import Metadata, Timestamp

from initiative_registry import RegistryError, layout
from initiative_registry.bundle import export_bundle
from initiative_registry.repo import utc_now
from initiative_registry.verify import verify

from .conftest import World


def _export(world: World, repo: Path, name: str = "bundle.tar.gz", **kwargs):
    return export_bundle(
        repo,
        world.root / name,
        snapshot_signer=world.signer("snapshot"),
        timestamp_signer=world.signer("timestamp"),
        **kwargs,
    )


def _unpack(bundle: Path, into: Path) -> Path:
    with tarfile.open(bundle) as tar:
        tar.extractall(into, filter="data")
    return into


def _tree(directory: Path) -> dict[str, str]:
    return {
        path.relative_to(directory).as_posix(): hashlib.sha256(
            path.read_bytes()
        ).hexdigest()
        for path in sorted(directory.rglob("*"))
        if path.is_file()
    }


def test_bundle_verifies_30_days_after_the_build(world: World) -> None:
    built_at = utc_now() - timedelta(days=30)
    result = world.build(now=built_at)
    bundle = _export(world, result.out, now=built_at)

    # The published repository has expired by now: its timestamp lasts a day.
    timestamp = Metadata[Timestamp].from_file(
        str(result.out / "metadata" / "timestamp.json")
    )
    assert timestamp.signed.expires < utc_now()
    with pytest.raises(RegistryError, match="expired"):
        verify(result.out, world.trusted_root)

    unpacked = _unpack(bundle.out, world.root / "unpacked")
    checked = verify(unpacked, world.trusted_root, target="public")
    assert checked.snapshot_version == bundle.snapshot_version
    assert checked.timestamp_version == bundle.timestamp_version
    assert len(checked.listings) == len(result.listings)


def test_bundle_takes_the_next_versions(world: World) -> None:
    now = utc_now()
    result = world.build(now=now)
    bundle = _export(world, result.out, now=now)
    assert bundle.snapshot_version == result.snapshot_version + 1
    assert bundle.timestamp_version == result.timestamp_version + 1
    assert bundle.expires == now + timedelta(days=90)
    assert bundle.limited_by is None


def test_the_published_repository_is_untouched(world: World) -> None:
    result = world.build()
    before = _tree(result.out)
    _export(world, result.out)
    assert _tree(result.out) == before


def test_bundle_holds_metadata_and_targets_only(world: World) -> None:
    result = world.build()
    bundle = _export(world, result.out)
    with tarfile.open(bundle.out) as tar:
        names = tar.getnames()
    assert all(name.startswith(("metadata/", "targets/")) for name in names)
    assert f"metadata/{bundle.snapshot_version}.snapshot.json" in names
    assert f"metadata/{result.snapshot_version}.snapshot.json" not in names
    targets = {f"targets/{path}" for path in _tree(result.out / layout.TARGETS_SUBDIR)}
    assert targets <= set(names)


def test_bundle_never_outlasts_the_publisher_roles(world: World) -> None:
    """Publisher roles last 90 days from the build; a longer request is capped
    there rather than signing a timestamp the client could not use."""
    now = utc_now()
    result = world.build(now=now)
    bundle = _export(world, result.out, expires_days=365, now=now)
    assert bundle.expires == now + layout.EXPIRY["publisher"]
    assert bundle.limited_by in {"acme", "other"}

    unpacked = _unpack(bundle.out, world.root / "unpacked")
    timestamp = Metadata[Timestamp].from_file(
        str(unpacked / "metadata" / "timestamp.json")
    )
    assert timestamp.signed.expires == bundle.expires
    verify(unpacked, world.trusted_root)


def test_bundle_is_capped_by_how_long_the_build_has_left(world: World) -> None:
    built_at = utc_now() - timedelta(days=60)
    result = world.build(now=built_at)
    bundle = _export(world, result.out)
    assert bundle.expires == built_at + layout.EXPIRY["publisher"]
    assert bundle.limited_by is not None


def test_bundle_from_an_expired_build_is_refused(world: World) -> None:
    result = world.build(now=utc_now() - timedelta(days=91))
    with pytest.raises(RegistryError, match="expired on"):
        _export(world, result.out)


@pytest.mark.parametrize("days", [0, 366])
def test_expiry_out_of_range_is_refused(world: World, days: int) -> None:
    result = world.build()
    with pytest.raises(RegistryError, match="1 to 365"):
        _export(world, result.out, expires_days=days)


def test_bundle_needs_the_online_keys(world: World) -> None:
    result = world.build()
    with pytest.raises(RegistryError, match="not the one root names for snapshot"):
        export_bundle(
            result.out,
            world.root / "bundle.tar.gz",
            snapshot_signer=world.signer("timestamp"),
            timestamp_signer=world.signer("timestamp"),
        )


def test_bundle_is_never_written_into_the_repository(world: World) -> None:
    result = world.build()
    with pytest.raises(RegistryError, match="is inside"):
        export_bundle(
            result.out,
            result.out / "bundle.tar.gz",
            snapshot_signer=world.signer("snapshot"),
            timestamp_signer=world.signer("timestamp"),
        )


def test_existing_bundle_is_not_overwritten(world: World) -> None:
    result = world.build()
    (world.root / "bundle.tar.gz").write_text("x")
    with pytest.raises(RegistryError, match="already exists"):
        _export(world, result.out)
