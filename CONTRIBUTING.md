# Contributing to @talk2view/sdk

Partner-facing documentation is in [README.md](README.md) and
[docs/chat.md](docs/chat.md). This file is for people changing the SDK itself.

## Getting set up

```bash
npm install
npm test          # unit tests (vitest)
npm run lint      # typecheck
npm run build     # produces dist/
```

The browser suites need Playwright's Chromium:

```bash
npx playwright install --with-deps chromium
npm run test:e2e:chat-hosts    # the chat, rendered inside six hostile host pages
```

## Proposing a change

Fork, branch, open a pull request against `main`. CI runs the unit tests, the
typecheck, the build, the vendored-code check and the stylesheet audit on your
branch — with your branch's code and none of this repository's secrets, which is
why a pull request from a fork is safe to run.

A few things the reviewer will look for:

- **A test that fails without the change.** The interesting bugs in this package
  have all been behavioural — a stylesheet that leaked, an image that fetched
  itself, a key that reported the wrong error — and none of them were visible by
  reading the code.
- **No new runtime dependency** unless there is no reasonable alternative. This
  package is loaded into other people's applications; every dependency is
  something they did not choose.
- **Comments that say why, not what.**

## Vendored code

`src/chat/vendor/` holds files copied verbatim from
[assistant-ui](https://github.com/assistant-ui/assistant-ui) (MIT). They are not
ours to edit in place. To take an upstream change:

```bash
npm run chat:sync     # re-copies from the registry, restamps provenance headers
npm run chat:check    # CI runs this: fails if a vendored file drifted
```

Read the resulting diff. `chat:sync` records the upstream hash in
`src/chat/vendor/MANIFEST.json` *before* stamping the provenance header, so the
recorded hash stays what the registry actually served.

## Reporting a security problem

Not here. See [SECURITY.md](SECURITY.md).

## Publishing (maintainers)

Releases go out through the **Publish** workflow. There is no npm token in this
repository: npm [trusted publishing](https://docs.npmjs.com/trusted-publishers)
exchanges GitHub's OIDC token for short-lived publish rights, so there is no
long-lived credential here to steal, and provenance is attested automatically.

The workflow publishes **whatever version is committed on `main`** and refuses a
version that is already on npm. So a release is two steps, and the reviewed one
comes first:

1. **Open a pull request that bumps the version** in `package.json` and adds the
   CHANGELOG entry. This is the release: someone reviews the diff that is about
   to become a published artifact. Merge it.
2. **Actions → Publish → Run workflow**, choosing the dist-tag (`latest` for a
   stable release, `beta`/`next`/`dev` for a prerelease). The workflow
   typechecks, tests, builds and prints `npm pack --dry-run` — then waits for an
   approval on the `npm-publish` environment. Approve it after reading what the
   tarball contains. It publishes, then tags the commit `v<version>`.

The workflow never pushes to `main`, so branch protection needs no exception.

**There is no local escape hatch, by design.** Publishing from a laptop needs a
token that can publish, and that token is the single most valuable thing an
attacker could take from this project. If CI is broken, fix CI.
