/**
 * pi-cmux-theme-picker
 *
 * Optionally syncs pi theme with the active cmux terminal theme on session start.
 * Registers /theme command for live theme picking with debounced preview.
 * Registers /theme-settings command for toggling extension settings.
 */

import { getSettingsListTheme, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Container, Key, type AutocompleteItem, type SettingItem, SettingsList, Text, matchesKey } from "@mariozechner/pi-tui";
import { getCurrentCmuxThemeName, getCmuxThemeColors, getAvailableCmuxThemes, runCmuxThemeSet } from "./cmux.js";
import { hexToRgb } from "./colors.js";
import {
	slugifyThemeName,
	removePreviewThemeFiles,
	writeAndSetPiTheme,
	writeAndPreviewPiTheme,
} from "./pi-theme.js";
import { showThemePicker } from "./picker.js";
import { getSettings, updateSettings, updateThemeParamInMemory, persistSettings, getThemeParams, restoreSettings } from "./settings.js";
import { DEFAULT_THEME_PARAMS, type SessionContext, type ThemeParams } from "./types.js";

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
	writeAndSetPiTheme(ctx, colors, currentTheme, getThemeParams());
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

/** Render a single truecolor block for a hex color. */
function swatch(hex: string): string {
	const { r, g, b } = hexToRgb(hex);
	return `\x1b[38;2;${r};${g};${b}m\u2588\x1b[0m`;
}

