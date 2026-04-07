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
	buildThemeInstance,
} from "./pi-theme.js";
import { showThemePicker } from "./picker.js";
import { getSettings, updateSettings, updateThemeParamInMemory, persistSettings, getThemeParams, getPreviewDebounceMs, loadSettings, resetThemeParams } from "./settings.js";
import { DEFAULT_THEME_PARAMS, type SessionContext, type ThemeParams } from "./types.js";
import { debounce } from "perfect-debounce";

const STATUS_KEY = "cmux-theme";

// Cached theme names for autocomplete
let cachedThemeNames: string[] = [];

function formatParamValue(value: number): string {
	if (Number.isInteger(value)) return value.toFixed(0);
	return value.toFixed(2);
}

function updateStatus(ctx: ExtensionContext, themeName?: string, params?: ThemeParams): void {
	if (!themeName) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}

	const statusParts: string[] = [`theme:${themeName}`];
	if (params) {
		const summaryMap: Array<{ key: keyof ThemeParams; short: string }> = [
			{ key: "mutedWeight", short: "muted" },
			{ key: "dimWeight", short: "dim" },
			{ key: "borderWeight", short: "border" },
			{ key: "bgShift", short: "bg" },
			{ key: "selectedBgFactor", short: "selBg" },
			{ key: "userMsgBgFactor", short: "msgBg" },
			{ key: "toolPendingBgFactor", short: "pendBg" },
			{ key: "toolSuccessTint", short: "okTint" },
			{ key: "toolErrorTint", short: "errTint" },
			{ key: "customMsgTint", short: "custTint" },
			{ key: "linkContrastMin", short: "linkCR" },
		];
		const diffSummary = summaryMap
			.filter(({ key }) => params[key] !== DEFAULT_THEME_PARAMS[key])
			.map(({ key, short }) => `${short}:${formatParamValue(params[key] as number)}`)
			.join(" ");
		if (diffSummary) statusParts.push(diffSummary);
	}

	let text = statusParts.join(" · ");
	if (text.length > 60) text = `${text.slice(0, 57)}…`;
	ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", text));
}

