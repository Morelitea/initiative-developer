from __future__ import annotations

import json
import stat
from pathlib import Path

import pytest

from initiative_registry import RegistryError, layout
from initiative_registry.keys import (
    PASSPHRASE_ENV,
    generate,
    key_from_dict,
    load_public_key,
    signer_from_path,
)


def test_keygen_writes_a_pair_outside_the_repository(tmp_path: Path) -> None:
    key = generate("snapshot", tmp_path / "keys")
    assert key.private_path == tmp_path / "keys" / "snapshot.pem"
    assert stat.S_IMODE(key.private_path.stat().st_mode) == 0o600
    public = json.loads(key.public_path.read_text())
    assert public["keytype"] == "ed25519"
    assert public["keyid"] == key.keyid
    assert signer_from_path(key.private_path).public_key.keyid == key.keyid
    assert load_public_key(key.public_path).keyid == key.keyid


def test_keygen_refuses_this_repository() -> None:
    with pytest.raises(RegistryError, match="inside the git repository"):
        generate("root", layout.REGISTRY_DIR / "keys")
    assert not (layout.REGISTRY_DIR / "keys").exists()


def test_keygen_refuses_any_repository(tmp_path: Path) -> None:
    (tmp_path / "project" / ".git").mkdir(parents=True)
    with pytest.raises(RegistryError, match="inside the git repository"):
        generate("root", tmp_path / "project" / "deep" / "keys")


def test_keygen_never_overwrites(tmp_path: Path) -> None:
    generate("root", tmp_path)
    with pytest.raises(RegistryError, match="already exists"):
        generate("root", tmp_path)


def test_keygen_refuses_odd_role_names(tmp_path: Path) -> None:
    with pytest.raises(RegistryError, match="role name"):
        generate("../root", tmp_path)


def test_encrypted_key_round_trip(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    key = generate("root", tmp_path, passphrase=b"correct horse")
    assert b"ENCRYPTED" in key.private_path.read_bytes()
    monkeypatch.setenv(PASSPHRASE_ENV, "correct horse")
    assert signer_from_path(key.private_path).public_key.keyid == key.keyid
    monkeypatch.setenv(PASSPHRASE_ENV, "wrong")
    with pytest.raises(RegistryError, match="wrong passphrase"):
        signer_from_path(key.private_path)


def test_public_key_keyid_must_match(tmp_path: Path) -> None:
    key = generate("root", tmp_path)
    wrong = dict(key.public, keyid="0" * 64)
    with pytest.raises(RegistryError, match="does not match the key"):
        key_from_dict(wrong, what="key")
