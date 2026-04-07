/**
 * pi-cmux-theme-picker
 *
 * Optionally syncs pi theme with the active cmux terminal theme on session start.
 * Registers /theme command for live theme picking with debounced preview.
 * Registers /theme-settings command for toggling extension settings.
 */

import { getSettingsListTheme, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Container, type AutocompleteItem, type SettingItem, SettingsList, Text } from "@mariozechner/pi-tui";
import { getCurrentCmuxThemeName, getCmuxThemeColors, getAvailableCmuxThemes, runCmuxThemeSet } from "./cmux.js";
import {
	slugifyThemeName,
	removePreviewThemeFiles,
	writeAndSetPiTheme,
} from "./pi-theme.js";
import { showThemePicker } from "./picker.js";
import { getSettings, updateSettings, restoreSettings } from "./settings.js";
import type { SessionContext } from "./types.js";

const STATUS_KEY = "cmux-theme";

// Cached theme names for autocomplete
let cachedThemeNames: string[] = [];

function updateStatus(ctx: ExtensionContext, themeName?: string): void {
	if (themeName) {
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", `theme:${themeName}`));
	} else {
		ctx.ui.setStatus(STATUS_KEY, undefined);
	}
}

function syncCurrentCmuxThemeToPi(ctx: SessionContext): void {
	const currentTheme = getCurrentCmuxThemeName();
	if (!currentTheme) return;
	const colors = getCmuxThemeColors(currentTheme);
	if (!colors) return;
	const slug = slugifyThemeName(currentTheme);
	const themeName = slug ? `cmux-sync-${slug}` : "cmux-sync";
	if (ctx.ui.theme.name === themeName) return;
	writeAndSetPiTheme(ctx, colors, currentTheme);
	updateStatus(ctx, currentTheme);
}

function parseCommandThemeName(args: string): string {
	const trimmed = args.trim();
	if (
		(trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

export default function (pi: ExtensionAPI) {
	// --- Session lifecycle ---
	pi.on("session_start", async (_event, ctx) => {
		restoreSettings(ctx);
		cachedThemeNames = getAvailableCmuxThemes().map((e) => e.name);

		if (getSettings().autoSync) {
			syncCurrentCmuxThemeToPi(ctx);
		}
	});

	// --- /theme command ---
	pi.registerCommand("theme", {
		description: "Switch cmux + pi themes with live preview",

		getArgumentCompletions(prefix: string): AutocompleteItem[] | null {
			const filtered = cachedThemeNames.filter((n) =>
				n.toLowerCase().startsWith(prefix.toLowerCase()),
			);
			if (filtered.length === 0) return null;
			return filtered.map((n) => ({ value: n, label: n }));
		},

		handler: async (args, ctx) => {
			const themeArg = parseCommandThemeName(args);
			if (themeArg) {
				const colors = getCmuxThemeColors(themeArg);
				if (!colors) {
					ctx.ui.notify(`Unknown cmux theme: ${themeArg}`, "error");
					return;
				}
				removePreviewThemeFiles();
				writeAndSetPiTheme(ctx, colors, themeArg);
				runCmuxThemeSet(themeArg);
				updateStatus(ctx, themeArg);
				ctx.ui.notify(`Theme "${themeArg}" applied`, "info");
				return;
			}

			const selected = await showThemePicker(ctx);
			if (selected) {
				updateStatus(ctx, selected);
				ctx.ui.notify(`Theme "${selected}" applied`, "info");
			}
		},
	});

	// --- /theme-settings command ---
	pi.registerCommand("theme-settings", {
		description: "Configure cmux theme picker settings",

		handler: async (_args, ctx) => {
			const settings = getSettings();
			const items: SettingItem[] = [
				{
					id: "autoSync",
					label: "Auto-sync on session start",
					currentValue: settings.autoSync ? "on" : "off",
					values: ["on", "off"],
				},
			];

			await ctx.ui.custom((_tui, theme, _kb, done) => {
				const container = new Container();
				container.addChild(new Text(theme.fg("accent", theme.bold(" cmux Theme Picker Settings")), 1, 1));

				const settingsList = new SettingsList(
					items,
					Math.min(items.length + 2, 15),
					getSettingsListTheme(),
					(id, newValue) => {
						if (id === "autoSync") {
							updateSettings(pi, { autoSync: newValue === "on" });
							ctx.ui.notify(`Auto-sync ${newValue === "on" ? "enabled" : "disabled"}`, "info");
						}
					},
					() => done(undefined),
				);

				container.addChild(settingsList);

				return {
					render: (w) => container.render(w),
					invalidate: () => container.invalidate(),
					handleInput: (data) => settingsList.handleInput?.(data),
				};
			});
		},
	});
}
