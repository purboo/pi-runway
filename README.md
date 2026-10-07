# pi-runway

**One line. Zero config. Silent until it matters — then it tells you how many turns you have left.**

A footer for [pi](https://pi.dev) that replaces the built-in 2–3 line footer with a single line.

![pi-runway](design/preview.png)

```
 pi-footer  main*  ·  mcp 3            1m23s  ·  Opus 4.6 high  ·  ━━━━━━━━━━ 38%  ·  $0.46 +0.04
 pi-footer  main*                      Opus 4.6 high  ·  ━━━━━━━━━━ 78%  ≈4 turns left  ·  $1.20
                                                     └── yellow at 70%, red at 90%
```

## Install

```bash
pi install npm:pi-runway
```

There is nothing to configure.

## What it shows

| | |
|---|---|
| `pi-footer  main*` | Repo and subdirectory, plus the git branch. A yellow `*` means the working tree has changes. |
| `mcp 3` | Status text set by other extensions through `ctx.ui.setStatus()`. Several statuses collapse to `+N` when the line is too narrow. |
| `1m23s` | Elapsed time of the current run. Shown only while the agent is working. |
| `Opus 4.6 high` | Model (its human name, vendor prefix dropped) and thinking level. The thinking level is hidden when it is off. A routed virtual model is shown as `auto → model`. |
| `━━━━━━━━━━ 38%` | Context usage. The used part is lit, the rest is a faint track. |
| `≈4 turns left` | Estimated number of prompts left before the context window is full, based on how much the context grew over your last three prompts. Shown only at 70% or more. |
| `$0.46 +0.04` | Total session cost, plus what the current run has cost so far (only while it runs). Costs under a cent are hidden. Subscriptions show `sub`. |

## Design rules

- **One line.** It uses 1–2 fewer rows than the built-in footer, so more of the screen goes to the conversation.
- **Dark cockpit.** One bright anchor (the model). Values are muted, qualifiers dimmer, structure faint. Color appears only when something needs your attention.
- **No icons.** It uses only `*·━≈→`, so it does not need a Nerd Font.
- **Fixed-width numbers.** Changing values do not shift the rest of the layout.
- **Works with every provider.** Anything that only some providers report is left out, such as token breakdowns, cache hit rate, and tok/s.
- **Graceful when narrow.** Separators tighten → statuses collapse to `+N` → the path shortens to its last directory → the bar shrinks, then disappears → thinking level → branch → model name shortens, then disappears → path. Context usage and cost always stay.

## Development

```bash
bun install
bun run link-pi      # symlink the host-provided pi packages for type checking
bun run check        # tsc + bun test
pi -ne -e ./index.ts # try it in isolation
```
