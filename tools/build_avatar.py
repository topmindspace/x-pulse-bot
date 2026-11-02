#!/usr/bin/env python3
"""Turn a profile image (URL or local file) into the compact avatar block used by X Pulse.

Output (JSON on stdout, or --out FILE):
    {"size": 96, "palette": "<base64>", "indices": "<base64>"}

* palette: colour table, 3 bytes (R, G, B) per colour, at most --colors entries (default 64)
* indices: size*size bytes, one palette index per pixel, row-major (top-left first)

The renderer decodes this with atob() and draws it through ImageData, so the page never loads an
image URL. Paste the JSON object into DATA.avatar, or use null when there is no image.

Usage:
    python3 build_avatar.py https://pbs.twimg.com/profile_images/.../abc_normal.jpg
    python3 build_avatar.py ./me.png --size 96 --colors 64 --out avatar.json

Needs Pillow:  pip install pillow
"""
import argparse
import base64
import io
import json
import re
import sys
import urllib.request

MAX_BYTES = 8 * 1024 * 1024


def load_bytes(src: str) -> bytes:
    if re.match(r"^https?://", src):
        if not src.startswith("https://"):
            raise SystemExit("only https:// image URLs are accepted")
        # X serves a 48x48 "_normal" thumbnail by default; ask for the 400x400 version instead.
        src = re.sub(r"_(normal|bigger|mini)(\.[A-Za-z0-9]+)$", r"_400x400\2", src)
        req = urllib.request.Request(src, headers={"User-Agent": "x-pulse-build-avatar/1.0"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = resp.read(MAX_BYTES + 1)
    else:
        with open(src, "rb") as fh:
            data = fh.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise SystemExit("image is larger than 8 MB")
    return data


def build(data: bytes, size: int, colors: int) -> dict:
    from PIL import Image

    if not 8 <= size <= 256:
        raise SystemExit("--size must be between 8 and 256")
    if not 2 <= colors <= 256:
        raise SystemExit("--colors must be between 2 and 256")
    img = Image.open(io.BytesIO(data))
    img.load()
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGBA", img.size, (11, 15, 25, 255))  # flatten transparency onto the page's dark background
        img = Image.alpha_composite(bg, img)
    img = img.convert("RGB")
    w, h = img.size
    side = min(w, h)  # centre square crop
    left, top = (w - side) // 2, (h - side) // 2
    img = img.crop((left, top, left + side, top + side)).resize((size, size), Image.LANCZOS)
    q = img.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    pal = (q.getpalette() or [])[: colors * 3]
    idx = q.tobytes()  # mode "P": one palette index per pixel
    pal = pal[: (max(idx) + 1) * 3]  # drop unused colour slots
    return {
        "size": size,
        "palette": base64.b64encode(bytes(pal)).decode("ascii"),
        "indices": base64.b64encode(idx).decode("ascii"),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", help="https image URL (X profile_image_url) or a local image file")
    ap.add_argument("--size", type=int, default=96)
    ap.add_argument("--colors", type=int, default=64)
    ap.add_argument("--out", help="write the JSON here instead of stdout")
    args = ap.parse_args()
    try:
        result = build(load_bytes(args.source), args.size, args.colors)
    except ImportError:
        raise SystemExit("Pillow is required: pip install pillow")
    except OSError as err:  # network errors, missing file, unreadable image
        raise SystemExit("could not read the image: %s" % err)
    text = json.dumps(result, separators=(",", ":"))
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
        print("wrote %s (%d bytes, palette %d colours)" % (args.out, len(text), len(base64.b64decode(result["palette"])) // 3), file=sys.stderr)
    else:
        print(text)


if __name__ == "__main__":
    main()
