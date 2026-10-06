from __future__ import annotations

import json
import shutil
from datetime import timedelta

import pytest
from tuf.api.metadata import TargetFile

from initiative_registry import RegistryError, layout
from initiative_registry.build import refresh_timestamp
from initiative_registry.repo import utc_now
from initiative_registry.sources import sha256
from initiative_registry.verify import open_updater, verify

from .conftest import World, resign_role

PLUGIN = "0ACME000000001"
DASHBOARD = "0ACME000000002"


def test_build_then_verify_round_trip(world: World) -> None:
    result = world.build()
    assert sorted(listing.uid for listing in result.listings) == [PLUGIN, DASHBOARD]

    checked = verify(result.out, world.trusted_root, target="public")
    assert checked.listings == [
        f"publishers/acme/{PLUGIN}/listing.json",
        f"publishers/acme/{DASHBOARD}/listing.json",
    ]
    assert set(checked.publishers) == {"acme", "other"}
    assert checked.root_version == 1
    assert checked.snapshot_version == result.snapshot_version
    # Two listings: each listing.json, three files for the plug-in, one for the
    # dashboard.
    assert checked.files == 2 + 3 + 2


def test_repository_layout(world: World) -> None:
    result = world.build()
    metadata = sorted(p.name for p in (result.out / "metadata").iterdir())
    version = result.snapshot_version
    assert metadata == sorted(
        [
            "1.root.json",
            "1.targets.json",
            f"{version}.acme.json",
            f"{version}.other.json",
            f"{version}.snapshot.json",
            "timestamp.json",
        ]
    )

    plugin = next(listing for listing in result.listings if listing.uid == PLUGIN)
    entry = plugin.entry
    avatar_sha = entry["avatar"]["sha256"]
    assert entry["avatar"]["path"] == f"assets/{avatar_sha}.png"
    assert entry["versions"][0]["manifest"] == "1.0.0/manifest.json"
    assert set(plugin.targets) == {
        f"publishers/acme/{PLUGIN}/listing.json",
        f"publishers/acme/{PLUGIN}/1.0.0/manifest.json",
        f"publishers/acme/{PLUGIN}/assets/{avatar_sha}.png",
        f"publishers/acme/{PLUGIN}/assets/{entry['images'][0]['sha256']}.png",
    }
    listing_blob = plugin.targets[f"publishers/acme/{PLUGIN}/listing.json"]
    served = result.out / "targets" / "publishers" / "acme" / PLUGIN
    assert (
        served / f"{listing_blob.sha256}.listing.json"
    ).read_bytes() == listing_blob.data
    assert (served / "assets" / f"{avatar_sha}.{avatar_sha}.png").is_file()
    assert json.loads(listing_blob.data)["registration"]["kind"] == "container"

    record = (world.publishers / "acme.json").read_bytes()
    assert (
        result.out / "targets" / "publishers" / f"{sha256(record)}.acme.json"
    ).is_file()


def test_delegations_are_limited_to_each_prefix(world: World) -> None:
    targets = json.loads((world.metadata / "targets.json").read_text())
    roles = {role["name"]: role for role in targets["signed"]["delegations"]["roles"]}
    assert roles["acme"]["paths"] == layout.delegation_paths("acme")
    assert roles["acme"]["terminating"] is True
    assert "core" not in roles


def test_overlay_adds_listings(world: World) -> None:
    overlay = world.root / "overlay"
    shutil.copytree(
        world.sources / "acme" / DASHBOARD, overlay / "other" / "0THER000000001"
    )
    listing = overlay / "other" / "0THER000000001" / "listing.json"
    document = json.loads(listing.read_text())
    document.update(uid="0THER000000001", publisher="other", public_id="other.board")
    listing.write_text(json.dumps(document))

    result = world.build(sources=[world.sources, overlay])
    assert len(result.listings) == 3
    checked = verify(result.out, world.trusted_root)
    assert "publishers/other/0THER000000001/listing.json" in checked.listings


def test_overlay_cannot_reuse_a_uid(world: World) -> None:
    overlay = world.root / "overlay"
    shutil.copytree(world.sources / "acme" / DASHBOARD, overlay / "acme" / DASHBOARD)
    with pytest.raises(RegistryError, match="used by two listings"):
        world.build(sources=[world.sources, overlay])


def _priced(document: dict) -> None:
    document["price"] = {"model": "per_use"}


def _sectored(document: dict) -> None:
    document["registration"]["reference_sectors"] = ["example-sector"]


