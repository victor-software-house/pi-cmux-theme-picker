/**
 * Shared types for pi-cmux-theme-picker.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export interface CmuxColors {
	background: string;
	foreground: string;
	palette: Record<number, string>;
}

export interface CmuxThemeEntry {
	name: string;
	colors: CmuxColors;
	isDark: boolean;
}

export type FilterMode = "all" | "dark" | "light";

export type SessionContext = Parameters<Parameters<ExtensionAPI["on"]>[1]>[1];
export type CommandContext = Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1];
