"""Each version's manifest target, and the kinds a listing may be."""

from __future__ import annotations

import json

import pytest
from tuf.api.metadata import TargetFile

from initiative_registry import RegistryError, layout
from initiative_registry.sources import sha256
from initiative_registry.verify import verify

from .conftest import FIXTURES, World, resign_role

PLUGIN = "0ACME000000001"
DASHBOARD = "0ACME000000002"

TOOL_KINDS = (
    "calendar",
    "counter_group",
    "dashboard",
    "file",
    "gallery",
    "post",
    "project",
    "queue",
    "wiki",
)


def _manifest(result, uid: str, version: str) -> dict:
    listing = next(listing for listing in result.listings if listing.uid == uid)
    path = layout.manifest_target("acme", uid, version)
    return json.loads(listing.targets[path].data)


def _registration(world: World) -> dict:
    return json.loads(world.listing(PLUGIN).read_text())["registration"]


def test_plugin_manifest_carries_the_kit_manifest(world: World) -> None:
    result = world.build()
    manifest = _manifest(result, PLUGIN, "1.0.0")
    kit = json.loads(
        (FIXTURES / "sources" / "acme" / PLUGIN / "1.0.0" / "manifest.json").read_text()
    )
    assert manifest == {
        "uid": PLUGIN,
        "public_id": "acme.tracker",
        "kind": "plugin",
        "definition": kit,
    }
    assert manifest["definition"]["service"]["public_id"] == "acme.tracker"


def test_dashboard_manifest_carries_definition_and_example(world: World) -> None:
    result = world.build()
    manifest = _manifest(result, DASHBOARD, "2.1.0")
    assert list(manifest) == ["uid", "public_id", "kind", "definition", "example"]
    assert manifest["kind"] == "dashboard"
    assert manifest["definition"]["widgets"][0]["id"] == "w1"
    example = FIXTURES / "sources" / "acme" / DASHBOARD / "2.1.0" / "example.json"
    assert manifest["example"] == json.loads(example.read_text())


def test_entry_names_the_manifest_instead_of_the_definition(world: World) -> None:
    result = world.build()
    listing = next(listing for listing in result.listings if listing.uid == DASHBOARD)
    entry = json.loads(listing.targets[layout.listing_target("acme", DASHBOARD)].data)
    version = entry["versions"][0]
    assert set(version) == {"version", "manifest", "sha256"}
    manifest = listing.targets[layout.manifest_target("acme", DASHBOARD, "2.1.0")]
    assert version["sha256"] == manifest.sha256


def test_plugin_definition_must_name_the_listings_service(world: World) -> None:
    kit = world.sources / "acme" / PLUGIN / "1.0.0" / "manifest.json"
    document = json.loads(kit.read_text())
    document["service"]["public_id"] = "acme.other"
    kit.write_text(json.dumps(document))
    with pytest.raises(
        RegistryError, match=r"service\.public_id must be 'acme\.tracker'"
    ):
        world.build()


def test_plugin_definition_must_be_a_service_plugin(world: World) -> None:
    world.edit_listing(
        PLUGIN, lambda d: d["versions"][0].update(definition={"plugin_kind": "embed"})
    )
    with pytest.raises(RegistryError, match="it is None"):
        world.build()


def test_definition_file_must_be_an_object(world: World) -> None:
    (world.sources / "acme" / PLUGIN / "1.0.0" / "manifest.json").write_text("[]")
    with pytest.raises(RegistryError, match="must be a JSON object"):
        world.build()


def test_a_version_needs_a_definition(world: World) -> None:
    world.edit_listing(DASHBOARD, lambda d: d["versions"][0].pop("definition"))
    with pytest.raises(RegistryError, match="'definition' is a required property"):
        world.build()


def test_a_plugin_takes_no_example(world: World) -> None:
    world.edit_listing(PLUGIN, lambda d: d["versions"][0].update(example={}))
    with pytest.raises(RegistryError, match=r"listing\.schema\.json"):
        world.build()


def test_verify_refuses_a_manifest_for_another_listing(world: World) -> None:
    """A publisher signs a manifest whose public_id is not its entry's."""
    result = world.build()
    listing = next(listing for listing in result.listings if listing.uid == DASHBOARD)
    manifest_path = layout.manifest_target("acme", DASHBOARD, "2.1.0")
    entry_path = layout.listing_target("acme", DASHBOARD)

    def change(role) -> None:
        manifest = json.loads(listing.targets[manifest_path].data)
        manifest["public_id"] = "acme.elsewhere"
        manifest_data = (json.dumps(manifest) + "\n").encode()
        entry = json.loads(listing.targets[entry_path].data)
        entry["versions"][0]["sha256"] = sha256(manifest_data)
        entry_data = (json.dumps(entry) + "\n").encode()
        for path, data in ((manifest_path, manifest_data), (entry_path, entry_data)):
            served = (
                result.out / "targets" / layout.served_target_path(path, sha256(data))
            )
            served.write_bytes(data)
            role.targets[path] = TargetFile.from_data(path, data, ["sha256"])

    resign_role(world, result.out, "acme", change)
    with pytest.raises(RegistryError, match="names a different public_id"):
        verify(result.out, world.trusted_root)