@pytest.mark.parametrize("change", [_priced, _sectored], ids=["priced", "sectored"])
def test_public_target_refuses_priced_and_sectored(world: World, change) -> None:
    world.edit_listing(PLUGIN, change)
    with pytest.raises(
        RegistryError, match="public target takes no priced or sectored"
    ):
        world.build(target="public")
    assert not (world.root / "out").exists()


@pytest.mark.parametrize("change", [_priced, _sectored], ids=["priced", "sectored"])
def test_hosted_target_accepts_priced_and_sectored(world: World, change) -> None:
    world.edit_listing(PLUGIN, change)
    result = world.build(target="hosted")
    verify(result.out, world.trusted_root, target="hosted")
    with pytest.raises(RegistryError, match="public target excludes"):
        verify(result.out, world.trusted_root, target="public")


def test_prefix_must_match_publisher(world: World) -> None:
    world.edit_listing(PLUGIN, lambda d: d.update(public_id="other.tracker"))
    with pytest.raises(RegistryError, match="must start with its publisher"):
        world.build()


def test_listing_must_sit_under_its_publisher(world: World) -> None:
    world.edit_listing(
        PLUGIN, lambda d: d.update(publisher="other", public_id="other.tracker")
    )
    with pytest.raises(RegistryError, match="is under acme/ but names publisher"):
        world.build()


@pytest.mark.parametrize(
    "change",
    [
        lambda d: d.update(publisher="core", public_id="core.tracker"),
        lambda d: d.update(public_id="core.tracker"),
    ],
    ids=["publisher", "public_id"],
)
def test_core_is_refused(world: World, change) -> None:
    world.edit_listing(PLUGIN, change)
    with pytest.raises(RegistryError, match="'core' prefix is reserved"):
        world.build()


def test_core_publisher_record_is_refused(world: World) -> None:
    record = json.loads((world.publishers / "acme.json").read_text())
    record["prefix"] = "core"
    (world.publishers / "core.json").write_text(json.dumps(record))
    with pytest.raises(RegistryError, match=r"does not match publisher\.schema\.json"):
        world.build()


def test_source_digest_mismatch_is_refused(world: World) -> None:
    world.edit_listing(PLUGIN, lambda d: d["avatar"].update(sha256="0" * 64))
    with pytest.raises(RegistryError, match="hashes to"):
        world.build()


def test_source_version_gives_no_digest(world: World) -> None:
    """The build writes each manifest target, so a source cannot pin its digest."""
    world.edit_listing(PLUGIN, lambda d: d["versions"][0].update(sha256="f" * 64))
    with pytest.raises(RegistryError, match="'sha256' was unexpected"):
        world.build()


def test_changed_target_file_is_refused_by_verify(world: World) -> None:
    result = world.build()
    served = next(
        (result.out / "targets" / "publishers" / "acme" / PLUGIN).glob("*.listing.json")
    )
    served.write_bytes(served.read_bytes().replace(b"Acme Tracker", b"Acme Trackr!"))
    with pytest.raises(RegistryError, match="failed verification"):
        verify(result.out, world.trusted_root)


def test_entry_digest_mismatch_is_refused_by_verify(world: World) -> None:
    """A publisher's key signs a listing whose digest for its avatar is wrong."""
    result = world.build()
    path = f"publishers/acme/{PLUGIN}/listing.json"

    def change(role) -> None:
        blob = next(b for b in result.listings if b.uid == PLUGIN).targets[path]
        entry = json.loads(blob.data)
        entry["avatar"]["sha256"] = entry["images"][0]["sha256"]
        entry["avatar"]["path"] = entry["images"][0]["path"]
        entry["images"][0]["sha256"] = "0" * 64
        data = (json.dumps(entry, indent=2) + "\n").encode()
        target = result.out / "targets" / layout.served_target_path(path, sha256(data))
        target.write_bytes(data)
        role.targets[path] = TargetFile.from_data(path, data, ["sha256"])

    resign_role(world, result.out, "acme", change)
    with pytest.raises(RegistryError, match="does not match the sha256"):
        verify(result.out, world.trusted_root)


