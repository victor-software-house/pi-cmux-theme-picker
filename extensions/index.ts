/**
 * pi-cmux-theme-picker
 *
 * Syncs pi theme with the currently active cmux terminal theme on session start.
 * Registers /theme command for live theme picking with debounced preview.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getCurrentCmuxThemeName, getCmuxThemeColors, runCmuxThemeSet } from "./cmux.js";
import {
	slugifyThemeName,
	removePreviewThemeFiles,
	writeAndSetPiTheme,
} from "./pi-theme.js";
import { showThemePicker } from "./picker.js";
import type { SessionContext } from "./types.js";

function syncCurrentCmuxThemeToPi(ctx: SessionContext): void {
	const currentTheme = getCurrentCmuxThemeName();
	if (!currentTheme) return;
	const colors = getCmuxThemeColors(currentTheme);
	if (!colors) return;
	const slug = slugifyThemeName(currentTheme);
	const themeName = slug ? `cmux-sync-${slug}` : "cmux-sync";
	if (ctx.ui.theme.name === themeName) return;
	writeAndSetPiTheme(ctx, colors, currentTheme);
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
	pi.on("session_start", async (_event, ctx) => {
		syncCurrentCmuxThemeToPi(ctx);
	});

	pi.registerCommand("theme", {
		description: "Switch cmux + pi themes with live preview",
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
				return;
			}

			await showThemePicker(ctx);
		},
	});
}
