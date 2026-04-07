# PLAN — UX Polish Execution Slice

Implements all items from the **UX polish** section of ROADMAP.md plus the full DR-03 design.

---

## Overview

Four UX work streams, ordered by dependency:

1. ~~**Preview cleanup**~~ — **INVALID** (see correction below)
2. **Status bar params summary** — show current ThemeParams snapshot in the status bar
3. **Settings panel: "Reset to defaults"** — add a reset action to `/theme-settings`
4. **Settings panel overhaul (DR-03)** — color swatches, palette role mapping, scoped settings

---

## 1. Preview cleanup — INVALID, requires reversal

~~**Problem:** `cmux-preview-*` theme files in `~/.pi/agent/themes/` may survive if the picker exits abnormally or if a code path skips cleanup.~~

**Correction:** The entire premise was wrong. `writePreviewFile()` is defined in `pi-theme.ts` but **never called anywhere** — it is dead code. All preview paths (`picker.ts` debounce and `/theme-settings` debounce in `index.ts`) use `buildThemeInstance()` which creates in-memory `Theme` instances applied via `ctx.ui.setTheme(instance)`. No `cmux-preview-*.json` files are ever written to disk during preview.

`removePreviewThemeFiles()` (also in `pi-theme.ts`) deletes files matching the `cmux-preview-` prefix, but since no code path creates them, it is also dead code.

Commit `46d952a` ("fix: clean up preview theme files on close") added `removePreviewThemeFiles()` calls to `picker.ts` (confirm + cancel) and `index.ts` (`/theme-settings` close handler). These calls are harmless (no-op) but misleading — they imply a cleanup problem that doesn't exist.

**Status:** ✔ Committed (`46d952a`) — but the commit is incorrect.

**Reversal tasks (to be done in a future commit):**

| Action | Detail |
|:--|:--|
| Remove `writePreviewFile()` from `pi-theme.ts` | Dead code — never called |
| Remove `removePreviewThemeFiles()` from `pi-theme.ts` | Dead code — cleans up files that are never created |
| Remove `removePreviewThemeFiles()` calls from `picker.ts` | Added in `46d952a`, no-op |
| Remove `removePreviewThemeFiles()` call from `index.ts` `/theme-settings` close | Added in `46d952a`, no-op |
| Remove `removePreviewThemeFiles()` call from `index.ts` session_start | Pre-existing, also no-op |
| Remove `removePreviewThemeFiles()` call from `index.ts` `/theme` direct-arg path | Pre-existing, also no-op |
| Keep `PREVIEW_THEME_PREFIX` only if needed elsewhere | Currently only used by the dead functions — remove if no other consumer |

---

## 2. Status bar params summary

**Problem:** The status bar shows `theme:<name>` but gives no hint about active generation params. Users must open `/theme-settings` just to see what's active.

**Design:** Extend the status bar to include a compact params summary when non-default values exist.

Format: `theme:nord · muted:0.65 dim:0.45 bg:12` (only params that differ from `DEFAULT_THEME_PARAMS`).

**Compact key mapping** (short labels for status bar):

| Param | Short key |
|:--|:--|
| `mutedWeight` | `muted` |
| `dimWeight` | `dim` |
| `borderWeight` | `border` |
| `bgShift` | `bg` |
| `selectedBgFactor` | `selBg` |
| `userMsgBgFactor` | `msgBg` |
| `toolPendingBgFactor` | `pendBg` |
| `toolSuccessTint` | `okTint` |
| `toolErrorTint` | `errTint` |
| `customMsgTint` | `custTint` |
| `linkContrastMin` | `linkCR` |
| `previewDebounceMs` | (omit — not theme-visible) |
| Fallback hex colors | (omit — too long, not useful in status) |

**Status:** ✔ Done — committed in `17c0f2a`.

---

## 3. Settings panel: "Reset to defaults"

**Problem:** No way to reset all ThemeParams back to defaults without manually cycling each value.

**Design:** Add a reset action triggered by a keybinding (`r` key).

When scoped settings land (task 4), reset in global mode resets global; reset in per-theme mode clears the per-theme overrides.

**Status:** ✔ Done — committed in `028dd63`. Scoped reset behavior is implemented in `9b21c1d` (`resetThemeParams` accepts scope) and wired in the uncommitted `index.ts` changes.

---

## 4. Settings panel overhaul (DR-03)

### 4a. Types — palette role source settings

Add `PaletteSource` type, `*Source` fields to `ThemeParams`, and a `resolvePaletteSourceColor()` resolver.

**Status:** ✔ Done — committed in `13b71d7` (types.ts + pi-theme.ts).

### 4b. Theme generation — use palette role mapping

Replace hardcoded `colors.palette[N]` in `generatePiTheme()` with `resolvePaletteSourceColor(colors, p.*Source)`.

**Status:** ✔ Done — committed in `13b71d7` (pi-theme.ts changes).

### 4c. Extended color swatches

Extend the `swatch()` helper and add a `computedSwatch()` that shows the mixed/tinted result for weight/tint settings. Palette source settings show the raw palette color swatch.

**Status:** ✔ Done — committed in `13b71d7` (index.ts changes to `buildItems()`).

### 4d. Palette role mapping settings UI

