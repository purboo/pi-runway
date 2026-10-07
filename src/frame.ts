/**
 * The editor frame, as plain data: what goes on the top and bottom border at a given width.
 * Pure — no pi, no colors. Colors are applied by src/paint.ts from each segment's tone.
 */

/** idle: your turn · run: the agent is busy · you: an extension is waiting for your answer · err: the last run failed. */
export type RunState = "idle" | "run" | "you" | "err";

export interface View {
	/** "repo/sub/dir" — shortened to `repo` when narrow. */
	path: string;
	repo: string;
	/** Current git branch; absent outside a repo. */
	branch?: string;
	dirty: boolean;
	/** Other extensions' status texts. */
	statuses: string[];
	model?: string;
	/** Shown only when the same model is available from more than one provider. */
	provider?: string;
	/** A virtual model is routing; `model` is the routed one. */
	routed?: boolean;
	/** Thinking level name, for models that can think. */
	thinking?: string;
	state: RunState;
	/** "esc to interrupt" while running. */
	hint?: string;
	/** Editor content hidden above / below the visible lines. */
	moreAbove?: number;
	moreBelow?: number;
	/** Context used, 0–100, or null when unknown (e.g. right after compaction). */
	pct: number | null;
	/** Predicted growth of the next run, in percent of the window. */
	next?: number;
	turns?: number;
	/** Undefined when it should not be shown (subscription, free, unknown). */
	cost?: number;
}

export type Tone = "border" | "text" | "muted" | "dim" | "warning" | "error" | "diamond";

export interface Seg {
	text: string;
	tone: Tone;
	bold?: boolean;
	/** Runway cell: position along the runway, 0–1. */
	heat?: number;
	/** Runway cell predicted for the next run. */
	ghost?: boolean;
}

export type Measure = (text: string) => number;

const s = (text: string, tone: Tone, bold?: boolean): Seg => (bold ? { text, tone, bold } : { text, tone });
const total = (segs: readonly Seg[], m: Measure) => segs.reduce((n, g) => n + m(g.text), 0);

export const WARN = 70;
export const DANGER = 90;

export function alertOf(pct: number | null): "warning" | "error" | undefined {
	if (pct === null) return undefined;
	return pct >= DANGER ? "error" : pct >= WARN ? "warning" : undefined;
}

export function formatCost(cost: number): string {
	return `$${cost >= 100 ? cost.toFixed(0) : cost.toFixed(2)}`;
}

/** "Claude Sonnet 4.5" → "Sonnet 4.5". */
export function shortModel(name: string): string {
	return name.replace(/^(Claude|Google|OpenAI|Anthropic|Gemini(?= \d))\s+/i, "") || name;
}

// ── top border ──────────────────────────────────────────────────────────────
// ╭─ pi-footer/src  ⎇ feat/x*  mcp 3 ───────── esc to interrupt ── ◆ Sonnet 4.5 high ─╮
// Degrades one step at a time; the run-state mark (● / ✗) is never dropped.

function left(v: View, lv: number): Seg[] {
	const out: Seg[] = [];
	if (v.state === "you") out.push(s("● ", "warning"));
	else if (v.state === "err") out.push(s("✗ ", "error"));
	if (lv >= 8) return out;
	out.push(s(lv < 4 ? v.path : v.repo, "text", true));
	if (v.branch && lv < 5) out.push(s("  ⎇ ", "dim"), s(v.branch, "muted"));
	if (v.dirty) out.push(s("*", "warning"));
	if (v.statuses.length && lv < 1) out.push(s(`  ${v.statuses.join("  ")}`, "dim"));
	return out;
}

function right(v: View, lv: number): Seg[] {
	const out: Seg[] = [];
	if (v.moreAbove && lv < 3) out.push(s(`↑ ${v.moreAbove} more`, "dim"), s(" ── ", "border"));
	if (v.hint && lv < 2) out.push(s(v.hint, "dim"), s(" ── ", "border"));
	if (v.model && lv < 7) {
		out.push(s("◆ ", "diamond"));
		if (v.routed && lv < 6) out.push(s("auto → ", "dim"));
		if (v.provider && lv < 1) out.push(s(`${v.provider} · `, "dim"));
		out.push(s(v.model, "text", true));
		if (v.thinking && lv < 6) out.push(s(` ${v.thinking}`, "diamond"));
	}
	return out;
}

