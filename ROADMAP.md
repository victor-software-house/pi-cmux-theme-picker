# Roadmap

Ordered work inventory for `pi-cmux-theme-picker`.
Detailed decision records and implementation notes live in [`docs/decisions/`](docs/decisions/).

## Next

- [ ] **Migrate to changesets** — replace semantic-release with `@changesets/cli` for batched, PR-gated releases. See [DR-01](docs/decisions/DR-01-changesets-migration.md).
- [ ] **Force-bump rules** — `docs(readme):` and `chore(bump):` should trigger patch releases. See [DR-02](docs/decisions/DR-02-force-bump-rules.md). (Blocked by DR-01 — changesets handles this differently.)
- [ ] **Branch protection** — require PRs to `main`, no direct push. Pairs with changesets model.

## UX polish

- [ ] Preview cleanup: ensure `cmux-preview-*` files are cleaned up on cancel and confirm
- [ ] Status bar: show current theme params summary (e.g. "muted:0.35 dim:0.20")
- [ ] Settings panel: add "Reset to defaults" option

## Future

- [ ] Theme export: `/theme export` to copy current theme JSON to clipboard
- [ ] Theme import: `/theme import <path>` to load a custom theme file
- [ ] Per-project theme profiles: auto-apply different themes per repo via project config
