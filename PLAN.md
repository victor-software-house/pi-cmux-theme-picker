# PLAN: Migrate from semantic-release to changesets (DR-01 + DR-02)

**Branch:** `chore/changesets-migration`
**Base:** `main`
**PR title:** `chore: migrate from semantic-release to changesets`
**Version impact:** none — no changeset file included, no npm release triggered.

---

## Context

This project (`pi-cmux-theme-picker`, v0.3.0) currently uses `semantic-release` to publish to npm on every push to `main`. This causes version churn, accidental bumps, and no human review gate before publishing.

We are migrating to `@changesets/cli` with the GitHub changesets action for batched, PR-gated releases with OIDC trusted publishing (no npm tokens).

Decision records:
- `docs/decisions/DR-01-changesets-migration.md` — full rationale and migration design
- `docs/decisions/DR-02-force-bump-rules.md` — superseded by DR-01 (changesets handles force bumps naturally)

## Decisions (confirmed)

- **D1:** Bun is the sole package manager (`bun add`, `bun install --frozen-lockfile` in CI).
- **D2:** Two GitHub Actions workflows: `ci.yml` (validation) and `release.yml` (changesets action).
- **D3:** OIDC trusted publishing stays. `id-token: write` in `release.yml`. No `NPM_TOKEN`.
- **D4:** Lefthook hooks (commitlint, lockfile sync, typecheck) unchanged.
- **D5:** Existing CHANGELOG.md entries preserved. Changesets appends in its own format.
- **D6:** `@changesets/changelog-github` for PR-linked changelog entries.
- **D7:** No post-publish `[skip ci]` commit. "Version Packages" PR merge carries bumps natively.
- **D8:** DR-02 status → `superseded by DR-01`. Never implemented.
- **D9:** Work on branch `chore/changesets-migration`. No direct push to main.
- **D10:** No changeset file in this PR → no npm release on merge.
- **D11:** PR opened via `gh pr create` at the end.
- Branch protection / rulesets are out of scope (separate follow-up).

---

## Steps

### Step 1: Create feature branch

```bash
git checkout -b chore/changesets-migration main
```

**Verify:** `git branch --show-current` outputs `chore/changesets-migration`.

---

### Step 2: Remove semantic-release dependencies

Remove all semantic-release packages from `package.json` devDependencies:

```bash
bun remove semantic-release @semantic-release/changelog @semantic-release/git @semantic-release/github @semantic-release/npm
```

**Verify:** `package.json` devDependencies contains none of the five packages above. `bun.lock` is regenerated.

---

### Step 3: Install changesets dependencies

```bash
bun add -D @changesets/cli @changesets/changelog-github
```

**Verify:** `package.json` devDependencies contains `@changesets/cli` and `@changesets/changelog-github`.

---

### Step 4: Initialize changesets

```bash
bunx changeset init
```

This creates `.changeset/config.json` and `.changeset/README.md`.

Then **overwrite** `.changeset/config.json` with exactly:

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3/schema.json",
  "changelog": [
    "@changesets/changelog-github",
    { "repo": "victor-software-house/pi-cmux-theme-picker" }
  ],
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

**Verify:** `.changeset/config.json` exists with the content above. `.changeset/README.md` exists.

---

### Step 5: Delete `release.config.mjs`

```bash
rm release.config.mjs
```

**Verify:** `ls release.config.mjs` fails with "No such file."

---

### Step 6: Create `.github/workflows/ci.yml`

Create the file with this exact content:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - name: Set up Bun
        uses: oven-sh/setup-bun@v2

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Compute commitlint range
        id: range
        run: |
          if [ "${{ github.event_name }}" = "pull_request" ]; then
            FROM="${{ github.event.pull_request.base.sha }}"
            TO="${{ github.event.pull_request.head.sha }}"
          else
            FROM="${{ github.event.before }}"
            TO="${{ github.sha }}"
            if [ "$FROM" = "0000000000000000000000000000000000000000" ]; then
              FROM=$(git rev-list --max-parents=0 HEAD | tail -n 1)
            fi
          fi
          echo "from=$FROM" >> "$GITHUB_OUTPUT"
          echo "to=$TO" >> "$GITHUB_OUTPUT"

      - name: Lint commit messages
        run: bunx commitlint --from "${{ steps.range.outputs.from }}" --to "${{ steps.range.outputs.to }}" --verbose

      - name: Type check
        run: bun run typecheck

      - name: Verify package contents
        run: npm pack --dry-run
