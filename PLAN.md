# PLAN — UX Polish Execution Slice

**Status: complete.** All items implemented and committed on `feat/ux-roadmap-dr03-implementation`.

---

## Summary

| Order | Task | Commit |
|:--|:--|:--|
| 1 | Reset to defaults | `028dd63` |
| 2 | Status bar params summary | `17c0f2a` |
| 3 | Palette source types + resolver + theme gen + swatches + settings UI | `13b71d7` |
| 4 | Scoped settings model (types, resolution, mutation) | `9b21c1d` |
| 5 | Scope toggle UI + all caller updates | `4d0f69c` |
| 6 | Per-theme override indicators (`* ` prefix + `(global: X)` description) | `194a050` |
| 7 | Dead code removal (preview file functions that were never called) | `fd9833d` |

---

## Corrections applied during execution

### Preview cleanup was invalid

The original plan included a "preview cleanup" task based on the premise that `cmux-preview-*.json` files accumulate on disk. This was wrong — previews are entirely in-memory via `buildThemeInstance()` + `ctx.ui.setTheme(instance)`. The functions `writePreviewFile()`, `removePreviewThemeFiles()`, and `PREVIEW_THEME_PREFIX` were dead code. Commit `46d952a` added no-op cleanup calls; these were removed in `fd9833d`.

### DR-03 Ghostty reference

DR-03 referenced "cmux/Ghostty themes" — corrected to "cmux themes" per the cmux-only constraint in AGENTS.md.

---

## Changeset

Pending — needs a changeset file before merging to `main`. This work adds palette role mapping, scoped per-theme settings, and override indicators to the existing `/theme-settings` command. Evaluate `patch` vs `minor` at PR time.
