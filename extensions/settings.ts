/**
 * Extension settings — persisted as JSON on disk.
 *
 * Config files (project overrides global):
 *   ~/.pi/agent/extensions/pi-cmux-theme-picker.json  (global)
 *   <cwd>/.pi/extensions/pi-cmux-theme-picker.json    (project)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { DEFAULT_THEME_PARAMS, type ThemeParams } from "./types.js";

const CONFIG_FILENAME = "pi-cmux-theme-picker.json";

export interface Settings {
	autoSync: boolean;
	themeParams: ThemeParams;
	previewDebounceMs: number;
}

const DEFAULTS: Settings = {
	autoSync: false,
	themeParams: { ...DEFAULT_THEME_PARAMS },
	previewDebounceMs: 200,
};

let current: Settings = { ...DEFAULTS, themeParams: { ...DEFAULTS.themeParams } };

// --- Paths ---

function globalConfigPath(): string {
	return join(getAgentDir(), "extensions", CONFIG_FILENAME);
}

function projectConfigPath(cwd: string): string {
	return join(cwd, ".pi", "extensions", CONFIG_FILENAME);
}

// --- Read / write ---

function readConfigFile(path: string): Partial<Settings> {
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as Partial<Settings>;
	} catch {
		return {};
	}
}

function writeConfigFile(path: string, data: Settings): void {
	const dir = dirname(path);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

// --- Public API ---

export function getSettings(): Settings {
	return current;
}

export function getThemeParams(): ThemeParams {
	return current.themeParams;
}

export function getPreviewDebounceMs(): number {
	return current.previewDebounceMs;
}

/** Load settings from disk (global, then project override). */
export function loadSettings(cwd: string): void {
	const globalConfig = readConfigFile(globalConfigPath());
	const projectConfig = readConfigFile(projectConfigPath(cwd));
	const merged = { ...globalConfig, ...projectConfig };
	current = {
		...DEFAULTS,
		...merged,
		themeParams: { ...DEFAULT_THEME_PARAMS, ...(merged.themeParams ?? {}) },
	};
}

/** Update in-memory settings and persist to global config. */
export function updateSettings(patch: Partial<Settings>): void {
	if (patch.themeParams) {
		current = { ...current, ...patch, themeParams: { ...current.themeParams, ...patch.themeParams } };
	} else {
		current = { ...current, ...patch };
	}
	writeConfigFile(globalConfigPath(), current);
}

/** Update a single theme param in memory only — call persistSettings() when done. */
export function updateThemeParamInMemory<K extends keyof ThemeParams>(key: K, value: ThemeParams[K]): void {
	current.themeParams[key] = value;
}

/** Persist current in-memory settings to global config. */
export function persistSettings(): void {
	writeConfigFile(globalConfigPath(), current);
}
