# registry

The signed catalogue of Initiative apps and content. Every listing is a source
file in this directory. The builder turns the sources into a
[TUF](https://theupdateframework.io/) repository and signs it, and CI publishes
it to this repository's GitHub Pages site at `/public/`. A deployment that
trusts our root key reads that catalogue. TUF lets it tell a current, complete,
correctly signed catalogue from anything else.

```
registry/
  sources/<publisher>/<uid>/listing.json   one per listing
  sources/<publisher>/<uid>/assets/…       its avatar and images
  sources/<publisher>/<uid>/<version>/…    its manifests, when not inline
  publishers/<prefix>.json                 publisher records
  schema/                                  JSON schemas for all of the above
  metadata/                                the signed root and targets metadata
  initiative_registry/                     the builder (python-tuf)
  scripts/ephemeral-build.sh               a full build and verify with throwaway keys
  tests/
```

## Adding a listing

Open a pull request that adds `sources/<publisher>/<uid>/listing.json`. The
pull request review is the listing's review: merging it publishes the listing.

```json
{
  "schema": 1,
  "uid": "0ACME000000001",
  "public_id": "acme.tracker",
  "publisher": "acme",
  "kind": "app",
  "name": "Acme Tracker",
  "summary": "Links Acme tickets to your projects.",
  "avatar": {"path": "assets/avatar.png"},
  "images": [{"path": "assets/board.png", "alt": "A board with Acme tickets"}],
  "versions": [
    {"version": "1.0.0", "manifest": "1.0.0/manifest.json", "min_app_version": "0.73.0"}
  ],
  "registration": {
    "kind": "container",
    "image": "ghcr.io/acme/tracker@sha256:…",
    "jwks": {"keys": [{"kty": "OKP", "crv": "Ed25519", "x": "…"}]},
    "scope_ceiling": ["projects:read", "comments:write"],
    "reference_sectors": []
  },
  "price": null
}
```

[`tests/fixtures/sources/`](tests/fixtures/sources/) holds a complete app
listing and a content listing you can copy. The build checks every rule below,
and [`schema/listing.schema.json`](schema/listing.schema.json) states most of
them:

- **`uid`** is 14 characters of Crockford base32 without `I`, `L`, `O` or `U`.
  It is also the directory's name, and it is never reused.
- **`publisher`** names a record in `publishers/` and the directory above the
  listing. **`public_id`** is `<publisher>.<slug>`. The `core` prefix is
  reserved and never accepted.
- **Paths** (`avatar`, `images`, a manifest) are relative to the listing's
  directory and stay inside it. Images are PNG, JPEG, WebP, GIF, AVIF or SVG,
  and each one in `images` needs `alt` text.
- **`sha256`** is optional on any file. If you give one, the build checks the
  file against it. If you leave it out, the build computes it.
- **`versions[].manifest`** is a path to a JSON file or the manifest inline.
- **`registration`** is required for an app and not allowed for content.
  - `container`: `image` pinned by digest, and `jwks`. The deployment's
    operator gives the location it runs at.
  - `hosted`: `base_url`, `embed_origin`, and `jwks` or `jwks_uri`.
  - `scope_ceiling` is the most the app may ever be granted. A manifest may ask
    for less, never more.
  - `reference_sectors` lists the reference sectors an app may be granted.
- **`price`** is `null` for a free listing.

The published entry, `publishers/<prefix>/<uid>/listing.json`, is the same
document with every path rewritten to the target beside it and every `sha256`
filled in ([`schema/entry.schema.json`](schema/entry.schema.json)).

## Targets

`build --target` decides what goes in. Both targets take one or more
`--sources` trees.

- **`public`** is built from this directory's `sources/` and published here. It
  excludes priced and sectored entries: if its input contains a listing with a
  non-null `price` or any `reference_sectors`, it refuses to run.
- **`hosted`** takes the same sources, and may take additional source trees
  after them. It accepts priced and sectored entries, and is signed under the
  same root and targets metadata.

Across all the trees given, each uid and `public_id` may appear only once.

## The repository as built

`build --out <dir>` writes a static directory that any web server can serve:

```
<out>/metadata/1.root.json … <N>.root.json        every root version
<out>/metadata/<v>.targets.json                     top-level targets, as signed offline
<out>/metadata/<v>.<prefix>.json                    one delegated role per publisher
<out>/metadata/<v>.snapshot.json
<out>/metadata/timestamp.json
<out>/targets/publishers/<sha256>.<prefix>.json                          publisher records
<out>/targets/publishers/<prefix>/<uid>/<sha256>.listing.json
<out>/targets/publishers/<prefix>/<uid>/<version>/<sha256>.manifest.json
<out>/targets/publishers/<prefix>/<uid>/assets/<sha256>.<sha256>.<ext>
```

The repository uses consistent snapshots. Every metadata file except
`timestamp.json` is fetched by version, and every target by its hash, so a
client in the middle of an update never mixes two builds. The target paths
themselves are:

| Target | Signed by |
|---|---|
| `publishers/<prefix>.json` | `targets` |
| `publishers/<prefix>/<uid>/listing.json` | `<prefix>` |
| `publishers/<prefix>/<uid>/<version>/manifest.json` | `<prefix>` |
| `publishers/<prefix>/<uid>/assets/<sha256>.<ext>` | `<prefix>` |

## Roles and keys

| Role | Signs | Key | Expiry |
|---|---|---|---|
| `root` | the keys of every top-level role | offline | 1 year |
| `targets` | one delegation per publisher, and each publisher's record | offline | 1 year |
| `<prefix>` | that publisher's listing targets | the publisher's own; ours is a CI secret | 90 days |
| `snapshot` | the versions of `targets` and of every publisher role | CI secret | 7 days |
| `timestamp` | the snapshot | CI secret | 1 day |

Every threshold is 1. `targets` delegates three path patterns to the key in
each publisher's record:
- `publishers/<prefix>/*/listing.json`;
- `publishers/<prefix>/*/*/manifest.json`;
- `publishers/<prefix>/*/assets/*`.

The delegation is terminating, so a publisher signs only under its own prefix.
`core` is never delegated.

The offline roles are signed on the owner's machine, and only their signed
metadata is committed to `metadata/`. CI signs the online roles on every build.
An online role's version is the build time in seconds, so each build supersedes
the last without keeping state between runs.

### Setting up

Keys are Ed25519. `keygen` writes `<role>.pem` and `<role>.pub.json` into a
directory, and refuses any directory inside a git repository. To encrypt a key,
add `--passphrase`: it prompts for one, or reads `REGISTRY_KEY_PASSPHRASE`.

```sh
keys=~/.config/initiative-registry
for role in root targets snapshot timestamp morelitea; do
  uv run initiative-registry keygen --role $role --out $keys
done
```

1. Paste `morelitea.pub.json` over the placeholder `key` in
   `publishers/morelitea.json`.
2. Sign the offline metadata:
   ```sh
   uv run initiative-registry init-root \
     --root-key $keys/root.pem --targets-key $keys/targets.pem \
     --snapshot-pub $keys/snapshot.pub.json --timestamp-pub $keys/timestamp.pub.json
   ```
3. Store the PEM text of each online key as a repository secret:
   - `REGISTRY_SNAPSHOT_KEY`;
   - `REGISTRY_TIMESTAMP_KEY`;
   - `REGISTRY_PUBLISHER_KEY_MORELITEA`. A publisher's variable is
     `REGISTRY_PUBLISHER_KEY_` followed by its prefix in capitals, with any
     other character as `_`.
4. Commit `metadata/` and the publisher record, then move `root.pem` and
   `targets.pem` offline.

`metadata/1.root.json` is the root a client ships with. It is also served at
`/public/metadata/1.root.json`.

### Changing things

Give `sign-offline` the keys each role should have. If anything differs from
the current root, it writes a new root version. The current root key signs it,
and so does the new one when the root key itself changes. Giving
`--targets-key` re-signs `targets` from the publisher records. Commit what it
writes.

```sh
# A publisher record was added or changed.
uv run initiative-registry sign-offline --targets-key $keys/targets.pem

# Rotate an online key: make the new one, name it in root, then replace the CI secret.
uv run initiative-registry keygen --role snapshot-2 --out $keys
uv run initiative-registry sign-offline --root-key $keys/root.pem \
  --snapshot-pub $keys/snapshot-2.pub.json

# Rotate the targets key: root names the new key, and targets is re-signed with it.
uv run initiative-registry sign-offline --root-key $keys/root.pem \
  --targets-key $keys/targets-2.pem

# Rotate the root key.
uv run initiative-registry sign-offline --root-key $keys/root.pem \
  --new-root-key $keys/root-2.pem

# Renew both before the year is up. The build warns 30 days ahead.
uv run initiative-registry sign-offline --root-key $keys/root.pem --renew-root \
  --targets-key $keys/targets.pem
```

A client moves from the root it has to the newest one a version at a time, so
every `<N>.root.json` stays in `metadata/`. Raising a threshold is a root change
like any other.

To rotate a publisher's key, change its record, re-sign `targets`, then replace
its secret.

## Commands

```sh
uv sync
uv run initiative-registry keygen --role <role> --out <dir>
uv run initiative-registry init-root …
uv run initiative-registry sign-offline …
uv run initiative-registry build --target public --sources sources --out <dir> [--keys <dir>]
uv run initiative-registry refresh-timestamp --repo <dir> [--keys <dir>]
uv run initiative-registry verify --repo <dir or URL> --root metadata/1.root.json [--target public]
```

`build` and `refresh-timestamp` look for each online key in this order:
1. `--snapshot-key`, `--timestamp-key` or `--publisher-key PREFIX=PATH`;
2. `<--keys>/<name>.pem`;
3. the environment variables above.

`refresh-timestamp` re-signs only `timestamp`, over the snapshot a built
directory already serves.

`verify` reads a repository with python-tuf's `ngclient`, starting from the
root you give it:
- it walks the root chain, then timestamp, snapshot and targets;
- it loads every publisher's role through its delegation;
- it downloads and checks every listing, and every file each listing names.

It works on a directory or on the published URL.

`scripts/ephemeral-build.sh` runs the whole sequence (keys, root, build,
verify) over this checkout's sources with throwaway keys, outside the checkout.
CI runs it on every pull request.

## CI

[`.github/workflows/registry.yml`](../.github/workflows/registry.yml):

- **Pull request:** `ruff check`, `ruff format --check`, `pytest`, and
  `scripts/ephemeral-build.sh`.
- **Push to `main`:** the same checks, then:
  - `build --target public` with the committed metadata and the online keys
    from secrets;
  - `verify`;
  - a deploy to GitHub Pages under `/public/`.

  Until `metadata/` holds a signed root, it publishes nothing.
- **Daily:** the same build and deploy, so the timestamp, snapshot and
  publisher roles are re-signed well before they expire.

## Development

```sh
uv sync
uv run ruff check && uv run ruff format --check
uv run pytest
```
