#!/usr/bin/env python3
"""Make a synthetic (non-personal) test avatar and run it through ../tools/build_avatar.py."""
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw

here = os.path.dirname(os.path.abspath(__file__))
img = Image.new("RGB", (400, 400))
px = img.load()
for y in range(400):
    for x in range(400):
        px[x, y] = (x * 255 // 399, y * 255 // 399, 160)
ImageDraw.Draw(img).ellipse((100, 100, 300, 300), fill=(250, 200, 40))
with tempfile.TemporaryDirectory() as d:
    f = os.path.join(d, "sample.png")
    img.save(f)
    subprocess.check_call([sys.executable, os.path.join(here, "..", "tools", "build_avatar.py"), f, "--out", os.path.join(here, "sample-avatar.json")])
