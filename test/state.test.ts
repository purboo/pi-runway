import { expect, test } from "bun:test";
import { displayPath, type EntryLike, latestResponse, runEnds, runGrowth, sanitize, totalCost, turnsLeft } from "../src/state.ts";

const usage = (tokens: number, cost = 0) => ({ input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: tokens, cost: { total: cost } });
const user = (): EntryLike => ({ type: "message", message: { role: "user" } });
const asst = (tokens: number, cost = 0, extra = {}): EntryLike => ({
	type: "message",
	message: { role: "assistant", usage: usage(tokens, cost), stopReason: "stop", provider: "p", model: "m", ...extra },
});

test("runEnds takes the last response of each run, reset by compaction", () => {
	const branch = [user(), asst(10), asst(20), user(), asst(30), { type: "compaction" }, user(), asst(5), user(), asst(9), asst(12)];
	expect(runEnds(branch)).toEqual([5, 12]);
	expect(runEnds(branch.slice(0, 5))).toEqual([20, 30]);
});

test("runEnds skips failed responses", () => {
	expect(runEnds([user(), asst(10), asst(99, 0, { stopReason: "error" })])).toEqual([10]);
});

test("turnsLeft needs two growth samples", () => {
	expect(turnsLeft([100, 200], 200, 1000)).toBeUndefined();
	expect(turnsLeft([100, 200, 300], 300, 1000)).toBe(7);
	// averages the last three runs only
	expect(turnsLeft([0, 100, 200, 300, 400], 400, 1000)).toBe(6);
	expect(turnsLeft([300, 200, 100], 100, 1000)).toBeUndefined();
	expect(turnsLeft([100, 200, 300], null, 1000)).toBeUndefined();
	expect(turnsLeft([800, 900, 990], 990, 1000)).toBe(0);
});

test("totalCost counts every spend", () => {
	const entries: EntryLike[] = [
		user(),
		asst(1, 0.1),
		{ type: "message", message: { role: "toolResult", usage: usage(1, 0.02) } },
		{ type: "compaction", usage: usage(1, 0.03) },
		{ type: "usage", usage: usage(1, 0.05) },
		{ type: "model_change" },
	];
	expect(totalCost(entries)).toBeCloseTo(0.2);
});

test("latestResponse ignores aborted", () => {
	const b = [asst(1, 0, { model: "a" }), asst(1, 0, { model: "b", stopReason: "aborted" })];
	expect(latestResponse(b)?.model).toBe("a");
});

test("displayPath: the shortest name that says which project", () => {
	expect(displayPath("/h/u/p/pi-footer", "/h/u/p/pi-footer", "/h/u")).toEqual({ path: "pi-footer", repo: "pi-footer" });
	expect(displayPath("/h/u/p/pi-footer/src/x", "/h/u/p/pi-footer", "/h/u")).toEqual({ path: "pi-footer/src/x", repo: "pi-footer" });
	expect(displayPath("/h/u/projects/scratch", undefined, "/h/u")).toEqual({ path: "scratch", repo: "scratch" });
	expect(displayPath("/h/u", undefined, "/h/u")).toEqual({ path: "~", repo: "~" });
});

test("runGrowth", () => {
	expect(runGrowth([100, 200])).toBeUndefined();
	expect(runGrowth([100, 200, 300])).toBe(100);
	expect(runGrowth([300, 200, 100])).toBeUndefined();
});

test("sanitize", () => {
	expect(sanitize(" a\n\tb  c ")).toBe("a b c");
});
