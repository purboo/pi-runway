/**
 * Role → theme token. Only tokens every pi theme defines, so colors always come from the user's theme.
 */
import type { Role, Seg } from "./render.ts";

export type Token =
	| "text"
	| "muted"
	| "dim"
	| "accent"
	| "success"
	| "warning"
	| "error"
	| "border"
	| "borderAccent"
	| "borderMuted"
	| "mdLink"
	| "syntaxString"
	| "syntaxKeyword"
	| "scrollbarTrack"
	| "thinkingOff"
	| "thinkingMinimal"
	| "thinkingLow"
	| "thinkingMedium"
	| "thinkingHigh"
	| "thinkingXhigh"
	| "thinkingMax";

export type Skin = Record<Role, Token | "thinking">;

const THINKING: Record<string, Token> = {
	off: "thinkingOff",
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
	max: "thinkingMax",
};

export const SKINS = {
	/** v2: grays only, the model is the single bright anchor. */
	quiet: {
		path: "muted",
		branch: "dim",
		dirty: "warning",
		status: "dim",
		elapsed: "muted",
		model: "text",
		via: "dim",
		thinking: "dim",
		fill: "muted",
		track: "scrollbarTrack",
		pct: "muted",
		turns: "muted",
		cost: "muted",
		delta: "dim",
		sep: "scrollbarTrack",
	},
	/** Every element gets its natural color; thinking level uses the same color pi gives the editor border. */
	vivid: {
		path: "text",
		branch: "accent",
		dirty: "warning",
		status: "dim",
		elapsed: "mdLink",
		model: "text",
		via: "dim",
		thinking: "thinking",
		fill: "success",
		track: "scrollbarTrack",
		pct: "success",
		turns: "muted",
		cost: "syntaxString",
		delta: "dim",
		sep: "scrollbarTrack",
	},
	/** Gray base, accent on the two things you scan for: who is working, and how much room is left. */
	accent: {
		path: "text",
		branch: "muted",
		dirty: "warning",
		status: "dim",
		elapsed: "muted",
		model: "accent",
		via: "dim",
		thinking: "thinking",
		fill: "accent",
		track: "scrollbarTrack",
		pct: "text",
		turns: "muted",
		cost: "muted",
		delta: "dim",
		sep: "scrollbarTrack",
	},
} satisfies Record<string, Skin>;

export type SkinName = keyof typeof SKINS;
export const DEFAULT_SKIN: SkinName = "vivid";

/** Theme token for a segment, or undefined for text that passes through unstyled. */
export function tokenFor(seg: Seg, skin: Skin): Token | undefined {
	if (seg.alert) return seg.alert;
	if (!seg.role) return undefined;
	const t = skin[seg.role];
	if (t === "thinking") return THINKING[seg.text.trim()] ?? "dim";
	return t;
}
