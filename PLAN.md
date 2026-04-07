# PLAN — UX Polish Execution Slice

Implements all items from the **UX polish** section of ROADMAP.md plus the full DR-03 design.

---

## Overview

Four UX work streams, ordered by dependency:

1. **Preview cleanup** — ensure `cmux-preview-*` files are removed on cancel and confirm
2. **Status bar params summary** — show current ThemeParams snapshot in the status bar
3. **Settings panel: "Reset to defaults"** — add a reset action to `/theme-settings`
4. **Settings panel overhaul (DR-03)** — color swatches, palette role mapping, scoped settings

Stream 4 is the largest and breaks into sub-tasks below.

---

## 1. Preview cleanup

**Problem:** `cmux-preview-*` theme files in `~/.pi/agent/themes/` may survive if the picker exits abnormally or if a code path skips cleanup.

**Current state:** `removePreviewThemeFiles()` exists in `pi-theme.ts` and is called at the start of `/theme` direct-arg invocations, but never after picker cancel or confirm.

**Changes:**

| File | Change |
|:--|:--|
| `picker.ts` → `closeWithConfirm` | Call `removePreviewThemeFiles()` after `writeAndSetPiTheme` |
| `picker.ts` → `closeWithCancel` | Call `removePreviewThemeFiles()` after restoring original theme |
| `index.ts` → `/theme-settings` close handler | Call `removePreviewThemeFiles()` after `writeAndSetPiTheme` in the `onCancel` / close path |

**Verification:** After picking or cancelling a theme, `ls ~/.pi/agent/themes/ | grep cmux-preview` returns nothing.

---

## 2. Status bar params summary

**Problem:** The status bar shows `theme:<name>` but gives no hint about active generation params. Users must open `/theme-settings` just to see what's active.

**Design:** Extend the status bar to include a compact params summary when non-default values exist.

Format: `theme:nord · muted:0.65 dim:0.45 bg:12` (only params that differ from `DEFAULT_THEME_PARAMS`).

**Changes:**

| File | Change |
|:--|:--|
| `index.ts` → `updateStatus()` | Accept optional `ThemeParams`. Compare each key against `DEFAULT_THEME_PARAMS`. Build a compact `key:value` string for non-default params. Append after the theme name with ` · ` separator. Truncate if > ~60 chars to avoid status overflow. |
| `index.ts` → all callsites of `updateStatus` | Pass `getThemeParams()` as second arg |

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

---

## 3. Settings panel: "Reset to defaults"

**Problem:** No way to reset all ThemeParams back to defaults without manually cycling each value.

**Design:** Add a reset action triggered by a keybinding (`r` key).

**Changes:**

| File | Change |
|:--|:--|
| `index.ts` → `/theme-settings` `handleInput` | On `r` key: reset `current.themeParams` to `{ ...DEFAULT_THEME_PARAMS }`, call `persistSettings()`, rebuild SettingsList items, `applyPreview()`, `requestRender()`. |
| `index.ts` → help footer | Add `r reset` to the key hint line |
| `settings.ts` | Add `resetThemeParams()` helper: sets `current.themeParams = { ...DEFAULT_THEME_PARAMS }` and persists |

When scoped settings land (task 4), reset in global mode resets global; reset in per-theme mode clears the per-theme overrides.

---

## 4. Settings panel overhaul (DR-03)

### 4a. Types — palette role source settings

Add new fields to `ThemeParams` in `types.ts`:

```ts
// Palette role mapping — which palette index feeds each semantic role
errorSource: PaletteSource;     // default: "palette[1]"
successSource: PaletteSource;   // default: "palette[2]"
warningSource: PaletteSource;   // default: "palette[3]"
linkSource: PaletteSource;      // default: "palette[4]"
accentSource: PaletteSource;    // default: "palette[5]"
accentAltSource: PaletteSource; // default: "palette[6]"
```

Where `PaletteSource` is:

```ts
export type PaletteSource =
  | `palette[${number}]`
  | "fg"
  | "bg";
```

Add a resolver function:

```ts
export function resolveSource(source: PaletteSource, colors: CmuxColors): string | undefined
```

