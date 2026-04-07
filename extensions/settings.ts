/**
 * Extension settings — persisted via pi.appendEntry(), restored on session_start.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { SessionContext } from "./types.js";

export interface Settings {
	autoSync: boolean;
}

const ENTRY_TYPE = "cmux-theme-picker-settings";
const DEFAULTS: Settings = { autoSync: false };

let current: Settings = { ...DEFAULTS };

export function getSettings(): Settings {
	return current;
}

export function updateSettings(pi: ExtensionAPI, patch: Partial<Settings>): void {
	current = { ...current, ...patch };
	pi.appendEntry(ENTRY_TYPE, { ...current });
}

export function restoreSettings(ctx: SessionContext): void {
	const entries = ctx.sessionManager.getEntries();
	// Walk backwards — last entry wins
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i]!;
		if (e.type === "custom" && e.customType === ENTRY_TYPE && e.data) {
			current = { ...DEFAULTS, ...(e.data as Partial<Settings>) };
			return;
		}
	}
	current = { ...DEFAULTS };
}
