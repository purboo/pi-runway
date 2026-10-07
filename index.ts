/**
 * pi-runway — one line, zero config. Silent until it matters,
 * then it tells you how many turns you have left.
 */
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ContextUsage, ExtensionAPI, ExtensionContext, ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { layout, shortModel, type Tone, type View } from "./src/render.ts";
import { displayPath, latestResponse, type MessageLike, runEnds, sanitize, totalCost, turnsLeft } from "./src/state.ts";

const VIRTUAL_API = "pi-virtual";
const GIT_TIMEOUT_MS = 3000;

/** Render tones → theme tokens. `faint` is the quietest color every built-in theme defines. */
const TOKENS = {
	text: "text",
	muted: "muted",
	dim: "dim",
	faint: "scrollbarTrack",
	warning: "warning",
	error: "error",
} as const satisfies Record<Tone, string>;

/** Human name, vendor prefix dropped: "Claude Sonnet 4.5" → "Sonnet 4.5". */
function displayName(model: { id: string; name?: string } | undefined): string | undefined {
	if (!model) return undefined;
	return model.name ? shortModel(model.name) : model.id;
}

export default function runway(pi: ExtensionAPI) {
	let ctx: ExtensionContext | undefined;
	let footer: ReadonlyFooterDataProvider | undefined;
	let requestRender = () => {};

	// Session-derived state, refreshed on events — never by scanning in render().
	let usage: ContextUsage | undefined;
	let cost = 0;
	let runStartCost = 0;
	let latest: MessageLike | undefined;
	let ends: number[] = [];
	let running = false;
	let runStartedAt = 0;
	let compacting = false;

	// Git: root once per session/branch, dirty after anything that may touch files.
	let gitRoot: string | undefined;
	let gitRootKnown = false;
	let dirty = false;
	let gitBusy = false;
	let gitAgain = false;

	let tick: ReturnType<typeof setInterval> | undefined;
	let gitTimer: ReturnType<typeof setTimeout> | undefined;
	let refreshTimer: ReturnType<typeof setTimeout> | undefined;

	function refresh() {
		refreshTimer = undefined;
		const c = ctx;
		if (!c) return;
		usage = c.getContextUsage();
		cost = totalCost(c.sessionManager.getEntries());
		const branch = c.sessionManager.getBranch();
		latest = latestResponse(branch);
		// A half-finished run would skew the growth estimate.
		if (!running) ends = runEnds(branch);
		requestRender();
	}

	/** Entries land after message_end handlers; coalesce bursts into one refresh. */
	function refreshSoon() {
		refreshTimer ??= setTimeout(refresh, 0);
	}

	async function refreshGit() {
		gitTimer = undefined;
		const c = ctx;
		if (!c || !footer?.getGitBranch()) {
			dirty = false;
			return;
		}
		if (gitBusy) {
			gitAgain = true;
			return;
		}
		gitBusy = true;
		try {
			if (!gitRootKnown) {
				const r = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd: c.cwd, timeout: GIT_TIMEOUT_MS });
				gitRoot = r.code === 0 ? r.stdout.trim() || undefined : undefined;
				gitRootKnown = true;
			}
			const s = await pi.exec("git", ["status", "--porcelain", "--ignore-submodules"], { cwd: c.cwd, timeout: GIT_TIMEOUT_MS });
			if (s.code === 0) dirty = s.stdout.trim().length > 0;
		} catch {
			// git missing or timed out: keep the last known state
		} finally {
			gitBusy = false;
		}
		requestRender();
		if (gitAgain) {
			gitAgain = false;
			scheduleGit(0);
		}
	}

	function scheduleGit(delayMs: number) {
		if (gitTimer) clearTimeout(gitTimer);
		gitTimer = setTimeout(() => void refreshGit(), delayMs);
	}

	function stopTimers() {
		if (tick) clearInterval(tick);
		if (gitTimer) clearTimeout(gitTimer);
		if (refreshTimer) clearTimeout(refreshTimer);
		tick = gitTimer = refreshTimer = undefined;
	}

	function isSubscription(provider: string | undefined): boolean {
		if (!provider || !ctx) return false;
		if (provider === "kimi-coding") return true; // subscription-backed despite API-key auth (as in pi's footer)
		// isUsingOAuth only reads model.provider.
		return ctx.modelRegistry.isUsingOAuth({ provider } as Model<Api>);
	}

	function view(): View {
		const c = ctx;
		const model = c?.model;
		const routed = model?.api === VIRTUAL_API ? latest : undefined;
		const level = pi.getThinkingLevel();
		const thinking = routed ? routed.thinkingLevel : model?.reasoning && level !== "off" ? level : undefined;
		const statuses = [...(footer?.getExtensionStatuses() ?? new Map<string, string>())]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([, text]) => sanitize(text))
			.filter(Boolean);
		const where = displayPath(c?.cwd ?? process.cwd(), gitRoot, process.env.HOME);
		return {
			...where,
			branch: footer?.getGitBranch() ?? undefined,
			dirty,
			statuses,
			model: displayName(model),
			thinking: thinking && thinking !== "off" ? thinking : undefined,
			routed: routed?.model
				? displayName(c?.modelRegistry.find(routed.provider ?? "", routed.model) ?? { id: routed.model })
				: undefined,
			ctxPercent: usage?.percent ?? null,
			turnsLeft: turnsLeft(ends, usage?.tokens ?? null, usage?.contextWindow ?? 0),
			cost,
			delta: Math.max(0, cost - runStartCost),
			sub: isSubscription(routed?.provider ?? model?.provider),
			phase: compacting ? "compacting" : running ? "running" : "idle",
			elapsedMs: running ? Date.now() - runStartedAt : 0,
		};
	}

	function install(c: ExtensionContext) {
		if (c.mode !== "tui") return;
		c.ui.setFooter((tui, theme, footerData) => {
			footer = footerData;
			requestRender = () => tui.requestRender();
			const unsubscribe = footerData.onBranchChange(() => {
				gitRootKnown = false;
				scheduleGit(0);
				tui.requestRender();
			});
			scheduleGit(0);
			return {
				invalidate() {},
				dispose() {
					unsubscribe();
					footer = undefined;
					requestRender = () => {};
				},
				render(width: number): string[] {
					const faintDistinct = theme.fg(TOKENS.faint, "x") !== theme.fg(TOKENS.muted, "x");
					const line = layout(view(), width, visibleWidth, { faintDistinct })
						.map((s) => (s.tone ? theme.fg(TOKENS[s.tone], s.text) : s.text))
						.join("");
					return [truncateToWidth(line, width)];
				},
			};
		});
	}

	pi.on("session_start", (_e, c) => {
		stopTimers();
		ctx = c;
		running = compacting = false;
		gitRootKnown = false;
		gitRoot = undefined;
		dirty = false;
		refresh();
		runStartCost = cost;
		install(c);
	});

	pi.on("agent_start", (_e, c) => {
		ctx = c;
		running = true;
		compacting = false; // in case a compaction was cancelled without a failure event
		runStartedAt = Date.now();
		runStartCost = cost;
		tick ??= setInterval(() => requestRender(), 1000);
		requestRender();
	});

	pi.on("message_end", (_e, c) => {
		ctx = c;
		refreshSoon();
	});

	pi.on("agent_end", (_e, c) => {
		ctx = c;
		running = false;
		if (tick) clearInterval(tick);
		tick = undefined;
		refreshSoon();
		scheduleGit(0);
	});

	pi.on("tool_execution_end", () => scheduleGit(500));
	pi.on("user_bash", () => scheduleGit(1500));

	pi.on("session_before_compact", () => {
		compacting = true;
		requestRender();
	});
	const compactDone = (_e: unknown, c: ExtensionContext) => {
		ctx = c;
		compacting = false;
		refreshSoon();
	};
	pi.on("session_compact", compactDone);
	pi.on("session_compact_failed", compactDone);

	const changed = (_e: unknown, c: ExtensionContext) => {
		ctx = c;
		refreshSoon();
	};
	pi.on("session_tree", changed);
	pi.on("model_select", changed);
	pi.on("thinking_level_select", changed);

	pi.on("session_shutdown", () => {
		stopTimers();
		ctx = undefined;
	});
}
