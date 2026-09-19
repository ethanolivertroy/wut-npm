# wut-cli

npm wrapper for [wut](https://github.com/ethanolivertroy/wut) — a tiny, fast
terminal assistant powered by Cerebras.

```sh
npm install --global wut-cli
wut "why is this container restarting?"
```

The wrapper downloads the prebuilt release binary for your platform
(macOS/Linux, Intel/ARM) on first run, checks it against the SHA-256 published
with the release, and caches it in `~/.cache/wut-npm/<version>/`. Every later
run starts the cached binary directly.

Requires Node 18 or newer and a Cerebras API key: export `CEREBRAS_API_KEY` or
write it to `~/.config/wut/credentials`.

## Other install methods

```sh
brew install ethanolivertroy/tap/wut
cargo install wut
curl -fsSL https://raw.githubusercontent.com/ethanolivertroy/wut/main/install.sh | sh
```

## Environment

- `WUT_NPM_CACHE_DIR` — where the binary is cached (default `$XDG_CACHE_HOME/wut-npm`)
- `WUT_NPM_BASE_URL` — override the release download base (defaults to the GitHub release)
- `WUT_NPM_VERBOSE` — print the install path when the binary is first unpacked

## Development

```sh
npm test          # hermetic: builds throwaway archives and serves them locally
```

Tests never touch the network or the real cache: they start a local HTTP server,
serve a stub `wut`, and check the checksum gate rejects a tampered archive.

## License

MIT.
