# GitHub for Initiative

Brings a GitHub organization's issues, pull requests and Dependabot alerts into
an [Initiative](https://github.com/Morelitea/initiative) community, as dashboard
tiles and as steps an automation can call.

```
ghcr.io/morelitea/initiative-github
```

## What it offers

| | |
|---|---|
| **Fourteen reads** | Repositories · who can be assigned · branches · labels · milestones · one issue · find issues · one pull request · find pull requests · Dependabot alerts · project boards · a board's fields · a field's values · an issue's card |
| **Seven writes** | Open an issue · comment · close · reopen · change labels · request a review · move a Projects card |
| **Six announcements** | An issue was opened · an issue was closed · a review was requested · a release was published · a pre-release was published · a tag was pushed |
| **Four widgets** | Open issues · pull requests waiting on your review · Dependabot alerts by severity · a fortnight of opened against closed |
| **A dashboard** | *GitHub overview*, arranging the four widgets. Point each tile at a repository where you place it. |

Every endpoint, widget and connection is named in English, German, Spanish and
French.

**Two credentials, two jobs.**

- **Reads run on the organization's installation**, so a tile answers the same
  for everyone in the community, whether or not they have connected anything.
  They reach exactly the repositories the organization ticked on GitHub's
  install page.
- **Writes run on the member's own GitHub account**, so an issue opened by an
  automation is opened by the person whose automation it is. A write never
  falls back to the app: a member who has not connected is told to.
  *Waiting on your review* also needs your own account, because it is about
  you.

**Initiative runs the connections.** Initiative sends people to GitHub, takes
them back, keeps the organization's installation in the app's configuration
and each member's GitHub authorization in their own connection, renews member
tokens, and mints the organization's installation tokens from the GitHub App's
key. The app asks Initiative for a token when it calls GitHub, and stores
nothing.

**Other apps use it through Initiative.** Every read and write is public: an
app the community has let use GitHub (`apps:morelitea.github`) calls it
through Initiative, as the community or as one of its members. A read takes
either and answers on the organization's installation. A write takes only a
member and runs on that member's own GitHub account, so an automation's
"comment on the issue" is theirs. Writes are reachable only this way.

**Removing it.** When a member disconnects, leaves or is blocked, or the app is
removed, Initiative ends the member's GitHub authorization at GitHub (the
grant, so its refresh token goes too). Turning the app off, or a community
being put on hold, only pauses it: everything is kept, and nobody has to
authorize again when it is turned back on.

## Installing it

### 1. Set it up for the deployment

Once per deployment, in Initiative under **Settings → Platform → Integrations →
App services**, on the GitHub app's registration:

1. **Copy the Compose service** shown there into the `docker-compose.yml` that
   runs Initiative, so the app joins its network. It runs the listed image and
   keeps the app's key on a volume, and the registration's address is filled in
   as `http://github:8080`.
2. **Press Create the GitHub App.** GitHub shows the app it is about to create,
   with the permissions and events in the table below and Initiative's
   addresses already set. Confirm it there, and GitHub sends you back to
   Initiative with the app's six values entered for you. Then
   `docker compose up -d`.
3. Press **Connect** on the registration. The app proves who it is to
   Initiative with its own key: on first start it generates one, keeps it in
   `/data`, serves the public half at `/.well-known/jwks.json`, and logs its
   fingerprint at every start:

   ```text
   app key fingerprint: <thumbprint> (kid <kid>)
   ```

   The fingerprint Initiative shows when it connects is the one in the log.

To give the app a key instead, generate one and set
`INITIATIVE_APP_PRIVATE_KEY` and `INITIATIVE_APP_KEY_ID` (the volume is then
not needed):

```sh
npx -p initiative-app-sdk initiative-app keygen --alg ES256 --out ./secrets
```

`secrets/private-key.pem` is the key and the printed `kid` its id. Keep
`secrets/` out of any repository.

#### By hand

An Initiative that shows no Compose service or **Create the GitHub App** takes
the same steps by hand.

Register the GitHub App on GitHub under *Settings → Developer settings → GitHub
Apps → New GitHub App*. `{APP_URL}` stands for Initiative's own public address:

| Setting | Value |
|---|---|
| Callback URL | `{APP_URL}/api/v1/app-connections/callback` |
| Expire user authorization tokens | on |
| Request user authorization (OAuth) during installation | off |
| Setup URL | `{APP_URL}/api/v1/app-connections/setup` |
| Webhook URL | `{APP_URL}/api/v1/app-hooks/morelitea.github` |
| Webhook secret | a long random value |
| Repository permissions | Issues: read and write · Pull requests: read and write · Contents: read · Dependabot alerts: read · Metadata: read |
| Organization permissions | Projects: read and write |
| Events | Issues · Pull request · Release · Create |

Then generate a private key and a client secret on the app's page, and enter
the GitHub App's client ID, client secret, slug (the name in its address,
`github.com/apps/<slug>`), app ID, private key and webhook secret on the
GitHub app's registration in Initiative. The app is not live until all six are
set.

Add the app to the `docker-compose.yml` that runs Initiative:

```yaml
services:
  github:
    image: ghcr.io/morelitea/initiative-github@sha256:<digest>
    restart: unless-stopped
    environment:
      INITIATIVE_BASE_URL: http://initiative:8173/api/v1
    volumes:
      - github_data:/data

volumes:
  github_data:
```

