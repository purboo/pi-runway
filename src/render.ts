/**
 * Pure layout: View + width → styled segments for exactly one line.
 * No pi imports, so it is testable in isolation; the caller injects a width measure.
 */

export type Tone = "dim" | "muted" | "warning" | "error";

/** A run of text. `tone` undefined = pre-styled text from another extension, emitted as-is. */
export interface Seg {
	text: string;
	tone?: Tone;
}

export interface View {
	/** "repo/sub/dir" inside git, else the last two path segments. */
	path: string;
	/** Last path segment. */
	base: string;
	branch?: string;
	dirty: boolean;
	/** Sanitized texts from ctx.ui.setStatus(), may contain ANSI. */
	statuses: string[];
	model?: string;
	thinking?: string;
	/** Physical model the virtual model routed to. */
	routed?: string;
	/** Context usage 0–100, null when unknown (right after compaction). */
	ctxPercent: number | null;
	/** Estimated runs until the context window is full. */
	turnsLeft?: number;
	cost: number;
	/** Cost of the current (or last) run. */
	delta: number;
	sub: boolean;
	phase: "idle" | "running" | "compacting";
	elapsedMs: number;
}

export type Measure = (text: string) => number;

const GAP = "  ";
export const MAX_LEVEL = 9;

export function severity(percent: number | null): Tone | undefined {
	if (percent === null) return undefined;
	if (percent >= 90) return "error";
	if (percent >= 70) return "warning";
	return undefined;
}

export function formatCost(cost: number): string {
	return cost >= 100 ? `$${Math.round(cost)}` : `$${cost.toFixed(2)}`;
}

export function formatDuration(ms: number): string {
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}s`;
	return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

export function formatTurns(n: number): string {
	if (n < 1) return "<1 turn";
	return n === 1 ? "≈1 turn" : `≈${n} turns`;
}

/** "claude-opus-4-6-20250514" → "opus-4-6"; "openai/gpt-5" → "gpt-5". */
export function shortModel(id: string): string {
	return id
		.replace(/^.*\//, "")
		.replace(/-\d{8}$/, "")
		.replace(/^claude-/, "");
}

function bar(percent: number, cells: number, tone: Tone | undefined): Seg[] {
	const filled = Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)));
	return [
		{ text: "━".repeat(filled), tone: tone ?? "muted" },
		{ text: "─".repeat(cells - filled), tone: "dim" },
	];
}

/**
 * Degradation levels (0 = everything):
 * 1 statuses → +N · 2 path → basename · 3 bar 10→6 · 4 bar off · 5 thinking and +N off ·
 * 6 branch off · 7 short model, delta off · 8 model and elapsed off · 9 path off.
 * Context percent and cost are never dropped.
 */
export function build(v: View, level: number): { left: Seg[][]; right: Seg[][] } {
	const left: Seg[][] = [];
	const right: Seg[][] = [];
	const sev = severity(v.ctxPercent);

	if (level < 9) {
		const where: Seg[] = [{ text: level >= 2 ? v.base : v.path, tone: "muted" }];
		if (v.branch && level < 6) {
			where.push({ text: ` (${v.branch}`, tone: "dim" });
			if (v.dirty) where.push({ text: "*", tone: "warning" });
			where.push({ text: ")", tone: "dim" });
		}
		left.push(where);
	}
	if (v.statuses.length > 0) {
		if (level < 1) for (const s of v.statuses) left.push([{ text: s }]);
		else if (level < 5) left.push([{ text: `+${v.statuses.length}`, tone: "dim" }]);
	}

	if (v.phase === "running" && level < 8 && v.elapsedMs >= 1000) {
		right.push([{ text: formatDuration(v.elapsedMs), tone: "muted" }]);
	}
	if (v.model && level < 8) {
		const model: Seg[] = [];
		if (level >= 7) {
			model.push({ text: shortModel(v.routed ?? v.model), tone: "muted" });
		} else if (v.routed) {
			model.push({ text: `${v.model} → `, tone: "dim" }, { text: v.routed, tone: "muted" });
		} else {
			model.push({ text: v.model, tone: "muted" });
		}
		if (v.thinking && level < 5) model.push({ text: ` ${v.thinking}`, tone: "dim" });
		right.push(model);
	}

	const ctx: Seg[] = [];
	if (level < 4 && v.ctxPercent !== null) ctx.push(...bar(v.ctxPercent, level >= 3 ? 6 : 10, sev), { text: " " });
	if (v.phase === "compacting") {
		ctx.push({ text: "compacting…", tone: "muted" });
		right.push(ctx);
		return { left, right };
	}
	const pct = v.ctxPercent === null ? "?" : String(Math.round(v.ctxPercent));
	ctx.push({ text: `${pct.padStart(3)}%`, tone: sev ?? "muted" });
	if (sev && v.turnsLeft !== undefined) ctx.push({ text: ` ${formatTurns(v.turnsLeft)}`, tone: sev });
	right.push(ctx);

	if (v.sub) {
		right.push([{ text: "sub", tone: "dim" }]);
	} else if (v.cost > 0) {
		const cost: Seg[] = [{ text: formatCost(v.cost), tone: "muted" }];
		if (v.delta >= 0.005 && level < 7) cost.push({ text: ` +${v.delta.toFixed(2)}`, tone: "dim" });
		right.push(cost);
	}
	return { left, right };
}

function join(groups: Seg[][]): Seg[] {
	const out: Seg[] = [];
	groups.forEach((g, i) => {
		if (i > 0) out.push({ text: GAP, tone: "dim" });
		out.push(...g);
	});
	return out;
}

const widthOf = (segs: Seg[], measure: Measure) => segs.reduce((n, s) => n + measure(s.text), 0);

/** Most informative single line that fits `width`. May still overflow at absurd widths; caller truncates. */
export function layout(v: View, width: number, measure: Measure): Seg[] {
	let last: Seg[] = [];
	for (let level = 0; level <= MAX_LEVEL; level++) {
		const { left, right } = build(v, level);
		const l = join(left);
		const r = join(right);
		const lw = widthOf(l, measure);
		const rw = widthOf(r, measure);
		const gap = lw > 0 && rw > 0 ? GAP.length : 0;
		last = r.length > 0 ? r : l;
		if (lw + gap + rw <= width) {
			return [...l, { text: " ".repeat(width - lw - rw) }, ...r];
		}
	}
	return last;
}
