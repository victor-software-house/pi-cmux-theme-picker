# pi-cmux-theme-picker — Agent Guide

Pi extension that provides live cmux terminal theme picking with synchronized Pi + cmux theme switching.
Published to npm as `pi-cmux-theme-picker`. Source: `extensions/` (TypeScript, Bun, no build step — Pi loads `.ts` directly).

## What matters most

This is a published npm package with automated releases via semantic-release on `main`. Every push to `main` is evaluated. Releasable commit types (`fix:`, `feat:`, `feat!:`) trigger a real npm publish. Treat `main` as a release branch.

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
release.config.mjs  — semantic-release: commit-analyzer → npm → github → git (version back to main)
lefthook.yml        — commit-msg: commitlint · pre-push: bun lockfile sync + typecheck
.github/workflows/publish.yml — OIDC trusted publishing, no NPM_TOKEN
```

## Verification

Run before every commit:

```bash
bun run typecheck   # tsc --noEmit — only gate required
```

Lefthook enforces commit message format on `git commit` and lockfile sync + typecheck on `git push`. Do not bypass.

## Commit discipline

- Small, logical commits — one change per commit.
- Conventional Commits are mandatory (enforced by lefthook + CI commitlint).
- Push to `main` carefully — every push can trigger a real npm release.
- **Squash merge titles determine the version bump**, not individual commits in the PR.

**Before pushing to `main`, state the version impact explicitly:**

| Commit type | Version bump | Example |
|:---|:---|:---|
| `chore:` `docs:` `refactor:` `test:` | none | dependency updates, README, internal restructure |
| `fix:` | patch (0.3.0 → 0.3.1) | bug fix, UX correction, behavioral adjustment |
| `feat:` | minor (0.3.0 → 0.4.0) | net-new user-facing command, new API surface |
| `feat!:` / `BREAKING CHANGE:` footer | major (0.3.0 → 1.0.0) | removed command, renamed parameter, broken import |

**DO:** use `fix:` for improvements, corrections, and UX refinements to existing features — even significant ones.

**DO NOT:** use `feat:` for changes to a feature that already shipped. Adding a setting to an existing command is `fix:`, not `feat:`.

**Before pushing, tell the user:** "This commit is `<type>:`, which will bump `<current>` → `<next>`. Confirm push?"

## Release pipeline

- `semantic-release` runs on every push to `main` via `.github/workflows/publish.yml`.
- Uses OIDC trusted publishing — no `NPM_TOKEN`, no `NODE_AUTH_TOKEN` in the workflow.
- `@semantic-release/git` commits the bumped `package.json` + `bun.lock` + `CHANGELOG.md` back to `main` with `[skip ci]`.
- Provenance is generated automatically in CI (`publishConfig.provenance: true`). Local `npm publish` requires `--provenance=false`.

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
