/**
 * Segments → ANSI with the user's theme. Only tokens every pi theme defines.
 */
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { type Color, mixColors } from "@earendil-works/pi-tui";
import type { Seg } from "./frame.ts";

/** Runway colors by position: cool while there is room, hot near the end. */
const STOPS: [number, ThemeColor][] = [
	[0, "mdLink"],
	[0.45, "success"],
	[0.72, "warning"],
	[0.9, "error"],
	[1, "error"],
];

export interface Look {
	/** Border color: pi's thinking/bash color, or warning/error while a run state asks for attention. */
	border: ThemeColor;
	/** Color of the ◆ and the thinking label. */
	diamond: ThemeColor;
	/** Extra brightness 0–1 for border characters at a column (the running light). */
	glow?: (col: number) => number;
	/** Runway cells fade and a light sweeps them (compaction). */
	sweep?: (col: number) => number;
}

export function heatColor(theme: Theme, x: number): Color {
	const c = theme.colors;
	for (let i = 1; i < STOPS.length; i++) {
		const [a, ta] = STOPS[i - 1];
		const [b, tb] = STOPS[i];
		if (x <= b) return mixColors(c[ta], c[tb], b > a ? (x - a) / (b - a) : 0, "oklch");
	}
	return c.error;
}

export function paint(theme: Theme, segs: readonly Seg[], look: Look): string {
	const c = theme.colors;
	const border = c[look.border];
	let out = "";
	let col = 0;
	for (const g of segs) {
		if (g.heat !== undefined) {
			let color = heatColor(theme, g.heat);
			if (g.ghost) color = mixColors(color, border, 0.55, "oklch");
			if (look.sweep) {
				const k = look.sweep(col);
				color = mixColors(mixColors(color, border, 0.55, "oklch"), c.text, k * 0.7, "oklch");
			}
			out += theme.style(g.text, { fg: color });
		} else if (g.tone === "border") {
			if (look.glow) {
				for (const ch of g.text) {
					const k = ch === " " ? 0 : look.glow(col);
					out += k > 0.01 ? theme.style(ch, { fg: mixColors(border, c.text, k, "oklch") }) : theme.fg(look.border, ch);
					col += 1;
				}
				continue;
			}
			out += theme.fg(look.border, g.text);
		} else {
			const tone = g.tone === "diamond" ? look.diamond : g.tone;
			out += theme.style(g.text, { fg: tone, bold: g.bold });
		}
		col += [...g.text].length;
	}
	return out;
}
