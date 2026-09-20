# Contributing to @talk2view/sdk

Internal notes for the Talk2View team. Partner-facing documentation is in
[README.md](README.md) and [docs/chat.md](docs/chat.md).

## Publishing

The SDK is published to npm via the **Publish SDK** GitHub Actions workflow (`Actions → Publish SDK → Run workflow`).

### Prerequisites

- An `NPM_TOKEN` repository secret with publish access to `@talk2view/sdk` (Settings → Secrets → Actions)
- The workflow uses npm provenance signing (`--provenance`), which requires the `id-token: write` permission (already configured)

### Production Release

Use this when shipping a stable version to partners.

1. Go to **Actions → Publish SDK → Run workflow**
2. Set **Version bump type** to `patch`, `minor`, or `major`
3. Click **Run workflow**

What happens:
- Builds and typechecks the SDK
- Bumps `package.json` version (e.g. `0.2.0` → `0.2.1` for patch)
- Publishes to npm as `latest` tag
- Commits the version bump and creates a git tag `sdk-v0.2.1`
- Pushes the commit and tag to `main`

Partners running `npm install @talk2view/sdk` will get this version.

### Dev / Testing Release

Use this to publish a prerelease version for testing before a stable release.

1. Go to **Actions → Publish SDK → Run workflow**
2. Set **Version bump type** to `prerelease`
3. Set **Prerelease identifier** to `dev` (default), `beta`, or `rc`
4. Click **Run workflow**

What happens:
- Builds and typechecks the SDK
- Bumps version with preid (e.g. `0.2.0` → `0.2.1-dev.0`, or `0.2.1-dev.0` → `0.2.1-dev.1`)
- Publishes to npm with the preid as dist-tag (e.g. `--tag dev`)
- Does **not** commit, tag, or push to git (prerelease versions are ephemeral)

To install a dev release:
```bash
npm install @talk2view/sdk@dev
```

To install a specific prerelease version:
```bash
npm install @talk2view/sdk@0.2.1-dev.0
```

### Version Lifecycle Example

```
0.1.0 (current latest)
  ↓ prerelease (preid=dev)
0.1.1-dev.0 (tagged as "dev" on npm)
  ↓ prerelease (preid=dev)
0.1.1-dev.1
  ↓ prerelease (preid=beta)
0.1.1-beta.0 (tagged as "beta" on npm)
  ↓ minor (production release)
0.2.0 (tagged as "latest" on npm, git tagged sdk-v0.2.0)
```

### Manual Publishing (escape hatch)

If CI is down or you need to publish from your machine:

```bash
cd packages/sdk
npm run build
npm run typecheck
npm version prerelease --preid=dev --no-git-tag-version
npm publish --access public --tag dev
```

For a production release from local (not recommended):
```bash
npm version patch --no-git-tag-version
npm publish --access public
git add package.json
git commit -m "Release @talk2view/sdk v$(node -p "require('./package.json').version")"
git tag "sdk-v$(node -p "require('./package.json').version")"
git push origin main --tags
```

---
