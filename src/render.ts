/**
 * Pure layout: View + width → segments for exactly one line.
 * No pi imports, so it is testable in isolation; the caller injects a width measure.
 *
 * Segments carry a semantic role, not a color. The caller maps roles to theme tokens (see src/skin.ts),
 * so the line follows whatever theme the user runs. `alert` marks segments that must turn
 * warning/error regardless of role.
 */

export type Role =
	| "path"
	| "branch"
	| "dirty"
	| "status"
	| "elapsed"
	| "model"
	| "via"
	| "thinking"
	| "fill"
	| "track"
	| "pct"
	| "note"
	| "cost"
	| "delta"
	| "sep";

export type Alert = "warning" | "error";

/** A run of text. `role` undefined = plain or pre-styled text (other extensions' statuses, padding). */
export interface Seg {
	text: string;
	role?: Role;
	alert?: Alert;
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
	/** Display name of the selected model. */
	model?: string;
	thinking?: string;
	/** Display name of the physical model a virtual model routed to. */
	routed?: string;
	/** Context usage 0–100, null when unknown (right after compaction). */
	ctxPercent: number | null;
	/** Estimated runs until the context window is full. */
	turnsLeft?: number;
	cost: number;
	/** Cost of the current run. */
	delta: number;
	sub: boolean;
	phase: "idle" | "running" | "compacting";
	elapsedMs: number;
}

export type Measure = (text: string) => number;

export interface Style {
	/**
	 * Whether the theme draws `faint` visibly differently from `muted`. When it does not (16-color
	 * fallbacks render every gray as SGR 2), the empty gauge track switches to a thinner glyph so the
	 * fill stays readable by shape alone.
	 */
	faintDistinct: boolean;
}
const DEFAULT_STYLE: Style = { faintDistinct: true };

const SEP_AIRY = "  ·  ";
const SEP_TIGHT = " · ";
const BRANCH_GAP = "  ";
const PAD = 1;
const GAUGE = 10;
const GAUGE_SHORT = 6;

/** Degradation thresholds: a feature is reduced once `level >= N`. Context % and cost are never dropped. */
const L = {
	tightSep: 1,
	statusCount: 2,
	basename: 3,
	shortGauge: 4,
	noGauge: 5,
	noThinking: 6,
	noStatuses: 6,
	noBranch: 7,
	shortModel: 8,
	noModel: 9,
	noElapsed: 9,
	noPath: 10,
} as const;
export const MAX_LEVEL = 10;

