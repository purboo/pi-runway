#!/usr/bin/env python3
"""Render footer style variants inside a pi-like frame → PNG for side-by-side comparison."""
import html, sys

W = 120
C = dict(text="#dcdde3", muted="#9c9fb3", dim="#7e8197", faint="#3f4250", border="#489287",
         warn="#e2c35a", err="#ec8a76", accent="#c39be6", bg="#16171d", green="#79c9a0")

def seg(t, c="muted"):
    return (t, c)

def line(left, right, width=W, pad=0):
    lw = sum(len(t) for t, _ in left)
    rw = sum(len(t) for t, _ in right)
    gap = width - 2 * pad - lw - rw
    return [(" " * pad, "dim")] + left + [(" " * max(1, gap), "dim")] + right + [(" " * pad, "dim")]

def sev(p):
    return "err" if p >= 90 else "warn" if p >= 70 else None

STATES = [
    dict(name="idle 2%", pct=2, running=False, cost=0.08, delta=0.03, turns=None, dirty=False, ext=[]),
    dict(name="running 41%", pct=41, running="1m23s", cost=0.46, delta=0.04, turns=None, dirty=True, ext=[("mcp 3", None)]),
    dict(name="tight 78%", pct=78, running=False, cost=1.20, delta=0.11, turns=4, dirty=True, ext=[("mcp 3", None)]),
    dict(name="danger 93%", pct=93, running=False, cost=1.38, delta=0.09, turns=1, dirty=True, ext=[]),
]

# ---------------- variants ----------------

def v_current(s):
    sv = sev(s["pct"])
    f = round(s["pct"] / 10)
    L = [seg("pi-footer"), seg(" (master", "dim")] + ([seg("*", "warn")] if s["dirty"] else []) + [seg(")", "dim")]
    for e, _ in s["ext"]:
        L += [seg("  "), seg(e.replace(" ", ":"), "dim")]
    R = []
    if s["running"]:
        R += [seg(s["running"]), seg("  ")]
    R += [seg("claude-sonnet-5-5"), seg(" medium", "dim"), seg("  "), seg("━" * f, sv or "muted"), seg("─" * (10 - f), "dim"),
          seg(" " + f"{s['pct']:>3}%", sv or "muted")]
    if sv:
        R += [seg(f" ≈{s['turns']} turn" + ("s" if s["turns"] != 1 else ""), sv)]
    R += [seg("  "), seg(f"${s['cost']:.2f}"), seg(f" +{s['delta']:.2f}", "dim")]
    return line(L, R)

DOT = ("  ·  ", "faint")

def join(groups, sep=DOT):
    out = []
    for i, g in enumerate(groups):
        if i:
            out.append(sep)
        out += g
    return out

def gauge_line(p, sv, n=10):
    """Heavy line, filled part colored, track faint: reads as a progress track, not a border."""
    f = max(1 if p > 0 else 0, round(p / 100 * n))
    return [seg("━" * f, sv or "muted"), seg("━" * (n - f), "faint")]

def gauge_blocks(p, sv, n=8):
    f = max(1 if p > 0 else 0, round(p / 100 * n))
    return [seg("▰" * f, sv or "muted"), seg("▱" * (n - f), "faint")]

def common(s, gauge, *, pad=1, pct_tone="text", delta_running_only=True, model="Sonnet 5.5", where_style="plain", model_tone="muted", sep=DOT, n=10):
    sv = sev(s["pct"])
    if where_style == "plain":
        where = [seg("pi-footer", "muted"), seg("  "), seg("master", "dim")] + ([seg("*", "warn")] if s["dirty"] else [])
    else:
        where = [seg("pi-footer", "muted"), seg(" on ", "faint"), seg("master", "dim")] + ([seg("*", "warn")] if s["dirty"] else [])
    L = join([where] + [[seg(e, "dim")] for e, _ in s["ext"]], sep)
    groups = []
    if s["running"]:
        groups.append([seg(s["running"], "muted")])
    groups.append([seg(model, model_tone), seg(" medium", "dim")])
    ctx = (gauge(s["pct"], sv, n) + [seg(" ")] if gauge else []) + [seg(f"{s['pct']}%", sv or pct_tone)]
    if sv:
        ctx += [seg(f"  ≈{s['turns']} turn" + ("s" if s["turns"] != 1 else "") + " left", sv)]
    groups.append(ctx)
    cost = [seg(f"${s['cost']:.2f}", "muted")]
    if s["running"] or not delta_running_only:
        cost += [seg(f" +{s['delta']:.2f}", "dim")]
    groups.append(cost)
    return line(L, join(groups, sep), pad=pad)

SEP1 = (" · ", "faint")
VARIANTS = [
    ("C · 细轨道（上一轮）", lambda s: common(s, gauge_line)),
    ("C1 · 模型名作锚点（亮），百分比 muted", lambda s: common(s, gauge_line, pct_tone="muted", model_tone="text")),
    ("C2 · 全部 muted，安静到底", lambda s: common(s, gauge_line, pct_tone="muted")),
    ("C3 · 紧凑分隔「 · 」+ 8 格轨道", lambda s: common(s, gauge_line, sep=SEP1, n=8)),
]

def frame(content):
    border = [("─" * W, "border")]
    return [border, [("> ", "text"), ("帮我把 footer 做得好看一点", "text")], border, content]

def render(spans):
    return "".join(f'<span style="color:{C[c]}">{html.escape(t)}</span>' for t, c in spans)

blocks = []
for title, fn in VARIANTS:
    rows = []
    for s in STATES:
        rows.append(f'<div class="tag">{s["name"]}</div><pre>{render(fn(s))}</pre>')
    blocks.append(f'<h2>{title}</h2><div class="term"><pre>{render(frame(None)[0])}</pre><pre>{render(frame(None)[1])}</pre><pre>{render(frame(None)[2])}</pre>' + "".join(rows) + "</div>")

doc = f"""<html><head><meta charset="utf-8"><style>
body{{background:#0e0f13;color:#ccc;font:14px sans-serif;padding:16px;margin:0;width:max-content}}
h2{{font-size:15px;color:{C['accent']};margin:18px 0 6px}}
.term{{background:{C['bg']};padding:10px 14px;border-radius:8px}}
pre{{margin:0;font:14px/1.45 'JetBrains Mono','DejaVu Sans Mono',monospace;white-space:pre}}
.tag{{font:11px sans-serif;color:#555a6a;margin-top:6px}}
</style></head><body>{''.join(blocks)}</body></html>"""
out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/variants.html"
open(out, "w").write(doc)

from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/chromium")
    pg = b.new_page(device_scale_factor=1.25, viewport={"width": 1300, "height": 800})
    pg.goto("file://" + out)
    pg.screenshot(path=out.replace(".html", ".png"), full_page=True)
    b.close()
print(out.replace(".html", ".png"))
