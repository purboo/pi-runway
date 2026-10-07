/**
 * Pure derivations from session entries. Structural types keep this testable without pi.
 */
import { basename, relative, sep } from "node:path";

export interface UsageLike {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens?: number;
	cost?: { total: number };
}

export interface MessageLike {
	role: string;
	usage?: UsageLike;
	stopReason?: string;
	provider?: string;
	model?: string;
	thinkingLevel?: string;
}

export interface EntryLike {
	type: string;
	usage?: UsageLike;
	message?: MessageLike;
}

/** How many recent runs the growth estimate averages over. */
const WINDOW = 3;

export function contextTokens(u: UsageLike): number {
	return u.totalTokens || u.input + u.output + u.cacheRead + u.cacheWrite;
}

const ok = (m: MessageLike) => m.role === "assistant" && m.stopReason !== "error" && m.stopReason !== "aborted";

/** Total spend across every entry, abandoned branches included (same accounting as pi's footer). */
export function totalCost(entries: readonly EntryLike[]): number {
	let cost = 0;
	for (const e of entries) {
		if (e.type === "message") {
			const m = e.message;
			if (m && (m.role === "assistant" || m.role === "toolResult")) cost += m.usage?.cost?.total ?? 0;
		} else {
			cost += e.usage?.cost?.total ?? 0; // usage, compaction, branch_summary
		}
	}
	return cost;
}

/** Latest successful response on the branch; under a virtual model its model is the routed one. */
export function latestResponse(branch: readonly EntryLike[]): MessageLike | undefined {
	for (let i = branch.length - 1; i >= 0; i--) {
		const m = branch[i].message;
		if (branch[i].type === "message" && m && ok(m)) return m;
	}
	return undefined;
}

/** Context size at the end of each user run since the latest compaction. */
export function runEnds(branch: readonly EntryLike[]): number[] {
	let ends: number[] = [];
	let last: number | undefined;
	for (const e of branch) {
		if (e.type === "compaction") {
			ends = [];
			last = undefined;
		} else if (e.type === "message" && e.message) {
			const m = e.message;
			if (m.role === "user") {
				if (last !== undefined) ends.push(last);
				last = undefined;
			} else if (ok(m) && m.usage) {
				last = contextTokens(m.usage);
			}
		}
	}
	if (last !== undefined) ends.push(last);
	return ends;
}

/** Mean context growth per run over the last few runs, in tokens. Needs ≥2 growth samples. */
export function runGrowth(ends: readonly number[]): number | undefined {
	if (ends.length < 3) return undefined;
	const recent = ends.slice(-(WINDOW + 1));
	const growth = (recent[recent.length - 1] - recent[0]) / (recent.length - 1);
	return growth > 0 ? growth : undefined;
}

/** Runs left before the window is full, from the mean growth of the last runs. */
export function turnsLeft(ends: readonly number[], tokens: number | null, window: number): number | undefined {
	const growth = runGrowth(ends);
	if (tokens === null || window <= 0 || growth === undefined) return undefined;
	return Math.max(0, Math.floor((window - tokens) / growth));
}

/**
 * The shortest name that says which project this is: "repo/sub/dir" inside git ("repo" when narrow),
 * otherwise the folder name, "~" at home.
 */
export function displayPath(cwd: string, gitRoot: string | undefined, home: string | undefined): { path: string; repo: string } {
	if (gitRoot) {
		const repo = basename(gitRoot) || gitRoot;
		const rel = relative(gitRoot, cwd);
		const inside = rel && !rel.startsWith("..");
		return { path: inside ? [repo, ...rel.split(sep)].join("/") : repo, repo };
	}
	if (home && cwd === home) return { path: "~", repo: "~" };
	const base = basename(cwd) || cwd;
	return { path: base, repo: base };
}

/** Status texts are single-line by contract; enforce it. */
export function sanitize(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}
