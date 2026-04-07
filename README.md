# pi-cmux-theme-picker

Live [cmux](https://cmux.dev) terminal theme picker for [Pi](https://pi.dev). Synchronises Pi and cmux themes with debounced preview.

![pi-cmux-theme-picker preview](assets/preview.png)

## What it does

- **`/theme`** — opens an inline picker to browse, filter, search, and live-preview all bundled cmux (Ghostty) themes. Confirm with Enter, cancel with Esc.
- **`/theme "Theme Name"`** — apply a named theme directly without opening the picker.
- **`/theme-settings`** — toggle extension settings (auto-sync on session start).
- **Auto-sync** (opt-in) — reads the active cmux theme and generates a matching Pi theme on session start.

## Install

```
pi install pi-cmux-theme-picker
```

## Usage

```
/theme              # Open the picker
/theme Catppuccin   # Apply a theme directly by name
/theme-settings     # Toggle auto-sync and other settings
```

### Picker controls

| Key | Action |
|:---|:---|
| `Up` / `Down` | Navigate themes with live preview |
| `Enter` | Apply selected theme |
| `Esc` | Cancel and restore original |
| `Tab` | Cycle filter: all / dark / light |
| Type | Incremental search |
| `Backspace` | Delete search character |

### Settings

| Setting | Default | Description |
|:---|:---|:---|
| Auto-sync on session start | off | Sync Pi theme from current cmux theme when a session starts |

## How it works

1. Reads cmux bundled Ghostty theme files from `/Applications/cmux.app/Contents/Resources/ghostty/themes/`.
2. Converts the palette into a full Pi theme JSON (semantic colors, contrast-aware link picking, dark/light adaptation).
3. Preview uses debounce + background prewrite — JSON file is written asynchronously; `setTheme` and `cmux themes set` fire back-to-back with no I/O in between.
4. On confirm, writes a permanent `cmux-sync-{slug}.json` theme file and cleans up old sync artifacts.

## Requirements

- [cmux](https://cmux.dev) installed at `/Applications/cmux.app`
- Pi with `@mariozechner/pi-coding-agent` and `@mariozechner/pi-tui`

## License

MIT