/** Generate a string[] of numeric values from min to max with given step, formatted to decimals. */
function numRange(min: number, max: number, step: number, decimals: number): string[] {
	const values: string[] = [];
	for (let v = min; v <= max + step / 2; v += step) {
		values.push(v.toFixed(decimals));
	}
	return values;
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
				writeAndSetPiTheme(ctx, colors, themeArg, getThemeParams());
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
		description: "Configure cmux theme picker and theme generation settings",

		handler: async (_args, ctx) => {
			// Snapshot current cmux theme for live preview
			const cmuxTheme = getCurrentCmuxThemeName();
			const cmuxColors = cmuxTheme ? getCmuxThemeColors(cmuxTheme) : null;

			const buildItems = (): SettingItem[] => {
				const p = getThemeParams();
				const settings = getSettings();

				// Discrete value ranges
				const weight01 = numRange(0.0, 1.0, 0.05, 2);
				const bgShiftRange = numRange(1, 30, 1, 0);
				const factorRange = numRange(0.0, 1.0, 0.1, 1);
				const tintRange = numRange(0.70, 0.99, 0.01, 2);
				const contrastRange = numRange(1.5, 6.0, 0.5, 1);

				return [
					// --- General ---
					{ id: "autoSync", label: "Auto-sync on session start", currentValue: settings.autoSync ? "on" : "off", values: ["on", "off"] },

					// --- Text blending ---
					{ id: "mutedWeight", label: "Muted text weight", currentValue: p.mutedWeight.toFixed(2), values: weight01, description: "fg/bg mix for muted text (higher = more fg)" },
					{ id: "dimWeight", label: "Dim text weight", currentValue: p.dimWeight.toFixed(2), values: weight01, description: "fg/bg mix for dim text" },
					{ id: "borderWeight", label: "Border weight", currentValue: p.borderWeight.toFixed(2), values: weight01, description: "fg/bg mix for muted borders" },

					// --- Background shift ---
					{ id: "bgShift", label: "Background shift", currentValue: p.bgShift.toFixed(0), values: bgShiftRange, description: "Brightness offset for derived backgrounds (higher = more contrast)" },
					{ id: "selectedBgFactor", label: "Selected bg factor", currentValue: p.selectedBgFactor.toFixed(1), values: factorRange, description: "Multiplier of bgShift for selected item bg" },
					{ id: "userMsgBgFactor", label: "User message bg factor", currentValue: p.userMsgBgFactor.toFixed(1), values: factorRange, description: "Multiplier of bgShift for user message bg" },
					{ id: "toolPendingBgFactor", label: "Tool pending bg factor", currentValue: p.toolPendingBgFactor.toFixed(1), values: factorRange, description: "Multiplier of bgShift for tool pending bg" },

					// --- Tint strength ---
					{ id: "toolSuccessTint", label: "Tool success tint", currentValue: p.toolSuccessTint.toFixed(2), values: tintRange, description: "bg/success blend (higher = more bg, subtler tint)" },
					{ id: "toolErrorTint", label: "Tool error tint", currentValue: p.toolErrorTint.toFixed(2), values: tintRange, description: "bg/error blend" },
					{ id: "customMsgTint", label: "Custom msg tint", currentValue: p.customMsgTint.toFixed(2), values: tintRange, description: "bg/accent blend for custom messages" },

					// --- Semantic fallback colors ---
					{ id: "errorFallback", label: `${swatch(p.errorFallback)} Error fallback`, currentValue: p.errorFallback, values: undefined, description: "Fallback when palette[1] hue is too far from red" },
					{ id: "successFallback", label: `${swatch(p.successFallback)} Success fallback`, currentValue: p.successFallback, values: undefined, description: "Fallback when palette[2] hue is too far from green" },
					{ id: "warningFallback", label: `${swatch(p.warningFallback)} Warning fallback`, currentValue: p.warningFallback, values: undefined, description: "Fallback when palette[3] hue is too far from yellow" },
					{ id: "linkFallback", label: `${swatch(p.linkFallback)} Link fallback`, currentValue: p.linkFallback, values: undefined, description: "Fallback when palette[4] hue is too far from blue" },
					{ id: "accentFallback", label: `${swatch(p.accentFallback)} Accent fallback`, currentValue: p.accentFallback, values: undefined, description: "Used when palette[5] is missing" },
					{ id: "accentAltFallback", label: `${swatch(p.accentAltFallback)} Accent alt fallback`, currentValue: p.accentAltFallback, values: undefined, description: "Used when palette[6] is missing" },

					// --- Contrast ---
					{ id: "linkContrastMin", label: "Link contrast minimum", currentValue: p.linkContrastMin.toFixed(1), values: contrastRange, description: "Minimum contrast ratio for readable links (WCAG AA = 4.5)" },
				];
			};

			// Debounced live preview — reapply current theme with updated params
			let previewTimer: ReturnType<typeof setTimeout> | null = null;
			let persistTimer: ReturnType<typeof setTimeout> | null = null;

			const schedulePreview = (): void => {
				if (previewTimer) clearTimeout(previewTimer);
				previewTimer = setTimeout(() => {
					previewTimer = null;
					if (!cmuxColors || !cmuxTheme) return;
					writeAndPreviewPiTheme(ctx, cmuxColors, cmuxTheme, getThemeParams());
				}, 120);
			};

			const schedulePersist = (): void => {
				if (persistTimer) clearTimeout(persistTimer);
				persistTimer = setTimeout(() => {
					persistTimer = null;
					persistSettings(pi);
				}, 500);
			};

			let settingsList: SettingsList | null = null;
			let items: SettingItem[] = [];
			let selectedIdx = 0;

			/** Cycle the currently selected item's value by the given direction (+1 or -1). */
			const cycleSelected = (direction: number): void => {
				const item = items[selectedIdx];
				if (!item?.values || item.values.length === 0) return;
				const curIdx = item.values.indexOf(item.currentValue);
				const nextIdx = (curIdx + direction + item.values.length) % item.values.length;
				const newValue = item.values[nextIdx]!;
				item.currentValue = newValue;
				settingsList?.updateValue(item.id, newValue);
				// Persist + preview
				handleValueChange(item.id, newValue);
			};

			/** Shared handler for value changes from both cycling and SettingsList onChange. */
			const handleValueChange = (id: string, newValue: string): void => {
				if (id === "autoSync") {
					updateSettings(pi, { autoSync: newValue === "on" });
					return;
				}
				const numericKeys: (keyof ThemeParams)[] = [
					"mutedWeight", "dimWeight", "borderWeight",
					"bgShift", "selectedBgFactor", "userMsgBgFactor", "toolPendingBgFactor",
					"toolSuccessTint", "toolErrorTint", "customMsgTint",
					"linkContrastMin",
				];
				if (numericKeys.includes(id as keyof ThemeParams)) {
					updateThemeParamInMemory(id as keyof ThemeParams, parseFloat(newValue));
					schedulePreview();
					schedulePersist();
					return;
				}
				const colorKeys: (keyof ThemeParams)[] = [
					"errorFallback", "successFallback", "warningFallback",
					"linkFallback", "accentFallback", "accentAltFallback",
				];
				if (colorKeys.includes(id as keyof ThemeParams)) {
					const hex = newValue.startsWith("#") ? newValue : `#${newValue}`;
					if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
						updateThemeParamInMemory(id as keyof ThemeParams, hex);
						schedulePreview();
						schedulePersist();
					}
				}
			};

			await ctx.ui.custom((tui, theme, _kb, done) => {
				const container = new Container();

				// Title and footer as mutable refs so invalidate can refresh them
				let titleText = new Text(theme.fg("accent", theme.bold(" Theme Generation Settings")), 1, 0);
				let footerText = new Text(theme.fg("dim", " \u2190\u2192 adjust \u00B7 enter/space cycle \u00B7 / search \u00B7 esc close"), 1, 0);

				// Build items once — SettingsList mutates currentValue in-place via onChange
				items = buildItems();

				settingsList = new SettingsList(
					items,
					12,
					getSettingsListTheme(),
					(id, newValue) => {
						handleValueChange(id, newValue);
						tui.requestRender();
					},
					() => {
						if (previewTimer) clearTimeout(previewTimer);
						if (persistTimer) { clearTimeout(persistTimer); persistSettings(pi); }
						done(undefined);
					},
				);

				container.addChild(titleText);
				container.addChild(settingsList);
				container.addChild(footerText);

				let searchEnabled = false;
				let searchList: SettingsList | null = null;

				return {
					render: (w) => container.render(w),
					invalidate: () => {
						// Refresh chrome Text nodes with the live theme — no SettingsList recreation
						const t = ctx.ui.theme;
						titleText = new Text(t.fg("accent", t.bold(" Theme Generation Settings")), 1, 0);
						footerText = new Text(t.fg("dim", " \u2190\u2192 adjust \u00B7 enter/space cycle \u00B7 / search \u00B7 esc close"), 1, 0);
						container.clear();
						container.addChild(titleText);
						container.addChild(searchEnabled && searchList ? searchList : settingsList!);
						container.addChild(footerText);
						container.invalidate();
						settingsList?.invalidate();
					},
					handleInput: (data) => {
						// Toggle search mode with '/'
						if (data === "/" && !searchEnabled) {
							searchEnabled = true;
							searchList = new SettingsList(
								items,
								12,
								getSettingsListTheme(),
								(id, newValue) => {
									handleValueChange(id, newValue);
									tui.requestRender();
								},
								() => {
									searchEnabled = false;
									searchList = null;
									tui.requestRender();
								},
								{ enableSearch: true },
							);
							container.clear();
							container.addChild(new Text(theme.fg("accent", theme.bold(" Theme Generation Settings")), 1, 0));
							container.addChild(searchList);
							container.addChild(new Text(theme.fg("dim", " esc to close search"), 1, 0));
							tui.requestRender();
							return;
						}

						if (searchEnabled && searchList) {
							searchList.handleInput?.(data);
							tui.requestRender();
							return;
						}

						// Track selection for left/right
						if (matchesKey(data, Key.up)) {
							selectedIdx = selectedIdx === 0 ? items.length - 1 : selectedIdx - 1;
						} else if (matchesKey(data, Key.down)) {
							selectedIdx = selectedIdx === items.length - 1 ? 0 : selectedIdx + 1;
						} else if (matchesKey(data, Key.right)) {
							cycleSelected(+1);
							tui.requestRender();
							return;
						} else if (matchesKey(data, Key.left)) {
							cycleSelected(-1);
							tui.requestRender();
							return;
						}

						settingsList?.handleInput?.(data);
						tui.requestRender();
					},
				};
			});
		},
	});
}
