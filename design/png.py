#!/usr/bin/env python3
"""Screenshot an HTML file → PNG with headless chromium. usage: png.py [in.html] [out.png]"""
import os, sys
from playwright.sync_api import sync_playwright

here = os.path.dirname(os.path.abspath(__file__))
src = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(here, "preview.html")
out = sys.argv[2] if len(sys.argv) > 2 else src.replace(".html", ".png")
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/chromium")
    pg = b.new_page(device_scale_factor=1.25, viewport={"width": 1200, "height": 600})
    pg.goto("file://" + src)
    pg.screenshot(path=out, full_page=True)
    b.close()
print(out)
