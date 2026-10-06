# initiative-developer

Where Initiative's plug-ins are built and published.

- **`registry/`** builds the signed catalogue Initiative follows: every plug-in
  and piece of content listed there, its publisher, and for a plug-in the keys
  and the most it may ever be granted. The catalogue is a [TUF](https://theupdateframework.io/)
  repository, so a deployment only ever installs what the keys it already
  trusts have signed, and can tell a stale catalogue from a current one.
- **`plugins/`** holds the plug-ins we publish, built on
  [initiative-plugin-sdk](https://github.com/beyonders-studio/initiative-plugin-sdk).

A listing is added by a pull request that adds its source under
`registry/sources/<publisher>/<listing>/`. Merging it publishes it.

MIT licensed.
