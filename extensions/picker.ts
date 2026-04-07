/**
 * TUI inline picker — live cmux theme picker with debounced preview.
 *
 * Design:
 * - Renders inline at the bottom (no overlay) for a cleaner look.
 * - True debounce (DEBOUNCE_MS): resets timer on every keypress. setTheme and
 *   cmux only fire once the user pauses — no updates while scrolling fast.
 * - Background prewrite (setImmediate): JSON file is written in the next I/O
 *   tick. By the time the debounce settles the file is already on disk.
 * - Apply is pure I/O-free: setTheme and cmux execute back-to-back with no
 *   file write in between — minimum gap between pi and cmux transitions.
 */

import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, Key, SelectList, Text, type SelectItem, matchesKey } from "@mariozechner/pi-tui";
import { getCurrentCmuxThemeName, getAvailableCmuxThemes, runCmuxThemeSet } from "./cmux.js";
import {
	ensureThemesDir,
	removePreviewThemeFiles,
	writeAndSetPiTheme,
	writePreviewFile,
	previewNameFor,
} from "./pi-theme.js";
import { getThemeParams } from "./settings.js";
import type { CmuxThemeEntry, FilterMode, CommandContext } from "./types.js";

const DEBOUNCE_MS = 80;

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

	// --- Debounce + prewrite state ---
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let pendingThemeName: string | null = null;
	let lastPreviewName: string | null = null;
	let closed = false;
	const prewritten = new Set<string>();

	const clearDebounce = (): void => {
		if (debounceTimer) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
		}
		pendingThemeName = null;
	};

	const prewriteTheme = (themeName: string): void => {
		if (closed || prewritten.has(themeName)) return;
		const entry = entryByName.get(themeName);
		if (!entry) return;
		setImmediate(() => {
			if (closed || prewritten.has(themeName)) return;
			try {
				ensureThemesDir();
				writePreviewFile(entry.colors, themeName, getThemeParams());
				prewritten.add(themeName);
			} catch {
				// Best-effort — applyPreview will fallback to sync write
			}
		});
	};

	const applyPreview = (themeName: string): void => {
		if (closed || themeName === lastPreviewName) return;
		const entry = entryByName.get(themeName);
		if (!entry) return;
		lastPreviewName = themeName;
		if (!prewritten.has(themeName)) {
			ensureThemesDir();
			writePreviewFile(entry.colors, themeName, getThemeParams());
			prewritten.add(themeName);
		}
		ctx.ui.setTheme(previewNameFor(themeName));
		runCmuxThemeSet(themeName);
	};

	const schedulePreview = (themeName: string): void => {
		if (closed) return;
		pendingThemeName = themeName;
		prewriteTheme(themeName);
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			const name = pendingThemeName;
			pendingThemeName = null;
			if (name) applyPreview(name);
		}, DEBOUNCE_MS);
	};

	// --- Close handlers ---
	const closeWithConfirm = (themeName: string, done: (value: string | null) => void): void => {
		if (closed) return;
		closed = true;
		clearDebounce();
		removePreviewThemeFiles();

		const entry = entryByName.get(themeName);
		if (!entry) {
			ctx.ui.notify(`Theme not found: ${themeName}`, "error");
			done(null);
			return;
		}

		writeAndSetPiTheme(ctx, entry.colors, themeName, getThemeParams());
		runCmuxThemeSet(themeName);
		done(themeName);
	};

	const closeWithCancel = (done: (value: string | null) => void): void => {
		if (closed) return;
		closed = true;
		clearDebounce();
		removePreviewThemeFiles();

		if (originalPiTheme) ctx.ui.setTheme(originalPiTheme);
		if (originalCmuxTheme) runCmuxThemeSet(originalCmuxTheme);
		done(null);
	};

	// --- Inline component (no overlay) ---
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
				schedulePreview(item.value);
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
		if (selectedTheme) schedulePreview(selectedTheme);

		return {
			render: (width: number) => container.render(width),
			invalidate: () => {
				container.invalidate();
				rebuild();
			},
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
