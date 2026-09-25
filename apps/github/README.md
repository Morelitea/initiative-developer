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

**Nothing is stored by the app.** The organization's installation is kept in
the app's configuration in Initiative, and each member's GitHub authorization
in their own connection there. The app holds short-lived copies in memory.

**Removing it.** When Initiative stops listing an installation, the app ends
every member's GitHub authorization under it (the grant, so its refresh token
goes too), and forgets what it cached. When a member disconnects, leaves or is
blocked, their authorization is ended at the next sync. Initiative lists only
installations that are turned on, so turning the app off is treated the same
way.

## Installing it

### 1. Register a GitHub App

Once per deployment, on GitHub under *Settings → Developer settings → GitHub
Apps → New GitHub App*. With `https://github-app.example.com` standing for
this app's public address:

| Setting | Value |
|---|---|
| Callback URLs | `https://github-app.example.com/connect/github/callback` and `https://github-app.example.com/install/github/verify` |
| Expire user authorization tokens | on |
| Request user authorization (OAuth) during installation | off |
| Setup URL | `https://github-app.example.com/install/github/setup` |
| Webhook URL | `https://github-app.example.com/github/webhook` |
| Webhook secret | a long random value, also given to the app as `GITHUB_WEBHOOK_SECRET` |
| Repository permissions | Issues: read and write · Pull requests: read and write · Dependabot alerts: read · Metadata: read |
| Organization permissions | Projects: read and write |
| Events | Issues · Pull request |

Then generate a private key and a client secret on the app's page. Those, the
client ID and the webhook secret are the app's `GITHUB_*` settings.

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
4. GitHub asks you to authorize once, which confirms the installation you chose
   is one you hold. You are sent back to Initiative, connected.
5. Each member who wants their review queue, or whose automations write to
   GitHub, connects *Your GitHub account* in the app's settings.

Adding or removing repositories later is done at GitHub, on the app's
*Configure* page, and needs nothing here.

## Settings

Required: the app refuses to start without any of them, and names what is
missing.

| Variable | |
|---|---|
| `APP_PUBLIC_URL` | This app's public address. GitHub sends people and webhooks here. |
| `INITIATIVE_BASE_URL` | Initiative's API as this container reaches it, e.g. `http://initiative:8173/api/v1`. |
| `INITIATIVE_APP_PRIVATE_KEY` | The app's own key for Initiative: PEM, PEM with literal `\n`, or base64 of the PEM. |
| `INITIATIVE_APP_KEY_ID` | The `kid` that key is registered under. |
| `GITHUB_CLIENT_ID` | The GitHub App's client ID. |
| `GITHUB_CLIENT_SECRET` | The GitHub App's client secret. |
| `GITHUB_APP_PRIVATE_KEY` | The GitHub App's private key, in any of the forms above. |
| `GITHUB_WEBHOOK_SECRET` | The GitHub App's webhook secret. |

Optional:

| Variable | Default | |
|---|---|---|
| `PORT` | `8080` | |
| `SYNC_INTERVAL_SECONDS` | `300` | How often installations are listed and checked. |
| `GITHUB_APP_SLUG` | read from GitHub | The GitHub App's slug, for its install page. |
| `GITHUB_API_BASE` | `https://api.github.com` | For GitHub Enterprise Server, with `GITHUB_WEB_BASE`. |
| `GITHUB_WEB_BASE` | `https://github.com` | |

## Running it

```sh
docker run -d --name initiative-github -p 8080:8080 --env-file github-app.env \
  ghcr.io/morelitea/initiative-github@sha256:<digest>
```

Put it behind the same reverse proxy as Initiative, at `APP_PUBLIC_URL`, and
register the container's address (for example `http://initiative-github:8080`)
as the app's location in Initiative.

- `GET /healthz` answers once the process is up; `GET /readyz` once the first
  installations sync has reached Initiative.
- A connect or install trip is remembered in memory for ten minutes, so run one
  replica, or route a person's requests to the same one.

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