@pytest.mark.parametrize("kind", TOOL_KINDS)
def test_every_tool_kind_is_a_listing_kind(world: World, kind: str) -> None:
    world.edit_listing(DASHBOARD, lambda d: d.update(kind=kind))
    result = world.build()
    assert _manifest(result, DASHBOARD, "2.1.0")["kind"] == kind
    verify(result.out, world.trusted_root)


@pytest.mark.parametrize("kind", ["art_pack", "widget", "app", "plugins"])
def test_other_kinds_are_refused(world: World, kind: str) -> None:
    world.edit_listing(DASHBOARD, lambda d: d.update(kind=kind))
    with pytest.raises(RegistryError, match="is not one of"):
        world.build()


def test_profile_pack_takes_no_example(world: World) -> None:
    world.edit_listing(DASHBOARD, lambda d: d.update(kind="profile_pack"))
    with pytest.raises(RegistryError, match=r"listing\.schema\.json"):
        world.build()
    world.edit_listing(DASHBOARD, lambda d: d["versions"][0].pop("example"))
    result = world.build()
    assert "example" not in _manifest(result, DASHBOARD, "2.1.0")


def test_profile_pack_takes_no_registration(world: World) -> None:
    registration = _registration(world)

    def change(document: dict) -> None:
        document.update(kind="profile_pack", registration=registration)
        document["versions"][0].pop("example")

    world.edit_listing(DASHBOARD, change)
    with pytest.raises(RegistryError, match=r"listing\.schema\.json"):
        world.build()


def test_only_a_plugin_carries_a_registration(world: World) -> None:
    world.edit_listing(PLUGIN, lambda d: d.update(kind="auto"))
    with pytest.raises(RegistryError, match=r"listing\.schema\.json"):
        world.build()


def test_auto_needs_no_registration(world: World) -> None:
    def change(document: dict) -> None:
        document.update(kind="auto")
        document.pop("registration")

    world.edit_listing(PLUGIN, change)
    world.build()


def _kit_path(world: World):
    return world.sources / "acme" / PLUGIN / "1.0.0" / "manifest.json"


def _set_kit_min_plugin_api(world: World, value: str) -> None:
    kit = _kit_path(world)
    document = json.loads(kit.read_text())
    document["min_plugin_api"] = value
    kit.write_text(json.dumps(document))


def _published_version(result, uid: str) -> dict:
    listing = next(listing for listing in result.listings if listing.uid == uid)
    return json.loads(listing.targets[layout.listing_target("acme", uid)].data)[
        "versions"
    ][0]


def test_min_plugin_api_passes_into_the_entry_and_manifest_unchanged(
    world: World,
) -> None:
    world.edit_listing(PLUGIN, lambda d: d["versions"][0].update(min_plugin_api="4.1"))
    _set_kit_min_plugin_api(world, "4.1")
    result = world.build()

    version = _published_version(result, PLUGIN)
    assert version["min_plugin_api"] == "4.1"
    assert version["min_app_version"] == "0.73.0"
    assert _manifest(result, PLUGIN, "1.0.0")["definition"]["min_plugin_api"] == "4.1"
    verify(result.out, world.trusted_root, target="public")


def test_min_plugin_api_is_optional(world: World) -> None:
    result = world.build()
    assert "min_plugin_api" not in _published_version(result, PLUGIN)
    assert "min_plugin_api" not in _manifest(result, PLUGIN, "1.0.0")["definition"]


@pytest.mark.parametrize("value", ["4", "4.1.1", "v4.1", "4.x", "", " 4.1"])
def test_a_listing_version_min_plugin_api_must_be_major_minor(
    world: World, value: str
) -> None:
    world.edit_listing(PLUGIN, lambda d: d["versions"][0].update(min_plugin_api=value))
    with pytest.raises(
        RegistryError, match=r"listing\.schema\.json[\s\S]*min_plugin_api"
    ):
        world.build()


@pytest.mark.parametrize("value", ["4", "4.1.1", "v4.1"])
def test_a_kit_manifest_min_plugin_api_must_be_major_minor(
    world: World, value: str
) -> None:
    _set_kit_min_plugin_api(world, value)
    with pytest.raises(
        RegistryError,
        match=r"entry\.schema\.json#/\$defs/manifest[\s\S]*min_plugin_api",
    ):
        world.build()


def test_min_plugin_api_must_agree_with_the_kit_manifest(world: World) -> None:
    world.edit_listing(PLUGIN, lambda d: d["versions"][0].update(min_plugin_api="4.1"))
    _set_kit_min_plugin_api(world, "4.2")
    with pytest.raises(RegistryError, match=r"differs from its kit manifest's '4\.2'"):
        world.build()
