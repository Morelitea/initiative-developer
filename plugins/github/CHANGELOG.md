# Changelog

## [6.0.0]

### Changed

- Built on `initiative-plugin-sdk` 6.0, and the manifest names the oldest
  plug-in API contract it needs: `min_plugin_api` `"6.0"`. An Initiative
  serving an older contract, or another major, refuses to install it.

## [5.0.0]

Published under BeyondersStudio, the organization's new name.

### Changed

- The plug-in's public id is `beyonders-studio.github`, where it was
  `morelitea.github`. Every endpoint and announcement id starts
  `plugin.beyonders-studio.github.`, another plug-in the community lets use
  GitHub is granted `plugins:beyonders-studio.github`, and the dashboard is
  `beyonders-studio.github-overview`.
- The registry lists it under the publisher `beyonders-studio`.
- The webhook URL is `{APP_URL}/api/v1/plugin-hooks/beyonders-studio.github`.

### Upgrading

- An Initiative sees this as a different plug-in from `morelitea.github`.
  Install it afresh and reconnect the GitHub organization; automations and
  dashboards that call `plugin.morelitea.github.*` need pointing at the new
  ids. In the GitHub App's settings, change the webhook URL to the one above.

## [4.0.0]

Renamed for Initiative's plug-ins.

### Changed

- The listing is a `plugin`, and every endpoint and announcement id starts
  `plugin.morelitea.github.` instead of `app.morelitea.github.`.
- Another plug-in the community lets use GitHub is granted
  `plugins:morelitea.github`.