```

**Verify:** File exists at `.github/workflows/ci.yml`. YAML is valid (`cat` and inspect).

---

### Step 6b: Add `changeset status` to `ci.yml` (changeset enforcement)

Append the following step to the `validate` job in `ci.yml`, after "Verify package contents":

```yaml
      - name: Require changeset
        if: github.event_name == 'pull_request' && !startsWith(github.head_ref, 'changeset-release/')
        run: bunx changeset status --since=origin/main
```

This step:
- Runs **only on PRs** (not on push to main).
- **Skips the auto-maintained "Version Packages" PR** (branch `changeset-release/main`).
- Fails if package files changed without a `.changeset/*.md` file.
- PRs that intentionally skip a release use `bunx changeset --empty` to satisfy the check.

**Verify:** The step is present in `ci.yml` after the pack step. The `if` condition references `changeset-release/`.

---

### Step 7: Replace `.github/workflows/publish.yml` with `release.yml`

Delete `publish.yml` and create `release.yml`:

```bash
rm .github/workflows/publish.yml
```

Create `.github/workflows/release.yml` with this exact content:

```yaml
name: Release

on:
  push:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      id-token: write

    steps:
      - name: Check out repository
        uses: actions/checkout@v6

      - name: Set up Bun
        uses: oven-sh/setup-bun@v2

      - name: Set up Node.js
        uses: actions/setup-node@v6
        with:
          node-version: lts/*
          registry-url: https://registry.npmjs.org

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Upgrade npm for OIDC trusted publishing
        run: npm install -g npm@latest

      - name: Create release PR or publish
        uses: changesets/action@v1
        with:
          version: bunx changeset version
          publish: bunx changeset publish
          commit: "chore(release): version packages"
          title: "chore(release): version packages"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ""
```

**Verify:** `publish.yml` is gone. `release.yml` exists with content above. YAML is valid.

**Note — npm trusted publisher update required after merge:** The existing `publish.yml` is registered in npmjs.com trusted publisher settings. After this PR merges, update the trusted publisher config at `https://www.npmjs.com/package/pi-cmux-theme-picker` → Settings → Trusted Publishers: change the workflow filename from `publish.yml` to `release.yml`. Publishing will fail until this is done. See Step 13 for the full post-merge checklist.

---

### Step 7b: Add `changeset-gate` to `lefthook.yml`

Add a `changeset-gate` command to the `pre-push` section of `lefthook.yml`, after the existing `typecheck` command:

```yaml
    changeset-gate:
      run: |
        BASE=$(git merge-base origin/main HEAD 2>/dev/null) || exit 0
        COMMITS=$(git log --format="%s%n%b" "${BASE}..HEAD" 2>/dev/null)
        [ -z "$COMMITS" ] && exit 0

        TYPES=$(echo "$COMMITS" | grep -oE '^(feat|fix|perf|revert)(\([^)]+\))?!?:' \
          | grep -oE '^[a-z]+' | sort -u | tr '\n' ' ')
        HAS_BREAKING=$(echo "$COMMITS" \
          | grep -cE '(BREAKING[- ]CHANGE|^[a-z]+(\([^)]+\))?!:)' || echo 0)

        [ -z "$TYPES" ] && [ "$HAS_BREAKING" -eq 0 ] && exit 0

        CHANGESETS=$(find .changeset -name "*.md" \
          ! -name "README.md" ! -name "config.json" 2>/dev/null \
          | wc -l | tr -d ' ')
        [ "$CHANGESETS" -gt 0 ] && exit 0

        BUMP="patch"
        echo "$TYPES" | grep -q "feat" && BUMP="minor"
        [ "$HAS_BREAKING" -gt 0 ] && BUMP="major"

        echo ""
        echo "STOP — changeset required."
        echo ""
        echo "Commits in this push include release-implying types: ${TYPES}"
        echo "Minimum bump implied: ${BUMP}"
        echo "No .changeset/*.md file found."
        echo ""
        echo "Action required:"
        echo "  bunx changeset        # interactive — select bump type and write summary"
        echo "  git add .changeset/"
        echo "  git commit -m 'chore: add changeset for <short description>'"
        echo ""
        echo "If this push intentionally should NOT release, use:"
        echo "  bunx changeset --empty"
        echo "  git add .changeset/"
        echo "  git commit -m 'chore: empty changeset — no release intended'"
        echo ""
        exit 1
```

The full `pre-push` section of `lefthook.yml` should look like:

```yaml
pre-push:
  commands:
    lockfile-sync:
      run: bun install --frozen-lockfile
    typecheck:
      run: bun run typecheck
    changeset-gate:
      run: |
        BASE=$(git merge-base origin/main HEAD 2>/dev/null) || exit 0
        COMMITS=$(git log --format="%s%n%b" "${BASE}..HEAD" 2>/dev/null)
        [ -z "$COMMITS" ] && exit 0

        TYPES=$(echo "$COMMITS" | grep -oE '^(feat|fix|perf|revert)(\([^)]+\))?!?:' \
          | grep -oE '^[a-z]+' | sort -u | tr '\n' ' ')
        HAS_BREAKING=$(echo "$COMMITS" \
          | grep -cE '(BREAKING[- ]CHANGE|^[a-z]+(\([^)]+\))?!:)' || echo 0)

        [ -z "$COMMITS" ] && exit 0
        [ -z "$TYPES" ] && [ "$HAS_BREAKING" -eq 0 ] && exit 0

        CHANGESETS=$(find .changeset -name "*.md" \
          ! -name "README.md" ! -name "config.json" 2>/dev/null \
          | wc -l | tr -d ' ')
        [ "$CHANGESETS" -gt 0 ] && exit 0

        BUMP="patch"
        echo "$TYPES" | grep -q "feat" && BUMP="minor"
        [ "$HAS_BREAKING" -gt 0 ] && BUMP="major"

        echo ""
        echo "STOP — changeset required."
        echo ""
        echo "Commits in this push include release-implying types: ${TYPES}"
        echo "Minimum bump implied: ${BUMP}"
        echo "No .changeset/*.md file found."
        echo ""
        echo "Action required:"
        echo "  bunx changeset        # interactive — select bump type and write summary"
        echo "  git add .changeset/"
        echo "  git commit -m 'chore: add changeset for <short description>'"
        echo ""
        echo "If this push intentionally should NOT release, use:"
        echo "  bunx changeset --empty"
        echo "  git add .changeset/"
        echo "  git commit -m 'chore: empty changeset — no release intended'"
        echo ""
        exit 1
```

**Verify:** `grep "changeset-gate" lefthook.yml` returns a match. Push a test with a `fix:` commit and no changeset — gate must fire.

---

### Step 8: Update decision records

**`docs/decisions/DR-01-changesets-migration.md`:** Change the first line after the title from `**Status:** planned` to `**Status:** implemented`.

**`docs/decisions/DR-02-force-bump-rules.md`:** Change:
- `**Status:** planned (blocked by [DR-01](DR-01-changesets-migration.md))` → `**Status:** superseded by [DR-01](DR-01-changesets-migration.md)`
- `**Priority:** next` → remove this line entirely

Add a section at the end before any existing `## References`:

```markdown
## Resolution

Superseded by DR-01. With changesets, any change that needs a release gets a changeset file with an explicit bump type — regardless of commit type. The semantic-release `releaseRules` approach described above was never implemented.
```

**Verify:** `grep "Status:" docs/decisions/DR-01*.md` shows `implemented`. `grep "Status:" docs/decisions/DR-02*.md` shows `superseded`.

---

### Step 9: Update ROADMAP.md

Replace the `## Next` section items with:

```markdown
## Next

- [x] **Migrate to changesets** — replaced semantic-release with `@changesets/cli`. See [DR-01](docs/decisions/DR-01-changesets-migration.md). ✔
- [x] ~~**Force-bump rules**~~ — superseded by changesets (explicit changeset files replace commit-type rules). See [DR-02](docs/decisions/DR-02-force-bump-rules.md).
- [ ] **Branch protection** — require PRs to `main`, no direct push. Configure via GitHub rulesets (`gh api`). Pairs with changesets model.
```

**Verify:** `grep -c "\[x\]" ROADMAP.md` returns 2. The branch protection item remains unchecked.

---

### Step 10: Update AGENTS.md

Replace the `## What matters most` section with:

````markdown
## What matters most

This is a published npm package with changesets-gated releases. Merging to `main` does not publish automatically — only merging the auto-maintained "Version Packages" PR triggers an npm publish. Treat `main` as a release branch.
````

Replace the `## Commit discipline` section (from `## Commit discipline` up to but not including the next `##` heading) with:

````markdown
## Commit discipline

- Small, logical commits — one change per commit.
- Conventional Commits are mandatory (enforced by lefthook + CI commitlint).
- PRs that affect the published package must include a changeset file (`bunx changeset`).
- The changeset file specifies the bump type (`patch`, `minor`, `major`) and a human-readable description.

**Before merging a PR with a changeset, confirm the bump type:**

| Changeset type | Version bump | Example |
|:---|:---|:---|
| `patch` | 0.3.0 → 0.3.1 | bug fix, UX correction, behavioral adjustment |
| `minor` | 0.3.0 → 0.4.0 | net-new user-facing command, new API surface |
| `major` | 0.3.0 → 1.0.0 | removed command, renamed parameter, broken import |

**DO:** use `patch` for improvements, corrections, and UX refinements to existing features.

**DO NOT:** use `minor` for changes to a feature that already shipped. Adding a setting to an existing command is `patch`, not `minor`.
````

Replace the `### Release pipeline` section (from `### Release pipeline` up to but not including the next `###` heading) with:

````markdown
### Release pipeline

- `@changesets/cli` manages versioning. PRs that affect the published package include a changeset file (`.changeset/*.md`).
- The changesets GitHub Action (`.github/workflows/release.yml`) maintains a "Version Packages" PR that accumulates pending changesets.
- Merging the "Version Packages" PR bumps `package.json`, updates `CHANGELOG.md`, deletes changeset files, and publishes to npm.
- Uses OIDC trusted publishing — no `NPM_TOKEN`, no `NODE_AUTH_TOKEN` in the workflow.
- Provenance is generated automatically in CI (`publishConfig.provenance: true`). Local `npm publish` requires `--provenance=false`.
- PRs without changeset files do not trigger releases (docs, refactors, chores are invisible to versioning).
- To force a release for a non-code change (e.g. README update visible on npm), add a `patch` changeset.

DO NOT add `NPM_TOKEN` or `NODE_AUTH_TOKEN` to the workflow — it would break OIDC trust.
````

Add a new `## Pre-push changeset gate` section after `## Commit discipline` and before the architecture constraints:

````markdown
## Pre-push changeset gate

Before every push, check whether a changeset is required. This is the bridge between conventional commits and changesets — enforced by the lefthook `changeset-gate` hook and reinforced here as agent guidance.

**Release rule (derived from conventional commit types in the push):**

| Commit types present | Changeset required? | Minimum bump |
|:---------------------|:--------------------|:-------------|
| Only `chore:` `docs:` `refactor:` `test:` `ci:` `style:` | No | — |
| Any `fix:` `perf:` `revert:` | Yes | `patch` |
| Any `feat:` | Yes | `minor` |
| Any `feat!:` or `BREAKING CHANGE:` footer | Yes | `major` |

**If a changeset is required and none exists:**

1. Run `bunx changeset` — select the correct bump type and write a short consumer-facing summary.
2. `git add .changeset/ && git commit -m "chore: add changeset for <description>"`

**If the push intentionally should not release** (releasable commits but release not wanted):

Run `bunx changeset --empty` — creates an empty changeset that satisfies both the hook and CI without triggering a version bump.

**Blocking message emitted by the hook:**

```
STOP — changeset required.

Commits in this push include release-implying types: <types>
Minimum bump implied: <patch|minor|major>
No .changeset/*.md file found.
```

CI also enforces this via `changeset status --since=origin/main` on PRs.
````

Update the `## Orient quickly` file listing — replace the lines referencing `release.config.mjs` and `publish.yml` with:

```
.changeset/                            — changeset config + pending changeset files
lefthook.yml                           — commit-msg: commitlint · pre-push: lockfile + typecheck + changeset-gate
.github/workflows/ci.yml               — PR validation: commitlint, typecheck, changeset status
.github/workflows/release.yml          — changesets action: Version Packages PR + npm publish (OIDC)
```

**Verify:**
- `grep "semantic-release" AGENTS.md` returns no matches.
- `grep "changesets" AGENTS.md` returns matches.
- `grep "Pre-push changeset gate" AGENTS.md` returns a match.
- `grep "changeset-gate" AGENTS.md` returns a match.

---

### Step 10b: Add empty changeset for this PR

This migration PR has no releasable commits (`chore:` only), but `changeset status` in CI will check for it. To be explicit:

```bash
bunx changeset --empty
git add .changeset/
```

This creates an empty changeset file (no packages, no bump) that satisfies the CI gate.

**Verify:** A new `.changeset/*.md` file exists with empty frontmatter (`---\n---`).

---

### Step 11: Typecheck

```bash
bun run typecheck
```

**Verify:** Exit code 0. No errors. This project has no source code changes, but typecheck must still pass to confirm nothing broke.

---

### Step 12: Commit

Stage all changes and commit:

```bash
git add -A
git commit -m "chore: migrate from semantic-release to changesets

- Replace semantic-release with @changesets/cli + @changesets/changelog-github
- Split single publish.yml into ci.yml (validation) and release.yml (changesets action)
- Keep OIDC trusted publishing (no NPM_TOKEN)
- Keep lefthook hooks (commitlint, lockfile sync, typecheck)
- Delete release.config.mjs
- Update DR-01 status to implemented, DR-02 to superseded
- Update ROADMAP.md, AGENTS.md for new release workflow

No changeset file included — this PR does not trigger an npm release.

Refs: DR-01, DR-02"
```

**Verify:** `git log --oneline -1` shows the commit. `git diff --cached` is empty (everything committed).

---

### Step 13: Push and open PR

```bash
git push -u origin chore/changesets-migration
```

Then open the PR:

```bash
gh pr create \
  --base main \
  --head chore/changesets-migration \
  --title "chore: migrate from semantic-release to changesets" \
  --body "## Summary

Replaces semantic-release with @changesets/cli for batched, PR-gated npm releases.

## What changed

- **Removed:** semantic-release + 4 plugins, release.config.mjs
- **Added:** @changesets/cli, @changesets/changelog-github, .changeset/ config
- **Workflows:** split into ci.yml (validation) + release.yml (changesets action)
- **Kept:** OIDC trusted publishing, lefthook hooks, commitlint, provenance

## How releases work now

1. PRs that affect the package include a changeset file (\`bunx changeset\`)
2. Changesets action maintains a \"Version Packages\" PR accumulating pending changesets
3. Merging that PR bumps version, updates CHANGELOG.md, publishes to npm
4. PRs without changesets (like this one) do not trigger releases

## Decision records

- [DR-01: Changesets migration](docs/decisions/DR-01-changesets-migration.md) — implemented
- [DR-02: Force-bump rules](docs/decisions/DR-02-force-bump-rules.md) — superseded by DR-01

## Verification

- [ ] \`bun run typecheck\` passes
- [ ] No changeset file present (no release on merge)
- [ ] CI workflow runs on this PR
- [ ] After merge: push a test commit to main → release.yml should create a \"Version Packages\" PR (empty, since no changesets exist yet)
"
```

**Verify:** `gh pr view --json url` returns the PR URL. PR is open against `main`.

---

## Post-merge verification (manual, not part of this branch)

After the PR is merged to `main`:

1. **Update npm trusted publisher** — go to `https://www.npmjs.com/package/pi-cmux-theme-picker` → Settings → Trusted Publishers. Change workflow filename from `publish.yml` to `release.yml`. This must be done before any changeset-triggered publish attempt or publishing will fail with an OIDC trust error.
2. Check that `ci.yml` runs and passes on the merge commit.
3. Check that `release.yml` runs — it should detect no pending changesets and do nothing (no "Version Packages" PR created yet).
4. To test the full flow later: create a branch, make a change, run `bunx changeset`, open a PR, merge it, and verify the "Version Packages" PR appears.
5. When the "Version Packages" PR is eventually merged, verify publish succeeds with OIDC (no `NPM_TOKEN`).

---

## Rollback

If anything breaks after merge: revert the merge commit on `main`. Re-add semantic-release deps and `release.config.mjs` from git history. The old `publish.yml` is recoverable from the commit before the merge.
