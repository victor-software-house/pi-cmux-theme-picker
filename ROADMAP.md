# Roadmap

Ordered work inventory for `pi-cmux-theme-picker`.
Detailed decision records and implementation notes live in [`docs/decisions/`](docs/decisions/).

## Next

- [x] **Migrate to changesets** — replaced semantic-release with `@changesets/cli`. See [DR-01](docs/decisions/DR-01-changesets-migration.md). ✔
- [x] ~~**Force-bump rules**~~ — superseded by changesets (explicit changeset files replace commit-type rules). See [DR-02](docs/decisions/DR-02-force-bump-rules.md).
- [x] **Branch protection** — require PRs to `main`, no direct push for non-admins. Configured via GitHub branch protection. ✔

## UX polish

- [ ] **Settings panel overhaul** — color swatches, palette role mapping, scoped settings (global vs per-theme). See [DR-03](docs/decisions/DR-03-settings-panel-ux.md).
- [ ] Preview cleanup: ensure `cmux-preview-*` files are cleaned up on cancel and confirm
- [ ] Status bar: show current theme params summary (e.g. "muted:0.35 dim:0.20")
- [ ] Settings panel: add "Reset to defaults" option

## Future

- [ ] Theme export: `/theme export` to copy current theme JSON to clipboard
- [ ] Theme import: `/theme import <path>` to load a custom theme file
- [ ] Per-project theme profiles: auto-apply different themes per repo via project config
