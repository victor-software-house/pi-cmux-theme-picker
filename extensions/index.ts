/**
 * pi-cmux-theme-picker
 *
 * Optionally syncs pi theme with the active cmux terminal theme on session start.
 * Registers /theme command for live theme picking with debounced preview.
 * Registers /theme-settings command for toggling extension settings.
 */

import { getMarkdownTheme, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Container, Key, Markdown, type AutocompleteItem, type Component, type OverlayHandle, type SettingItem, SettingsList, Spacer, Text, Box, matchesKey } from "@mariozechner/pi-tui";
import { getCurrentCmuxThemeName, getCmuxThemeColors, getAvailableCmuxThemes, runCmuxThemeSet } from "./cmux.js";
import { ensureSemanticHue, hexToRgb, mixColors } from "./colors.js";
import {
	slugifyThemeName,
	writeAndSetPiTheme,
	buildThemeInstance,
	resolvePaletteSourceColor,
} from "./pi-theme.js";
import { showThemePicker } from "./picker.js";
import {
	getSettings,
	updateSettings,
	updateThemeParamInMemory,
	persistSettings,
	getThemeParams,
	getPreviewDebounceMs,
	loadSettings,
	resetThemeParams,
	setOverrideEnabled,
	clearOverrideParam,
} from "./settings.js";
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
	const params = getThemeParams(slug);
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

// --- Theme preview overlay ---

// Lazy-loaded ToolExecutionComponent — lives in Pi's internal renderer.
let _tec: { cls: any; defs: Record<string, any> } | null = null;
function getTEC(): typeof _tec {
	if (!_tec) {
		try {
			const base = require.resolve("@mariozechner/pi-coding-agent").replace(/dist\/index\.js$/, "dist/");
			const tecMod = require(`${base}modes/interactive/components/tool-execution.js`);
			const toolsMod = require(`${base}core/tools/index.js`);
			_tec = { cls: tecMod.ToolExecutionComponent, defs: toolsMod.allToolDefinitions };
		} catch { /* graceful fallback */ }
	}
	return _tec;
}

function createToolPreview(name: string, args: Record<string, unknown>, result: { content: { type: string; text: string }[]; details?: string; isError: boolean }): Component | null {
	const tec = getTEC();
	if (!tec) return null;
	const mockUi = { requestRender: () => {} };
	const comp = new tec.cls(name, `preview-${name}`, args, { showImages: false }, tec.defs[name], mockUi, process.cwd());
	comp.setArgsComplete();
	comp.markExecutionStarted();
	comp.updateResult(result);
	return comp as Component;
}

/**
 * Non-capturing overlay that previews theme colors using Pi's actual renderers.
 * ToolExecutionComponent renders tool calls identically to real Pi output
 * (syntax highlighting, diff rendering, backgrounds, timing).
 * Markdown handles user/assistant/custom messages. Box handles selected highlight.
 */
class ThemePreview implements Component {
	private container = new Container();

