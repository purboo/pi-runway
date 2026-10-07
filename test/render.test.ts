import { describe, expect, test } from "bun:test";
import { layout, type Seg, shortModel, type View } from "../src/render.ts";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const measure = (s: string) => [...strip(s)].length;
const text = (segs: Seg[]) => segs.map((s) => strip(s.text)).join("");
const squash = (segs: Seg[]) => text(segs).replace(/ +/g, " ").trim();
const tones = (segs: Seg[], needle: string) => segs.filter((s) => s.text.includes(needle)).map((s) => s.tone);

const base: View = {
	path: "pi-things/pi-footer",
	base: "pi-footer",
	branch: "main",
	dirty: true,
	statuses: ["mcp 3", "\x1b[32mlsp ok\x1b[39m"],
	model: "Opus 4.6",
	thinking: "high",
	ctxPercent: 38,
	cost: 0.42,
	delta: 0,
	sub: false,
	phase: "idle",
	elapsedMs: 0,
};
const v = (o: Partial<View> = {}): View => ({ ...base, ...o });
const at = (o: Partial<View>, w = 120) => squash(layout(v(o), w, measure));

describe("width", () => {
	for (const w of [160, 120, 100, 80, 64, 52, 40, 30, 22]) {
		test(`${w} cols fits exactly`, () => {
			for (const view of [v(), v({ phase: "running", elapsedMs: 83_000, delta: 0.04 }), v({ ctxPercent: 93, turnsLeft: 1 }), v({ phase: "compacting" })]) {
				expect([...text(layout(view, w, measure))].length).toBe(w);
			}
		});
	}

	test("one column of breathing room on both edges", () => {
		const out = text(layout(v(), 120, measure));
		expect(out.startsWith(" p")).toBe(true);
		expect(out.endsWith("2 ")).toBe(true);
	});

	test("degrades in order and never drops context or cost", () => {
		expect([140, 100, 80, 64, 52, 40, 22].map((w) => at({}, w))).toEqual([
			"pi-things/pi-footer main* · mcp 3 · lsp ok Opus 4.6 high · ━━━━━━━━━━ 38% · $0.42",
			"pi-things/pi-footer main* · mcp 3 · lsp ok Opus 4.6 high · ━━━━━━━━━━ 38% · $0.42",
			"pi-things/pi-footer main* · +2 Opus 4.6 high · ━━━━━━━━━━ 38% · $0.42",
			"pi-footer main* · +2 Opus 4.6 high · ━━━━━━ 38% · $0.42",
			"pi-footer main* Opus 4.6 · 38% · $0.42",
			"pi-footer Opus 4.6 · 38% · $0.42",
			"38% · $0.42",
		]);
		expect(at({ ctxPercent: 93, turnsLeft: 1 }, 22)).toBe("93% ≈1 turn · $0.42");
	});

	test("airy separators when there is room", () => {
		expect(text(layout(v(), 160, measure))).toContain("high  ·  ━");
	});
});

describe("states", () => {
	test("quiet when healthy: one bright anchor, no alarm colors", () => {
		const segs = layout(v({ dirty: false }), 120, measure);
		expect(segs.filter((s) => s.tone === "text").map((s) => s.text)).toEqual(["Opus 4.6"]);
		expect(segs.some((s) => s.tone === "warning" || s.tone === "error")).toBe(false);
	});

	test("warning at 70, error at 90, with runway", () => {
		const warn = layout(v({ ctxPercent: 78, turnsLeft: 4 }), 120, measure);
		expect(squash(warn)).toContain("78% ≈4 turns left");
		expect(tones(warn, "78%")).toEqual(["warning"]);
		const err = layout(v({ ctxPercent: 93, turnsLeft: 1 }), 120, measure);
		expect(squash(err)).toContain("93% ≈1 turn left");
		expect(tones(err, "93%")).toEqual(["error"]);
		expect(at({ ctxPercent: 99, turnsLeft: 0 })).toContain("99% <1 turn left");
	});

	test("runway hidden below 70%", () => {
		expect(at({ ctxPercent: 50, turnsLeft: 9 })).not.toContain("turn");
	});

	test("gauge: track is faint, any usage shows at least one cell", () => {
		const segs = layout(v({ ctxPercent: 2 }), 120, measure);
		expect(segs.filter((s) => s.text.includes("━")).map((s) => [s.text.length, s.tone])).toEqual([
			[1, "muted"],
			[9, "faint"],
		]);
	});

	test("gauge falls back to a thin track when the theme cannot draw faint", () => {
		const segs = layout(v({ ctxPercent: 30 }), 120, measure, { faintDistinct: false });
		expect(text(segs)).toContain("━━━───────");
	});

	test("cost below a cent is hidden", () => {
		expect(at({ cost: 0.003 })).toMatch(/38%$/);
	});

	test("running shows elapsed and the run's cost; idle shows total only", () => {
		expect(at({ phase: "running", elapsedMs: 83_000, delta: 0.04, cost: 0.46 })).toContain("1m23s · Opus 4.6 high · ━━━━━━━━━━ 38% · $0.46 +0.04");
		expect(at({ phase: "running", elapsedMs: 500 })).not.toMatch(/\ds /);
		expect(at({ delta: 0.04, cost: 0.46 })).toMatch(/\$0\.46$/);
	});

	test("compacting replaces numbers", () => {
		expect(at({ phase: "compacting", ctxPercent: 93 })).toMatch(/━+ compacting…$/);
	});

	test("unknown context after compaction", () => {
		expect(at({ ctxPercent: null })).toContain("high · ?% · $0.42");
	});

	test("routed, subscription, hidden extras", () => {
		expect(at({ model: "auto", routed: "Sonnet 4.5", thinking: "low" })).toContain("auto → Sonnet 4.5 low");
		expect(at({ sub: true })).toMatch(/38% · sub$/);
		expect(at({ cost: 0 })).toMatch(/38%$/);
		expect(at({ thinking: undefined, dirty: false, branch: undefined, statuses: [] })).toBe("pi-things/pi-footer Opus 4.6 · ━━━━━━━━━━ 38% · $0.42");
	});
});

test("shortModel", () => {
	expect(shortModel("Claude Sonnet 4.5")).toBe("Sonnet 4.5");
	expect(shortModel("claude-sonnet-4-5-20250929")).toBe("sonnet-4-5");
	expect(shortModel("openrouter/openai/gpt-5")).toBe("gpt-5");
	expect(shortModel("Gemini 2.5 Pro")).toBe("Gemini 2.5 Pro");
});
