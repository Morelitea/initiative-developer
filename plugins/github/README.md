# GitHub for Initiative

Brings a GitHub organization's issues, pull requests and Dependabot alerts into
an [Initiative](https://github.com/Morelitea/initiative) community, as dashboard
tiles and as steps an automation can call.

It runs inside Initiative: the app is a manifest that says which GitHub calls
each endpoint makes and how to read the answers, and Initiative makes them.
There is no service to run beside it.

## What it offers

| | |
|---|---|
| **Fifteen reads** | Repositories · who can be assigned · branches · labels · milestones · one issue · find issues · one pull request · find pull requests · pull requests waiting on your review · Dependabot alerts · project boards · a board's fields · a field's values · an issue's card |
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
  *Waiting on your review* (`review-queue`) also needs your own account,
  because it is about you.

**Initiative runs everything.** Initiative sends people to GitHub, takes them
back, keeps the organization's installation in the app's configuration and
each member's GitHub authorization in their own connection, renews member
tokens, and mints the organization's installation tokens from the GitHub App's
key. It makes each endpoint's calls to `api.github.com` with the right token,
turns GitHub's webhook deliveries into the six announcements, and checks every
15 minutes that GitHub still has each organization's installation.

**Other apps use it through Initiative.** Every read and write is public: an
app the community has let use GitHub (`apps:morelitea.github`) calls it
through Initiative, as the community or as one of its members. A read takes
either and answers on the organization's installation, except the review
queue, which takes a member and asks GitHub as them. A write takes only a
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
App services**, on the GitHub app's registration, press **Create the GitHub
App**. GitHub shows the app it is about to create, with the permissions and
events in the table below and Initiative's addresses already set. Confirm it
there, and GitHub sends you back to Initiative with the app's six values
entered for you.

#### By hand

An Initiative that shows no **Create the GitHub App** takes the same step by
hand. Register the GitHub App on GitHub under *Settings → Developer settings →
GitHub Apps → New GitHub App*. `{APP_URL}` stands for Initiative's own public
address:

| Setting | Value |
|---|---|
| Callback URL | `{APP_URL}/api/v1/plugin-connections/callback` |
| Expire user authorization tokens | on |
| Request user authorization (OAuth) during installation | off |
| Setup URL | `{APP_URL}/api/v1/plugin-connections/setup` |
| Webhook URL | `{APP_URL}/api/v1/plugin-hooks/morelitea.github` |
| Webhook secret | a long random value |
| Repository permissions | Issues: read and write · Pull requests: read and write · Contents: read · Dependabot alerts: read · Metadata: read |
| Organization permissions | Projects: read and write |
| Events | Issues · Pull request · Release · Create |

Then generate a private key and a client secret on the app's page, and enter
the GitHub App's client ID, client secret, slug (the name in its address,
`github.com/apps/<slug>`), app ID, private key and webhook secret on the
GitHub app's registration in Initiative. The app is not live until all six are
set.

### 2. In a community

1. A community superadmin installs **GitHub** from the marketplace and
   confirms what it may reach.
2. In the app's settings, they press **Connect** on *GitHub organization*.

### 3. On GitHub

3. GitHub's install page opens. Choose the account and the repositories the
   app may see. Only an owner of that account can finish; anyone else sends a
   request for an owner to approve, and Initiative says it is waiting.
4. GitHub asks you to authorize once, and Initiative checks that you control
   the account the installation is on: an admin of the organization, or the
   user it is installed for. You are sent back to Initiative, connected.
5. Each member who wants their review queue, or whose automations write to
   GitHub, connects *Your GitHub account* in the app's settings.

Adding or removing repositories later is done at GitHub, on the app's
*Configure* page, and needs nothing here.

## Upgrading from 2.x

The app now runs inside Initiative, so this needs Initiative 0.75.0 or later.

1. Take this version's manifest. Initiative starts making the app's calls
   itself, and the community connections, members' accounts and the GitHub App
   carry on as they were.
2. Stop and remove the old `github` service and its `github_data` volume from
   the `docker-compose.yml` that runs Initiative. The registration's base
   address and key are no longer used.
3. Dashboards and automations that asked `find-pull-requests` for
   `review_requested: "@me"` move to `review-queue`, which takes the same
   parameters without it. `find-pull-requests` still takes a reviewer's login.

From 2.1 or older, also set the GitHub App up as the table under *By hand*
says: its webhook, callback and setup addresses point at Initiative, and it has
the Contents permission and the Release and Create events.

## Working on it

The app is built on [initiative-plugin-sdk](https://github.com/Morelitea/initiative-plugin-sdk):
`src/app.ts` declares everything it does. Each endpoint is a request to GitHub
and a [JSONata](https://jsonata.org) mapping of the answer; the tests run them
against GitHub's recorded answers in `test/fixtures/`.

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
the version in `package.json`, so run it once the release has bumped both.

MIT licensed.
