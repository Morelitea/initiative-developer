from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path

import pytest
from tuf.api.metadata import Metadata, Targets

from initiative_registry import RegistryError, layout
from initiative_registry.keys import generate, signer_from_path
from initiative_registry.offline import init_root, sign_offline
from initiative_registry.repo import (
    TARGETS_FILE,
    load_root_chain,
    top_level_targets,
    utc_now,
)
from initiative_registry.sources import load_publisher, load_publishers
from initiative_registry.verify import verify

from .conftest import World, write_publisher


def test_init_root_refuses_an_existing_root(world: World) -> None:
    with pytest.raises(RegistryError, match="already holds a root"):
        init_root(
            world.metadata,
            root_signer=world.signer("root"),
            targets_signer=world.signer("targets"),
            snapshot_key=world.signer("snapshot").public_key,
            timestamp_key=world.signer("timestamp").public_key,
            publisher_dirs=[world.publishers],
        )


def test_init_root_writes_only_signed_metadata(world: World) -> None:
    assert sorted(p.name for p in world.metadata.iterdir()) == [
        "1.root.json",
        "targets.json",
    ]
    root = json.loads((world.metadata / "1.root.json").read_text())
    assert root["signed"]["consistent_snapshot"] is True
    assert {r["threshold"] for r in root["signed"]["roles"].values()} == {1}
    for text in (p.read_text() for p in world.metadata.iterdir()):
        assert "PRIVATE KEY" not in text


def test_root_rotation_is_followed_by_a_client(world: World) -> None:
    generate("root2", world.keys)
    generate("snapshot2", world.keys)
    result = sign_offline(
        world.metadata,
        root_signer=world.signer("root"),
        new_root_signer=world.signer("root2"),
        snapshot_key=world.signer("snapshot2").public_key,
    )
    assert result.root_version == 2
    assert result.targets_version is None
    (world.keys / "snapshot2.pem").rename(world.keys / "snapshot.pem.new")
    (world.keys / "snapshot.pem").unlink()
    (world.keys / "snapshot.pem.new").rename(world.keys / "snapshot.pem")

    built = world.build()
    assert built.root_version == 2
    checked = verify(built.out, world.trusted_root)
    assert checked.root_version == 2


def test_rotated_root_needs_the_old_key(world: World) -> None:
    generate("root2", world.keys)
    with pytest.raises(RegistryError, match="not the one root names for root"):
        sign_offline(
            world.metadata,
            root_signer=world.signer("root2"),
            new_root_signer=world.signer("root2"),
        )


def test_adding_a_publisher_re_signs_targets(world: World) -> None:
    generate("third", world.keys)
    write_publisher(world.publishers, "third", world.keys)
    with pytest.raises(RegistryError, match="not delegated"):
        world.build("before")

    result = sign_offline(
        world.metadata,
        targets_signer=world.signer("targets"),
        publisher_dirs=[world.publishers],
    )
    assert result.targets_version == 2
    assert result.root_version is None
    checked = verify(world.build("after").out, world.trusted_root)
    assert "third" in checked.publishers


def test_targets_key_rotation(world: World) -> None:
    generate("targets2", world.keys)
    result = sign_offline(
        world.metadata,
        root_signer=world.signer("root"),
        targets_signer=world.signer("targets2"),
        publisher_dirs=[world.publishers],
    )
    assert (result.root_version, result.targets_version) == (2, 2)
    verify(world.build().out, world.trusted_root)


def test_nothing_to_sign(world: World) -> None:
    with pytest.raises(RegistryError, match="nothing to sign"):
        sign_offline(world.metadata)


def test_placeholder_key_is_explained(tmp_path: Path) -> None:
    record = json.loads(
        (layout.DEFAULT_PUBLISHERS_DIR / "beyonders-studio.json").read_text()
    )
    record["key"] = "PLACEHOLDER: paste the keygen output here"
    path = tmp_path / "beyonders-studio.json"
    path.write_text(json.dumps(record))
    with pytest.raises(RegistryError, match="still a placeholder"):
        load_publisher(path)


def test_committed_record_is_valid() -> None:
    assert (
        load_publisher(layout.DEFAULT_PUBLISHERS_DIR / "beyonders-studio.json").prefix
        == "beyonders-studio"
    )


def test_committed_targets_delegates_the_committed_publishers() -> None:
    # The signed targets a client fetches, checked from the root it ships with,
    # must delegate exactly the records in publishers/: a renamed or added
    # publisher needs targets re-signed before the build can serve it.
    root = load_root_chain(layout.DEFAULT_METADATA_DIR)[-1].metadata.signed
    data = (layout.DEFAULT_METADATA_DIR / TARGETS_FILE).read_bytes()
    signed = Metadata[Targets].from_bytes(data)
    root.verify_delegate(layout.TARGETS, signed.signed_bytes, signed.signatures)
    expected = top_level_targets(
        load_publishers([layout.DEFAULT_PUBLISHERS_DIR]),
        version=signed.signed.version,
        now=utc_now(),
    )
    assert signed.signed.delegations == expected.delegations
    assert signed.signed.targets == expected.targets


def test_seed_record_is_otherwise_valid(tmp_path: Path) -> None:
    generate("beyonders-studio", tmp_path / "keys")
    record = json.loads(
        (layout.DEFAULT_PUBLISHERS_DIR / "beyonders-studio.json").read_text()
    )
    record["key"] = json.loads(
        (tmp_path / "keys" / "beyonders-studio.pub.json").read_text()
    )
    path = tmp_path / "beyonders-studio.json"
    path.write_text(json.dumps(record))
    publisher = load_publisher(path)
    assert publisher.prefix == "beyonders-studio"
    assert (
        publisher.key.keyid
        == signer_from_path(tmp_path / "keys" / "beyonders-studio.pem").public_key.keyid
    )


def test_build_warns_before_offline_metadata_expires(world: World, capsys) -> None:
    sign_offline(
        world.metadata,
        targets_signer=world.signer("targets"),
        publisher_dirs=[world.publishers],
        now=utc_now() - timedelta(days=340),
    )
    world.build()
    assert "targets.json expires in 2" in capsys.readouterr().err


def test_build_refuses_expired_offline_metadata(world: World) -> None:
    sign_offline(
        world.metadata,
        targets_signer=world.signer("targets"),
        publisher_dirs=[world.publishers],
        now=utc_now() - timedelta(days=366),
    )
    with pytest.raises(RegistryError, match=r"targets\.json expired"):
        world.build()