function syncCurrentCmuxThemeToPi(ctx: SessionContext): void {
	const currentTheme = getCurrentCmuxThemeName();
	if (!currentTheme) return;
	const colors = getCmuxThemeColors(currentTheme);
	if (!colors) return;
	const slug = slugifyThemeName(currentTheme);
	const themeName = slug ? `cmux-sync-${slug}` : "cmux-sync";
	if (ctx.ui.theme.name === themeName) return;
	const params = getThemeParams();
	writeAndSetPiTheme(ctx, colors, currentTheme, params);
	updateStatus(ctx, currentTheme, params);
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
		loadSettings(ctx.cwd);
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
				const params = getThemeParams();
				writeAndSetPiTheme(ctx, colors, themeArg, params);
				runCmuxThemeSet(themeArg);
				updateStatus(ctx, themeArg, params);
				ctx.ui.notify(`Theme "${themeArg}" applied`, "info");
				return;
			}

			const selected = await showThemePicker(pi, ctx);
			if (selected) {
				updateStatus(ctx, selected, getThemeParams());
				ctx.ui.notify(`Theme "${selected}" applied`, "info");
			}
		},
	});

	// --- /theme-settings command ---
	pi.registerCommand("theme-settings", {
		description: "Configure cmux theme picker and theme generation settings",

		handler: async (_args, ctx) => {
			const cmuxTheme = getCurrentCmuxThemeName();
			const cmuxColors = cmuxTheme ? getCmuxThemeColors(cmuxTheme) : null;

			const buildItems = (): SettingItem[] => {
				const p = getThemeParams();
				const settings = getSettings();

				const weight01 = numRange(0.0, 1.0, 0.05, 2);
				const bgShiftRange = numRange(1, 30, 1, 0);
				const factorRange = numRange(0.0, 1.0, 0.1, 1);
				const tintRange = numRange(0.70, 0.99, 0.01, 2);
				const contrastRange = numRange(1.5, 6.0, 0.5, 1);

				return [
					{ id: "autoSync", label: "Auto-sync on session start", currentValue: settings.autoSync ? "on" : "off", values: ["on", "off"] },
					{ id: "mutedWeight", label: "Muted text weight", currentValue: p.mutedWeight.toFixed(2), values: weight01, description: "fg/bg mix for muted text (higher = more fg)" },
					{ id: "dimWeight", label: "Dim text weight", currentValue: p.dimWeight.toFixed(2), values: weight01, description: "fg/bg mix for dim text" },
					{ id: "borderWeight", label: "Border weight", currentValue: p.borderWeight.toFixed(2), values: weight01, description: "fg/bg mix for muted borders" },
					{ id: "bgShift", label: "Background shift", currentValue: p.bgShift.toFixed(0), values: bgShiftRange, description: "Brightness offset for derived backgrounds (higher = more contrast)" },
					{ id: "selectedBgFactor", label: "Selected bg factor", currentValue: p.selectedBgFactor.toFixed(1), values: factorRange, description: "Multiplier of bgShift for selected item bg" },
					{ id: "userMsgBgFactor", label: "User message bg factor", currentValue: p.userMsgBgFactor.toFixed(1), values: factorRange, description: "Multiplier of bgShift for user message bg" },
					{ id: "toolPendingBgFactor", label: "Tool pending bg factor", currentValue: p.toolPendingBgFactor.toFixed(1), values: factorRange, description: "Multiplier of bgShift for tool pending bg" },
					{ id: "toolSuccessTint", label: "Tool success tint", currentValue: p.toolSuccessTint.toFixed(2), values: tintRange, description: "bg/success blend (higher = more bg, subtler tint)" },
					{ id: "toolErrorTint", label: "Tool error tint", currentValue: p.toolErrorTint.toFixed(2), values: tintRange, description: "bg/error blend" },
					{ id: "customMsgTint", label: "Custom msg tint", currentValue: p.customMsgTint.toFixed(2), values: tintRange, description: "bg/accent blend for custom messages" },
					{ id: "errorFallback", label: `${swatch(p.errorFallback)} Error fallback`, currentValue: p.errorFallback, description: "Fallback when palette[1] hue is too far from red" },
					{ id: "successFallback", label: `${swatch(p.successFallback)} Success fallback`, currentValue: p.successFallback, description: "Fallback when palette[2] hue is too far from green" },
					{ id: "warningFallback", label: `${swatch(p.warningFallback)} Warning fallback`, currentValue: p.warningFallback, description: "Fallback when palette[3] hue is too far from yellow" },
					{ id: "linkFallback", label: `${swatch(p.linkFallback)} Link fallback`, currentValue: p.linkFallback, description: "Fallback when palette[4] hue is too far from blue" },
					{ id: "accentFallback", label: `${swatch(p.accentFallback)} Accent fallback`, currentValue: p.accentFallback, description: "Used when palette[5] is missing" },
					{ id: "accentAltFallback", label: `${swatch(p.accentAltFallback)} Accent alt fallback`, currentValue: p.accentAltFallback, description: "Used when palette[6] is missing" },
					{ id: "linkContrastMin", label: "Link contrast minimum", currentValue: p.linkContrastMin.toFixed(1), values: contrastRange, description: "Minimum contrast ratio for readable links (WCAG AA = 4.5)" },
					{ id: "previewDebounceMs", label: "Preview debounce (ms)", currentValue: settings.previewDebounceMs.toFixed(0), values: numRange(50, 1000, 50, 0), description: "Cooldown before theme preview applies (lower = faster, higher = smoother navigation)" },
				];
			};

			// Trailing-only debounce — reads latest in-memory params, never blocks input.
			const applyPreview = debounce(() => {
				if (!cmuxColors || !cmuxTheme) return;
				const slug = slugifyThemeName(cmuxTheme);
				const instance = buildThemeInstance(cmuxColors, `cmux-preview-${slug}-${Date.now()}`, getThemeParams(), ctx);
				ctx.ui.setTheme(instance);
			}, getPreviewDebounceMs());

			// Persist debounced — disk write only after 500ms of inactivity
			const schedulePersist = debounce(() => persistSettings(), 500, { trailing: true });

			const numericKeys = new Set<string>([
				"mutedWeight", "dimWeight", "borderWeight",
				"bgShift", "selectedBgFactor", "userMsgBgFactor", "toolPendingBgFactor",
				"toolSuccessTint", "toolErrorTint", "customMsgTint",
				"linkContrastMin",
			]);
			const colorKeys = new Set<string>([
				"errorFallback", "successFallback", "warningFallback",
				"linkFallback", "accentFallback", "accentAltFallback",
			]);

			const handleValueChange = (id: string, newValue: string): void => {
				if (id === "autoSync") {
					updateSettings({ autoSync: newValue === "on" });
					return;
				}
				if (id === "previewDebounceMs") {
					updateSettings({ previewDebounceMs: parseInt(newValue, 10) });
					return;
				}
				if (numericKeys.has(id)) {
					updateThemeParamInMemory(id as keyof ThemeParams, parseFloat(newValue));
					applyPreview();
					schedulePersist();
					return;
				}
				if (colorKeys.has(id)) {
					const hex = newValue.startsWith("#") ? newValue : `#${newValue}`;
					if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
						updateThemeParamInMemory(id as keyof ThemeParams, hex);
						applyPreview();
						schedulePersist();
					}
				}
			};

			// Track selected index for left/right cycling
			let selectedIdx = 0;
			let items: SettingItem[] = [];
			let settingsList: SettingsList | null = null;

			const refreshItems = (): void => {
				items = buildItems();
				if (selectedIdx >= items.length) selectedIdx = Math.max(0, items.length - 1);
				for (const item of items) settingsList?.updateValue(item.id, item.currentValue);
			};

			const cycleSelected = (direction: number): void => {
				const item = items[selectedIdx];
				if (!item?.values || item.values.length === 0) return;
				const curIdx = item.values.indexOf(item.currentValue);
				const nextIdx = (curIdx + direction + item.values.length) % item.values.length;
				const newValue = item.values[nextIdx]!;
				item.currentValue = newValue;
				settingsList?.updateValue(item.id, newValue);
				handleValueChange(item.id, newValue);
			};

			await ctx.ui.custom((tui, _theme, _kb, done) => {
				const t = () => ctx.ui.theme;
				const container = new Container();
				refreshItems();

				// Use live theme callbacks — same pattern as the picker
				settingsList = new SettingsList(
					items,
					12,
					{
						label: (text, selected) => selected ? t().fg("accent", text) : text,
						value: (text, selected) => selected ? t().fg("accent", text) : t().fg("muted", text),
						description: (text) => t().fg("dim", text),
						cursor: t().fg("accent", "\u2192 "),
						hint: (text) => t().fg("dim", text),
					},
					(id, newValue) => {
						handleValueChange(id, newValue);
						tui.requestRender();
					},
					() => {
						applyPreview.cancel();
						schedulePersist.flush();
						// Write final theme with clean name — same as /theme confirm
						if (cmuxColors && cmuxTheme) {
							writeAndSetPiTheme(ctx, cmuxColors, cmuxTheme, getThemeParams());
						}
						removePreviewThemeFiles();
						done(undefined);
					},
				);

				container.addChild(new Text(t().fg("accent", t().bold(" Theme Generation Settings")), 1, 0));
				container.addChild(settingsList);
				container.addChild(new Text(t().fg("dim", " \u2190\u2192 adjust \u00B7 enter/space cycle \u00B7 r reset \u00B7 esc close"), 1, 0));

				return {
					render: (w) => container.render(w),
					invalidate: () => container.invalidate(),
					handleInput: (data) => {
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
						} else if (data.toLowerCase() === "r") {
							resetThemeParams();
							refreshItems();
							applyPreview();
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
