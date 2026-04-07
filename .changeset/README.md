# Changesets

This directory is managed by [@changesets/cli](https://github.com/changesets/changesets).

## When to add a changeset

Any PR with commits that affect the published package (`fix:`, `feat:`, `perf:`, `revert:`, or breaking changes) must include a changeset file.

## How

```bash
bunx changeset          # interactive — pick bump type + write summary
git add .changeset/
git commit -m "chore: add changeset"
```

To explicitly skip a release on a PR with releasable commits:

```bash
bunx changeset --empty
```

## What happens next

The changesets GitHub Action maintains a "Version Packages" PR. Merging that PR bumps `package.json`, updates `CHANGELOG.md`, and publishes to npm.
