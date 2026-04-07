# pi-cmux-theme-picker

Pi extension that syncs Pi theme with cmux terminal themes.

## Orient quickly

1. [`README.md`](README.md) — purpose, install, usage
2. [`extensions/index.ts`](extensions/index.ts) — entry point: session_start hook + `/theme` command
3. [`extensions/picker.ts`](extensions/picker.ts) — TUI overlay with debounce + prewrite
4. [`extensions/pi-theme.ts`](extensions/pi-theme.ts) — Pi theme generation and file management
5. [`extensions/cmux.ts`](extensions/cmux.ts) — cmux CLI interaction
6. [`extensions/colors.ts`](extensions/colors.ts) — pure color math utilities
7. [`extensions/types.ts`](extensions/types.ts) — shared type definitions

## Working rules

- cmux is the only terminal multiplexer target. No Ghostty fallback paths.
- Never hardcode color overrides in Ghostty config files.
- Preview theme files use the `cmux-preview-` prefix; permanent files use `cmux-sync-`.
- Preview design: debounce (80ms) + background prewrite. The JSON file is written in `setImmediate`; when the debounce settles, `setTheme` and `cmux themes set` execute back-to-back with no I/O.
- All `theme.fg()` / `theme.bold()` calls in the overlay must use `ctx.ui.theme` (live instance), not the factory closure's theme parameter.

## Verification

```bash
bun run typecheck
```
