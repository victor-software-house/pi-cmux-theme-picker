# DR-01: Migrate from semantic-release to changesets

**Status:** planned
**Priority:** next

## Problem

semantic-release publishes on every push to `main`. This causes:
- Version churn from small fixes
- Accidental bumps from squash merge titles (`feat:` when `fix:` was intended → 0.2.0 → 0.3.0)
- No batching — each push is a separate release
- No human review gate before publishing to npm

## Decision

Migrate to [`@changesets/cli`](https://github.com/changesets/changesets) with the GitHub bot for automated release PRs.

## How changesets works

1. Each PR that should trigger a release includes a changeset file (`.changeset/*.md`) describing the change and its semver impact (`patch`, `minor`, `major`).
2. The changesets GitHub bot maintains a "Version Packages" PR that accumulates pending changesets.
3. Merging the "Version Packages" PR bumps `package.json`, updates `CHANGELOG.md`, and publishes to npm.
4. PRs without changesets don't trigger releases — docs, refactors, and chores are invisible to versioning.

## Migration steps

1. Install: `pnpm add -D @changesets/cli @changesets/changelog-github`
2. Init: `pnpm changeset init` (creates `.changeset/` directory with config)
3. Configure `.changeset/config.json`:
   ```json
   {
     "changelog": ["@changesets/changelog-github", { "repo": "victor-software-house/pi-cmux-theme-picker" }],
     "commit": false,
     "fixed": [],
     "linked": [],
     "access": "public",
     "baseBranch": "main",
     "updateInternalDependencies": "patch",
     "ignore": []
   }
   ```
4. Replace `.github/workflows/publish.yml` with two workflows:
   - `release.yml` — runs `changeset version` + `changeset publish` on the release PR merge
   - `ci.yml` — runs typecheck + commitlint on every push/PR (no release logic)
5. Remove: `semantic-release`, `@semantic-release/*` plugins, `release.config.mjs`
6. Keep: OIDC trusted publishing (works the same — just move `id-token: write` to the release workflow)
7. Keep: lefthook commit-msg + pre-push hooks (unchanged)

## Workflow after migration

```
developer creates PR
  → adds changeset: `pnpm changeset` (interactive prompt for bump type + description)
  → PR reviewed and merged to main

changesets bot updates "Version Packages" PR
  → accumulates all pending changesets
  → shows exact version bump and changelog preview

maintainer merges "Version Packages" PR when ready
  → changeset version: bumps package.json, writes CHANGELOG.md, deletes changeset files
  → changeset publish: publishes to npm with provenance
  → creates git tag
```

## What about force bumps?

Changesets handles this naturally — `pnpm changeset` prompts for the bump type. To force a patch for a docs change, just create a changeset with `patch` and describe it. No special commit type rules needed.

## What about failed releases?

If npm publish fails mid-release, the "Version Packages" PR is still open (version was bumped but not published). Re-run the workflow or close and re-open the PR to trigger the bot again.

## References

- [changesets docs](https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md)
- [changesets GitHub action](https://github.com/changesets/action)
- [npm trusted publishing with changesets](https://docs.npmjs.com/generating-provenance-statements#using-third-party-ci-cd)
