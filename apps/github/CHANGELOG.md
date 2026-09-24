# Changelog

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

### Upgrading

- Existing installs are removed and installed again, then the GitHub
  organization is connected again and members connect their accounts again.
- On the GitHub App's settings, the setup URL and webhook URL change to the
  ones listed in the README, and the Contents permission and the Release and
  Create events are no longer needed.
- `DATABASE_URL`, `APP_ENCRYPTION_KEY`, `INITIATIVE_APP_SECRET` and
  `OUTBOX_INTERVAL_SECONDS` are no longer read. `INITIATIVE_APP_PRIVATE_KEY`
  and `INITIATIVE_APP_KEY_ID` are new.
