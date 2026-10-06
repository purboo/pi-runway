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

/** Runs left before the window is full, from the mean growth of the last runs. Needs ≥2 growth samples. */
export function turnsLeft(ends: readonly number[], tokens: number | null, window: number): number | undefined {
	if (tokens === null || window <= 0 || ends.length < 3) return undefined;
	const recent = ends.slice(-(WINDOW + 1));
	const growth = (recent[recent.length - 1] - recent[0]) / (recent.length - 1);
	if (growth <= 0) return undefined;
	return Math.max(0, Math.floor((window - tokens) / growth));
}

/** Where we are: "repo/sub/dir" inside git, else the last two segments ("~" aware). */
export function displayPath(cwd: string, gitRoot: string | undefined, home: string | undefined): { path: string; base: string } {
	const base = basename(cwd) || cwd;
	if (gitRoot) {
		const rel = relative(gitRoot, cwd);
		const path = rel && !rel.startsWith("..") ? [basename(gitRoot), ...rel.split(sep)].join("/") : basename(gitRoot);
		return { path, base };
	}
	if (home && cwd === home) return { path: "~", base: "~" };
	const parts = cwd.split(sep).filter(Boolean);
	return { path: parts.slice(-2).join("/") || cwd, base };
}

/** Status texts are single-line by contract; enforce it. */
export function sanitize(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}