export function severity(percent: number | null): Alert | undefined {
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

export function formatTurns(n: number, short = false): string {
	const s = n < 1 ? "<1 turn" : n === 1 ? "≈1 turn" : `≈${n} turns`;
	return short ? s : `${s} left`;
}

/** Drop vendor prefixes and date stamps: "Claude Sonnet 4.5" → "Sonnet 4.5", "openai/gpt-5-20250101" → "gpt-5". */
export function shortModel(name: string): string {
	return name
		.replace(/^.*\//, "")
		.replace(/-\d{8}$/, "")
		.replace(/^claude[- ]/i, "");
}

function gauge(percent: number, cells: number, alert: Alert | undefined, style: Style): Seg[] {
	const filled = percent < 0.5 ? 0 : Math.max(1, Math.min(cells, Math.round((percent / 100) * cells)));
	return [
		{ text: "━".repeat(filled), role: "fill", alert },
		{ text: (style.faintDistinct ? "━" : "─").repeat(cells - filled), role: "track" },
	];
}

export function build(v: View, level: number, style: Style = DEFAULT_STYLE): { left: Seg[][]; right: Seg[][]; sep: string } {
	const at = (n: number) => level >= n;
	const left: Seg[][] = [];
	const right: Seg[][] = [];
	const sev = severity(v.ctxPercent);

	if (!at(L.noPath)) {
		const where: Seg[] = [{ text: at(L.basename) ? v.base : v.path, role: "path" }];
		if (v.branch && !at(L.noBranch)) {
			where.push({ text: `${BRANCH_GAP}${v.branch}`, role: "branch" });
			if (v.dirty) where.push({ text: "*", role: "dirty" });
		}
		left.push(where);
	}
	if (v.statuses.length > 0 && !at(L.noStatuses)) {
		// "+1" says less than the status itself; only collapse when it saves room.
		if (!at(L.statusCount) || v.statuses.length === 1) for (const s of v.statuses) left.push([{ text: s, role: "status" }]);
		else left.push([{ text: `+${v.statuses.length}`, role: "status" }]);
	}

	if (v.phase === "running" && v.elapsedMs >= 1000 && !at(L.noElapsed)) {
		right.push([{ text: formatDuration(v.elapsedMs), role: "elapsed" }]);
	}
	if (v.model && !at(L.noModel)) {
		const model: Seg[] = [];
		if (at(L.shortModel)) {
			model.push({ text: shortModel(v.routed ?? v.model), role: "model" });
		} else if (v.routed) {
			model.push({ text: `${v.model} → `, role: "via" }, { text: v.routed, role: "model" });
		} else {
			model.push({ text: v.model, role: "model" });
		}
		if (v.thinking && !at(L.noThinking)) model.push({ text: " " }, { text: v.thinking, role: "thinking" });
		right.push(model);
	}

	const ctx: Seg[] = [];
	if (!at(L.noGauge) && v.ctxPercent !== null) {
		ctx.push(...gauge(v.ctxPercent, at(L.shortGauge) ? GAUGE_SHORT : GAUGE, sev, style), { text: " " });
	}
	if (v.phase === "compacting") {
		ctx.push({ text: "compacting…", role: "note" });
		right.push(ctx);
	} else {
		ctx.push({ text: v.ctxPercent === null ? "?%" : `${Math.round(v.ctxPercent)}%`, role: "pct", alert: sev });
		if (sev && v.turnsLeft !== undefined) ctx.push({ text: "  " }, { text: formatTurns(v.turnsLeft, at(L.noPath)), role: "note", alert: sev });
		right.push(ctx);

		if (v.sub) {
			right.push([{ text: "sub", role: "cost" }]);
		} else if (v.cost >= 0.005) {
			const cost: Seg[] = [{ text: formatCost(v.cost), role: "cost" }];
			if (v.phase === "running" && v.delta >= 0.005 && !at(L.shortModel)) {
				cost.push({ text: " " }, { text: `+${v.delta.toFixed(2)}`, role: "delta" });
			}
			right.push(cost);
		}
	}
	return { left, right, sep: at(L.tightSep) ? SEP_TIGHT : SEP_AIRY };
}

function join(groups: Seg[][], sep: string): Seg[] {
	const out: Seg[] = [];
	groups.forEach((g, i) => {
		if (i > 0) out.push({ text: sep, role: "sep" });
		out.push(...g);
	});
	return out;
}

const widthOf = (segs: Seg[], measure: Measure) => segs.reduce((n, s) => n + measure(s.text), 0);

/** Most informative single line that fits `width`. May still overflow at absurd widths; caller truncates. */
export function layout(v: View, width: number, measure: Measure, style: Style = DEFAULT_STYLE): Seg[] {
	const pad = width >= 40 ? PAD : 0;
	const inner = width - 2 * pad;
	const edge: Seg = { text: " ".repeat(pad) };
	let last: Seg[] = [];
	for (let level = 0; level <= MAX_LEVEL; level++) {
		const { left, right, sep } = build(v, level, style);
		const l = join(left, sep);
		const r = join(right, sep);
		const lw = widthOf(l, measure);
		const rw = widthOf(r, measure);
		const gap = lw > 0 && rw > 0 ? SEP_AIRY.length : 0;
		last = r.length > 0 ? r : l;
		if (lw + gap + rw <= inner) {
			return [edge, ...l, { text: " ".repeat(inner - lw - rw) }, ...r, edge];
		}
	}
	return last;
}
