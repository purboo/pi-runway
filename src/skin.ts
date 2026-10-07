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
	| "mdLink"
	| "syntaxString"
	| "scrollbarTrack"
	| "thinkingOff"
	| "thinkingMinimal"
	| "thinkingLow"
	| "thinkingMedium"
	| "thinkingHigh"
	| "thinkingXhigh"
	| "thinkingMax";

/** `thinking` = the color pi gives the editor border for that thinking level. */
export const SKIN: Record<Role, Token | "thinking"> = {
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
	note: "muted",
	cost: "syntaxString",
	delta: "dim",
	sep: "scrollbarTrack",
};

const THINKING: Record<string, Token> = {
	off: "thinkingOff",
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
	max: "thinkingMax",
};

/** Theme token for a segment, or undefined for text that passes through unstyled. Alerts win over roles. */
export function tokenFor(seg: Seg): Token | undefined {
	if (seg.alert) return seg.alert;
	if (!seg.role) return undefined;
	const t = SKIN[seg.role];
	return t === "thinking" ? (THINKING[seg.text] ?? "dim") : t;
}
