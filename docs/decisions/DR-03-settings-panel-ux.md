# DR-03: Settings panel UX — color swatches, palette role mapping, scoped overrides

**Status:** planned
**Priority:** next (UX polish)

## Problem

The `/theme-settings` panel has three gaps:

1. **No visual feedback for color settings.** Fallback color options (`errorFallback`, `successFallback`, etc.) show hex values but no color preview. Users must mentally map `#cc4444` to a color.

2. **No control over palette role mapping.** The theme generator assigns fixed palette indices to semantic roles (e.g. `palette[1]` → error, `palette[4]` → link). Some cmux/Ghostty themes have better accent colors at different indices. Users should be able to remap which palette slot feeds which semantic role.

3. **Settings are global only.** All ThemeParams apply identically to every theme. Some themes need per-theme overrides (e.g. a light theme might need higher `bgShift` than a dark one, or a specific theme's `palette[5]` works better as the error color than `palette[1]`).

## Design

### Color swatches

Add an ANSI color block (`\x1b[48;2;r;g;bm  \x1b[0m`) next to every setting that affects a color:

- Fallback color settings: show the current hex value as a swatch
- Tint/weight settings: show a computed preview (e.g. the mixed result of `bg` + `success` at the current `toolSuccessTint` ratio)
- Palette role settings (new, see below): show the raw palette color at that index

The `swatch()` helper already exists for fallback labels — extend it to tint/weight previews using the current cmux colors.

### Palette role mapping

Current hardcoded mapping in `pi-theme.ts`:

| Semantic role | Palette index | Hue target |
|:---|:---|:---|
| error | `palette[1]` | red |
| success | `palette[2]` | green |
| warning | `palette[3]` | yellow |
| link | `palette[4]` | blue |
| accent | `palette[5]` | magenta |
| accentAlt | `palette[6]` | cyan |

New settings to add (per role):

| Setting | Default | Description |
|:---|:---|:---|
| Error source | `palette[1]` | Which palette index provides the error base color |
| Success source | `palette[2]` | Which palette index provides the success base color |
| Warning source | `palette[3]` | Which palette index provides the warning base color |
| Link source | `palette[4]` | Which palette index provides the link base color |
| Accent source | `palette[5]` | Which palette index provides the accent base color |
| Accent alt source | `palette[6]` | Which palette index provides the accent alt base color |

Values: `palette[0]` through `palette[15]`, `fg`, `bg`. Each shows a swatch of the actual color from the current cmux theme.

The hue validation (`ensureSemanticHue`) still applies — if the user picks `palette[5]` (magenta) for `error`, the hue check fires and falls back to `errorFallback`. This is intentional: users can override the fallback too.

### Scoped settings: global vs per-theme

Settings scope model:

```
global defaults (always present)
  └── per-theme overrides (optional, keyed by cmux theme slug)
```

Config file structure (`~/.pi/agent/extensions/pi-cmux-theme-picker.json`):

```json
{
  "autoSync": false,
  "previewDebounceMs": 200,
  "themeParams": {
    "mutedWeight": 0.35,
    "dimWeight": 0.20,
    "errorSource": "palette[1]",
    "successSource": "palette[2]"
  },
  "themeOverrides": {
    "catppuccin-mocha": {
      "bgShift": 12,
      "accentSource": "palette[4]"
    },
    "nord": {
      "mutedWeight": 0.40,
      "linkSource": "palette[5]"
    }
  }
}
```

Resolution order: `global.themeParams` merged with `themeOverrides[currentThemeSlug]` (override wins).

### Settings panel scope toggle

Add a scope indicator to the `/theme-settings` panel header:

```
 Theme Generation Settings [global]        ← or [catppuccin-mocha]
```

Toggle with a key (e.g. `Tab` or `s`):
- **Global** — edits apply to `themeParams` (all themes)
- **Per-theme** — edits apply to `themeOverrides[currentTheme]` (current theme only)

When in per-theme mode:
- Values that match the global default show normally
- Values that override the global show with a marker (e.g. `*` prefix or accent color)
- A "Reset to global" action clears the per-theme override for the selected setting

## Implementation notes

- `settings.ts`: add `themeOverrides: Record<string, Partial<ThemeParams>>` to `Settings`
- `getThemeParams()`: accept optional `themeSlug` arg, merge `themeParams` with `themeOverrides[themeSlug]`
- `updateThemeParamInMemory`: accept scope (`global` | slug), write to correct location
- `pi-theme.ts` / `generatePiTheme`: read palette role mapping from resolved params instead of hardcoded indices
- `index.ts` settings panel: add scope toggle, swatch rendering, palette role settings
- Backward compatible: existing configs without `themeOverrides` or `*Source` keys work unchanged
