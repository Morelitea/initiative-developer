"""Each version's manifest target, and the kinds a listing may be."""

from __future__ import annotations

import json

import pytest
from tuf.api.metadata import TargetFile

from initiative_registry import RegistryError, layout
from initiative_registry.sources import sha256
from initiative_registry.verify import verify

from .conftest import FIXTURES, World, resign_role

APP = "0ACME000000001"
DASHBOARD = "0ACME000000002"

TOOL_KINDS = (
    "calendar",
    "counter_group",
    "dashboard",
    "document",
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
    return json.loads(world.listing(APP).read_text())["registration"]


def test_app_manifest_carries_the_kit_manifest(world: World) -> None:
    result = world.build()
    manifest = _manifest(result, APP, "1.0.0")
    kit = json.loads(
        (FIXTURES / "sources" / "acme" / APP / "1.0.0" / "manifest.json").read_text()
    )
    assert manifest == {
        "uid": APP,
        "public_id": "acme.tracker",
        "kind": "app",
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


def test_app_definition_must_name_the_listings_service(world: World) -> None:
    kit = world.sources / "acme" / APP / "1.0.0" / "manifest.json"
    document = json.loads(kit.read_text())
    document["service"]["public_id"] = "acme.other"
    kit.write_text(json.dumps(document))
    with pytest.raises(
        RegistryError, match=r"service\.public_id must be 'acme\.tracker'"
    ):
        world.build()


def test_app_definition_must_be_a_service_app(world: World) -> None:
    world.edit_listing(
        APP, lambda d: d["versions"][0].update(definition={"app_kind": "embed"})
    )
    with pytest.raises(RegistryError, match="it is None"):
        world.build()


def test_definition_file_must_be_an_object(world: World) -> None:
    (world.sources / "acme" / APP / "1.0.0" / "manifest.json").write_text("[]")
    with pytest.raises(RegistryError, match="must be a JSON object"):
        world.build()


def test_a_version_needs_a_definition(world: World) -> None:
    world.edit_listing(DASHBOARD, lambda d: d["versions"][0].pop("definition"))
    with pytest.raises(RegistryError, match="'definition' is a required property"):
        world.build()


def test_an_app_takes_no_example(world: World) -> None:
    world.edit_listing(APP, lambda d: d["versions"][0].update(example={}))
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


@pytest.mark.parametrize("kind", ["art_pack", "widget", "apps"])
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


def test_only_an_app_carries_a_registration(world: World) -> None:
    world.edit_listing(APP, lambda d: d.update(kind="auto"))
    with pytest.raises(RegistryError, match=r"listing\.schema\.json"):
        world.build()


def test_auto_needs_no_registration(world: World) -> None:
    def change(document: dict) -> None:
        document.update(kind="auto")
        document.pop("registration")

    world.edit_listing(APP, change)
    world.build()
