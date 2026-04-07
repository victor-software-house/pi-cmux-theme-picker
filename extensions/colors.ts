/**
 * Color math utilities for theme generation.
 *
 * Pure functions — no side effects, no I/O.
 */

export function normalizeColor(color: string): string {
	const trimmed = color.trim();
	if (trimmed.startsWith("#")) {
		if (trimmed.length === 4) {
			return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
		}
		return trimmed;
	}
	if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed}`;
	return `#${trimmed}`;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const h = hex.replace("#", "");
	return {
		r: parseInt(h.substring(0, 2), 16),
		g: parseInt(h.substring(2, 4), 16),
		b: parseInt(h.substring(4, 6), 16),
	};
}

export function rgbToHex(r: number, g: number, b: number): string {
	const clamp = (n: number) => Math.round(Math.min(255, Math.max(0, n)));
	return `#${clamp(r).toString(16).padStart(2, "0")}${clamp(g).toString(16).padStart(2, "0")}${clamp(b).toString(16).padStart(2, "0")}`;
}

export function getLuminance(hex: string): number {
	const { r, g, b } = hexToRgb(hex);
	return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function adjustBrightness(hex: string, amount: number): string {
	const { r, g, b } = hexToRgb(hex);
	return rgbToHex(r + amount, g + amount, b + amount);
}

export function mixColors(color1: string, color2: string, weight: number): string {
	const c1 = hexToRgb(color1);
	const c2 = hexToRgb(color2);
	return rgbToHex(
		c1.r * weight + c2.r * (1 - weight),
		c1.g * weight + c2.g * (1 - weight),
		c1.b * weight + c2.b * (1 - weight),
	);
}

export function rgbToHsl(hex: string): { h: number; s: number; l: number } {
	const { r, g, b } = hexToRgb(hex);
	const rn = r / 255;
	const gn = g / 255;
	const bn = b / 255;
	const max = Math.max(rn, gn, bn);
	const min = Math.min(rn, gn, bn);
	const l = (max + min) / 2;
	if (max === min) return { h: 0, s: 0, l };
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h = 0;
	if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
	else if (max === gn) h = (bn - rn) / d + 2;
	else h = (rn - gn) / d + 4;
	h *= 60;
	return { h, s, l };
}

export function hueDistance(a: number, b: number): number {
	const d = Math.abs(a - b) % 360;
	return d > 180 ? 360 - d : d;
}

export function ensureSemanticHue(color: string | undefined, targetHue: number, fallback: string): string {
	if (!color) return fallback;
	const { h, s } = rgbToHsl(color);
	if (s >= 0.2 && hueDistance(h, targetHue) <= 65) return color;
	return mixColors(color, fallback, 0.5);
}

export function contrastRatio(a: string, b: string): number {
	const l1 = getLuminance(a);
	const l2 = getLuminance(b);
	const lighter = Math.max(l1, l2);
	const darker = Math.min(l1, l2);
	return (lighter + 0.05) / (darker + 0.05);
}

export function pickReadableLink(candidate: string, bg: string, fallback: string, fg: string, minContrast = 3): string {
	if (contrastRatio(candidate, bg) >= minContrast) return candidate;
	if (contrastRatio(fallback, bg) >= minContrast) return fallback;
	return fg;
}