Maps `"palette[N]"` → `colors.palette[N]`, `"fg"` → `colors.foreground`, `"bg"` → `colors.background`.

Update `DEFAULT_THEME_PARAMS` with the new defaults.

### 4b. Theme generation — use palette role mapping

In `pi-theme.ts` → `generatePiTheme()`:

Replace hardcoded `colors.palette[1]` etc. with `resolveSource(p.errorSource, colors)` etc.

Before:
```ts
const error = ensureSemanticHue(colors.palette[1], 0, p.errorFallback);
```

After:
```ts
const error = ensureSemanticHue(resolveSource(p.errorSource, colors), 0, p.errorFallback);
```

Same pattern for success, warning, link, accent, accentAlt.

### 4c. Extended color swatches

Extend the `swatch()` helper and add a `computedSwatch()` that shows the mixed/tinted result.

**New swatches to show in settings panel:**

| Setting | Swatch shows |
|:--|:--|
| `mutedWeight` | `mixColors(fg, bg, value)` — preview of muted text color |
| `dimWeight` | `mixColors(fg, bg, value)` — preview of dim text color |
| `borderWeight` | `mixColors(fg, bg, value)` — preview of border color |
| `toolSuccessTint` | `mixColors(bg, success, value)` — preview of success bg tint |
| `toolErrorTint` | `mixColors(bg, error, value)` — preview of error bg tint |
| `customMsgTint` | `mixColors(bg, accent, value)` — preview of custom msg bg tint |
| `*Source` settings | Raw palette color at that index |
| `*Fallback` settings | Already have swatches ✔ |

Requires passing `cmuxColors` into `buildItems()` (already available in the handler scope).

### 4d. Palette role mapping settings UI

Add six new `SettingItem` entries in `buildItems()`, one per semantic role:

```
Error source       palette[1]    ← cycles through palette[0]..palette[15], fg, bg
Success source     palette[2]
Warning source     palette[3]
Link source        palette[4]
Accent source      palette[5]
Accent alt source  palette[6]
```

Each shows a swatch of the resolved color. `values` array: `["palette[0]", ..., "palette[15]", "fg", "bg"]`.

Handle in `handleValueChange`: write to `ThemeParams` as a string, same as fallback hex values.

### 4e. Settings — scoped settings (global vs per-theme)

**Types** (`settings.ts`):

```ts
export interface ThemeOverride {
  enabled: boolean;
  params: Partial<ThemeParams>;
}

export interface Settings {
  autoSync: boolean;
  themeParams: ThemeParams;
  previewDebounceMs: number;
  themeOverrides: Record<string, ThemeOverride>;  // keyed by cmux theme slug
}
```

**Resolution** (`settings.ts`):

```ts
export function getThemeParams(themeSlug?: string): ThemeParams {
  const base = current.themeParams;
  if (!themeSlug) return base;
  const override = current.themeOverrides[themeSlug];
  if (!override?.enabled) return base;
  return { ...base, ...override.params };
}
```

**Mutation** (`settings.ts`):

```ts
export function updateThemeParamInMemory<K extends keyof ThemeParams>(
  key: K,
  value: ThemeParams[K],
  scope: "global" | string, // string = theme slug for per-theme
): void {
  if (scope === "global") {
    current.themeParams[key] = value;
  } else {
    if (!current.themeOverrides[scope]) {
      current.themeOverrides[scope] = { enabled: true, params: {} };
    }
    current.themeOverrides[scope].params[key] = value;
  }
}
```

**New helpers:**

- `setOverrideEnabled(slug: string, enabled: boolean)` — toggles `themeOverrides[slug].enabled`
- `clearOverrideParam(slug: string, key: keyof ThemeParams)` — deletes a single per-theme override
- `clearAllOverrides(slug: string)` — removes `themeOverrides[slug]` entirely
- `resetThemeParams(scope: "global" | string)` — resets global or per-theme params to defaults

### 4f. Settings panel — scope toggle UI

**State:** Add `scope: "global" | string` to the settings panel (default: `"global"`). The string value is the current cmux theme slug.

**Header:** `" Theme Generation Settings [global]"` or `" Theme Generation Settings [catppuccin-mocha]"`.