/** Border with optional labels: `╭─ L ───── R ─╮`. Undefined when it does not fit. */
function bar(l: readonly Seg[], r: readonly Seg[], width: number, m: Measure, [a, b]: [string, string]): Seg[] | undefined {
	const fixed = 4 + (l.length ? total(l, m) + 2 : 0) + (r.length ? total(r, m) + 2 : 0);
	const run = width - fixed;
	if (run < 3) return undefined;
	const out: Seg[] = [s(`${a}─`, "border")];
	if (l.length) out.push(s(" ", "border"), ...l, s(" ", "border"));
	out.push(s("─".repeat(run), "border"));
	if (r.length) out.push(s(" ", "border"), ...r, s(" ", "border"));
	out.push(s(`─${b}`, "border"));
	return merge(out);
}

function merge(segs: Seg[]): Seg[] {
	const out: Seg[] = [];
	for (const g of segs) {
		const prev = out[out.length - 1];
		if (prev && g.tone === "border" && prev.tone === "border" && !prev.heat && !g.heat && !prev.bold && !g.bold) {
			out[out.length - 1] = { ...prev, text: prev.text + g.text };
		} else out.push(g);
	}
	return out;
}

export function top(v: View, width: number, m: Measure): Seg[] {
	for (let lv = 0; lv <= 9; lv++) {
		const r = bar(left(v, lv), right(v, lv), width, m, ["╭", "╮"]);
		if (r) return r;
	}
	return [s(`╭${"─".repeat(Math.max(0, width - 2))}╮`, "border")];
}

// ── bottom border: the runway ───────────────────────────────────────────────
// ╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╍╍╍─────────────────── 78%  ≈4 turns  $1.20 ─╯

function labels(v: View, lv: number): Seg[] {
	const a = alertOf(v.pct);
	const tone: Tone = a ?? "dim";
	const parts: Seg[][] = [];
	if (v.moreBelow && lv < 3) parts.push([s(`↓ ${v.moreBelow} more`, "dim")]);
	if (v.pct !== null && lv < 4) parts.push([s(`${Math.round(v.pct)}%`, tone)]);
	if (a && v.turns !== undefined && lv < 1) parts.push([s(`≈${v.turns} turn${v.turns === 1 ? "" : "s"}`, tone)]);
	if (v.cost !== undefined && lv < 2) parts.push([s(formatCost(v.cost), "muted")]);
	return parts.flatMap((p, i) => (i ? [s("  ", "dim"), ...p] : p));
}

/** Runway cells: used ━ colored by position, the next run's share ╍, the rest plain border ─. */
export function runway(v: View, n: number): Seg[] {
	if (n <= 0) return [];
	const pct = v.pct ?? 0;
	const used = v.pct === null ? 0 : Math.min(n, Math.max(pct > 0 ? 1 : 0, Math.round((pct / 100) * n)));
	const ghostTo =
		alertOf(v.pct) && v.next ? Math.min(n, Math.max(used + 1, Math.round(((pct + v.next) / 100) * n))) : used;
	const out: Seg[] = [];
	for (let i = 0; i < n; i++) {
		const heat = (i + 0.5) / n;
		if (i < used) out.push({ text: "━", tone: "border", heat });
		else if (i < ghostTo) out.push({ text: "╍", tone: "border", heat, ghost: true });
		else break;
	}
	const rest = n - out.length;
	if (rest > 0) out.push(s("─".repeat(rest), "border"));
	return out;
}

export function bottom(v: View, width: number, m: Measure): Seg[] {
	for (let lv = 0; lv <= 4; lv++) {
		const r = labels(v, lv);
		const rw = total(r, m);
		const n = width - (r.length ? rw + 5 : 2);
		if (n >= 4 || lv === 4) {
			const cells = runway(v, Math.max(0, n));
			return r.length
				? [s("╰", "border"), ...cells, s(" ", "border"), ...r, s(" ─╯", "border")]
				: [s("╰", "border"), ...cells, s("╯", "border")];
		}
	}
	return [s(`╰${"─".repeat(Math.max(0, width - 2))}╯`, "border")];
}
