/**
 * Pi theme generation, file management, and preview lifecycle.
 *
 * Converts cmux palette colors into a full Pi theme JSON, handles writing
 * preview and permanent theme files, and cleans up stale artifacts.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
	getLuminance,
	adjustBrightness,
	mixColors,
	ensureSemanticHue,
	pickReadableLink,
} from "./colors.js";
import type { CmuxColors, SessionContext } from "./types.js";

export const PI_THEMES_DIR = join(homedir(), ".pi", "agent", "themes");
export const PREVIEW_THEME_PREFIX = "cmux-preview-";

export function slugifyThemeName(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export function ensureThemesDir(): void {
	if (!existsSync(PI_THEMES_DIR)) {
		mkdirSync(PI_THEMES_DIR, { recursive: true });
	}
}

export function removePreviewThemeFiles(): void {
	try {
		for (const file of readdirSync(PI_THEMES_DIR)) {
			if (file.startsWith(PREVIEW_THEME_PREFIX) && file.endsWith(".json")) {
				unlinkSync(join(PI_THEMES_DIR, file));
			}
		}
	} catch {
		// Best-effort cleanup
	}
}

function computeThemeHash(colors: CmuxColors): string {
	const parts: string[] = [];
	parts.push(`bg=${colors.background}`);
	parts.push(`fg=${colors.foreground}`);
	for (let i = 0; i <= 15; i++) parts.push(`p${i}=${colors.palette[i] ?? ""}`);
	const signature = parts.join("\n");
	return createHash("sha1").update(signature).digest("hex").slice(0, 8);
}

function cleanupOldSyncThemes(keepFiles: string[]): void {
	const keep = new Set(keepFiles);
	try {
		for (const file of readdirSync(PI_THEMES_DIR)) {
			if (keep.has(file)) continue;
			// Legacy name from the old extension
			if (file === "ghostty-sync.json") {
				unlinkSync(join(PI_THEMES_DIR, file));
				continue;
			}
			if (file.startsWith("ghostty-sync-") && file.endsWith(".json")) {
				unlinkSync(join(PI_THEMES_DIR, file));
			}
			if (file.startsWith("cmux-sync-") && file.endsWith(".json")) {
				unlinkSync(join(PI_THEMES_DIR, file));
			}
		}
	} catch {
		// Best-effort cleanup
	}
}

export function generatePiTheme(colors: CmuxColors, themeName: string): object {
	const bg = colors.background;
	const fg = colors.foreground;
	const isDark = getLuminance(bg) < 0.5;

	const error = ensureSemanticHue(colors.palette[1], 0, "#cc6666");
	const success = ensureSemanticHue(colors.palette[2], 120, "#98c379");
	const warning = ensureSemanticHue(colors.palette[3], 50, "#e5c07b");
	const rawLink = ensureSemanticHue(colors.palette[4], 220, "#61afef");
	const link = pickReadableLink(rawLink, bg, "#61afef", fg);

	const accent = colors.palette[5] || "#c678dd";
	const accentAlt = colors.palette[6] || "#56b6c2";

	const muted = mixColors(fg, bg, 0.65);
	const dim = mixColors(fg, bg, 0.45);
	const borderMuted = mixColors(fg, bg, 0.25);

	const bgShift = isDark ? 12 : -12;
	const selectedBg = adjustBrightness(bg, bgShift);
	const userMsgBg = adjustBrightness(bg, Math.round(bgShift * 0.7));
	const toolPendingBg = adjustBrightness(bg, Math.round(bgShift * 0.4));
	const toolSuccessBg = mixColors(bg, success, 0.88);
	const toolErrorBg = mixColors(bg, error, 0.88);
	const customMsgBg = mixColors(bg, accent, 0.92);

	return {
		$schema: "https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json",
		name: themeName,
		vars: {
			bg, fg, accent, accentAlt, link, error, success, warning,
			muted, dim, borderMuted, selectedBg, userMsgBg,
			toolPendingBg, toolSuccessBg, toolErrorBg, customMsgBg,
		},
		colors: {
			accent: "accent",
			border: "borderMuted",
			borderAccent: "accent",
			borderMuted: "borderMuted",
			success: "success",
			error: "error",
			warning: "warning",
			muted: "muted",
			dim: "dim",
			text: "",
			thinkingText: "muted",
			selectedBg: "selectedBg",
			userMessageBg: "userMsgBg",
			userMessageText: "",
			customMessageBg: "customMsgBg",
			customMessageText: "",
			customMessageLabel: "accent",
			toolPendingBg: "toolPendingBg",
			toolSuccessBg: "toolSuccessBg",
			toolErrorBg: "toolErrorBg",
			toolTitle: "",
			toolOutput: "muted",
			mdHeading: "warning",
			mdLink: "link",
			mdLinkUrl: "dim",
			mdCode: "accent",
			mdCodeBlock: "success",
			mdCodeBlockBorder: "muted",
			mdQuote: "muted",
			mdQuoteBorder: "muted",
			mdHr: "muted",
			mdListBullet: "accent",
			toolDiffAdded: "success",
			toolDiffRemoved: "error",
			toolDiffContext: "muted",
			syntaxComment: "muted",
			syntaxKeyword: "accent",
			syntaxFunction: "link",
			syntaxVariable: "accentAlt",
			syntaxString: "success",
			syntaxNumber: "accent",
			syntaxType: "accentAlt",
			syntaxOperator: "fg",
			syntaxPunctuation: "muted",
			thinkingOff: "borderMuted",
			thinkingMinimal: "muted",
			thinkingLow: "link",
			thinkingMedium: "accentAlt",
			thinkingHigh: "accent",
			thinkingXhigh: "accent",
			bashMode: "success",
		},
		export: {
			pageBg: isDark ? adjustBrightness(bg, -8) : adjustBrightness(bg, 8),
			cardBg: bg,
			infoBg: mixColors(bg, warning, 0.88),
		},
	};
}

/** Write permanent theme, clean up old sync files, apply via setTheme. */
export function writeAndSetPiTheme(ctx: SessionContext, colors: CmuxColors, sourceThemeName: string): string {
	ensureThemesDir();
	const hash = computeThemeHash(colors);
	const slug = slugifyThemeName(sourceThemeName);
	const themeName = slug ? `cmux-sync-${slug}` : `cmux-sync-${hash}`;
	const themeFile = `${themeName}.json`;
	const themePath = join(PI_THEMES_DIR, themeFile);

	const themeJson = generatePiTheme(colors, themeName);
	writeFileSync(themePath, JSON.stringify(themeJson, null, 2));
	cleanupOldSyncThemes([themeFile]);

	const result = ctx.ui.setTheme(themeName);
	if (!result.success) {
		ctx.ui.notify(`cmux theme sync failed: ${result.error}`, "error");
	}
	return themeName;
}

/** Write a preview theme file (for prewrite or fallback sync write). */
export function writePreviewFile(colors: CmuxColors, themeName: string): string {
	const slug = slugifyThemeName(themeName);
	const previewName = `${PREVIEW_THEME_PREFIX}${slug}`;
	const previewPath = join(PI_THEMES_DIR, `${previewName}.json`);
	const json = generatePiTheme(colors, previewName);
	writeFileSync(previewPath, JSON.stringify(json, null, 2));
	return previewName;
}

/** Resolve the preview theme name for a given source theme. */
export function previewNameFor(themeName: string): string {
	return `${PREVIEW_THEME_PREFIX}${slugifyThemeName(themeName)}`;
}
