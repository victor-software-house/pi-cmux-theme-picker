# pi-cmux-theme-picker — Agent Guide

Pi extension that provides live cmux terminal theme picking with synchronized Pi + cmux theme switching.
Published to npm as `pi-cmux-theme-picker`. Source: `extensions/` (TypeScript, Bun, no build step — Pi loads `.ts` directly).

## What matters most

This is a published npm package with automated releases via semantic-release on `main`. Every push to `main` is evaluated. Releasable commit types (`fix:`, `feat:`, `feat!:`) trigger a real npm publish. Treat `main` as a release branch.

## Orient quickly

```
extensions/
  index.ts      — session_start hook · /theme · /theme-settings · status bar · autocomplete
  picker.ts     — TUI inline picker (debounce 80ms + background prewrite)
  pi-theme.ts   — Pi theme JSON generation · writeAndSetPiTheme · preview file lifecycle
  cmux.ts       — cmux CLI (getCurrentCmuxThemeName · runCmuxThemeSet · getAvailableCmuxThemes)
  colors.ts     — pure color math (hex/rgb/hsl · contrast · mixing)
  settings.ts   — persisted settings via pi.appendEntry() · restoreSettings on session_start
  types.ts      — shared interfaces (CmuxColors · CmuxThemeEntry · FilterMode · SessionContext)
release.config.mjs  — semantic-release: commit-analyzer → npm → github → git (version back to main)
lefthook.yml        — commit-msg hook: commitlint (Conventional Commits enforced locally)
.github/workflows/publish.yml — OIDC trusted publishing, no NPM_TOKEN
```

## Verification

Run before every commit:

```bash
bun run typecheck   # tsc --noEmit — only gate required
```

Lefthook enforces commit message format automatically on `git commit`. Do not bypass it.

## Commit discipline

- Small, logical commits — one change per commit.
- Conventional Commits are mandatory (enforced by lefthook + CI commitlint).
- Push to `main` carefully — every push can trigger a real npm release.

**Before pushing to `main`, state the version impact explicitly:**

| Commit type | Version bump | Example |
|:---|:---|:---|
| `chore:` `docs:` `refactor:` `test:` | none | dependency updates, README, internal restructure |
| `fix:` | patch (0.1.0 → 0.1.1) | bug fix, UX correction, behavioral adjustment |
| `feat:` | minor (0.1.0 → 0.2.0) | net-new user-facing command, new API surface |
| `feat!:` / `BREAKING CHANGE:` footer | major (0.1.0 → 1.0.0) | removed command, renamed parameter, broken import |

**DO:** use `fix:` for improvements, corrections, and UX refinements to existing features — even significant ones.

**DO NOT:** use `feat:` for changes to a feature that already shipped. Adding a setting to an existing command is `fix:`, not `feat:`. A new `/theme-settings` subcommand on an existing `/theme` is `fix:`.

**DO NOT:** use `feat!:` or `BREAKING CHANGE:` for internal refactors. Breaking changes mean a Pi user who installed this package will have their workflow break.

**Before pushing, tell the user:** "This commit is `<type>:`, which will bump `<current>` → `<next>`. Confirm push?"

## Release pipeline

- `semantic-release` runs on every push to `main` via `.github/workflows/publish.yml`.
- Uses OIDC trusted publishing — no `NPM_TOKEN`, no `NODE_AUTH_TOKEN` in the workflow.
- `@semantic-release/git` commits the bumped `package.json` + `bun.lock` + `CHANGELOG.md` back to `main` with `[skip ci]`.
- Provenance is generated automatically in CI (`publishConfig.provenance: true`). Local `npm publish` requires `--provenance=false`.

DO NOT add `NPM_TOKEN` or `NODE_AUTH_TOKEN` to the workflow — it would break OIDC trust.

## Architecture constraints

### cmux only

cmux is the sole terminal multiplexer target. No Ghostty CLI fallbacks. No hardcoded color overrides in Ghostty config files.

### Theme file naming

| Purpose | Prefix | Example |
|:---|:---|:---|
| Live preview (ephemeral) | `cmux-preview-` | `cmux-preview-nord.json` |
| Confirmed / session-start | `cmux-sync-` | `cmux-sync-nord.json` |

Preview files are cleaned up on confirm and cancel. Never leave stale `cmux-preview-*` files.

### Pi API: always use the live theme instance

The `theme` factory parameter in `ctx.ui.custom(...)` is captured once at overlay creation. When `setTheme` changes the theme during preview, this reference goes stale.

**DO:** `ctx.ui.theme` (live Proxy, always current)
**DO NOT:** the `theme` param from the `ctx.ui.custom` factory closure

All `theme.fg()` / `theme.bold()` calls in `picker.ts` must go through `const t = () => ctx.ui.theme`.

### Preview design invariant

The file write and the `setTheme` + cmux calls must remain separated:

1. `setImmediate` → write JSON to disk (background, non-blocking)
2. Debounce settles (80ms) → `ctx.ui.setTheme(previewName)` + `runCmuxThemeSet(name)` back-to-back, no I/O between them

Do not merge steps 1 and 2. The point is that `setTheme` fires with the file already on disk.

### Settings persistence

Settings are stored via `pi.appendEntry(ENTRY_TYPE, data)` and restored in `session_start` by scanning `ctx.sessionManager.getEntries()` in reverse. Auto-sync is off by default.

## Documentation

`README.md` is the human entry point (usage, controls, install). This file is agent-operational guidance. Do not duplicate between them. When behavior changes, update both in the same commit.