**Toggle:** `Tab` key switches between global and per-theme (using current cmux theme slug from `getCurrentCmuxThemeName()`).

- Switching to global: sets `themeOverrides[slug].enabled = false`.
- Switching to per-theme: sets `themeOverrides[slug].enabled = true`. Seeds initial per-theme params from the current resolved params if the override entry doesn't exist yet.

**Per-theme visual indicators:**

- Values that match global show normally.
- Values that differ from global show with an accent-colored `*` prefix.
- The description line for overridden values appends `(overrides global: <globalValue>)`.

**Reset behavior (`r` key):**

- In global scope: resets `themeParams` to `DEFAULT_THEME_PARAMS`.
- In per-theme scope: clears all per-theme overrides for current theme (`clearAllOverrides(slug)`), toggles `enabled = false`, switches scope back to global.

**Per-setting reset (`d` key — "delete override"):**

- Only active in per-theme scope.
- Removes the override for the selected setting (`clearOverrideParam(slug, key)`).
- Value falls back to global.

### 4g. Callers — pass theme slug

Update all callers of `getThemeParams()` to pass the current cmux theme slug where available:

| Callsite | Change |
|:--|:--|
| `index.ts` → `syncCurrentCmuxThemeToPi` | `getThemeParams(slugifyThemeName(currentTheme))` |
| `index.ts` → `/theme` direct apply | `getThemeParams(slugifyThemeName(themeArg))` |
| `index.ts` → `/theme-settings` | `getThemeParams(cmuxTheme ? slugifyThemeName(cmuxTheme) : undefined)` |
| `picker.ts` → `applyPreview` debounce | `getThemeParams(slugifyThemeName(selectedTheme))` |
| `picker.ts` → `closeWithConfirm` | `getThemeParams(slugifyThemeName(themeName))` |
| `picker.ts` → `closeWithCancel` (restore) | `getThemeParams()` (no slug — use global for restore) |

---

## Implementation order

Dependencies flow top-down — each task can be committed independently.

| Order | Task | Est. size | Depends on |
|:--|:--|:--|:--|
| 1 | Preview cleanup (#1) | S | — |
| 2 | Reset to defaults (#3) | S | — |
| 3 | Status bar params summary (#2) | S | — |
| 4 | Types — palette source + resolver (#4a) | S | — |
| 5 | Theme gen — use palette mapping (#4b) | S | #4a |
| 6 | Extended color swatches (#4c) | M | — |
| 7 | Palette role mapping settings UI (#4d) | M | #4a, #4b |
| 8 | Scoped settings types + resolution (#4e) | M | #4a |
| 9 | Scope toggle UI (#4f) | L | #4e, #4c |
| 10 | Callers — pass theme slug (#4g) | S | #4e |

Total: ~10 commits, each independently reviewable. One PR with a `minor` changeset (net-new user-facing settings surface).

---

## Changeset

This work adds net-new user-facing features (palette role mapping, scoped settings, reset) → `minor` changeset.

However: the settings panel itself already shipped. Adding settings to an existing command is `patch` per AGENTS.md. The scoped settings and palette role mapping do introduce new conceptual surface.

**Decision:** Use `patch` for the initial commits (cleanup, reset, swatches). Evaluate `minor` vs `patch` for palette role mapping + scoped settings when those land — if users must learn new concepts to use the panel, that tips toward `minor`.

---

## Verification gate

Before every commit:

```bash
bun run typecheck
```

After the full set lands, manual verification:

1. `/theme` → pick a theme → cancel → verify no `cmux-preview-*` files remain
2. `/theme` → pick a theme → confirm → verify no `cmux-preview-*` files remain
3. `/theme-settings` → verify swatches render for all color and blend settings
4. `/theme-settings` → cycle palette source for error → verify swatch updates
5. `/theme-settings` → press `Tab` → scope switches to per-theme → verify header updates
6. `/theme-settings` → change a value in per-theme scope → verify `*` marker appears
7. `/theme-settings` → press `d` on overridden value → verify it reverts to global
8. `/theme-settings` → press `r` → verify all params reset
9. Status bar → apply a theme with non-default params → verify compact summary appears
