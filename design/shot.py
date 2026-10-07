#!/usr/bin/env python3
"""Screenshot a tmux pane: ANSI capture → HTML → PNG (headless chromium).

usage: shot.py <tmux-target> <out.png> [last_n_lines]
"""
import html, re, subprocess, sys

target, out = sys.argv[1], sys.argv[2]
last = int(sys.argv[3]) if len(sys.argv) > 3 else 0
raw = subprocess.run(["tmux", "capture-pane", "-t", target, "-p", "-e"], capture_output=True, text=True).stdout
lines = raw.rstrip("\n").split("\n")
if last:
    lines = lines[-last:]

BASE16 = ["#1d1f21", "#cc6666", "#b5bd68", "#f0c674", "#81a2be", "#b294bb", "#8abeb7", "#c5c8c6",
          "#666666", "#d54e53", "#b9ca4a", "#e7c547", "#7aa6da", "#c397d8", "#70c0b1", "#eaeaea"]

def xterm(n):
    if n < 16:
        return BASE16[n]
    if n < 232:
        n -= 16
        c = [0, 95, 135, 175, 215, 255]
        return "#%02x%02x%02x" % (c[n // 36], c[(n // 6) % 6], c[n % 6])
    v = 8 + (n - 232) * 10
    return "#%02x%02x%02x" % (v, v, v)

FG, BG = "#c5c8c6", "#16171d"

def convert(line):
    st = {"fg": None, "bg": None, "dim": False, "bold": False, "inv": False}
    out, pos = [], 0
    for m in re.finditer(r"\x1b\[([0-9;:]*)m|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)", line):
        out.append((line[pos:m.start()], dict(st)))
        pos = m.end()
        if m.group(1) is None:
            continue
        codes = [int(c) if c else 0 for c in re.split("[;:]", m.group(1))] or [0]
        i = 0
        while i < len(codes):
            c = codes[i]
            if c == 0: st.update(fg=None, bg=None, dim=False, bold=False, inv=False)
            elif c == 1: st["bold"] = True
            elif c == 2: st["dim"] = True
            elif c == 22: st.update(dim=False, bold=False)
            elif c == 7: st["inv"] = True
            elif c == 27: st["inv"] = False
            elif c == 39: st["fg"] = None
            elif c == 49: st["bg"] = None
            elif 30 <= c <= 37: st["fg"] = BASE16[c - 30]
            elif 90 <= c <= 97: st["fg"] = BASE16[c - 90 + 8]
            elif 40 <= c <= 47: st["bg"] = BASE16[c - 40]
            elif c in (38, 48):
                key = "fg" if c == 38 else "bg"
                if codes[i + 1] == 5:
                    st[key] = xterm(codes[i + 2]); i += 2
                elif codes[i + 1] == 2:
                    st[key] = "#%02x%02x%02x" % tuple(codes[i + 2:i + 5]); i += 4
            i += 1
    out.append((line[pos:], dict(st)))
    res = []
    for text, s in out:
        if not text:
            continue
        fg, bg = s["fg"] or FG, s["bg"]
        if s["inv"]:
            fg, bg = bg or BG, fg
        style = f"color:{fg};" + (f"background:{bg};" if bg else "") + ("opacity:.55;" if s["dim"] else "") + ("font-weight:bold;" if s["bold"] else "")
        res.append(f'<span style="{style}">{html.escape(text)}</span>')
    return "".join(res)

body = "\n".join(convert(l) for l in lines)
doc = f"""<html><body style="margin:0;background:{BG}"><pre style="margin:0;padding:14px 16px;font:15px/1.35 'JetBrains Mono','DejaVu Sans Mono',monospace;color:{FG};display:inline-block">{body}</pre></body></html>"""
open("/tmp/shot.html", "w").write(doc)

from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/chromium")
    pg = b.new_page(device_scale_factor=1.5)
    pg.goto("file:///tmp/shot.html")
    pg.locator("pre").screenshot(path=out)
    b.close()
print(out)
