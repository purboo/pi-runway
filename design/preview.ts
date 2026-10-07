// Render real footer lines (src/render.ts + src/skin.ts) with pi's built-in dark theme → design/preview.html.
// Run: bun design/preview.ts && python3 design/png.py
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { layout, type Seg, type View } from "../src/render.ts";
import { tokenFor } from "../src/skin.ts";

// Needs `bun run link-pi` first.
const piDir = new URL("../node_modules/@earendil-works/pi-coding-agent/dist", import.meta.url).pathname;
const themeDir = join(piDir, "modes/interactive/theme");
const { loadThemeFromPath } = await import(join(themeDir, "theme.js"));
const theme = loadThemeFromPath(join(themeDir, "dark.json"), "truecolor");

const hex = (token: string) => {
	const m = /38;2;(\d+);(\d+);(\d+)/.exec(theme.fg(token, "x"));
	return m ? `rgb(${m[1]},${m[2]},${m[3]})` : "#dcdde3";
};

const base: View = {
	path: "pi-things/pi-footer",
	base: "pi-footer",
	branch: "main",
	dirty: false,
	statuses: [],
	model: "Sonnet 4.5",
	thinking: "medium",
	ctxPercent: 12,
	cost: 0.08,
	delta: 0,
	sub: false,
	phase: "idle",
	elapsedMs: 0,
};
const states: [string, Partial<View>][] = [
	["idle", {}],
	["running", { phase: "running", elapsedMs: 83_000, ctxPercent: 41, cost: 0.46, delta: 0.04, dirty: true, statuses: ["mcp 3"], thinking: "high" }],
	["tight", { ctxPercent: 78, turnsLeft: 4, cost: 1.2, dirty: true, thinking: "low" }],
	["danger", { ctxPercent: 93, turnsLeft: 1, cost: 1.38, dirty: true, thinking: "xhigh" }],
	["compacting", { phase: "compacting", ctxPercent: 93, cost: 1.38 }],
	["virtual model", { model: "auto", routed: "Opus 4.6", thinking: "max", ctxPercent: 22, cost: 0.31 }],
	["subscription", { sub: true, ctxPercent: 22, thinking: "minimal" }],
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const span = (s: Seg) => `<span style="color:${hex(tokenFor(s) ?? "text")}">${esc(s.text)}</span>`;
const measure = (s: string) => [...s].length;
const line = (o: Partial<View>, w: number) => `<pre>${layout({ ...base, ...o }, w, measure).map(span).join("")}</pre>`;

const html = `<html><head><meta charset="utf-8"><style>
body{background:#0e0f13;color:#ccc;font:14px sans-serif;padding:16px;margin:0;width:max-content}
h2{font-size:14px;color:${hex("accent")};margin:18px 0 6px;font-weight:600}
.term{background:#1b1c22;padding:10px 0 12px;border-radius:8px}
pre{margin:0;font:14px/1.5 'JetBrains Mono','DejaVu Sans Mono',monospace;white-space:pre}
.tag{font:11px sans-serif;color:#50546a;margin:8px 0 1px 9px}
</style></head><body>
<h2>States · 120 cols</h2><div class="term"><pre style="color:${hex("border")}">${"─".repeat(120)}</pre>
${states.map(([n, o]) => `<div class="tag">${n}</div>${line(o, 120)}`).join("")}</div>
<h2>Widths · running</h2><div class="term">
${[120, 90, 64, 48, 32].map((w) => `<div class="tag">${w} cols</div>${line(states[1][1], w)}`).join("")}</div>
</body></html>`;
writeFileSync(new URL("./preview.html", import.meta.url), html);
console.log("design/preview.html");
