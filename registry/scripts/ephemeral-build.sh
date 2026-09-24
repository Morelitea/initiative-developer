#!/usr/bin/env bash
# Builds and verifies the public repository from this checkout's sources with
# keys made for this run only: every top-level role and every publisher record
# gets a fresh key, the records are copied with those keys filled in, and a new
# root and targets are signed for them. Nothing is written inside the checkout.
#
# Usage: scripts/ephemeral-build.sh [work-dir]   (default: a new temporary dir)
set -euo pipefail

registry="$(cd "$(dirname "$0")/.." && pwd)"
work="${1:-$(mktemp -d)}"
keys="$work/keys"
publishers="$work/publishers"
metadata="$work/metadata"
out="$work/site/public"
cli=(uv run --project "$registry" initiative-registry)

mkdir -p "$publishers"
for role in root targets snapshot timestamp; do
  "${cli[@]}" keygen --role "$role" --out "$keys" >/dev/null
done
for record in "$registry"/publishers/*.json; do
  prefix="$(basename "$record" .json)"
  "${cli[@]}" keygen --role "$prefix" --out "$keys" >/dev/null
  uv run --project "$registry" python - "$record" "$keys/$prefix.pub.json" \
    "$publishers/$prefix.json" <<'PY'
import json
import sys

record_path, key_path, out_path = sys.argv[1:]
with open(record_path) as handle:
    record = json.load(handle)
with open(key_path) as handle:
    record["key"] = json.load(handle)
with open(out_path, "w") as handle:
    handle.write(json.dumps(record, indent=2) + "\n")
PY
done

"${cli[@]}" init-root --metadata "$metadata" \
  --root-key "$keys/root.pem" --targets-key "$keys/targets.pem" \
  --snapshot-pub "$keys/snapshot.pub.json" --timestamp-pub "$keys/timestamp.pub.json" \
  --publishers "$publishers"
"${cli[@]}" build --target public --sources "$registry/sources" \
  --metadata "$metadata" --publishers "$publishers" --keys "$keys" --out "$out"
"${cli[@]}" verify --repo "$out" --root "$metadata/1.root.json" --target public
