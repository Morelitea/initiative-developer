"""The JSON schemas under ``registry/schema/``, and validation against them."""

from __future__ import annotations

import json
import re
from collections.abc import Iterator
from functools import cache
from typing import Any

from jsonschema import Draft202012Validator, ValidationError, validators
from referencing import Registry, Resource

from .errors import RegistryError
from .layout import SCHEMA_DIR

LISTING = "listing"
ENTRY = "entry"
PUBLISHER = "publisher"
#: A version's manifest target, described in ``entry.schema.json``.
MANIFEST = "manifest"

_SUBSCHEMAS = {MANIFEST: "urn:initiative-registry:schema:entry#/$defs/manifest"}


@cache
def _compiled(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern)


def _whole_pattern(
    validator: Any, pattern: str, instance: Any, schema: dict[str, Any]
) -> Iterator[ValidationError]:
    """``pattern``, matched against the whole string.

    jsonschema applies ``pattern`` with ``re.search``, where ``$`` also matches
    before a final newline, so ``^[0-9]+$`` would take ``"4\\n"``. ECMA-262's
    ``$`` does not. Every pattern in these schemas is anchored ``^...$``, so a
    full match gives them the meaning the schema states, in standard regex.
    """
    if validator.is_type(instance, "string") and not _compiled(pattern).fullmatch(
        instance
    ):
        yield ValidationError(f"{instance!r} does not match {pattern!r}")


#: Draft 2020-12, with ``pattern`` matching the whole string.
Validator = validators.extend(Draft202012Validator, {"pattern": _whole_pattern})


@cache
def _documents() -> dict[str, dict[str, Any]]:
    documents = {}
    for name in (LISTING, ENTRY, PUBLISHER):
        path = SCHEMA_DIR / f"{name}.schema.json"
        documents[name] = json.loads(path.read_text())
    return documents


@cache
def _validator(name: str) -> Any:
    documents = _documents()
    registry: Registry = Registry().with_resources(
        (document["$id"], Resource.from_contents(document))
        for document in documents.values()
    )
    if name in _SUBSCHEMAS:
        schema = {"$ref": _SUBSCHEMAS[name]}
    else:
        schema = documents[name]
        Validator.check_schema(schema)
    return Validator(schema, registry=registry)


def problems(name: str, document: Any) -> list[str]:
    """Every way ``document`` fails the schema, one line each."""
    errors = sorted(_validator(name).iter_errors(document), key=lambda e: list(e.path))
    lines = []
    for error in errors:
        where = "/".join(str(part) for part in error.absolute_path) or "(top level)"
        lines.append(f"{where}: {error.message}")
    return lines


def _source(name: str) -> str:
    if name in _SUBSCHEMAS:
        return f"entry.schema.json#/$defs/{name}"
    return f"{name}.schema.json"


def validate(name: str, document: Any, *, what: str) -> None:
    found = problems(name, document)
    if found:
        raise RegistryError(
            f"{what} does not match {_source(name)}:\n  " + "\n  ".join(found)
        )