def test_a_publisher_cannot_sign_outside_its_prefix(world: World) -> None:
    result = world.build()
    stray = "publishers/other/0THER000000009/listing.json"
    data = (
        next(b for b in result.listings if b.uid == DASHBOARD)
        .targets[f"publishers/acme/{DASHBOARD}/listing.json"]
        .data
    )

    def change(role) -> None:
        role.targets[stray] = TargetFile.from_data(stray, data, ["sha256"])
        served = result.out / "targets" / layout.served_target_path(stray, sha256(data))
        served.parent.mkdir(parents=True, exist_ok=True)
        served.write_bytes(data)

    resign_role(world, result.out, "acme", change)

    # The client never takes that target from acme: the path resolves through
    # the delegation to 'other', which does not sign it.
    with open_updater(result.out, world.trusted_root) as (updater, _):
        updater.refresh()
        assert updater.get_targetinfo(stray) is None
    with pytest.raises(RegistryError, match="outside its delegation"):
        verify(result.out, world.trusted_root)


def test_expired_timestamp_is_refused_and_refresh_fixes_it(world: World) -> None:
    result = world.build()
    refresh_timestamp(
        result.out, world.signer("timestamp"), now=utc_now() - timedelta(days=2)
    )
    with pytest.raises(RegistryError, match="expired"):
        verify(result.out, world.trusted_root)

    timestamp = refresh_timestamp(result.out, world.signer("timestamp"))
    assert timestamp.signed.expires > utc_now()
    verify(result.out, world.trusted_root)


def test_expired_snapshot_is_refused(world: World) -> None:
    result = world.build(now=utc_now() - timedelta(days=8))
    refresh_timestamp(result.out, world.signer("timestamp"))
    with pytest.raises(RegistryError, match="expired"):
        verify(result.out, world.trusted_root)


def test_refresh_timestamp_needs_the_timestamp_key(world: World) -> None:
    result = world.build()
    with pytest.raises(RegistryError, match="not the one root names for timestamp"):
        refresh_timestamp(result.out, world.signer("snapshot"))


def test_wrong_online_key_is_refused(world: World) -> None:
    def keys(name: str):
        return world.signer("timestamp" if name == "snapshot" else name)

    with pytest.raises(RegistryError, match="not the one root names for snapshot"):
        from initiative_registry.build import build

        build(
            target="public",
            sources=[world.sources],
            out=world.root / "out",
            keys=keys,
            metadata_dir=world.metadata,
            publisher_dirs=[world.publishers],
        )


def test_wrong_publisher_key_is_refused(world: World) -> None:
    from initiative_registry.build import build

    def keys(name: str):
        return world.signer("other" if name == "acme" else name)

    with pytest.raises(RegistryError, match="not the one its record names"):
        build(
            target="public",
            sources=[world.sources],
            out=world.root / "out",
            keys=keys,
            metadata_dir=world.metadata,
            publisher_dirs=[world.publishers],
        )


def test_publisher_record_changed_since_signing_is_refused(world: World) -> None:
    path = world.publishers / "acme.json"
    record = json.loads(path.read_text())
    record["verified"] = True
    path.write_text(json.dumps(record))
    with pytest.raises(RegistryError, match="changed; run sign-offline"):
        world.build()


def test_listing_for_an_unknown_publisher_is_refused(world: World) -> None:
    shutil.copytree(
        world.sources / "acme" / DASHBOARD, world.sources / "nobody" / DASHBOARD
    )
    shutil.rmtree(world.sources / "acme" / DASHBOARD)
    world.edit_listing(
        DASHBOARD,
        lambda d: d.update(publisher="nobody", public_id="nobody.x"),
        "nobody",
    )
    with pytest.raises(RegistryError, match="has no record"):
        world.build()


def test_plugin_without_registration_is_refused(world: World) -> None:
    world.edit_listing(PLUGIN, lambda d: d.pop("registration"))
    with pytest.raises(RegistryError, match="registration"):
        world.build()


@pytest.mark.parametrize(
    "fields",
    [
        {"jwks": {"keys": [{"kty": "OKP", "crv": "Ed25519", "kid": "k", "x": "x"}]}},
        {"base_url": "https://tracker.acme.test"},
        {"kind": "hosted"},
    ],
    ids=["keys", "location", "hosted"],
)
def test_a_plugin_is_a_container_with_no_location_or_keys(
    world: World, fields: dict
) -> None:
    """Each deployment runs its own copy, and gives its location and keys."""
    world.edit_listing(PLUGIN, lambda d: d["registration"].update(fields))
    with pytest.raises(RegistryError, match=r"listing\.schema\.json"):
        world.build()


