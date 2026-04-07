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
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
/** Color swatch using background color — doesn't interfere with fg accent on selection. */
function swatch(hex: string): string {
	const { r, g, b } = hexToRgb(hex);
	return `\x1b[48;2;${r};${g};${b}m  \x1b[49m`;
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

// Captured internal runner — provides getToolDefinition with extension overrides.
let _runner: { getToolDefinition: (name: string) => any } | null = null;
let _tecClass: any = null;

async function captureRunner(pi: ExtensionAPI): Promise<void> {
	try {
		const inspector = require("node:inspector");
		const session = new inspector.Session();
		session.connect();
		const post = (method: string, params: Record<string, unknown>): Promise<any> =>
			new Promise((resolve, reject) => session.post(method, params, (err: Error | null, res: unknown) => err ? reject(err) : resolve(res)));

		const key = `__cmuxTheme_${Date.now()}`;
		(globalThis as any)[key] = pi.getAllTools;
		try {
			const fn1 = await post("Runtime.evaluate", { expression: `globalThis.${key}` });
			const int1 = await post("Runtime.getProperties", { objectId: fn1.result.objectId, ownProperties: false });
			const scopesId1 = int1.internalProperties.find((p: any) => p.name === "[[Scopes]]").value.objectId;
			const chain1 = await post("Runtime.getProperties", { objectId: scopesId1, ownProperties: true });
			const props1 = await post("Runtime.getProperties", { objectId: chain1.result[0].value.objectId, ownProperties: true });
			const runtimeId = props1.result.find((p: any) => p.name === "runtime").value.objectId;
			await post("Runtime.callFunctionOn", { objectId: runtimeId, functionDeclaration: `function() { globalThis.${key} = this.getAllTools; }` });
			const fn2 = await post("Runtime.evaluate", { expression: `globalThis.${key}` });
			const int2 = await post("Runtime.getProperties", { objectId: fn2.result.objectId, ownProperties: false });
			const scopesId2 = int2.internalProperties.find((p: any) => p.name === "[[Scopes]]").value.objectId;
			const chain2 = await post("Runtime.getProperties", { objectId: scopesId2, ownProperties: true });
			const props2 = await post("Runtime.getProperties", { objectId: chain2.result[0].value.objectId, ownProperties: true });
			const runnerId = props2.result.find((p: any) => p.name === "runner").value.objectId;
			await post("Runtime.callFunctionOn", { objectId: runnerId, functionDeclaration: `function() { globalThis.${key} = this; }` });
			_runner = (globalThis as any)[key];
		} finally {
			delete (globalThis as any)[key];
			session.disconnect();
		}
	} catch { /* runner capture failed — will fall back to built-in defs */ }

	try {
		const base = require.resolve("@mariozechner/pi-coding-agent").replace(/dist\/index\.js$/, "dist/");
		_tecClass = require(`${base}modes/interactive/components/tool-execution.js`).ToolExecutionComponent;
		// If runner capture failed, load built-in defs as fallback
		if (!_runner) {
			const defs = require(`${base}core/tools/index.js`).allToolDefinitions;
			_runner = { getToolDefinition: (name: string) => defs[name] };
		}
	} catch { /* ToolExecutionComponent not available */ }
}

function createToolPreviewSync(name: string, args: Record<string, unknown>): Component | null {
	if (!_tecClass || !_runner) return null;
	const def = _runner.getToolDefinition(name);
	if (!def) return null;
	const mockUi = { requestRender: () => {} };
	const comp = new _tecClass(name, `preview-${name}-${Date.now()}`, args, { showImages: false }, def, mockUi, process.cwd());
	comp.setArgsComplete();
	return comp;
}

/** Execute a real tool call and feed the result into a ToolExecutionComponent. */
async function executeToolPreview(
	comp: any, name: string, args: Record<string, unknown>, ctx: any,
): Promise<void> {
	if (!_runner) return;
	const def = _runner.getToolDefinition(name);
	if (!def?.execute) return;
	try {
		comp.markExecutionStarted();
		const ac = new AbortController();
		const result = await def.execute(`preview-${name}`, args, ac.signal, () => {}, ctx);
		comp.updateResult({ ...result, isError: false });
	} catch (e: any) {
		comp.updateResult({ content: [{ type: "text", text: e.message }], isError: true });
	}
}

/**
 * Non-capturing overlay that previews theme colors using Pi's actual renderers.
 * ToolExecutionComponent renders tool calls identically to real Pi output
 * (syntax highlighting, diff rendering, backgrounds, timing).
 * Markdown handles user/assistant/custom messages. Box handles selected highlight.
 */
/** Page definition for paginated preview. */
interface PreviewPage {
	title: string;
	build: (theme: any) => { container: Container; executions: { comp: any; name: string; args: Record<string, unknown> }[] };
}

function getPreviewPages(): PreviewPage[] {
	// Prepare temp file once
	const previewDir = join(tmpdir(), "pi-theme-preview");
	if (!existsSync(previewDir)) mkdirSync(previewDir, { recursive: true });
	const sampleFile = join(previewDir, "auth.ts");
	writeFileSync(sampleFile, [
		'import { verify } from "./crypto";',
		"",
		"export async function login(user: string, token: string) {",
		"  const valid = await verify(token);",
		'  if (!valid) throw new Error("invalid token");',
		'  return { user, role: "admin" };',
		"}",
	].join("\n"));

	return [
		// Page 1: Messages — user msg, assistant text, markdown, custom msg
		{
			title: "Messages",
			build: (theme) => {
				const c = new Container();
				c.addChild(new Markdown("> Fix the auth bug in login.ts", 1, 1, getMarkdownTheme(), {
					bgColor: (text: string) => theme.bg("userMessageBg", text),
					color: (text: string) => theme.fg("userMessageText", text),
				}));
				c.addChild(new Markdown(
					"I'll fix the **authentication** bug.\n" +
					"Let me [read the file](src/auth.ts) first.",
					1, 0, getMarkdownTheme(),
				));
				c.addChild(new Spacer(1));
				c.addChild(new Markdown(
					"## Done\n" +
					"- Added `\"HS256\"` algorithm parameter\n" +
					"- All tests [passing](results.txt)\n\n" +
					"> **Note:** review before merging",
					1, 0, getMarkdownTheme(),
				));
				c.addChild(new Spacer(1));
				c.addChild(new Markdown("Waiting for approval", 1, 1, getMarkdownTheme(), {
					bgColor: (text: string) => theme.bg("customMessageBg", text),
					color: (text: string) => theme.fg("customMessageText", text),
				}));
				c.addChild(new Spacer(1));
				const selBox = new Box(1, 0, (text: string) => theme.bg("selectedBg", text));
				selBox.addChild(new Text("\u2192 Selected item highlight", 0, 0));
				c.addChild(selBox);
				return { container: c, executions: [] };
			},
		},
		// Page 2: Read tool
		{
			title: "Read",
			build: (theme) => {
				const c = new Container();
				const args = { path: sampleFile, limit: 7 };
				const comp = createToolPreviewSync("read", args);
				if (comp) c.addChild(comp);
				c.addChild(new Markdown(
					"**Syntax-highlighted** file content.\n" +
					"Uses `toolSuccessBg` background, `toolTitle` for the header, " +
					"and `toolOutput` for the content.\n\n" +
					"Colors: `syntaxKeyword` `syntaxFunction` `syntaxString` `syntaxVariable`",
					1, 1, getMarkdownTheme(),
				));
				return { container: c, executions: comp ? [{ comp, name: "read", args }] : [] };
			},
		},
		// Page 3: Edit tool
		{
			title: "Edit",
			build: (theme) => {
				// Re-write file so edit can find the original text
				writeFileSync(sampleFile, [
					'import { verify } from "./crypto";',
					"",
					"export async function login(user: string, token: string) {",
					"  const valid = await verify(token);",
					'  if (!valid) throw new Error("invalid token");',
					'  return { user, role: "admin" };',
					"}",
				].join("\n"));
				const c = new Container();
				const args = {
					path: sampleFile,
					edits: [{ oldText: "  const valid = await verify(token);", newText: '  const valid = await verify(token, "HS256");' }],
				};
				const comp = createToolPreviewSync("edit", args);
				if (comp) c.addChild(comp);
				c.addChild(new Markdown(
					"**Inline diff** with colored changes.\n" +
					"Uses `toolSuccessBg` on success, `toolDiffAdded` for **+** lines, " +
					"`toolDiffRemoved` for **-** lines, `toolDiffContext` for unchanged.",
					1, 1, getMarkdownTheme(),
				));
				return { container: c, executions: comp ? [{ comp, name: "edit", args }] : [] };
			},
		},
		// Page 4: Bash tool
		{
			title: "Bash",
			build: (theme) => {
				const c = new Container();
				const args = { command: "echo 'Tests passed: 3/3'" };
				const comp = createToolPreviewSync("bash", args);
				if (comp) c.addChild(comp);
				c.addChild(new Markdown(
					"**Command** output with exit status.\n" +
					"Uses `toolSuccessBg` on exit 0, `toolErrorBg` on failure.\n" +
					"Output in `toolOutput`, timing in `muted`.",
					1, 1, getMarkdownTheme(),
				));
				return { container: c, executions: comp ? [{ comp, name: "bash", args }] : [] };
			},
		},
	];
}

class ThemePreview implements Component {
	private pages: PreviewPage[] = [];
	private pageIdx = 0;
	private pageContainer = new Container();
	private maxHeight = 0;
	_pendingExecutions: { comp: any; name: string; args: Record<string, unknown> }[] = [];

	// biome-ignore lint: Theme proxy has typed keys but we use string-based lookups
	rebuild(t: () => any): void {
		const theme = t();
		this.setBorderFn(
			(s: string) => theme.fg("borderMuted", s),
			(s: string) => theme.fg("accent", s),
		);
		if (this.pages.length === 0) {
			this.pages = getPreviewPages();
			// Compute fixed height from all pages so the overlay doesn't jump.
			for (const p of this.pages) {
				const { container } = p.build(theme);
				const h = container.render(60).length;
				if (h > this.maxHeight) this.maxHeight = h;
			}
		}
		const page = this.pages[this.pageIdx];
		if (!page) return;
		const { container, executions } = page.build(theme);
		this.pageContainer = container;
		this._pendingExecutions = executions;
	}

	nextPage(): void { this.pageIdx = (this.pageIdx + 1) % this.pages.length; }
	prevPage(): void { this.pageIdx = (this.pageIdx - 1 + this.pages.length) % this.pages.length; }
	getPageLabel(): string {
		const p = this.pages[this.pageIdx];
		return p ? `${p.title} (${this.pageIdx + 1}/${this.pages.length})` : "";
	}

	invalidate(): void { this.pageContainer.invalidate(); }

	render(width: number): string[] {
		const inner = Math.max(1, width - 2);
		const content = this.pageContainer.render(inner);

		// Fixed height: pad to maxHeight so overlay doesn't jump between pages.
		const padded = [...content];
		while (padded.length < this.maxHeight) padded.push("");

		const b = (s: string) => this.borderFn?.(s) ?? s;
		const label = this.getPageLabel();
		const title = this.titleFn?.(` ${label} `) ?? ` ${label} `;
		const titleW = title.replace(/\x1b\[[^m]*m/g, "").length;
		const topFill = Math.max(0, inner - titleW);
		const top = b("\u256D") + title + b("\u2500".repeat(topFill)) + b("\u256E");
		const hint = this.hintFn?.(" n next \u00B7 N prev \u00B7 p hide ") ?? " n next \u00B7 N prev \u00B7 p hide ";
		const hintW = hint.replace(/\x1b\[[^m]*m/g, "").length;
		const botFill = Math.max(0, inner - hintW);
		const bot = b("\u2570") + hint + b("\u2500".repeat(botFill)) + b("\u256F");
		const wrap = (line: string): string => {
			const vis = line.replace(/\x1b\[[^m]*m/g, "").length;
			const pad = Math.max(0, inner - vis);
			return b("\u2502") + line + " ".repeat(pad) + b("\u2502");
		};
		return [top, ...padded.map(wrap), bot];
	}

	private borderFn?: (s: string) => string;
	private titleFn?: (s: string) => string;
	private hintFn?: (s: string) => string;
	setBorderFn(border: (s: string) => string, title: (s: string) => string): void {
		this.borderFn = border;
		this.titleFn = title;
		this.hintFn = (s: string) => border(s); // hints use border color
	}
}

export default function (pi: ExtensionAPI) {
	// --- Session lifecycle ---
	pi.on("session_start", async (_event, ctx) => {
		loadSettings(ctx.cwd);
		cachedThemeNames = getAvailableCmuxThemes().map((e) => e.name);
		await captureRunner(pi);

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
					{ id: "autoSync", label: "Auto-sync on session start", currentValue: settings.autoSync ? "on" : "off", values: ["on", "off"], description: "Sync Pi theme with cmux theme when a session starts" },
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
				container.addChild(new Text(t().fg("dim", " \u2190\u2192 adjust \u00B7 tab scope \u00B7 d clear \u00B7 r reset \u00B7 p preview \u00B7 n/N page"), 1, 0));

				// Theme preview overlay — non-capturing, anchored right.
				const preview = new ThemePreview();
				const updatePreview = (): void => {
					preview.rebuild(t);
					// Fire async tool executions — results update components in place.
					for (const { comp, name, args } of preview._pendingExecutions) {
						executeToolPreview(comp, name, args, ctx).then(() => tui.requestRender());
					}
					preview._pendingExecutions = [];
				};
				updatePreview();
				const previewHandle = (tui as any).showOverlay(preview, {
					nonCapturing: true,
					anchor: "right-center",
					width: "55%",
					minWidth: 44,
					margin: { right: 1, top: 0, bottom: 0 },
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
						} else if (data === "n" || data === "N") {
							if (!previewHandle.isHidden()) {
								if (data === "n") preview.nextPage(); else preview.prevPage();
								updatePreview();
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
