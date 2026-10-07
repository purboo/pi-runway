// Draw the real frame (src/frame.ts + src/paint.ts) with pi's built-in dark theme, as ANSI.
// Run: bun design/preview.ts > /tmp/preview.ans, show it in a tmux pane, then design/shot.py it.
// Needs `bun run link-pi` first.
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { bottom, top, type View } from "../src/frame.ts";
import { type Look, paint } from "../src/paint.ts";

const piDir = new URL("../node_modules/@earendil-works/pi-coding-agent/dist", import.meta.url).pathname;
const themeDir = join(piDir, "modes/interactive/theme");
const { loadThemeFromPath } = await import(join(themeDir, "theme.js"));
const theme = loadThemeFromPath(join(themeDir, "dark.json"), "truecolor");

const W = Number(process.argv[2] ?? 100);
const base: View = {
	path: "pi-footer",
	repo: "pi-footer",
	branch: "feat/runway",
	dirty: true,
	statuses: [],
	model: "Sonnet 4.5",
	state: "idle",
	pct: 41,
	cost: 1.2,
};

const frames: [string, View, Partial<Look>][] = [
	["idle", base, {}],
	["running", { ...base, state: "run", hint: "esc to interrupt" }, { glow: (c) => {
		const d = 62 - c;
		return d >= 0 && d < 22 ? (1 - d / 22) ** 1.4 * 0.85 : 0;
	} }],
	["needs you", { ...base, state: "you", pct: 78, next: 6, turns: 4 }, { border: "warning" }],
	["failed", { ...base, state: "err", pct: 93, next: 5, turns: 1, cost: 1.38 }, { border: "error" }],
];

const side = (b: string) => theme.fg(b, "│");
for (const [, v, extra] of frames) {
	const look: Look = { border: "thinkingHigh", diamond: "thinkingHigh", ...extra };
	console.log(paint(theme, top(v, W, visibleWidth), look));
	console.log(`${side(look.border)} ${"\x1b[7m \x1b[27m"}${" ".repeat(W - 5)} ${side(look.border)}`);
	console.log(paint(theme, bottom(v, W, visibleWidth), { ...look, glow: undefined }));
	console.log("");
}
