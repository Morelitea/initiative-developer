"""``initiative-registry``: keys, offline signing, the build, and verification."""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
from pathlib import Path

from . import layout
from .build import BUILD_TARGETS, build, refresh_timestamp
from .errors import RegistryError
from .keys import (
    PASSPHRASE_ENV,
    generate,
    load_public_key,
    resolve_signer,
    signer_from_path,
)
from .offline import init_root, sign_offline
from .verify import verify


def _path(value: str) -> Path:
    return Path(value).expanduser()


def _keygen(args: argparse.Namespace) -> None:
    passphrase = None
    if args.passphrase:
        passphrase = (os.environ.get(PASSPHRASE_ENV) or "").encode()
        if not passphrase:
            first = getpass.getpass("Passphrase for the new key: ")
            if first != getpass.getpass("Again: "):
                raise RegistryError("the passphrases differ")
            passphrase = first.encode()
    key = generate(args.role, args.out, passphrase=passphrase)
    print(f"wrote {key.private_path} (private: keep it out of every repository)")
    print(f"wrote {key.public_path}")
    print(f"keyid {key.keyid}")
    print(json.dumps(key.public, indent=2))


def _init_root(args: argparse.Namespace) -> None:
    result = init_root(
        args.metadata,
        root_signer=signer_from_path(args.root_key),
        targets_signer=signer_from_path(args.targets_key),
        snapshot_key=load_public_key(args.snapshot_pub),
        timestamp_key=load_public_key(args.timestamp_pub),
        publisher_dirs=args.publishers or [layout.DEFAULT_PUBLISHERS_DIR],
    )
    for path in result.written:
        print(f"wrote {path}")


def _optional_signer(path: Path | None):
    return signer_from_path(path) if path is not None else None


def _optional_public(path: Path | None):
    return load_public_key(path) if path is not None else None


def _sign_offline(args: argparse.Namespace) -> None:
    result = sign_offline(
        args.metadata,
        root_signer=_optional_signer(args.root_key),
        new_root_signer=_optional_signer(args.new_root_key),
        targets_signer=_optional_signer(args.targets_key),
        snapshot_key=_optional_public(args.snapshot_pub),
        timestamp_key=_optional_public(args.timestamp_pub),
        publisher_dirs=args.publishers,
        renew_root=args.renew_root,
    )
    for path in result.written:
        print(f"wrote {path}")


def _publisher_key_flags(values: list[str]) -> dict[str, Path]:
    keys = {}
    for value in values:
        prefix, sep, path = value.partition("=")
        if not sep or not prefix or not path:
            raise RegistryError(f"--publisher-key takes PREFIX=PATH, got {value!r}")
        keys[prefix] = _path(path)
    return keys


def _build(args: argparse.Namespace) -> None:
    explicit = {
        layout.SNAPSHOT: args.snapshot_key,
        layout.TIMESTAMP: args.timestamp_key,
        **_publisher_key_flags(args.publisher_key),
    }

    def keys(name: str):
        env = (
            layout.role_key_env(name)
            if name in layout.TOP_LEVEL_ROLES
            else layout.publisher_key_env(name)
        )
        return resolve_signer(
            name, explicit=explicit.get(name), key_dir=args.keys, env_var=env
        )

    result = build(
        target=args.target,
        sources=args.sources,
        out=args.out,
        keys=keys,
        metadata_dir=args.metadata,
        publisher_dirs=args.publishers or [layout.DEFAULT_PUBLISHERS_DIR],
    )
    print(
        f"built the {args.target} repository in {result.out}: "
        f"{len(result.listings)} listings, root v{result.root_version}, "
        f"targets v{result.targets_version}, snapshot and timestamp "
        f"v{result.snapshot_version}"
    )


def _refresh_timestamp(args: argparse.Namespace) -> None:
    signer = resolve_signer(
        layout.TIMESTAMP,
        explicit=args.timestamp_key,
        key_dir=args.keys,
        env_var=layout.role_key_env(layout.TIMESTAMP),
    )
    timestamp = refresh_timestamp(args.repo, signer)
    print(
        f"re-signed timestamp v{timestamp.signed.version}, "
        f"expires {timestamp.signed.expires:%Y-%m-%dT%H:%M:%SZ}"
    )


def _verify(args: argparse.Namespace) -> None:
    result = verify(args.repo, args.root, target=args.target)
    print(
        f"verified root v{result.root_version}, timestamp v{result.timestamp_version}, "
        f"snapshot v{result.snapshot_version}, targets v{result.targets_version}"
    )
    for prefix, version in sorted(result.publishers.items()):
        print(f"  publisher {prefix}: v{version}")
    for listing in result.listings:
        print(f"  {listing}")
    print(f"{len(result.listings)} listings, {result.files} files, all verified")


