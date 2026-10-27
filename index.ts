/**
 * pi-runway — the editor's frame tells you everything, and nothing more than you need.
 *
 * Top border: where you are, and the model. Bottom border: the context runway.
 * The frame's color and motion say whose turn it is: a light runs while the agent works,
 * yellow when an extension waits for your answer, red when the last run failed.
 *
 * Fast by construction: render() only splices cached strings. Session state is derived on events.
 */
// Namespaces for what older pi versions may lack: a missing named import would stop the extension from loading.
import * as ai from "@earendil-works/pi-ai";
import * as host from "@earendil-works/pi-coding-agent";
import {
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
import {
	calibration,
	displayPath,
	latestResponse,
	measured,
	type MessageLike,
	runEnds,
	runGrowth,
	sanitize,
	turnsLeft,
} from "./src/state.ts";

const VIRTUAL_API = "pi-virtual";
const GIT_TIMEOUT_MS = 3000;
/** Below this the editor is drawn unframed, as pi would. */
const MIN_FRAMED_WIDTH = 16;
/** Running light: ms per column, and the length of its tail. */
const LIGHT_MS_PER_COL = 40;
const LIGHT_TAIL = 22;
/** Each frame redraws all of pi's TUI. 80 ms is the rate of pi's own working spinner, which Runway hides: no more
 *  redraws than stock pi. With 40 ms per column the light still moves an even 2 columns per frame. */
const FRAME_MS = 80;

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

/** Context in use; `estimated` until a response measures it. */
interface Context {
	tokens: number | null;
	window: number;
	estimated: boolean;
}

type Message = Parameters<typeof host.estimateTokens>[0];

/** pi's characters/4 estimate of a projected context: the system prompt as it stands, plus every other message. */
function estimateSize(messages: Message[]): number {
	const system =
		typeof ai.getCurrentSystemMessage === "function"
			? (ai.getCurrentSystemMessage(messages as Parameters<typeof ai.getCurrentSystemMessage>[0]) as Message | undefined)
			: [...messages].reverse().find((m) => m.role === "system");
	let tokens = system ? host.estimateTokens(system) : 0;
	for (const m of messages) if (m.role !== "system") tokens += host.estimateTokens(m);
	return tokens;
}

export default function runway(pi: ExtensionAPI) {
	let ctx: ExtensionContext | undefined;
	let footer: ReadonlyFooterDataProvider | undefined;
	let requestRender = () => {};
	/** Toggled with /runway; kept across sessions for the life of the process. */
	let enabled = true;
	let editorFactory: Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0];

	// Session-derived state, refreshed on events — never by scanning in render().
	let context: Context | undefined;
	/** Estimated context size with a given response as the leaf. Entries are append-only: these never change. */
	const estimates = new Map<string, number>();
	let latest: MessageLike | undefined;
	let ends: number[] = [];
	let multiProvider = false;

	// Run state.
	let runState: RunState = "idle";
	let failed = false;
	let prompts = 0;
	let compacting = false;
	let animStart = 0;
	let anim: ReturnType<typeof setInterval> | undefined;

	// Git: root once per session/branch change, dirty after anything that may touch files.
	let gitRoot: string | undefined;
	let gitRootKnown = false;
	let dirty = false;
	let gitBusy = false;
	let gitAgain = false;
	let gitTimer: ReturnType<typeof setTimeout> | undefined;
	let refreshTimer: ReturnType<typeof setTimeout> | undefined;

	/**
	 * pi's figure, unless a compaction or context edit came after the latest response. pi then knows nothing
	 * (compaction) or guesses from characters, about half the real size for some models. Instead: the same estimate,
	 * scaled by how far it was off for the latest responses, until the next response measures the context again.
	 */
	function contextNow(c: ExtensionContext): Context | undefined {
		const u = c.getContextUsage();
		if (!u) return undefined;
		const branch = c.sessionManager.getBranch();
		if (measured(branch)) return { tokens: u.tokens, window: u.contextWindow, estimated: false };
		const project = host.buildSessionProjection;
		if (typeof project !== "function" || typeof host.estimateTokens !== "function") {
			return { tokens: u.tokens, window: u.contextWindow, estimated: true };
		}
		const entries = c.sessionManager.getEntries();
		const ratio = calibration(branch, (id) => {
			let n = estimates.get(id);
			if (n === undefined) estimates.set(id, (n = estimateSize(project(entries, id).messages)));
			return n;
		});
		const tokens =
			ratio === undefined ? u.tokens : Math.round(ratio * estimateSize(project(entries, c.sessionManager.getLeafId()).messages));
		return { tokens, window: u.contextWindow, estimated: true };
	}

	function refresh() {
		refreshTimer = undefined;
		const c = ctx;
		if (!c) return;
		context = contextNow(c);
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
		if (enabled) refreshTimer ??= setTimeout(refresh, 0);
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
		if (!enabled) return;
		gitTimer = setTimeout(() => void refreshGit(), delayMs);
	}

	function animating(): boolean {
		return enabled && (runState === "run" || compacting);
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
		anim = gitTimer = refreshTimer = undefined;
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
		const window = context?.window ?? 0;
		const tokens = context?.tokens ?? null;
		const pct = tokens !== null && window > 0 ? (tokens / window) * 100 : null;
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
			// Only for models that can think; others have no level worth naming.
			thinking: model?.reasoning ? pi.getThinkingLevel() : undefined,
			state: prompts > 0 ? "you" : runState,
			hint: interrupt ? `${interrupt} to interrupt` : undefined,
			pct,
			estimated: pct !== null && context?.estimated ? true : undefined,
			next: growth && window > 0 ? (growth / window) * 100 : undefined,
			turns: turnsLeft(ends, tokens, window),
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
			private bottomKey = "";
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
				this.key = this.bottomKey = "";
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
				const base = `${width}|${lk.border}|${lk.diamond}|${JSON.stringify(v)}`;
				// The running light is only on the top border: the bottom is repainted per frame only while compaction sweeps it.
				const key = `${frame}|${base}`, bottomKey = lk.sweep ? key : base;
				if (th !== this.lastTheme) this.key = this.bottomKey = "";
				this.lastTheme = th;
				if (key !== this.key) {
					this.key = key;
					this.cached.top = paint(th, top(v, width, visibleWidth), lk);
					this.cached.side = th.fg(lk.border, "│");
				}
				if (bottomKey !== this.bottomKey) {
					this.bottomKey = bottomKey;
					this.cached.bottom = paint(th, bottom(v, width, visibleWidth), { ...lk, glow: undefined });
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
		if (c.mode !== "tui" || !enabled) return;
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
		editorFactory = (tui, theme, keybindings) => new Editor(tui, theme, keybindings);
		c.ui.setEditorComponent(editorFactory);
	}

	/** Hand the footer, editor and working row back to pi. */
	function uninstall(c: ExtensionContext) {
		if (c.mode !== "tui") return;
		c.ui.setFooter(undefined);
		// Leave another extension's editor alone.
		if (editorFactory && c.ui.getEditorComponent() === editorFactory) c.ui.setEditorComponent(undefined);
		editorFactory = undefined;
		c.ui.setWorkingVisible(true);
	}

	pi.registerCommand("runway", {
		description: "Toggle the runway frame (on | off)",
		getArgumentCompletions: (prefix) =>
			["on", "off"].filter((a) => a.startsWith(prefix.trim())).map((a) => ({ value: a, label: a })),
		handler: async (args, c) => {
			const arg = args.trim().toLowerCase();
			const want = arg === "on" ? true : arg === "off" ? false : !enabled;
			if (want === enabled) {
				c.ui.notify(`Runway is already ${enabled ? "on" : "off"}`, "info");
				return;
			}
			enabled = want;
			ctx = c;
			if (enabled) {
				gitRootKnown = false;
				install(c);
				refresh();
				syncAnimation();
			} else {
				stopTimers();
				uninstall(c);
			}
			c.ui.notify(enabled ? "Runway on" : "Runway off — pi's footer and editor restored", "info");
		},
	});

	pi.on("session_start", (_e, c) => {
		stopTimers();
		ctx = c;
		estimates.clear();
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
		refreshSoon();
	});

	pi.on("session_shutdown", () => {
		stopTimers();
		ctx = undefined;
	});
}