	// biome-ignore lint: Theme proxy has typed keys but we use string-based lookups
	rebuild(t: () => any): void {
		const theme = t();
		this.container = new Container();
		this.setBorderFn(
			(s: string) => theme.fg("borderMuted", s),
			(s: string) => theme.fg("accent", s),
		);

		// --- User message ---
		this.container.addChild(new Spacer(1));
		this.container.addChild(new Markdown("> Fix the auth bug in login.ts", 1, 1, getMarkdownTheme(), {
			bgColor: (text: string) => theme.bg("userMessageBg", text),
			color: (text: string) => theme.fg("userMessageText", text),
		}));

		// --- Assistant text ---
		this.container.addChild(new Spacer(1));
		this.container.addChild(new Markdown(
			"I'll fix the **authentication** bug. Let me [read the file](src/login.ts).",
			1, 0, getMarkdownTheme(),
		));

		// --- Tool calls using Pi's actual ToolExecutionComponent ---
		const readTool = createToolPreview("read", { path: "src/login.ts" }, {
			content: [{ type: "text", text: "export function login(user: string) {\n  validateToken(user.token);\n}" }],
			details: "3 lines", isError: false,
		});
		if (readTool) this.container.addChild(readTool);

		const editTool = createToolPreview("edit", {
			path: "src/login.ts",
			edits: [{ oldText: "// missing", newText: "validateToken(user.token);" }],
		}, {
			content: [{ type: "text", text: "1 edit applied" }],
			details: "--- src/login.ts\n+++ src/login.ts\n@@ -1,3 +1,3 @@\n export function login(user) {\n-  // missing\n+  validateToken(user.token);\n }",
			isError: false,
		});
		if (editTool) this.container.addChild(editTool);

		const bashTool = createToolPreview("bash", { command: "npm test" }, {
			content: [{ type: "text", text: "Error: test suite failed\n  at login.test.ts:15" }],
			details: "exit 1 (2 lines)", isError: true,
		});
		if (bashTool) this.container.addChild(bashTool);

		// --- Markdown summary ---
		this.container.addChild(new Spacer(1));
		this.container.addChild(new Markdown(
			"## Summary\n" +
			"- Added `token validation`\n" +
			"- Tests **failing** \u2014 needs fix",
			1, 0, getMarkdownTheme(),
		));

		// --- Custom message ---
		this.container.addChild(new Spacer(1));
		this.container.addChild(new Markdown("Review before merging", 1, 1, getMarkdownTheme(), {
			bgColor: (text: string) => theme.bg("customMessageBg", text),
			color: (text: string) => theme.fg("customMessageText", text),
		}));

		// --- Selected item ---
		this.container.addChild(new Spacer(1));
		const selectedBox = new Box(1, 0, (text: string) => theme.bg("selectedBg", text));
		selectedBox.addChild(new Text("\u2192 Selected item highlight", 0, 0));
		this.container.addChild(selectedBox);
	}

	invalidate(): void { this.container.invalidate(); }

