# DR-02: Force bump rules for visible changes

**Status:** planned (blocked by [DR-01](DR-01-changesets-migration.md))
**Priority:** next

## Problem

`docs:` and `chore:` commits don't trigger npm releases. But README changes are visible on the npm package page — stale READMEs confuse users.

## Current approach (semantic-release)

Add custom `releaseRules` to `@semantic-release/commit-analyzer`:

```js
["@semantic-release/commit-analyzer", {
  releaseRules: [
    { type: "docs", scope: "readme", release: "patch" },
    { type: "chore", scope: "bump", release: "patch" },
  ],
}]
```

- `docs(readme): update install instructions` → patch bump
- `chore(bump): force release` → patch bump (escape hatch)

## After changesets migration

This decision becomes moot. With changesets, any change that should trigger a release gets a changeset file — regardless of commit type. To release a README update, just add a `patch` changeset. No special rules needed.

## Decision

Do not implement the semantic-release rules. Wait for DR-01 (changesets migration) which solves this naturally.
