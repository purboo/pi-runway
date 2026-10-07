// Render real footer lines (src/render.ts) for a set of states → design/preview.html.
// Colors approximate pi's built-in dark theme. Run: bun design/preview.ts && python3 design/png.py
import { writeFileSync } from "node:fs";
import { layout, type Seg, type View } from "../src/render.ts";

const COLORS: Record<string, string> = {
	text: "#dcdde3",
	muted: "#9c9fb3",
	dim: "#7e8197",
	faint: "#43465a",
	warning: "#e2c35a",
	error: "#ec8a76",
};
const BORDER = "#489287";

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
	["running", { phase: "running", elapsedMs: 83_000, ctxPercent: 41, cost: 0.46, delta: 0.04, dirty: true }],
	["with statuses", { ctxPercent: 41, cost: 0.46, dirty: true, statuses: ["mcp 3", "lsp ok"] }],
	["tight", { ctxPercent: 78, turnsLeft: 4, cost: 1.2, dirty: true }],
	["danger", { ctxPercent: 93, turnsLeft: 1, cost: 1.38, dirty: true }],
	["compacting", { phase: "compacting", ctxPercent: 93, cost: 1.38 }],
	["virtual model", { model: "auto", routed: "Opus 4.6", thinking: "high", ctxPercent: 22, cost: 0.31 }],
	["subscription", { sub: true, ctxPercent: 22 }],
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const span = (s: Seg) => `<span style="color:${COLORS[s.tone ?? "muted"]}">${esc(s.text)}</span>`;
const measure = (s: string) => [...s].length;

const term = (width: number, rows: [string, Partial<View>][]) =>
	`<div class="term"><pre style="color:${BORDER}">${"─".repeat(width)}</pre>` +
	rows.map(([name, o]) => `<div class="tag">${name}</div><pre>${layout({ ...base, ...o }, width, measure).map(span).join("")}</pre>`).join("") +
	"</div>";

const widths = [120, 90, 64, 48, 32].map((w) => [`${w} cols`, w] as const);
const html = `<html><head><meta charset="utf-8"><style>
body{background:#0e0f13;color:#ccc;font:14px sans-serif;padding:16px;margin:0;width:max-content}
h2{font-size:14px;color:#c39be6;margin:18px 0 6px;font-weight:600}
.term{background:#1b1c22;padding:10px 0 12px;border-radius:8px}
pre{margin:0;font:14px/1.5 'JetBrains Mono','DejaVu Sans Mono',monospace;white-space:pre}
.tag{font:11px sans-serif;color:#50546a;margin:8px 0 1px 9px}
</style></head><body>
<h2>States · 120 cols</h2>${term(120, states)}
<h2>Widths · running</h2><div class="term">${widths
	.map(([n, w]) => `<div class="tag">${n}</div><pre>${layout({ ...base, ...states[1][1], statuses: ["mcp 3"] }, w, measure).map(span).join("")}</pre>`)
	.join("")}</div>
</body></html>`;
writeFileSync(new URL("./preview.html", import.meta.url), html);
console.log("design/preview.html");
