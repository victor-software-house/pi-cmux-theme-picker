# pi-cmux-theme-picker — Agent Guide

Pi extension that provides live cmux terminal theme picking with synchronized Pi + cmux theme switching.
Published to npm as `pi-cmux-theme-picker`. Source: `extensions/` (TypeScript, Bun, no build step — Pi loads `.ts` directly).

## What matters most

This is a published npm package with changesets-gated releases. Merging to `main` does not publish automatically — only merging the auto-maintained "Version Packages" PR triggers an npm publish. Treat `main` as a release branch.

## Orient quickly

```
extensions/
  index.ts      — session_start hook · /theme · /theme-settings · status bar · autocomplete
  picker.ts     — TUI inline picker (trailing-only debounce, zero work in handleInput)
  pi-theme.ts   — Pi theme JSON generation · writeAndSetPiTheme · in-memory Theme building
  cmux.ts       — cmux CLI (getCurrentCmuxThemeName · runCmuxThemeSet · getAvailableCmuxThemes)
  colors.ts     — pure color math (hex/rgb/hsl · contrast · mixing)
  settings.ts   — disk-persisted settings (~/.pi/agent/extensions/pi-cmux-theme-picker.json)
  types.ts      — shared interfaces (CmuxColors · CmuxThemeEntry · FilterMode · SessionContext · ThemeParams)
.changeset/                            — changeset config + pending changeset files
lefthook.yml                           — commit-msg: commitlint · pre-push: lockfile + typecheck + changeset-gate
.github/workflows/ci.yml               — PR validation: commitlint, typecheck, changeset status
.github/workflows/release.yml          — changesets action: Version Packages PR + npm publish (OIDC)
```

## Verification

Run before every commit:

```bash
bun run typecheck   # tsc --noEmit — only gate required
```

Lefthook enforces commit message format on `git commit` and lockfile sync + typecheck + changeset gate on `git push`. Do not bypass.

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

## Release pipeline

- `@changesets/cli` manages versioning. PRs that affect the published package include a changeset file (`.changeset/*.md`).
- The changesets GitHub Action (`.github/workflows/release.yml`) maintains a "Version Packages" PR that accumulates pending changesets.
- Merging the "Version Packages" PR bumps `package.json`, updates `CHANGELOG.md`, deletes changeset files, and publishes to npm.
- Uses OIDC trusted publishing — no `NPM_TOKEN`, no `NODE_AUTH_TOKEN` in the workflow.
- Provenance is generated automatically in CI (`publishConfig.provenance: true`). Local `npm publish` requires `--provenance=false`.
- PRs without changeset files do not trigger releases (docs, refactors, chores are invisible to versioning).
- To force a release for a non-code change (e.g. README update visible on npm), add a `patch` changeset.

DO NOT add `NPM_TOKEN` or `NODE_AUTH_TOKEN` to the workflow — it would break OIDC trust.

## Architecture constraints

### cmux only

cmux is the sole terminal multiplexer target. No Ghostty CLI fallbacks.

### Theme file naming

| Purpose | Prefix | Example |
|:---|:---|:---|
| Live preview (ephemeral, in-memory) | `cmux-preview-` | `cmux-preview-nord-1712512345678` |
| Confirmed / session-start (on disk) | `cmux-sync-` | `cmux-sync-nord.json` |

In-memory theme instances always use **unique names** (slug + `Date.now()`) so renderer caches keyed on `theme.name` invalidate. File names on disk stay **constant** (`cmux-sync-{slug}`).

### Pi API: always use the live theme

`ctx.ui.theme` is a **Proxy** — always reflects the current global theme, not a snapshot. Do NOT try to capture it for later restoration (`instanceof Theme` fails on the Proxy).

**DO:** `const t = () => ctx.ui.theme` — call on every render for live colors
**DO NOT:** `const originalTheme = ctx.ui.theme` — this captures the Proxy, not a snapshot

For cancel/restore: build a fresh Theme instance from the original cmux colors via `buildThemeInstance`.

### Preview architecture

`handleInput` must do **zero heavy work** — only update shared state + `requestRender()`.

Theme preview runs in a **trailing-only debounce** (`perfect-debounce`, configurable `previewDebounceMs`):
1. `handleInput` updates `selectedTheme`, returns immediately
2. Debounce fires after cooldown, reads latest `selectedTheme`
3. Builds in-memory Theme instance, applies via `setTheme(instance)`
4. `runCmuxThemeSet` updates terminal

No leading edge. No work during input processing. Debounce reads shared state — no arguments passed.

### Pi's registeredThemes cache

`ctx.ui.setTheme(name)` checks an internal `registeredThemes` Map. If a theme was previously loaded under the same name, it returns the **stale cached instance** without re-reading disk.

**Workaround:** `setTheme(instance)` calls `setThemeInstance` internally, which bypasses the cache entirely. On confirm, call `setTheme(name)` first to register with Pi's `settingsManager` (persists across restarts), then immediately override with `setTheme(instance)` for correct colors.

### Settings persistence

Settings are stored as JSON on disk (not session-scoped):
- Global: `~/.pi/agent/extensions/pi-cmux-theme-picker.json`
- Project override: `<cwd>/.pi/extensions/pi-cmux-theme-picker.json`

Settings are reloaded from disk on every `session_start` event (`startup`, `reload`, `new`, `resume`, `fork`).

### Dependencies

- `perfect-debounce` — trailing-only debounce (zero deps, ESM-native, typed)
- Both `pnpm-lock.yaml` and `bun.lock` must stay in sync. CI uses `bun install --frozen-lockfile`. Pre-push hook validates.

## Documentation

`README.md` is the human entry point (usage, controls, install). This file is agent-operational guidance. Do not duplicate between them. When behavior changes, update both in the same commit.
