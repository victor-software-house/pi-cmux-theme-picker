/**
 * TUI inline picker — live cmux theme picker.
 *
 * Architecture:
 * - UI is a normal SelectList. Handles input, renders immediately.
 * - Preview is a fire-and-forget side effect via setImmediate.
 *   buildThemeInstance is pure in-memory (~1ms, zero disk I/O).
 *   setImmediate batches rapid input to the next tick — no debounce needed.
 * - Disk write happens only on confirm (writeAndSetPiTheme).
 */

import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, Key, SelectList, Text, type SelectItem, matchesKey } from "@mariozechner/pi-tui";
import { getCurrentCmuxThemeName, getAvailableCmuxThemes, runCmuxThemeSet } from "./cmux.js";
import { writeAndSetPiTheme, buildThemeInstance } from "./pi-theme.js";
import { getThemeParams } from "./settings.js";
import type { CmuxThemeEntry, FilterMode, CommandContext } from "./types.js";

function isPrintableInput(data: string): boolean {
	return data.length === 1 && data >= " " && data !== "\x7f";
}

function nextFilterMode(mode: FilterMode): FilterMode {
	if (mode === "all") return "dark";
	if (mode === "dark") return "light";
	return "all";
}

export async function showThemePicker(ctx: CommandContext): Promise<string | null> {
	const entries = getAvailableCmuxThemes();
	if (entries.length === 0) {
		ctx.ui.notify("No cmux themes found", "warning");
		return null;
	}

	const entryByName = new Map(entries.map((e) => [e.name, e]));
	const originalPiTheme = ctx.ui.theme.name;
	const originalCmuxTheme = getCurrentCmuxThemeName();

	let filterMode: FilterMode = "all";
	let searchText = "";
	let selectedTheme = originalCmuxTheme && entryByName.has(originalCmuxTheme)
		? originalCmuxTheme
		: entries[0]!.name;
	let closed = false;

	// --- Fire-and-forget preview ---
	// Pi TUI renders at 16ms intervals (MIN_RENDER_INTERVAL_MS).
	// Schedule preview AFTER the next render completes so intermediate
	// cursor positions are visible before the theme changes.
	let pendingPreview: ReturnType<typeof setTimeout> | null = null;
	let lastAppliedTheme: string | null = null;

	const firePreview = (themeName: string): void => {
		if (pendingPreview) clearTimeout(pendingPreview);
		pendingPreview = setTimeout(() => {
			pendingPreview = null;
			if (closed || themeName === lastAppliedTheme) return;
			const entry = entryByName.get(themeName);
			if (!entry) return;
			lastAppliedTheme = themeName;
			const instance = buildThemeInstance(entry.colors, `cmux-preview-${themeName}`, getThemeParams(), ctx);
			ctx.ui.setTheme(instance);
			runCmuxThemeSet(themeName);
		}, 20);
	};

	const cancelPreview = (): void => {
		if (pendingPreview) { clearTimeout(pendingPreview); pendingPreview = null; }
	};

	// --- Confirm / cancel ---
	const closeWithConfirm = (themeName: string, done: (value: string | null) => void): void => {
		if (closed) return;
		closed = true;
		cancelPreview();
		const entry = entryByName.get(themeName);
		if (!entry) { ctx.ui.notify(`Theme not found: ${themeName}`, "error"); done(null); return; }
		// Single disk write — only place a file is ever written
		writeAndSetPiTheme(ctx, entry.colors, themeName, getThemeParams());
		runCmuxThemeSet(themeName);
		done(themeName);
	};

	const closeWithCancel = (done: (value: string | null) => void): void => {
		if (closed) return;
		closed = true;
		cancelPreview();
		if (originalPiTheme) ctx.ui.setTheme(originalPiTheme);
		if (originalCmuxTheme) runCmuxThemeSet(originalCmuxTheme);
		done(null);
	};

	// --- Normal inline component ---
	const selected = await ctx.ui.custom<string | null>((tui, _factoryTheme, _keybindings, done) => {
		const t = () => ctx.ui.theme;
		const container = new Container();
		let selectList: SelectList | null = null;

		const getVisibleEntries = (): CmuxThemeEntry[] => {
			const byMode = entries.filter((entry) => {
				if (filterMode === "all") return true;
				if (filterMode === "dark") return entry.isDark;
				return !entry.isDark;
			});
			if (!searchText) return byMode;
			const needle = searchText.toLowerCase();
			return byMode.filter((entry) => entry.name.toLowerCase().includes(needle));
		};

		const buildSelectItems = (visibleEntries: CmuxThemeEntry[]): SelectItem[] => {
			return visibleEntries.map((entry) => {
				const tags: string[] = [];
				if (entry.name === originalCmuxTheme) tags.push("current");
				tags.push(entry.isDark ? "dark" : "light");
				return {
					value: entry.name,
					label: entry.name,
					description: tags.join(" \u00B7 "),
				};
			});
		};

		const rebuild = (): void => {
			const theme = t();
			const visibleEntries = getVisibleEntries();
			const items = buildSelectItems(visibleEntries);

			if (items.length > 0 && !items.some((item) => item.value === selectedTheme)) {
				selectedTheme = items[0]!.value;
			}

			container.clear();
			container.addChild(new DynamicBorder((s: string) => t().fg("accent", s)));
			container.addChild(new Text(
				theme.fg("accent", theme.bold(" cmux Theme Picker")) +
				"  " +
				theme.fg("dim", `${filterMode} \u00B7 ${searchText || "\u2014"}`),
			));

			selectList = new SelectList(items, 14, {
				selectedPrefix: (text) => t().fg("accent", text),
				selectedText: (text) => t().fg("accent", text),
				description: (text) => t().fg("muted", text),
				scrollInfo: (text) => t().fg("dim", text),
				noMatch: (text) => t().fg("warning", text),
			});

			const selectedIndex = items.findIndex((item) => item.value === selectedTheme);
			if (selectedIndex >= 0) selectList.setSelectedIndex(selectedIndex);

			selectList.onSelectionChange = (item) => {
				selectedTheme = item.value;
				firePreview(item.value);
			};
			selectList.onSelect = (item) => closeWithConfirm(item.value, done);
			selectList.onCancel = () => closeWithCancel(done);

			container.addChild(selectList);
			container.addChild(new Text(
				theme.fg("dim", " type to search \u00B7 backspace delete \u00B7 tab all/dark/light \u00B7 \u2191\u2193 navigate \u00B7 enter apply \u00B7 esc cancel"),
			));
			container.addChild(new DynamicBorder((s: string) => t().fg("accent", s)));
		};

		rebuild();
		if (selectedTheme) firePreview(selectedTheme);

		return {
			render: (width: number) => container.render(width),
			// Theme change: just invalidate — SelectList callbacks use t() (live).
			// rebuild() is only for filter/search changes triggered from handleInput.
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, Key.tab)) {
					filterMode = nextFilterMode(filterMode);
					rebuild();
					tui.requestRender();
					return;
				}
				if (matchesKey(data, Key.backspace)) {
					if (searchText.length > 0) {
						searchText = searchText.slice(0, -1);
						rebuild();
						tui.requestRender();
					}
					return;
				}
				if (isPrintableInput(data)) {
					searchText += data;
					rebuild();
					tui.requestRender();
					return;
				}
				selectList?.handleInput(data);
				tui.requestRender();
			},
		};
	});

	return selected ?? null;
}
