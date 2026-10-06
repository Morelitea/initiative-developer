"""Schema validation: every ``pattern`` matches the whole string."""

from __future__ import annotations

import json

import pytest

from initiative_registry import RegistryError, schemas
from initiative_registry.layout import SCHEMA_DIR

from .conftest import FIXTURES, World

PLUGIN = "0ACME000000001"


def _patterns(node) -> list[str]:
    if isinstance(node, dict):
        found = [node["pattern"]] if isinstance(node.get("pattern"), str) else []
        return found + [p for value in node.values() for p in _patterns(value)]
    if isinstance(node, list):
        return [p for value in node for p in _patterns(value)]
    return []


def test_every_pattern_is_anchored() -> None:
    """A full match gives an anchored pattern its ECMA-262 meaning; an
    unanchored one would change meaning, so none may be added."""
    patterns = [
        pattern
        for path in sorted(SCHEMA_DIR.glob("*.schema.json"))
        for pattern in _patterns(json.loads(path.read_text()))
    ]
    assert patterns
    for pattern in patterns:
        assert pattern.startswith("^") and pattern.endswith("$"), pattern


def test_a_publisher_prefix_with_a_trailing_newline_is_refused(world: World) -> None:
    record = json.loads((world.publishers / "acme.json").read_text())
    assert schemas.problems(schemas.PUBLISHER, record) == []
    record["prefix"] = "acme\n"
    assert any(
        line.startswith("prefix:")
        for line in schemas.problems(schemas.PUBLISHER, record)
    )


def test_a_public_id_with_a_trailing_newline_is_refused(world: World) -> None:
    world.edit_listing(PLUGIN, lambda d: d.update(public_id="acme.tracker\n"))
    with pytest.raises(RegistryError, match=r"public_id: 'acme\.tracker\\n'"):
        world.build()


def test_a_min_plugin_api_with_a_trailing_newline_is_refused(world: World) -> None:
    world.edit_listing(
        PLUGIN, lambda d: d["versions"][0].update(min_plugin_api="4.1\n")
    )
    with pytest.raises(RegistryError, match=r"min_plugin_api: '4\.1\\n'"):
        world.build()


def test_a_kit_manifest_min_plugin_api_with_a_trailing_newline_is_refused(
    world: World,
) -> None:
    kit = world.sources / "acme" / PLUGIN / "1.0.0" / "manifest.json"
    document = json.loads(kit.read_text())
    document["min_plugin_api"] = "4.1\n"
    kit.write_text(json.dumps(document))
    with pytest.raises(RegistryError, match=r"min_plugin_api: '4\.1\\n'"):
        world.build()


def test_a_compose_service_still_spans_lines() -> None:
    """The one pattern that admits newlines keeps admitting them."""
    service = "tracker:\n  image: ${IMAGE}\n"
    compose = {"service": service, "base_url": "http://tracker:8080"}
    listing = json.loads(
        (FIXTURES / "sources" / "acme" / PLUGIN / "listing.json").read_text()
    )
    listing["registration"]["compose"] = compose
    assert schemas.problems(schemas.LISTING, listing) == []
    compose["service"] = "tracker:\n  image: ${OTHER}\n"
    assert schemas.problems(schemas.LISTING, listing) != []