def parser() -> argparse.ArgumentParser:
    top = argparse.ArgumentParser(
        prog="initiative-registry",
        description="Build, sign and verify the TUF repository of Initiative apps "
        "and content.",
    )
    commands = top.add_subparsers(dest="command", required=True)

    keygen = commands.add_parser(
        "keygen", help="generate an Ed25519 key pair outside the repository"
    )
    keygen.add_argument(
        "--role",
        required=True,
        help="root, targets, snapshot, timestamp, or a publisher prefix",
    )
    keygen.add_argument(
        "--out",
        required=True,
        type=_path,
        help="directory for <role>.pem and <role>.pub.json",
    )
    keygen.add_argument(
        "--passphrase",
        action="store_true",
        help=f"encrypt the private key (prompts, or reads ${PASSPHRASE_ENV})",
    )
    keygen.set_defaults(run=_keygen)

    metadata_help = "the committed signed metadata (default: registry/metadata)"
    publishers_help = "a directory of publisher records (default: registry/publishers)"

    init = commands.add_parser("init-root", help="create root v1 and the first targets")
    init.add_argument(
        "--metadata",
        type=_path,
        default=layout.DEFAULT_METADATA_DIR,
        help=metadata_help,
    )
    init.add_argument("--root-key", type=_path, required=True)
    init.add_argument("--targets-key", type=_path, required=True)
    init.add_argument(
        "--snapshot-pub", type=_path, required=True, help="the snapshot key's .pub.json"
    )
    init.add_argument(
        "--timestamp-pub",
        type=_path,
        required=True,
        help="the timestamp key's .pub.json",
    )
    init.add_argument("--publishers", type=_path, action="append", help=publishers_help)
    init.set_defaults(run=_init_root)

    offline = commands.add_parser(
        "sign-offline", help="rotate keys, renew, and re-sign root and targets"
    )
    offline.add_argument(
        "--metadata",
        type=_path,
        default=layout.DEFAULT_METADATA_DIR,
        help=metadata_help,
    )
    offline.add_argument(
        "--root-key",
        type=_path,
        help="the current root key, needed for any root change",
    )
    offline.add_argument(
        "--new-root-key", type=_path, help="rotate the root key to this one"
    )
    offline.add_argument(
        "--targets-key",
        type=_path,
        help="re-sign targets from the publisher records with this key "
        "(rotating root to it if it is new)",
    )
    offline.add_argument("--snapshot-pub", type=_path, help="rotate the snapshot key")
    offline.add_argument("--timestamp-pub", type=_path, help="rotate the timestamp key")
    offline.add_argument(
        "--renew-root", action="store_true", help="re-sign root with a fresh expiry"
    )
    offline.add_argument(
        "--publishers", type=_path, action="append", help=publishers_help
    )
    offline.set_defaults(run=_sign_offline)

    online_keys = (
        "Online keys come from --snapshot-key/--timestamp-key/--publisher-key, then "
        "<--keys>/<name>.pem, then the PEM text in REGISTRY_SNAPSHOT_KEY, "
        "REGISTRY_TIMESTAMP_KEY and REGISTRY_PUBLISHER_KEY_<PREFIX>."
    )
    run = commands.add_parser(
        "build", help="build and sign a repository", epilog=online_keys
    )
    run.add_argument(
        "--target",
        required=True,
        choices=BUILD_TARGETS,
        help="public excludes priced and sectored listings, and refuses "
        "input that has one",
    )
    run.add_argument(
        "--sources",
        type=_path,
        action="append",
        required=True,
        help="a source tree; repeat to add more",
    )
    run.add_argument(
        "--out", type=_path, required=True, help="an empty output directory"
    )
    run.add_argument(
        "--metadata",
        type=_path,
        default=layout.DEFAULT_METADATA_DIR,
        help=metadata_help,
    )
    run.add_argument("--publishers", type=_path, action="append", help=publishers_help)
    run.add_argument("--keys", type=_path, help="a directory of <name>.pem online keys")
    run.add_argument("--snapshot-key", type=_path)
    run.add_argument("--timestamp-key", type=_path)
    run.add_argument(
        "--publisher-key", action="append", default=[], metavar="PREFIX=PATH"
    )
    run.set_defaults(run=_build)

    refresh = commands.add_parser(
        "refresh-timestamp", help="re-sign timestamp over the built repository"
    )
    refresh.add_argument("--repo", type=_path, required=True)
    refresh.add_argument("--keys", type=_path)
    refresh.add_argument("--timestamp-key", type=_path)
    refresh.set_defaults(run=_refresh_timestamp)

    check = commands.add_parser("verify", help="consume a repository with ngclient")
    check.add_argument(
        "--repo", required=True, help="a built directory or an http(s) URL"
    )
    check.add_argument(
        "--root", type=_path, required=True, help="the trusted root.json"
    )
    check.add_argument(
        "--target",
        choices=BUILD_TARGETS,
        help="also hold every listing to this target's rule",
    )
    check.set_defaults(run=_verify)
    return top


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        args.run(args)
    except RegistryError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0
