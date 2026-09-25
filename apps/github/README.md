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
| **Eleven reads** | Repositories · labels · one issue · find issues · one pull request · find pull requests · Dependabot alerts · project boards · a board's fields · a field's values · an issue's card |
| **Seven writes** | Open an issue · comment · close · reopen · change labels · request a review · move a Projects card |
| **Three announcements** | An issue was opened · an issue was closed · a review was requested |
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
removed, Initiative ends the member's GitHub authorization (the grant, so its
refresh token goes too) by calling the app's revoke hook. Turning the app off,
or a community being put on hold, only pauses it: everything is kept, and
nobody has to authorize again when it is turned back on.

## Installing it

### 1. Register a GitHub App

Once per deployment, on GitHub under *Settings → Developer settings → GitHub
Apps → New GitHub App*. `{APP_URL}` stands for Initiative's own public address,
and `https://github-app.example.com` for this app's:

| Setting | Value |
|---|---|
| Callback URL | `{APP_URL}/api/v1/app-connections/callback` |
| Expire user authorization tokens | on |
| Request user authorization (OAuth) during installation | off |
| Setup URL | `{APP_URL}/api/v1/app-connections/setup` |
| Webhook URL | `https://github-app.example.com/github/webhook` |
| Webhook secret | a long random value, also given to the app as `GITHUB_WEBHOOK_SECRET` |
| Repository permissions | Issues: read and write · Pull requests: read and write · Dependabot alerts: read · Metadata: read |
| Organization permissions | Projects: read and write |
| Events | Issues · Pull request |

Then generate a private key and a client secret on the app's page.

- **Initiative** gets the GitHub App's values: its client ID, client secret,
  slug (the name in its address, `github.com/apps/<slug>`), app ID and private
  key. An operator enters them in **Settings → Platform → Integrations → App
  services**, on the GitHub app's registration. The app is not live until all
  five are set.
- **The app** gets the client ID and client secret too, as `GITHUB_CLIENT_ID`
  and `GITHUB_CLIENT_SECRET`: ending a member's authorization at GitHub is
  authenticated as the GitHub App's client, and Initiative's revoke hook call
  carries the tokens but not those. It also gets the webhook secret. It never
  needs the private key.

### 2. Give the app a key for Initiative

The app proves who it is to Initiative with its own key:

```sh
npx initiative-app keygen --alg ES256 --out ./secrets
```

`secrets/private-key.pem` becomes `INITIATIVE_APP_PRIVATE_KEY` and the printed
`kid` becomes `INITIATIVE_APP_KEY_ID`. The public half in `secrets/jwks.json`
is what the deployment registers for the app (the app also serves it at
`/.well-known/jwks.json`). Keep `secrets/` out of any repository.

### 3. In Initiative

1. A community admin installs **GitHub** from the marketplace and confirms
   what it may reach.
2. In the app's settings, the admin presses **Connect** on *GitHub
   organization*.

### 4. On GitHub

3. GitHub's install page opens. Choose the account and the repositories the
   app may see. Only an owner of that account can finish; anyone else sends a
   request for an owner to approve, and Initiative says it is waiting.
4. GitHub asks you to authorize once, and the app checks that the installation
   you chose is one you hold. You are sent back to Initiative, connected. The
   app reports the organization's configuration as working at its next sync.
5. Each member who wants their review queue, or whose automations write to
   GitHub, connects *Your GitHub account* in the app's settings.

Adding or removing repositories later is done at GitHub, on the app's
*Configure* page, and needs nothing here.

## Settings

Required: the app refuses to start without any of them, and names what is
missing.

| Variable | |
|---|---|
| `INITIATIVE_BASE_URL` | Initiative's API as this container reaches it, e.g. `http://initiative:8173/api/v1`. |
| `INITIATIVE_APP_PRIVATE_KEY` | The app's own key for Initiative: PEM, PEM with literal `\n`, or base64 of the PEM. |
| `INITIATIVE_APP_KEY_ID` | The `kid` that key is registered under. |
| `GITHUB_CLIENT_ID` | The GitHub App's client ID, for ending a member's authorization. |
| `GITHUB_CLIENT_SECRET` | The GitHub App's client secret, for the same. |
| `GITHUB_WEBHOOK_SECRET` | The GitHub App's webhook secret. |

Optional:

| Variable | Default | |
|---|---|---|
| `PORT` | `8080` | |
| `SYNC_INTERVAL_SECONDS` | `300` | How often installations are listed and checked. |
| `GITHUB_API_BASE` | `https://api.github.com` | GitHub's API. |
| `GITHUB_WEB_BASE` | `https://github.com` | Where a member's lapsed token is renewed before their authorization is ended. |

## Running it

```sh
docker run -d --name initiative-github -p 8080:8080 --env-file github-app.env \
  ghcr.io/morelitea/initiative-github@sha256:<digest>
```

Register the container's address (for example `http://initiative-github:8080`)
as the app's location in Initiative. Initiative calls the app there, for its
endpoints and its two hooks (`/v1/hooks/after_connect`, `/v1/hooks/revoke`).

The app's public address is for GitHub's webhook deliveries only
(`/github/webhook`), and for a deployment that registers the app's key by
address (`/.well-known/jwks.json`). No browser is ever sent to the app. If
GitHub cannot reach it, announcements stop, and an installation removed at
GitHub is noticed by the next sync rather than at once.

`GET /healthz` answers once the process is up; `GET /readyz` once the first
installations sync has reached Initiative.

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

```sh
npm install
npm run typecheck
npm test
npm run manifest   # rebuild manifest.json and listing.json, validated by the kit
```

`listing.json` is the app's registry source listing, with the manifest inline
and `assets/avatar.png` beside it. At a release, its image digest and key set
are replaced by the pushed image's digest and the app's public key.

MIT licensed.