- Built on [initiative-plugin-sdk](https://github.com/beyonders-studio/initiative-plugin-sdk)
  2.0.0.

### Upgrading

- Needs an Initiative that speaks plug-ins. An older one refuses this
  manifest.

## [3.1.0]

Connecting an installation asks who controls its account.

### Changed

- Connecting an organization's installation needs an admin of that
  organization, and connecting a personal account's installation needs that
  account. Initiative checks it when you authorize, with no new permission.
- `repo` names one repository of the connected organization: a name GitHub
  could not give a repository answers `repository-required`, or `not-found`
  from a write.

### Upgrading

- Needs Initiative 0.75.0 or later.

## [3.0.0]

The app runs inside Initiative.

### Changed

- Initiative makes every call to GitHub itself, from what the manifest
  declares, and reshapes GitHub's answers. There is no image, Compose service,
  key or Connect step: set it up by creating the GitHub App, then install it.
- Initiative turns GitHub's deliveries into the six announcements itself, and
  checks every 15 minutes that each organization's installation still exists.
- Pull requests waiting on your review have their own endpoint,
  `review-queue`, which asks GitHub as you. `find-pull-requests` searches as
  the organization and takes a reviewer's login, not `@me`.
- A read of a repository the installation does not cover answers GitHub's own
  `not-found`. A refusal answers `not-authorized`, and GitHub limiting
  requests is a failure to retry rather than an answer.
- `label` sets the issue's whole set of labels in one change.

### Upgrading

- Needs Initiative 0.75.0 or later.
- After upgrading, stop and remove the old `github` service and its
  `github_data` volume.
- Move dashboards and automations that pass `review_requested: "@me"` to
  `find-pull-requests` over to `review-queue`.

## [2.6.0]

Initiative can set the app up, and ends a member's authorization itself.

### Changed

- The app's manifest describes the GitHub App it needs, so Initiative can
  create it with one button on the app's registration and enter its six values
  itself. The permissions and events are the ones the README lists for
  registering it by hand.
- The listing carries the Compose service to run the app beside Initiative,
  which Initiative shows on the app's registration to copy.
- Initiative ends a member's GitHub authorization itself, with the GitHub
  App's values it already holds. The app no longer needs the client ID and
  secret, and no longer has a revoke hook.

### Upgrading

- Needs Initiative 0.75.0 or later; an older one refuses this manifest.
- Take this version's manifest and image together: an Initiative still holding
  2.5.0's manifest calls the revoke hook, which this version no longer has.
- Remove `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` from the app's settings;
  it no longer reads them.

## [2.5.0]

The app keeps its own key.

### Changed

- With no `INITIATIVE_APP_PRIVATE_KEY`, the app makes a signing key on first
  start and keeps it in `/data` (`INITIATIVE_APP_DATA_DIR`). Mount a volume
  there so the key survives a restart.
- Every start logs `app key fingerprint: <thumbprint> (kid <kid>)`, to check
  against the fingerprint Initiative shows when it pins the app's keys.

### Upgrading

- Nothing to do: a key given in the environment is used as before.

## [2.4.0]

Rebuilt on the Initiative app SDK, with no change to what it does.

### Upgrading

- Needs an Initiative that types the tokens it sends apps.

## [2.3.0]

Initiative runs the organization check.

### Changed

- Every 15 minutes, Initiative asks the app whether each community's GitHub
  installation still exists. The app no longer runs a timer of its own.
- `/readyz` answers as soon as the process is up.

### Upgrading

- Needs an Initiative that runs app schedules.
- Remove `SYNC_INTERVAL_SECONDS` from the app's settings; it is no longer
  read.

## [2.2.0]

Initiative receives GitHub's webhooks.

### Changed

- GitHub's webhook deliveries go to Initiative, which checks them and hands
  each to the app for every community connected to the installation it came
  from. Initiative keeps each announcement and delivers it until it is taken,
  so none is lost while a subscriber is away.
- The app needs no public address: only Initiative calls it.

### Upgrading

- Needs an Initiative that receives app webhooks.
- On the GitHub App, set the webhook URL to
  `{APP_URL}/api/v1/app-hooks/morelitea.github`. Nothing else changes there.
- Enter the GitHub App's webhook secret as the *Webhook secret* vendor value
  on the app's registration, and remove `GITHUB_WEBHOOK_SECRET` from the app's
  settings.

## [2.1.0]

Other apps can use GitHub through Initiative.

### Added

- Every read and write can be called by another app the community has let use
  GitHub. A read answers on the organization's installation, whether the app
  calls as the community or as a member. A write runs only as a member, on
  their own GitHub account; a member who has not connected is told to.
- The reads *who can be assigned*, *branches* and *milestones*, which fill
  the assignee, reviewer, *waiting on* and milestone choices.
- The announcements *a release was published*, *a pre-release was published*
  and *a tag was pushed*.

### Upgrading

- Needs an Initiative that lets apps call one another.
- On the GitHub App, add the Contents: read permission and the Release and
  Create events. Each organization's owner approves the new permission on
  GitHub; until then its releases and tags are not announced.

## [2.0.0]

Initiative runs the GitHub connections.

### Changed

- Initiative sends people to GitHub's install and authorization pages, keeps
  every token, renews members' tokens and mints the organization's
  installation tokens. The app asks it for a token for each call, and ends a
  member's authorization at GitHub when Initiative calls its revoke hook.
- A write GitHub refuses for want of a permission the organization did not
  grant answers GitHub's own `forbidden`, rather than being refused before it
  is sent.
- The configuration is reported unavailable when no installation token can be
  had for several syncs in a row.

### Upgrading

- Needs an Initiative that runs app connections. On the GitHub App, the
  callback URL becomes `{APP_URL}/api/v1/app-connections/callback` and the
  setup URL `{APP_URL}/api/v1/app-connections/setup`; the GitHub App's client
  ID, client secret, slug, app ID and private key are entered on the app's
  registration in Initiative.
- Members connect their GitHub account again, once.
- `APP_PUBLIC_URL`, `GITHUB_APP_PRIVATE_KEY` and `GITHUB_APP_SLUG` are no
  longer read.

## [1.0.0]

Rewritten on the installation-token platform.

### Changed

- The app keeps no database. The organization's GitHub installation is kept in
  the app's configuration in Initiative, and each member's GitHub authorization
  in their own connection there.
- The app signs in to Initiative with its own key instead of a shared secret.
  Installing it is done in Initiative alone; there is no registration step per
  community.
- Announcements are handed to Initiative, which delivers them to subscribers.
- Reads answer on the organization's installation. Writes run on the member's
  own GitHub account and never fall back to the app.
- Turning the app off in Initiative pauses it and keeps every member's GitHub
  authorization; only removing it ends them.

### Upgrading

- Existing installs are removed and installed again, then the GitHub
  organization is connected again and members connect their accounts again.
- On the GitHub App's settings, the setup URL and webhook URL change to the
  ones listed in the README, and the Contents permission and the Release and
  Create events are no longer needed.
- `DATABASE_URL`, `APP_ENCRYPTION_KEY`, `INITIATIVE_APP_SECRET` and
  `OUTBOX_INTERVAL_SECONDS` are no longer read. `INITIATIVE_APP_PRIVATE_KEY`
  and `INITIATIVE_APP_KEY_ID` are new.
