import { describe, expect, test } from "bun:test";
import { layout, type Seg, shortModel, type View } from "../src/render.ts";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const measure = (s: string) => [...strip(s)].length;
const text = (segs: Seg[]) => segs.map((s) => strip(s.text)).join("");
const tones = (segs: Seg[], needle: string) => segs.filter((s) => s.text.includes(needle)).map((s) => s.tone);

const base: View = {
	path: "pi-things/pi-footer",
	base: "pi-footer",
	branch: "main",
	dirty: true,
	statuses: ["mcp:3", "\x1b[32mlsp ok\x1b[39m"],
	model: "claude-opus-4-6",
	thinking: "high",
	ctxPercent: 38,
	cost: 0.42,
	delta: 0,
	sub: false,
	phase: "idle",
	elapsedMs: 0,
};
const v = (o: Partial<View> = {}): View => ({ ...base, ...o });

describe("width", () => {
	for (const w of [140, 120, 100, 80, 64, 52, 40, 30, 22]) {
		test(`${w} cols fits exactly`, () => {
			for (const view of [v(), v({ phase: "running", elapsedMs: 83_000, delta: 0.04 }), v({ ctxPercent: 93, turnsLeft: 1 }), v({ phase: "compacting" })]) {
				const out = text(layout(view, w, measure));
				expect([...out].length).toBe(w);
			}
		});
	}

	test("degrades in order and never drops context or cost", () => {
		const lines = [120, 80, 64, 52, 40, 22].map((w) => text(layout(v(), w, measure)).replace(/ +/g, " ").trim());
		expect(lines).toEqual([
			"pi-things/pi-footer (main*) mcp:3 lsp ok claude-opus-4-6 high ━━━━────── 38% $0.42",
			"pi-things/pi-footer (main*) +2 claude-opus-4-6 high ━━━━────── 38% $0.42",
			"pi-footer (main*) +2 claude-opus-4-6 high ━━──── 38% $0.42",
			"pi-footer (main*) claude-opus-4-6 38% $0.42",
			"pi-footer claude-opus-4-6 38% $0.42",
			"pi-footer 38% $0.42",
		]);
	});
});

describe("states", () => {
	const at = (o: Partial<View>) => text(layout(v(o), 120, measure)).replace(/ +/g, " ").trim();

	test("quiet when healthy", () => {
		const segs = layout(v(), 120, measure);
		expect(segs.every((s) => s.tone !== "warning" || s.text === "*")).toBe(true);
		expect(segs.some((s) => s.tone === "error")).toBe(false);
	});

	test("warning at 70, error at 90, with runway", () => {
		const warn = layout(v({ ctxPercent: 78, turnsLeft: 4 }), 120, measure);
		expect(text(warn)).toContain("78% ≈4 turns");
		expect(tones(warn, "78%")).toEqual(["warning"]);
		const err = layout(v({ ctxPercent: 93, turnsLeft: 1 }), 120, measure);
		expect(text(err)).toContain("93% ≈1 turn");
		expect(tones(err, "93%")).toEqual(["error"]);
		expect(at({ ctxPercent: 99, turnsLeft: 0 })).toContain("99% <1 turn");
	});

	test("runway hidden below 70%", () => {
		expect(at({ ctxPercent: 50, turnsLeft: 9 })).not.toContain("turn");
	});

	test("running shows elapsed and run delta", () => {
		expect(at({ phase: "running", elapsedMs: 83_000, delta: 0.04, cost: 0.46 })).toContain("1m23s claude-opus-4-6 high ━━━━────── 38% $0.46 +0.04");
		expect(at({ phase: "running", elapsedMs: 500 })).not.toMatch(/\ds /);
	});

	test("delta stays after the run", () => {
		expect(at({ delta: 0.04, cost: 0.46 })).toContain("$0.46 +0.04");
	});

	test("compacting replaces numbers", () => {
		expect(at({ phase: "compacting", ctxPercent: 93 })).toMatch(/━+─* compacting…$/);
	});

	test("unknown context after compaction", () => {
		expect(at({ ctxPercent: null })).toContain("high ?% $0.42");
	});

	test("routed, subscription, hidden extras", () => {
		expect(at({ model: "auto", routed: "claude-sonnet-4-5", thinking: "low" })).toContain("auto → claude-sonnet-4-5 low");
		expect(at({ sub: true })).toMatch(/38% sub$/);
		expect(at({ cost: 0 })).toMatch(/38%$/);
		expect(at({ thinking: undefined, dirty: false, branch: undefined, statuses: [] })).toBe("pi-things/pi-footer claude-opus-4-6 ━━━━────── 38% $0.42");
	});

	test("percent has fixed width", () => {
		const a = layout(v({ ctxPercent: 5 }), 120, measure);
		const b = layout(v({ ctxPercent: 55 }), 120, measure);
		expect(text(a).indexOf("claude")).toBe(text(b).indexOf("claude"));
	});
});

test("shortModel", () => {
	expect(shortModel("claude-opus-4-6")).toBe("opus-4-6");
	expect(shortModel("claude-sonnet-4-5-20250929")).toBe("sonnet-4-5");
	expect(shortModel("openrouter/openai/gpt-5")).toBe("gpt-5");
});
