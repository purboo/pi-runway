import { expect, test } from "bun:test";
import { alertOf, bottom, runway, type Seg, shortModel, top, type View } from "../src/frame.ts";

const m = (t: string) => [...t].length;
const text = (segs: Seg[]) => segs.map((g) => g.text).join("");
const width = (segs: Seg[]) => m(text(segs));

const base: View = {
	path: "pi-footer/src",
	repo: "pi-footer",
	dirty: false,
	statuses: [],
	model: "Sonnet 4.5",
	state: "idle",
	pct: 12,
};

test("idle at 100 cols: where on the left, model on the right, % and nothing else below", () => {
	expect(text(top(base, 100, m))).toBe(`╭─ pi-footer/src ${"─".repeat(67)} ◆ Sonnet 4.5 ─╮`);
	const b = text(bottom(base, 100, m));
	expect(b.startsWith("╰━━━━━━━━━━━─")).toBe(true);
	expect(b.endsWith("─ 12% ─╯")).toBe(true);
});

test("every border is exactly the width, in every state, at every width", () => {
	const views: View[] = [
		base,
		{ ...base, branch: "feat/runway", dirty: true, statuses: ["mcp 3"], provider: "s2a", thinking: "high" },
		{ ...base, state: "run", hint: "esc to interrupt", moreAbove: 3, moreBelow: 2 },
		{ ...base, state: "you" },
		{ ...base, state: "err", pct: 93, next: 5, turns: 1, cost: 1.38 },
		{ ...base, routed: true, model: "Opus 4.6", pct: null },
		{ ...base, pct: 78, next: 5.5, turns: 4, cost: 1.2 },
	];
	for (const v of views) {
		for (let w = 16; w <= 200; w++) {
			expect(width(top(v, w, m))).toBe(w);
			expect(width(bottom(v, w, m))).toBe(w);
		}
	}
});

test("degrades: statuses go first, the run-state mark never", () => {
	const v: View = { ...base, branch: "feat/runway", dirty: true, statuses: ["mcp 3"], state: "err" };
	expect(text(top(v, 100, m))).toContain("mcp 3");
	expect(text(top(v, 50, m))).not.toContain("mcp 3");
	expect(text(top(v, 50, m))).toContain("⎇ feat/runway*");
	expect(text(top(v, 34, m))).toContain("pi-footer*");
	expect(text(top(v, 34, m))).not.toContain("/src");
	for (let w = 16; w < 40; w++) expect(text(top(v, w, m))).toContain("✗");
});

test("running shows the interrupt hint while there is room", () => {
	const v: View = { ...base, state: "run", hint: "esc to interrupt" };
	expect(text(top(v, 100, m))).toContain("esc to interrupt ── ◆ Sonnet 4.5");
	expect(text(top(v, 40, m))).not.toContain("esc");
});

test("turns and the next-run ghost appear only from 70%", () => {
	const quiet = { ...base, pct: 50, next: 5, turns: 9 };
	expect(text(bottom(quiet, 100, m))).not.toContain("turn");
	expect(text(bottom(quiet, 100, m))).not.toContain("╍");
	const tight = { ...base, pct: 78, next: 5, turns: 4, cost: 1.2 };
	expect(text(bottom(tight, 100, m))).toContain("78%  ≈4 turns  $1.20 ─╯");
	expect(text(bottom(tight, 100, m))).toContain("╍");
	expect(text(bottom({ ...tight, turns: 1 }, 100, m))).toContain("≈1 turn ");
});

test("runway: unknown usage draws an empty track; any usage shows at least one cell", () => {
	expect(text(runway({ ...base, pct: null }, 10))).toBe("─".repeat(10));
	expect(text(runway({ ...base, pct: 0.2 }, 10))).toBe("━─────────");
	expect(text(runway({ ...base, pct: 100 }, 10))).toBe("━".repeat(10));
	const cells = runway({ ...base, pct: 50 }, 10).filter((g) => g.heat !== undefined);
	expect(cells.map((g) => g.heat)).toEqual([0.05, 0.15, 0.25, 0.35, 0.45]);
});

test("alert thresholds", () => {
	expect(alertOf(null)).toBeUndefined();
	expect(alertOf(69.9)).toBeUndefined();
	expect(alertOf(70)).toBe("warning");
	expect(alertOf(90)).toBe("error");
});

test("shortModel", () => {
	expect(shortModel("Claude Sonnet 4.5")).toBe("Sonnet 4.5");
	expect(shortModel("GPT-5")).toBe("GPT-5");
});