@pytest.mark.parametrize(
    ("scope", "accepted"),
    [
        ("plugins:other.tool", True),
        ("plugins:other.", False),
        ("plugins:Other.tool", False),
        ("apps:other.tool", False),
    ],
)
def test_a_ceiling_may_name_another_plugin(
    world: World, scope: str, accepted: bool
) -> None:
    world.edit_listing(
        PLUGIN, lambda d: d["registration"]["scope_ceiling"].append(scope)
    )
    if accepted:
        world.build()
    else:
        with pytest.raises(RegistryError, match=r"listing\.schema\.json"):
            world.build()


COMPOSE = {
    "service": "tracker:\n  image: ${IMAGE}\n  environment:\n"
    "    INITIATIVE_URL: ${INITIATIVE_URL}\n    PRICE: $$5\n",
    "base_url": "http://tracker:8080",
}


@pytest.mark.parametrize(
    ("change", "accepted"),
    [
        ({}, True),
        ({"service": "tracker:\n  image: ${IMAGES}\n"}, False),
        ({"service": "tracker:\n  image: ${IMAGE\n"}, False),
        ({"service": "x" * 4097}, False),
        ({"base_url": "ftp://tracker"}, False),
        ({"base_url": "http://tracker:8080/a b"}, False),
        ({"base_url": f"http://{'t' * 506}"}, False),
        ({"base_url": None}, False),
        ({"ports": []}, False),
    ],
    ids=[
        "snippet",
        "unknown-placeholder",
        "unclosed-placeholder",
        "long-service",
        "not-http",
        "space",
        "long-url",
        "no-url",
        "unknown-term",
    ],
)
def test_a_registration_may_carry_a_compose_snippet(
    world: World, change: dict, accepted: bool
) -> None:
    compose = {**COMPOSE, **change}
    compose = {key: value for key, value in compose.items() if value is not None}
    world.edit_listing(PLUGIN, lambda d: d["registration"].update(compose=compose))
    if accepted:
        result = world.build()
        plugin = next(listing for listing in result.listings if listing.uid == PLUGIN)
        signed = plugin.targets[f"publishers/acme/{PLUGIN}/listing.json"]
        assert json.loads(signed.data)["registration"]["compose"] == compose
    else:
        with pytest.raises(RegistryError, match=r"listing\.schema\.json"):
            world.build()


DECLARATIVE = {"kind": "declarative", "scope_ceiling": [], "reference_sectors": []}


def test_a_declarative_plugin_registers_no_image(world: World) -> None:
    """Initiative runs it from its kit manifest, which names no service."""
    kit = world.sources / "acme" / PLUGIN / "1.0.0" / "manifest.json"
    document = json.loads(kit.read_text())
    del document["service"]
    kit.write_text(json.dumps(document))
    world.edit_listing(PLUGIN, lambda d: d.update(registration=DECLARATIVE))
    result = world.build()
    verify(result.out, world.trusted_root, target="public")
    plugin = next(listing for listing in result.listings if listing.uid == PLUGIN)
    signed = plugin.targets[f"publishers/acme/{PLUGIN}/listing.json"]
    assert json.loads(signed.data)["registration"] == DECLARATIVE


@pytest.mark.parametrize(
    ("registration", "match"),
    [
        ({**DECLARATIVE, "image": f"ghcr.io/acme/t@sha256:{'0' * 64}"}, "schema"),
        ({**DECLARATIVE, "compose": COMPOSE}, "schema"),
        ({"kind": "container", "scope_ceiling": []}, "schema"),
        (DECLARATIVE, "has no service block"),
    ],
    ids=["declarative-image", "declarative-compose", "no-image", "service-block"],
)
def test_a_registration_fits_its_kind(
    world: World, registration: dict, match: str
) -> None:
    world.edit_listing(PLUGIN, lambda d: d.update(registration=registration))
    with pytest.raises(RegistryError, match=match):
        world.build()


def test_content_with_registration_is_refused(world: World) -> None:
    registration = json.loads(world.listing(PLUGIN).read_text())["registration"]
    world.edit_listing(DASHBOARD, lambda d: d.update(registration=registration))
    with pytest.raises(RegistryError, match=r"listing\.schema\.json"):
        world.build()


def test_asset_outside_the_listing_is_refused(world: World) -> None:
    world.edit_listing(
        PLUGIN, lambda d: d["avatar"].update(path="../0ACME000000002/assets/avatar.png")
    )
    with pytest.raises(RegistryError, match=r"listing\.schema\.json"):
        world.build()


def test_output_must_be_empty(world: World) -> None:
    (world.root / "out").mkdir()
    (world.root / "out" / "stale").write_text("x")
    with pytest.raises(RegistryError, match="not empty"):
        world.build()
