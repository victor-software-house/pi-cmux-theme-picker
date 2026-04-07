# Roadmap

Ordered work inventory for `pi-cmux-theme-picker`.
Detailed decision records and implementation notes live in [`docs/decisions/`](docs/decisions/).

## Next

- [x] **Migrate to changesets** — replaced semantic-release with `@changesets/cli`. See [DR-01](docs/decisions/DR-01-changesets-migration.md). ✔
- [x] ~~**Force-bump rules**~~ — superseded by changesets (explicit changeset files replace commit-type rules). See [DR-02](docs/decisions/DR-02-force-bump-rules.md).
- [x] **Branch protection** — require PRs to `main`, no direct push for non-admins. Configured via GitHub branch protection. ✔

## UX polish

- [x] **Status bar params summary** — show current theme params when non-default (`17c0f2a`) ✔
- [x] **Reset to defaults** — `r` key in `/theme-settings` resets params (`028dd63`) ✔
- [ ] **Settings panel overhaul** — color swatches, palette role mapping, scoped settings (global vs per-theme). See [DR-03](docs/decisions/DR-03-settings-panel-ux.md).
  - [x] Palette source types + resolver (`13b71d7`)
  - [x] Theme generation uses palette mapping (`13b71d7`)
  - [x] Color swatches in settings panel (`13b71d7`)
  - [x] Palette role mapping settings UI (`13b71d7`)
  - [x] Scoped settings model in `settings.ts` (`9b21c1d`)
  - [ ] Scope toggle UI in `/theme-settings` (in progress, uncommitted)
  - [ ] Pass theme slug to all `getThemeParams()` callers (partial, uncommitted)
  - [ ] Per-theme visual indicators (`*` prefix, override description)
- [ ] **Dead code cleanup** — remove `writePreviewFile()`, `removePreviewThemeFiles()`, and `PREVIEW_THEME_PREFIX` (never called — previews are entirely in-memory). Revert the no-op cleanup calls added in `46d952a`.

## Future

- [ ] Theme export: `/theme export` to copy current theme JSON to clipboard
- [ ] Theme import: `/theme import <path>` to load a custom theme file
- [ ] Per-project theme profiles: auto-apply different themes per repo via project config
