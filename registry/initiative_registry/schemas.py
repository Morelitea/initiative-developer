"""The JSON schemas under ``registry/schema/``, and validation against them."""

from __future__ import annotations

import json
from functools import cache
from typing import Any

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from .errors import RegistryError
from .layout import SCHEMA_DIR

LISTING = "listing"
ENTRY = "entry"
PUBLISHER = "publisher"


@cache
def _documents() -> dict[str, dict[str, Any]]:
    documents = {}
    for name in (LISTING, ENTRY, PUBLISHER):
        path = SCHEMA_DIR / f"{name}.schema.json"
        documents[name] = json.loads(path.read_text())
    return documents


@cache
def _validator(name: str) -> Draft202012Validator:
    documents = _documents()
    registry: Registry = Registry().with_resources(
        (document["$id"], Resource.from_contents(document))
        for document in documents.values()
    )
    schema = documents[name]
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, registry=registry)


def problems(name: str, document: Any) -> list[str]:
    """Every way ``document`` fails the schema, one line each."""
    errors = sorted(_validator(name).iter_errors(document), key=lambda e: list(e.path))
    lines = []
    for error in errors:
        where = "/".join(str(part) for part in error.absolute_path) or "(top level)"
        lines.append(f"{where}: {error.message}")
    return lines


def validate(name: str, document: Any, *, what: str) -> None:
    found = problems(name, document)
    if found:
        raise RegistryError(
            f"{what} does not match {name}.schema.json:\n  " + "\n  ".join(found)
        )
