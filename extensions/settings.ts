/**
 * Extension settings — persisted via pi.appendEntry(), restored on session_start.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DEFAULT_THEME_PARAMS, type ThemeParams, type SessionContext } from "./types.js";

export interface Settings {
	autoSync: boolean;
	themeParams: ThemeParams;
}

const ENTRY_TYPE = "cmux-theme-picker-settings";
const DEFAULTS: Settings = { autoSync: false, themeParams: { ...DEFAULT_THEME_PARAMS } };

let current: Settings = { ...DEFAULTS, themeParams: { ...DEFAULTS.themeParams } };

export function getSettings(): Settings {
	return current;
}

export function getThemeParams(): ThemeParams {
	return current.themeParams;
}

export function updateSettings(pi: ExtensionAPI, patch: Partial<Settings>): void {
	if (patch.themeParams) {
		current = { ...current, ...patch, themeParams: { ...current.themeParams, ...patch.themeParams } };
	} else {
		current = { ...current, ...patch };
	}
	pi.appendEntry(ENTRY_TYPE, { ...current, themeParams: { ...current.themeParams } });
}

/** Update in memory only — caller must call persistSettings() when done adjusting. */
export function updateThemeParamInMemory<K extends keyof ThemeParams>(key: K, value: ThemeParams[K]): void {
	current.themeParams[key] = value;
}

/** Persist current settings to session storage. Debounce this — don't call on every keypress. */
export function persistSettings(pi: ExtensionAPI): void {
	pi.appendEntry(ENTRY_TYPE, { ...current, themeParams: { ...current.themeParams } });
}

export function restoreSettings(ctx: SessionContext): void {
	const entries = ctx.sessionManager.getEntries();
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i]!;
		if (e.type === "custom" && e.customType === ENTRY_TYPE && e.data) {
			const d = e.data as Partial<Settings>;
			current = {
				...DEFAULTS,
				...d,
				themeParams: { ...DEFAULT_THEME_PARAMS, ...(d.themeParams ?? {}) },
			};
			return;
		}
	}
	current = { ...DEFAULTS, themeParams: { ...DEFAULTS.themeParams } };
}