	render(width: number): string[] {
		const inner = Math.max(1, width - 2);
		const content = this.container.render(inner);

		// Border using theme border color via the live theme proxy
		const b = (s: string) => this.borderFn?.(s) ?? s;
		const title = this.titleFn?.(" Preview ") ?? " Preview ";
		const titleW = title.replace(/\x1b\[[^m]*m/g, "").length;
		const topFill = Math.max(0, inner - titleW);
		const top = b("\u256D") + title + b("\u2500".repeat(topFill)) + b("\u256E");
		const bot = b("\u2570") + b("\u2500".repeat(inner)) + b("\u256F");
		const wrap = (line: string): string => {
			// Pad line to inner width for clean right border
			const vis = line.replace(/\x1b\[[^m]*m/g, "").length;
			const pad = Math.max(0, inner - vis);
			return b("\u2502") + line + " ".repeat(pad) + b("\u2502");
		};
		return [top, ...content.map(wrap), bot];
	}

	private borderFn?: (s: string) => string;
	private titleFn?: (s: string) => string;
	setBorderFn(border: (s: string) => string, title: (s: string) => string): void {
		this.borderFn = border;
		this.titleFn = title;
	}
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
				const params = getThemeParams(slugifyThemeName(themeArg));
				writeAndSetPiTheme(ctx, colors, themeArg, params);
				runCmuxThemeSet(themeArg);
				updateStatus(ctx, themeArg, params);
				ctx.ui.notify(`Theme "${themeArg}" applied`, "info");
				return;
			}

			const selected = await showThemePicker(pi, ctx);
			if (selected) {
				updateStatus(ctx, selected, getThemeParams(slugifyThemeName(selected)));
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
			const currentThemeSlug = cmuxTheme ? slugifyThemeName(cmuxTheme) : null;
			let scope: "global" | string = "global";
			const scopeLabel = (): string => (scope === "global" ? "global" : scope);
			const paramsForScope = (): ThemeParams => (scope === "global" ? getThemeParams() : getThemeParams(scope));

			const buildItems = (): SettingItem[] => {
				const p = paramsForScope();
				const settings = getSettings();

				const weight01 = numRange(0.0, 1.0, 0.05, 2);
				const bgShiftRange = numRange(1, 30, 1, 0);
				const factorRange = numRange(0.0, 1.0, 0.1, 1);
				const tintRange = numRange(0.70, 0.99, 0.01, 2);
				const contrastRange = numRange(1.5, 6.0, 0.5, 1);
				const sourceValues = [
					...Array.from({ length: 16 }, (_, i) => `palette[${i}]`),
					"fg",
					"bg",
				];

				const bg = cmuxColors?.background;
				const fg = cmuxColors?.foreground;
				const error = cmuxColors ? ensureSemanticHue(resolvePaletteSourceColor(cmuxColors, p.errorSource), 0, p.errorFallback) : p.errorFallback;
				const success = cmuxColors ? ensureSemanticHue(resolvePaletteSourceColor(cmuxColors, p.successSource), 120, p.successFallback) : p.successFallback;
				const accent = cmuxColors ? (resolvePaletteSourceColor(cmuxColors, p.accentSource) || p.accentFallback) : p.accentFallback;
				const sourceSwatch = (source: keyof Pick<ThemeParams, "errorSource" | "successSource" | "warningSource" | "linkSource" | "accentSource" | "accentAltSource">, fallback: string): string => {
					if (!cmuxColors) return swatch(fallback);
					return swatch(resolvePaletteSourceColor(cmuxColors, p[source]) || fallback);
				};
				const globalParams = getThemeParams();
				const isOverridden = <K extends keyof ThemeParams>(key: K): boolean =>
					scope !== "global" && p[key] !== globalParams[key];
				const overridePrefix = <K extends keyof ThemeParams>(key: K): string =>
					isOverridden(key) ? "* " : "";
				const overrideDesc = <K extends keyof ThemeParams>(key: K, base: string): string =>
					isOverridden(key) ? `${base} (global: ${globalParams[key]})` : base;

				return [
					{ id: "autoSync", label: "Auto-sync on session start", currentValue: settings.autoSync ? "on" : "off", values: ["on", "off"] },
					{ id: "mutedWeight", label: `${overridePrefix("mutedWeight")}${bg && fg ? `${swatch(mixColors(fg, bg, p.mutedWeight))} ` : ""}Muted text weight`, currentValue: p.mutedWeight.toFixed(2), values: weight01, description: overrideDesc("mutedWeight", "fg/bg mix for muted text (higher = more fg)") },
					{ id: "dimWeight", label: `${overridePrefix("dimWeight")}${bg && fg ? `${swatch(mixColors(fg, bg, p.dimWeight))} ` : ""}Dim text weight`, currentValue: p.dimWeight.toFixed(2), values: weight01, description: overrideDesc("dimWeight", "fg/bg mix for dim text") },
					{ id: "borderWeight", label: `${overridePrefix("borderWeight")}${bg && fg ? `${swatch(mixColors(fg, bg, p.borderWeight))} ` : ""}Border weight`, currentValue: p.borderWeight.toFixed(2), values: weight01, description: overrideDesc("borderWeight", "fg/bg mix for muted borders") },
					{ id: "bgShift", label: `${overridePrefix("bgShift")}Background shift`, currentValue: p.bgShift.toFixed(0), values: bgShiftRange, description: overrideDesc("bgShift", "Brightness offset for derived backgrounds (higher = more contrast)") },
					{ id: "selectedBgFactor", label: `${overridePrefix("selectedBgFactor")}Selected bg factor`, currentValue: p.selectedBgFactor.toFixed(1), values: factorRange, description: overrideDesc("selectedBgFactor", "Multiplier of bgShift for selected item bg") },
					{ id: "userMsgBgFactor", label: `${overridePrefix("userMsgBgFactor")}User message bg factor`, currentValue: p.userMsgBgFactor.toFixed(1), values: factorRange, description: overrideDesc("userMsgBgFactor", "Multiplier of bgShift for user message bg") },
					{ id: "toolPendingBgFactor", label: `${overridePrefix("toolPendingBgFactor")}Tool pending bg factor`, currentValue: p.toolPendingBgFactor.toFixed(1), values: factorRange, description: overrideDesc("toolPendingBgFactor", "Multiplier of bgShift for tool pending bg") },
					{ id: "toolSuccessTint", label: `${overridePrefix("toolSuccessTint")}${bg ? `${swatch(mixColors(bg, success, p.toolSuccessTint))} ` : ""}Tool success tint`, currentValue: p.toolSuccessTint.toFixed(2), values: tintRange, description: overrideDesc("toolSuccessTint", "bg/success blend (higher = more bg, subtler tint)") },
					{ id: "toolErrorTint", label: `${overridePrefix("toolErrorTint")}${bg ? `${swatch(mixColors(bg, error, p.toolErrorTint))} ` : ""}Tool error tint`, currentValue: p.toolErrorTint.toFixed(2), values: tintRange, description: overrideDesc("toolErrorTint", "bg/error blend") },
					{ id: "customMsgTint", label: `${overridePrefix("customMsgTint")}${bg ? `${swatch(mixColors(bg, accent, p.customMsgTint))} ` : ""}Custom msg tint`, currentValue: p.customMsgTint.toFixed(2), values: tintRange, description: overrideDesc("customMsgTint", "bg/accent blend for custom messages") },
					{ id: "errorSource", label: `${overridePrefix("errorSource")}${sourceSwatch("errorSource", p.errorFallback)} Error source`, currentValue: p.errorSource, values: sourceValues, description: overrideDesc("errorSource", "Source color for error semantic role") },
					{ id: "successSource", label: `${overridePrefix("successSource")}${sourceSwatch("successSource", p.successFallback)} Success source`, currentValue: p.successSource, values: sourceValues, description: overrideDesc("successSource", "Source color for success semantic role") },
					{ id: "warningSource", label: `${overridePrefix("warningSource")}${sourceSwatch("warningSource", p.warningFallback)} Warning source`, currentValue: p.warningSource, values: sourceValues, description: overrideDesc("warningSource", "Source color for warning semantic role") },
					{ id: "linkSource", label: `${overridePrefix("linkSource")}${sourceSwatch("linkSource", p.linkFallback)} Link source`, currentValue: p.linkSource, values: sourceValues, description: overrideDesc("linkSource", "Source color for link semantic role") },
					{ id: "accentSource", label: `${overridePrefix("accentSource")}${sourceSwatch("accentSource", p.accentFallback)} Accent source`, currentValue: p.accentSource, values: sourceValues, description: overrideDesc("accentSource", "Source color for accent semantic role") },
					{ id: "accentAltSource", label: `${overridePrefix("accentAltSource")}${sourceSwatch("accentAltSource", p.accentAltFallback)} Accent alt source`, currentValue: p.accentAltSource, values: sourceValues, description: overrideDesc("accentAltSource", "Source color for alternate accent role") },
					{ id: "linkContrastMin", label: `${overridePrefix("linkContrastMin")}Link contrast minimum`, currentValue: p.linkContrastMin.toFixed(1), values: contrastRange, description: overrideDesc("linkContrastMin", "Minimum contrast ratio for readable links (WCAG AA = 4.5)") },
					{ id: "previewDebounceMs", label: "Preview debounce (ms)", currentValue: settings.previewDebounceMs.toFixed(0), values: numRange(50, 1000, 50, 0), description: "Cooldown before theme preview applies (lower = faster, higher = smoother navigation)" },
				];
			};

			// Trailing-only debounce — reads latest in-memory params, never blocks input.
			const applyPreview = debounce(() => {
				if (!cmuxColors || !cmuxTheme) return;
				const slug = slugifyThemeName(cmuxTheme);
				const instance = buildThemeInstance(cmuxColors, `cmux-preview-${slug}-${Date.now()}`, paramsForScope(), ctx);
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
			const sourceKeys = new Set<string>([
				"errorSource", "successSource", "warningSource",
				"linkSource", "accentSource", "accentAltSource",
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
					updateThemeParamInMemory(id as keyof ThemeParams, parseFloat(newValue), scope);
					applyPreview();
					schedulePersist();
					return;
				}
				if (colorKeys.has(id)) {
					const hex = newValue.startsWith("#") ? newValue : `#${newValue}`;
					if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
						updateThemeParamInMemory(id as keyof ThemeParams, hex, scope);
						applyPreview();
						schedulePersist();
					}
					return;
				}
				if (sourceKeys.has(id)) {
					updateThemeParamInMemory(id as keyof ThemeParams, newValue, scope);
					applyPreview();
					schedulePersist();
				}
			};

			await ctx.ui.custom((tui, _theme, _kb, done) => {
				const t = () => ctx.ui.theme;
				const container = new Container();

				// Indirect close — allows preview overlay cleanup to be wired in later.
				let beforeClose: (() => void) | null = null;
				const onClose = (): void => {
					beforeClose?.();
					applyPreview.cancel();
					schedulePersist.flush();
					if (cmuxColors && cmuxTheme) {
						writeAndSetPiTheme(ctx, cmuxColors, cmuxTheme, getThemeParams(currentThemeSlug ?? undefined));
					}
					done(undefined);
				};

				// Build initial items and keep references — mutated in place on every refresh.
				const items = buildItems();
				const headerText = new Text(t().fg("accent", t().bold(` Theme Generation Settings [${scopeLabel()}]`)), 1, 0);

				const settingsList = new SettingsList(
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
						refreshItems();
						tui.requestRender();
					},
					onClose,
				);

				container.addChild(headerText);
				container.addChild(settingsList);
				container.addChild(new Text(t().fg("dim", " \u2190\u2192 adjust \u00B7 tab scope \u00B7 d clear override \u00B7 r reset \u00B7 p preview"), 1, 0));

				// Theme preview overlay — non-capturing, anchored right.
				const preview = new ThemePreview();
				const updatePreview = (): void => { preview.rebuild(t); };
				updatePreview();
				const previewHandle = (tui as any).showOverlay(preview, {
					nonCapturing: true,
					anchor: "right-center",
					width: "40%",
					minWidth: 38,
					margin: { right: 1, top: 1, bottom: 1 },
				}) as OverlayHandle;

				beforeClose = () => previewHandle.hide();

				// Read SettingsList internal selected index (private but accessible at runtime).
				const getSelectedIdx = (): number => (settingsList as any).selectedIndex ?? 0;

				// Mutate existing item objects so SettingsList picks up fresh labels/swatches on next render.
				const refreshItems = (): void => {
					const fresh = buildItems();
					for (let i = 0; i < items.length; i++) {
						const src = fresh[i];
						if (!src) continue;
						items[i].label = src.label;
						items[i].description = src.description;
						items[i].currentValue = src.currentValue;
					}
					headerText.setText(t().fg("accent", t().bold(` Theme Generation Settings [${scopeLabel()}]`)));
					updatePreview();
				};

				const cycleSelected = (direction: number): void => {
					const idx = getSelectedIdx();
					const item = items[idx];
					if (!item?.values || item.values.length === 0) return;
					const curIdx = item.values.indexOf(item.currentValue);
					const nextIdx = (curIdx + direction + item.values.length) % item.values.length;
					const newValue = item.values[nextIdx]!;
					handleValueChange(item.id, newValue);
					refreshItems();
				};

				return {
					render: (w) => container.render(w),
					invalidate: () => container.invalidate(),
					handleInput: (data) => {
						if (matchesKey(data, Key.right)) {
							cycleSelected(+1);
							tui.requestRender();
							return;
						} else if (matchesKey(data, Key.left)) {
							cycleSelected(-1);
							tui.requestRender();
							return;
						} else if (matchesKey(data, Key.tab)) {
							if (!currentThemeSlug) return;
							if (scope === "global") {
								scope = currentThemeSlug;
								setOverrideEnabled(currentThemeSlug, true);
							} else {
								scope = "global";
								setOverrideEnabled(currentThemeSlug, false);
							}
							refreshItems();
							applyPreview();
							schedulePersist();
							tui.requestRender();
							return;
						} else if (data.toLowerCase() === "d") {
							if (scope === "global") return;
							const item = items[getSelectedIdx()];
							if (!item) return;
							if (Object.hasOwn(DEFAULT_THEME_PARAMS, item.id)) {
								clearOverrideParam(scope, item.id as keyof ThemeParams);
								persistSettings();
								refreshItems();
								applyPreview();
								tui.requestRender();
							}
							return;
						} else if (data.toLowerCase() === "p") {
							previewHandle.setHidden(!previewHandle.isHidden());
							tui.requestRender();
							return;
						} else if (data.toLowerCase() === "r") {
							if (scope === "global") {
								resetThemeParams("global");
							} else {
								resetThemeParams(scope);
								scope = "global";
							}
							refreshItems();
							applyPreview();
							tui.requestRender();
							return;
						}
						// Delegate everything else (up/down/enter/esc) to SettingsList.
						settingsList.handleInput?.(data);
						tui.requestRender();
					},
				};
			});
		},
	});
}
