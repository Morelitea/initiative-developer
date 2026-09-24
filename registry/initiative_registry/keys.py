"""Role keys: generating them outside the repository, and loading them to sign."""

from __future__ import annotations

import getpass
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from securesystemslib.signer import CryptoSigner, Key, SSlibKey

from .errors import RegistryError

#: Read when a PEM key is encrypted, before falling back to a prompt.
PASSPHRASE_ENV = "REGISTRY_KEY_PASSPHRASE"

_ROLE_NAME = re.compile(r"^[a-z0-9][a-z0-9_-]{0,119}$")


@dataclass(frozen=True)
class GeneratedKey:
    private_path: Path
    public_path: Path
    keyid: str
    public: dict[str, Any]


def enclosing_repository(path: Path) -> Path | None:
    """The git working tree ``path`` is in, if any."""
    probe = path.resolve()
    while not probe.exists():
        probe = probe.parent
    for candidate in (probe, *probe.parents):
        if (candidate / ".git").exists():
            return candidate
    return None


def public_key_dict(key: Key) -> dict[str, Any]:
    """The key as a publisher record or ``.pub.json`` file carries it."""
    return {"keyid": key.keyid, **key.to_dict()}


def key_from_dict(data: Any, *, what: str) -> SSlibKey:
    """An Ed25519 public key from its JSON form, with the keyid computed from it."""
    if not isinstance(data, dict):
        raise RegistryError(f"{what}: expected a key object, got {type(data).__name__}")
    if data.get("keytype") != "ed25519" or data.get("scheme") != "ed25519":
        raise RegistryError(f"{what}: only ed25519 keys are accepted")
    keyval = data.get("keyval")
    public_hex = keyval.get("public") if isinstance(keyval, dict) else None
    try:
        public = Ed25519PublicKey.from_public_bytes(bytes.fromhex(str(public_hex)))
    except ValueError as exc:
        raise RegistryError(f"{what}: keyval.public is not an ed25519 key") from exc
    key = SSlibKey.from_crypto(public)
    stated = data.get("keyid")
    if stated is not None and stated != key.keyid:
        raise RegistryError(
            f"{what}: keyid {stated} does not match the key ({key.keyid})"
        )
    return key


def generate(
    role: str, out_dir: Path, *, passphrase: bytes | None = None
) -> GeneratedKey:
    """Write ``<role>.pem`` (private) and ``<role>.pub.json`` into ``out_dir``.

    Refuses a directory inside any git working tree, so a private key is never
    written where it could be committed, and never overwrites an existing key.
    """
    if not _ROLE_NAME.match(role):
        raise RegistryError(f"role name {role!r} must match {_ROLE_NAME.pattern}")
    repository = enclosing_repository(out_dir)
    if repository is not None:
        raise RegistryError(
            f"{out_dir} is inside the git repository at {repository}; "
            "keys are written outside every repository"
        )
    private_path = out_dir / f"{role}.pem"
    public_path = out_dir / f"{role}.pub.json"
    for path in (private_path, public_path):
        if path.exists():
            raise RegistryError(f"{path} already exists; keys are never overwritten")

    private_key = Ed25519PrivateKey.generate()
    encryption: serialization.KeySerializationEncryption = (
        serialization.BestAvailableEncryption(passphrase)
        if passphrase
        else serialization.NoEncryption()
    )
    pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=encryption,
    )
    public = SSlibKey.from_crypto(private_key.public_key())

    out_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor = os.open(private_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(pem)
    public_path.write_text(json.dumps(public_key_dict(public), indent=2) + "\n")
    return GeneratedKey(
        private_path, public_path, public.keyid, public_key_dict(public)
    )


def _passphrase(what: str) -> bytes:
    value = os.environ.get(PASSPHRASE_ENV)
    if value:
        return value.encode()
    if sys.stdin.isatty():
        return getpass.getpass(f"Passphrase for {what}: ").encode()
    raise RegistryError(f"{what} is encrypted; set {PASSPHRASE_ENV}")


def signer_from_pem(pem: bytes, *, what: str) -> CryptoSigner:
    """A signer for an Ed25519 private key in PEM form."""
    try:
        private_key = serialization.load_pem_private_key(pem, password=None)
    except TypeError:
        private_key = _load_encrypted(pem, what)
    except ValueError as exc:
        raise RegistryError(f"{what} is not a PEM private key ({exc})") from exc
    if not isinstance(private_key, Ed25519PrivateKey):
        raise RegistryError(f"{what} is not an Ed25519 key")
    return CryptoSigner(private_key)


def _load_encrypted(pem: bytes, what: str) -> Any:
    try:
        return serialization.load_pem_private_key(pem, password=_passphrase(what))
    except ValueError as exc:
        raise RegistryError(f"{what}: wrong passphrase or damaged key") from exc


def signer_from_path(path: Path) -> CryptoSigner:
    try:
        pem = path.read_bytes()
    except OSError as exc:
        raise RegistryError(f"cannot read key {path}: {exc.strerror}") from exc
    return signer_from_pem(pem, what=str(path))


def load_public_key(path: Path) -> SSlibKey:
    """A public key from a ``.pub.json`` file, or derived from a ``.pem``."""
    if path.suffix == ".pem":
        return signer_from_path(path).public_key
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError) as exc:
        raise RegistryError(f"cannot read public key {path}: {exc}") from exc
    return key_from_dict(data, what=str(path))


def resolve_signer(
    name: str,
    *,
    explicit: Path | None,
    key_dir: Path | None,
    env_var: str,
) -> CryptoSigner:
    """An online key: an explicit path, then ``<key_dir>/<name>.pem``, then the
    PEM text in ``env_var``."""
    if explicit is not None:
        return signer_from_path(explicit)
    if key_dir is not None and (key_dir / f"{name}.pem").exists():
        return signer_from_path(key_dir / f"{name}.pem")
    value = os.environ.get(env_var)
    if value:
        return signer_from_pem(value.encode(), what=f"${env_var}")
    where = f"{key_dir / (name + '.pem')} or " if key_dir is not None else ""
    raise RegistryError(f"no key for {name!r}: expected {where}${env_var}")
