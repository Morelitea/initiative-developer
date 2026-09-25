# Changelog

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
