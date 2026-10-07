/**
 * pi-runway — the editor's frame tells you everything, and nothing more than you need.
 *
 * Top border: where you are, and the model. Bottom border: the context runway.
 * The frame's color and motion say whose turn it is: a light runs while the agent works,
 * yellow when an extension waits for your answer, red when the last run failed.
 *
 * Fast by construction: render() only splices cached strings. Session state is derived on events.
 */
import type { Api, Model } from "@earendil-works/pi-ai";
import {
	type ContextUsage,
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
	keyText,
	type ReadonlyFooterDataProvider,
	type Theme,
	type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { type EditorTheme, type TUI, type TuiMouseEvent, visibleWidth } from "@earendil-works/pi-tui";
import { bottom, type RunState, shortModel, top, type View } from "./src/frame.ts";
import { type Look, paint } from "./src/paint.ts";
import { displayPath, latestResponse, type MessageLike, runEnds, runGrowth, sanitize, totalCost, turnsLeft } from "./src/state.ts";

const VIRTUAL_API = "pi-virtual";
const GIT_TIMEOUT_MS = 3000;
/** Below this the editor is drawn unframed, as pi would. */
const MIN_FRAMED_WIDTH = 16;
/** Running light: ms per column, and the length of its tail. */
const LIGHT_MS_PER_COL = 30;
const LIGHT_TAIL = 22;
const FRAME_MS = 60;
/** How long the thinking level name stays next to ◆ after it changes. */
const THINKING_FLASH_MS = 2000;

const THINKING_TOKEN: Record<string, ThemeColor> = {
	off: "thinkingOff",
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
	max: "thinkingMax",
};

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
	let latest: MessageLike | undefined;
	let ends: number[] = [];
	let multiProvider = false;

	// Run state.
	let runState: RunState = "idle";
	let failed = false;
	let prompts = 0;
	let compacting = false;
	let thinkingUntil = 0;
	let animStart = 0;
	let anim: ReturnType<typeof setInterval> | undefined;
	let flashTimer: ReturnType<typeof setTimeout> | undefined;

	// Git: root once per session/branch change, dirty after anything that may touch files.
	let gitRoot: string | undefined;
	let gitRootKnown = false;
	let dirty = false;
	let gitBusy = false;
	let gitAgain = false;
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
		if (runState !== "run") ends = runEnds(branch);
		const model = c.model;
		const id = model?.api === VIRTUAL_API ? latest?.model : model?.id;
		multiProvider = id ? c.modelRegistry.getAvailable().filter((m) => m.id === id).length > 1 : false;
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
		const git = (...args: string[]) => pi.exec("git", args, { cwd: c.cwd, timeout: GIT_TIMEOUT_MS });
		try {
			if (!gitRootKnown) {
				const r = await git("rev-parse", "--show-toplevel");
				gitRoot = r.code === 0 ? r.stdout.trim() || undefined : undefined;
				gitRootKnown = true;
			}
			const s = await git("status", "--porcelain", "--ignore-submodules");
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

	function animating(): boolean {
		return runState === "run" || compacting;
	}

	function syncAnimation() {
		if (animating() && !anim) {
			animStart = Date.now();
			anim = setInterval(() => requestRender(), FRAME_MS);
		} else if (!animating() && anim) {
			clearInterval(anim);
			anim = undefined;
		}
		requestRender();
	}

	function stopTimers() {
		if (anim) clearInterval(anim);
		if (gitTimer) clearTimeout(gitTimer);
		if (refreshTimer) clearTimeout(refreshTimer);
		if (flashTimer) clearTimeout(flashTimer);
		anim = gitTimer = refreshTimer = flashTimer = undefined;
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
		const routedModel = routed?.model
			? (c?.modelRegistry.find(routed.provider ?? "", routed.model) ?? { id: routed.model })
			: undefined;
		const provider = routed ? routed.provider : model?.provider;
		const statuses = [...(footer?.getExtensionStatuses() ?? new Map<string, string>())]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([, text]) => sanitize(text))
			.filter(Boolean);
		const branch = footer?.getGitBranch() ?? undefined;
		const pct = usage?.percent ?? null;
		const window = usage?.contextWindow ?? 0;
		const growth = runGrowth(ends);
		const busy = animating();
		// pi spells the key "escape"; the keycap says "esc".
		const interrupt = busy ? keyText("app.interrupt").replace(/\bescape\b/gi, "esc") : "";
		return {
			...displayPath(c?.cwd ?? process.cwd(), gitRoot, process.env.HOME),
			branch: branch || undefined,
			dirty,
			statuses,
			model: displayName(routedModel ?? model),
			provider: multiProvider ? provider : undefined,
			routed: !!routedModel,
			thinking: Date.now() < thinkingUntil ? pi.getThinkingLevel() : undefined,
			state: prompts > 0 ? "you" : runState,
			hint: interrupt ? `${interrupt} to interrupt` : undefined,
			pct,
			next: growth && window > 0 ? (growth / window) * 100 : undefined,
			turns: turnsLeft(ends, usage?.tokens ?? null, window),
			cost: cost >= 0.005 && !isSubscription(provider) ? cost : undefined,
		};
	}

	function look(v: View, editorText: string, width: number): { look: Look; frame: number } {
		const thinking = THINKING_TOKEN[pi.getThinkingLevel()] ?? "thinkingOff";
		const border: ThemeColor =
			v.state === "you"
				? "warning"
				: v.state === "err"
					? "error"
					: editorText.trimStart().startsWith("!")
						? "bashMode"
						: thinking;
		if (!animating()) return { look: { border, diamond: thinking }, frame: -1 };
		const loop = width + LIGHT_TAIL;
		const head = Math.floor((Date.now() - animStart) / LIGHT_MS_PER_COL) % loop;
		const glow = (col: number) => {
			const d = head - col;
			return d >= 0 && d < LIGHT_TAIL ? (1 - d / LIGHT_TAIL) ** 1.4 * 0.85 : 0;
		};
		const sweep = compacting ? (col: number) => Math.max(0, 1 - Math.abs(col - head) / 4) : undefined;
		return { look: { border, diamond: thinking, glow, sweep }, frame: head };
	}

	function makeEditor(theme: () => Theme) {
		return class RunwayEditor extends CustomEditor {
			private framing = false;
			private above = 0;
			private below = 0;
			private key = "";
			private lastTheme: Theme | undefined;
			private cached: { top: string; bottom: string; side: string } = { top: "", bottom: "", side: "" };

			constructor(tui: TUI, editorTheme: EditorTheme, keybindings: KeybindingsManager) {
				super(tui, editorTheme, keybindings);
			}

			protected override renderTopBorder(width: number, hidden: number): string {
				if (!this.framing) return super.renderTopBorder(width, hidden);
				this.above = hidden;
				return "";
			}

			protected override renderBottomBorder(width: number, hidden: number): string {
				if (!this.framing) return super.renderBottomBorder(width, hidden);
				this.below = hidden;
				return "";
			}

			override invalidate(): void {
				super.invalidate();
				this.key = "";
			}

			override render(width: number): string[] {
				if (width < MIN_FRAMED_WIDTH) return super.render(width);
				this.framing = true;
				let lines: string[];
				try {
					lines = super.render(width - 4);
				} finally {
					this.framing = false;
				}
				const acHeight = (this as unknown as { renderedAutocompleteHeight?: number }).renderedAutocompleteHeight ?? 0;
				const bodyEnd = lines.length - 1 - acHeight;
				const body = lines.slice(1, bodyEnd);
				const below = lines.slice(bodyEnd + 1);

				const v = view();
				v.moreAbove = this.above || undefined;
				v.moreBelow = this.below || undefined;
				const { look: lk, frame } = look(v, this.getText(), width);
				const th = theme();
				const key = `${width}|${frame}|${lk.border}|${lk.diamond}|${JSON.stringify(v)}`;
				if (key !== this.key || th !== this.lastTheme) {
					this.key = key;
					this.lastTheme = th;
					this.cached = {
						top: paint(th, top(v, width, visibleWidth), lk),
						bottom: paint(th, bottom(v, width, visibleWidth), { ...lk, glow: undefined }),
						side: th.fg(lk.border, "│"),
					};
				}
				const { side } = this.cached;
				return [
					this.cached.top,
					...body.map((l) => `${side} ${l} ${side}`),
					this.cached.bottom,
					...below.map((l) => `  ${l}  `),
				];
			}

			override handleMouse(event: TuiMouseEvent) {
				if (event.width < MIN_FRAMED_WIDTH) return super.handleMouse(event);
				return super.handleMouse({ ...event, x: event.x - 2, width: event.width - 4 });
			}
		};
	}

	function install(c: ExtensionContext) {
		if (c.mode !== "tui") return;
		c.ui.setWorkingVisible(false);
		c.ui.setFooter((tui, _theme, footerData) => {
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
				render: () => [],
			};
		});
		const Editor = makeEditor(() => c.ui.theme);
		c.ui.setEditorComponent((tui, theme, keybindings) => new Editor(tui, theme, keybindings));
	}

	pi.on("session_start", (_e, c) => {
		stopTimers();
		ctx = c;
		runState = "idle";
		prompts = 0;
		compacting = false;
		gitRootKnown = false;
		gitRoot = undefined;
		dirty = false;
		refresh();
		install(c);
	});

	pi.on("agent_start", (_e, c) => {
		ctx = c;
		runState = "run";
		compacting = false; // in case a compaction was cancelled without a failure event
		syncAnimation();
	});

	pi.on("message_end", (_e, c) => {
		ctx = c;
		refreshSoon();
	});

	// agent_end fires per attempt; pi may still retry. The run is over only once the agent settles.
	pi.on("agent_end", (e, c) => {
		ctx = c;
		const last = [...e.messages].reverse().find((m) => (m as MessageLike).role === "assistant") as
			| MessageLike
			| undefined;
		failed = last?.stopReason === "error";
		refreshSoon();
		scheduleGit(0);
	});

	pi.on("agent_settled", (_e, c) => {
		ctx = c;
		runState = failed ? "err" : "idle";
		failed = false;
		syncAnimation();
		refreshSoon();
	});

	pi.on("ui_prompt_start", () => {
		prompts += 1;
		requestRender();
	});
	pi.on("ui_prompt_end", () => {
		prompts = Math.max(0, prompts - 1);
		requestRender();
	});

	pi.on("tool_execution_end", () => scheduleGit(500));
	pi.on("user_bash", () => scheduleGit(1500));

	pi.on("session_before_compact", () => {
		compacting = true;
		syncAnimation();
	});
	const compactDone = (_e: unknown, c: ExtensionContext) => {
		ctx = c;
		compacting = false;
		syncAnimation();
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

	pi.on("thinking_level_select", (_e, c) => {
		ctx = c;
		thinkingUntil = Date.now() + THINKING_FLASH_MS;
		if (flashTimer) clearTimeout(flashTimer);
		flashTimer = setTimeout(() => {
			flashTimer = undefined;
			requestRender();
		}, THINKING_FLASH_MS + 20);
		refreshSoon();
	});

	pi.on("session_shutdown", () => {
		stopTimers();
		ctx = undefined;
	});
}