Add six new `SettingItem` entries in `buildItems()`, one per semantic role. Each shows a swatch of the resolved color. Values cycle through `palette[0]..palette[15]`, `fg`, `bg`.

**Status:** ✔ Done — committed in `13b71d7` (the source key items with swatches are part of that commit).

### 4e. Settings — scoped settings (global vs per-theme)

Types (`ThemeOverride`, updated `Settings`), resolution (`getThemeParams(themeSlug?)`), mutation (`updateThemeParamInMemory` with scope), and helpers (`setOverrideEnabled`, `clearOverrideParam`, `clearAllOverrides`, `resetThemeParams` with scope).

**Status:** ✔ Done — committed in `9b21c1d`.

### 4f. Settings panel — scope toggle UI

Scope state, `Tab` toggle between global and per-theme, header update, `d` key for clearing single override, scope-aware reset.

**Status:** ⏳ In progress — implemented in dirty `extensions/index.ts` (uncommitted). Includes:
- Scope state (`let scope: "global" | string`)
- `Tab` key toggles scope, updates header text
- `d` key clears per-theme override for selected setting
- `r` key reset is scope-aware
- Header shows `[global]` or `[slug]`
- Help footer includes `tab scope · d clear override`

**Remaining:** Per-theme visual indicators (accent `*` prefix for overridden values, `(overrides global: <value>)` description) are not yet implemented in the uncommitted changes.

### 4g. Callers — pass theme slug

Update all callers of `getThemeParams()` to pass the current cmux theme slug.

**Status:** ⏳ Partially done in dirty `extensions/index.ts` (uncommitted). The following callsites are updated:
- `syncCurrentCmuxThemeToPi` — ✔ passes `slug`
- `/theme` direct apply — ✔ passes `slugifyThemeName(themeArg)`
- Picker result handler — ✔ passes `slugifyThemeName(selected)`
- `/theme-settings` `buildItems()` — ✔ uses `paramsForScope()`
- `/theme-settings` preview debounce — ✔ uses `paramsForScope()`
- `/theme-settings` close handler — ✔ passes `currentThemeSlug`
- `picker.ts` callsites — ❌ not yet updated (still calls `getThemeParams()` without slug)

---

## Dead code reversal (new task)

The following dead code should be removed in a dedicated cleanup commit:

| File | Item | Reason |
|:--|:--|:--|
| `pi-theme.ts` | `writePreviewFile()` | Defined, never called — no code path writes preview files to disk |
| `pi-theme.ts` | `removePreviewThemeFiles()` | Cleans up files that are never created |
| `pi-theme.ts` | `PREVIEW_THEME_PREFIX` | Only used by the above dead functions |
| `picker.ts` | `removePreviewThemeFiles` import + calls | Added in `46d952a`, no-op |
| `index.ts` | `removePreviewThemeFiles` import + calls | Pre-existing + `46d952a`, no-op |

This reversal should happen after the scope toggle UI and caller updates are committed, as a separate `refactor:` commit.

---

## Implementation order (updated)

| Order | Task | Status |
|:--|:--|:--|
| 1 | ~~Preview cleanup (#1)~~ | ✔ Committed (`46d952a`) — **invalid, needs reversal** |
| 2 | Reset to defaults (#3) | ✔ Committed (`028dd63`) |
| 3 | Status bar params summary (#2) | ✔ Committed (`17c0f2a`) |
| 4 | Types — palette source + resolver (#4a) | ✔ Committed (`13b71d7`) |
| 5 | Theme gen — use palette mapping (#4b) | ✔ Committed (`13b71d7`) |
| 6 | Extended color swatches (#4c) | ✔ Committed (`13b71d7`) |
| 7 | Palette role mapping settings UI (#4d) | ✔ Committed (`13b71d7`) |
| 8 | Scoped settings types + resolution (#4e) | ✔ Committed (`9b21c1d`) |
| 9 | Scope toggle UI (#4f) | ⏳ In progress (dirty `index.ts`) |
| 10 | Callers — pass theme slug (#4g) | ⏳ Partial (dirty `index.ts` + `picker.ts` not started) |
| 11 | Dead code reversal (new) | Pending — remove preview file dead code |
| 12 | Per-theme visual indicators (#4f remainder) | Pending — `*` prefix + override description |

---

## Changeset

This work adds net-new user-facing features (palette role mapping, scoped settings, reset) → `patch` for improvements to an existing command. Evaluate `minor` vs `patch` for the full set when scoped settings UI is complete.

---

## Verification gate

Before every commit:

```bash
bun run typecheck
```

After the full set lands, manual verification:

1. `/theme-settings` → verify swatches render for all color and blend settings
2. `/theme-settings` → cycle palette source for error → verify swatch updates
3. `/theme-settings` → press `Tab` → scope switches to per-theme → verify header updates
4. `/theme-settings` → change a value in per-theme scope → verify `*` marker appears
5. `/theme-settings` → press `d` on overridden value → verify it reverts to global
6. `/theme-settings` → press `r` → verify all params reset
7. Status bar → apply a theme with non-default params → verify compact summary appears
8. Verify no `writePreviewFile` or `removePreviewThemeFiles` calls remain after dead code reversal
