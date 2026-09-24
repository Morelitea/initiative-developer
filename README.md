# initiative-developer

Where Initiative's apps are built and published.

- **`registry/`** builds the signed catalogue Initiative follows: every app and
  piece of content listed there, its publisher, and for an app the keys and the
  most it may ever be granted. The catalogue is a [TUF](https://theupdateframework.io/)
  repository, so a deployment only ever installs what the keys it already
  trusts have signed, and can tell a stale catalogue from a current one.
- **`apps/`** holds the apps we publish, built on
  [initiative-app-kit](https://github.com/Morelitea/initiative-app-kit).

A listing is added by a pull request that adds its source under
`registry/sources/<publisher>/<listing>/`. Merging it publishes it.

MIT licensed.