Then `docker compose up -d`, and register the app under **App services** at
`http://github:8080`, checking its key's fingerprint as in step 4.

### 2. In a community

1. A community superadmin installs **GitHub** from the marketplace and
   confirms what it may reach.
2. In the app's settings, they press **Connect** on *GitHub organization*.

### 3. On GitHub

3. GitHub's install page opens. Choose the account and the repositories the
   app may see. Only an owner of that account can finish; anyone else sends a
   request for an owner to approve, and Initiative says it is waiting.
4. GitHub asks you to authorize once, and the app checks that the installation
   you chose is one you hold. You are sent back to Initiative, connected. The
   app reports the organization's configuration as working at its next check.
5. Each member who wants their review queue, or whose automations write to
   GitHub, connects *Your GitHub account* in the app's settings.

Adding or removing repositories later is done at GitHub, on the app's
*Configure* page, and needs nothing here.

## Settings

Required: the app refuses to start without it, and names what is missing.

| Variable | |
|---|---|
| `INITIATIVE_BASE_URL` | Initiative's API as this container reaches it, e.g. `http://initiative:8173/api/v1`. |

Optional:

| Variable | Default | |
|---|---|---|
| `PORT` | `8080` | |
| `INITIATIVE_APP_PRIVATE_KEY` | | The app's own key for Initiative: PEM, PEM with literal `\n`, or base64 of the PEM. Unset, the app generates one. |
| `INITIATIVE_APP_KEY_ID` | the key's thumbprint | The `kid` that key is registered under. |
| `INITIATIVE_APP_DATA_DIR` | `/data` | Where a generated key is kept, as `app-key.pem`. |
| `GITHUB_API_BASE` | `https://api.github.com` | GitHub's API. |
| `GITHUB_WEB_BASE` | `https://github.com` | GitHub's website, for the Dependabot alerts link. |

## Running it

Initiative calls the app at its registered address, for its endpoints and its
three hooks (`/v1/hooks/after_connect`, `/v1/hooks/webhook`,
`/v1/hooks/schedule`).

Every 15 minutes, Initiative asks the app to check each community's
organization. The app reports the configuration as not working when GitHub has
removed or suspended the installation, or will not give a token for it. There
is nothing to set up for this.

The app needs no public address. GitHub's webhook deliveries go to Initiative,
which checks each one and forwards it to the app's webhook hook for every
community connected to the installation it came from. No browser is ever sent
to the app, and only Initiative calls it. A deployment that registers the
app's key by address reads it at `/.well-known/jwks.json`.

`GET /healthz` and `GET /readyz` both answer once the process is up.

## Upgrading from 2.5

Initiative now ends a member's GitHub authorization itself, so this needs
Initiative 0.75.0 or later. Take this version's manifest and image together:
an Initiative still holding 2.5.0's manifest calls the revoke hook, which this
version no longer has. Remove `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`
from the app's settings; it no longer reads them.

## Upgrading from 2.2

Initiative now runs the organization check on a schedule, so this needs an
Initiative that runs app schedules. Remove `SYNC_INTERVAL_SECONDS` from the
app's settings; it no longer reads it.

## Upgrading from 2.1

GitHub's webhooks now go to Initiative, so this needs an Initiative that
receives app webhooks.

1. On the GitHub App's settings, set the webhook URL to
   `{APP_URL}/api/v1/app-hooks/morelitea.github`. The webhook secret, the
   events and every other setting stay as they are.
2. Enter the GitHub App's webhook secret as the *Webhook secret* vendor value
   on the app's registration in Initiative.
3. Remove `GITHUB_WEBHOOK_SECRET` from the app's settings; it no longer reads
   it. The app's public address, if it had one only for GitHub, can go.

## Upgrading from 2.0

On the GitHub App's settings, add the Contents: read repository permission and
the Release and Create events. GitHub asks each organization's owner to approve
the new permission; until they do, that organization's releases and tags are
not announced. Everything else carries on as it was.

## Upgrading from 1.0

Initiative now runs both GitHub connections, so this needs Initiative's app
connections (the vendor values under App services).

1. On the GitHub App's settings, replace the callback URLs with
   `{APP_URL}/api/v1/app-connections/callback` and the setup URL with
   `{APP_URL}/api/v1/app-connections/setup`. The webhook URL stays.
2. Enter the GitHub App's client ID, client secret, slug, app ID and private
   key on the app's registration in Initiative.
3. Remove `APP_PUBLIC_URL`, `GITHUB_APP_PRIVATE_KEY` and `GITHUB_APP_SLUG` from
   the app's settings; it no longer reads them.
4. Each member connects their GitHub account again, once. A community's GitHub
   organization is kept; if its connection shows as not set up, an admin
   connects it again.

## Working on it

The app is built on [initiative-app-sdk](https://github.com/Morelitea/initiative-app-sdk):
`src/app.ts` declares everything it does, and the SDK serves it.

```sh
npm install
npm run typecheck
npm test
npm run manifest         # rebuild manifest.json from src/app.ts, widgets bundled
npm run manifest:check   # CI: fail if manifest.json is stale
npm run listing          # at a release: manifest.json and the registry source
```

`npm run listing` writes the app's registry source under
`registry/sources/morelitea/<uid>/`: the listing, this version's manifest and
`assets/avatar.png`. It writes it only while the listing in `src/app.ts` names
the version in `package.json`, so run it once the release has bumped both and
the listing names the pushed image's digest.

MIT licensed.
