/**
 * Live skin comparison inside a real pi, using your actual theme.
 *   pi -ne --no-session -e ./design/demo.ts
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { layout, type View } from "../src/render.ts";
import { SKINS, tokenFor } from "../src/skin.ts";

const base: View = {
	path: "pi-things/pi-footer",
	base: "pi-footer",
	branch: "main",
	dirty: false,
	statuses: [],
	model: "Sonnet 4.5",
	thinking: "medium",
	ctxPercent: 12,
	cost: 0.08,
	delta: 0,
	sub: false,
	phase: "idle",
	elapsedMs: 0,
};
const states: Partial<View>[] = [
	{},
	{ phase: "running", elapsedMs: 83_000, ctxPercent: 41, cost: 0.46, delta: 0.04, dirty: true, statuses: ["mcp 3"], thinking: "high" },
	{ ctxPercent: 78, turnsLeft: 4, cost: 1.2, dirty: true, thinking: "low" },
	{ ctxPercent: 93, turnsLeft: 1, cost: 1.38, dirty: true, model: "auto", routed: "Opus 4.6", thinking: "xhigh" },
];

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_e, ctx) => {
		ctx.ui.setFooter((_tui, theme) => ({
			invalidate() {},
			render(width: number) {
				const out: string[] = [];
				for (const [name, skin] of Object.entries(SKINS)) {
					out.push("", theme.fg("accent", ` ${name}`));
					for (const s of states) {
						const line = layout({ ...base, ...s }, width, visibleWidth, { faintDistinct: true })
							.map((seg) => {
								const t = tokenFor(seg, skin);
								return t ? theme.fg(t, seg.text) : seg.text;
							})
							.join("");
						out.push(truncateToWidth(line, width));
					}
				}
				return out;
			},
		}));
	});
}
