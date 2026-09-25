"""The commands end to end, as CI runs them: keys by path and by environment."""

from __future__ import annotations

import json
import shutil
import tarfile
from pathlib import Path

import pytest

from initiative_registry import layout
from initiative_registry.cli import main

from .conftest import FIXTURES, write_publisher


def test_commands_end_to_end(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    keys = tmp_path / "keys"
    for role in ("root", "targets", "snapshot", "timestamp", "acme", "other"):
        assert main(["keygen", "--role", role, "--out", str(keys)]) == 0
    publishers = tmp_path / "publishers"
    publishers.mkdir()
    for prefix in ("acme", "other"):
        write_publisher(publishers, prefix, keys)
    metadata = tmp_path / "metadata"

    assert (
        main(
            [
                "init-root",
                "--metadata",
                str(metadata),
                "--root-key",
                str(keys / "root.pem"),
                "--targets-key",
                str(keys / "targets.pem"),
                "--snapshot-pub",
                str(keys / "snapshot.pub.json"),
                "--timestamp-pub",
                str(keys / "timestamp.pub.json"),
                "--publishers",
                str(publishers),
            ]
        )
        == 0
    )

    for name, variable in (
        ("snapshot", "REGISTRY_SNAPSHOT_KEY"),
        ("timestamp", "REGISTRY_TIMESTAMP_KEY"),
        ("acme", "REGISTRY_PUBLISHER_KEY_ACME"),
    ):
        monkeypatch.setenv(variable, (keys / f"{name}.pem").read_text())
    sources = tmp_path / "sources"
    shutil.copytree(FIXTURES / "sources", sources)
    out = tmp_path / "site" / "public"
    assert (
        main(
            [
                "build",
                "--target",
                "public",
                "--sources",
                str(sources),
                "--metadata",
                str(metadata),
                "--publishers",
                str(publishers),
                "--publisher-key",
                f"other={keys / 'other.pem'}",
                "--out",
                str(out),
            ]
        )
        == 0
    )
    assert "2 listings" in capsys.readouterr().out

    root = str(metadata / "1.root.json")
    assert (
        main(["verify", "--repo", str(out), "--root", root, "--target", "public"]) == 0
    )
    assert "2 listings, 7 files, all verified" in capsys.readouterr().out

    before = json.loads((out / "metadata" / "timestamp.json").read_text())["signed"][
        "version"
    ]
    assert main(["refresh-timestamp", "--repo", str(out)]) == 0
    after = json.loads((out / "metadata" / "timestamp.json").read_text())["signed"][
        "version"
    ]
    assert after > before
    assert main(["verify", "--repo", str(out), "--root", root]) == 0
    capsys.readouterr()

    bundle = tmp_path / "bundle.tar.gz"
    assert main(["export-bundle", "--repo", str(out), "--out", str(bundle)]) == 0
    assert f"wrote {bundle}" in capsys.readouterr().out

    unpacked = tmp_path / "unpacked"
    with tarfile.open(bundle) as tar:
        tar.extractall(unpacked, filter="data")
    assert main(["verify", "--repo", str(unpacked), "--root", root]) == 0

    long = tmp_path / "long.tar.gz"
    args = ["export-bundle", "--repo", str(out), "--out", str(long)]
    with pytest.raises(SystemExit):
        main([*args, "--expires-days", "366"])
    assert main([*args, "--expires-days", "365"]) == 0
    assert "when acme does, not in 365 days" in capsys.readouterr().err


def test_errors_are_reported_not_raised(tmp_path: Path, capsys) -> None:
    assert (
        main(["keygen", "--role", "root", "--out", str(layout.REGISTRY_DIR / "k")]) == 1
    )
    assert "inside the git repository" in capsys.readouterr().err


def test_missing_online_key_names_the_variable(
    tmp_path: Path, monkeypatch, capsys
) -> None:
    monkeypatch.delenv("REGISTRY_SNAPSHOT_KEY", raising=False)
    keys = tmp_path / "keys"
    for role in ("root", "targets", "snapshot", "timestamp", "acme", "other"):
        main(["keygen", "--role", role, "--out", str(keys)])
    publishers = tmp_path / "publishers"
    publishers.mkdir()
    for prefix in ("acme", "other"):
        write_publisher(publishers, prefix, keys)
    metadata = tmp_path / "metadata"
    main(
        [
            "init-root",
            "--metadata",
            str(metadata),
            "--root-key",
            str(keys / "root.pem"),
            "--targets-key",
            str(keys / "targets.pem"),
            "--snapshot-pub",
            str(keys / "snapshot.pub.json"),
            "--timestamp-pub",
            str(keys / "timestamp.pub.json"),
            "--publishers",
            str(publishers),
        ]
    )
    capsys.readouterr()
    assert (
        main(
            [
                "build",
                "--target",
                "public",
                "--sources",
                str(FIXTURES / "sources"),
                "--metadata",
                str(metadata),
                "--publishers",
                str(publishers),
                "--out",
                str(tmp_path / "out"),
            ]
        )
        == 1
    )
    assert "$REGISTRY_SNAPSHOT_KEY" in capsys.readouterr().err
