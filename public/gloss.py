#!/usr/bin/env python3
"""Fill cache/gloss.json with translations for hot posts that need one (an English post needs a Chinese line and vice versa), so the page reads
well in both languages. gloss.json maps post id -> { "zh": "...", "en": "..." } (old files with a plain Chinese string still work).

  python3 gloss.py --tag 2026-11-03T04        # reads out/summary_<TAG>.json (written by fill_public.py)

Order of work: (1) a local `pi -p` translator when installed, (2) otherwise the missing ids and texts are printed as MISSING and the exit code is 4:
the Bot then translates them itself in ONE pass (<= 8 short lines), writes them into cache/gloss.json and re-runs fill_public.py.
Exit codes: 0 nothing missing, 4 something is still missing.
"""
import argparse
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import HERE, dump_json, die, load_json  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--cache", default=os.path.join(HERE, "cache"))
    ap.add_argument("--out", default=os.path.join(HERE, "out"))
    a = ap.parse_args(argv)
    summ = load_json(os.path.join(a.out, "summary_%s.json" % a.tag))
    if summ is None:
        die(2, "gloss: run fill_public.py first (out/summary_%s.json missing)" % a.tag)
    path = os.path.join(a.cache, "gloss.json")
    g = load_json(path, {})
    for k, v in list(g.items()):
        if isinstance(v, str):
            g[k] = {"zh": v}
    left = 0
    for m in summ["gloss_missing"]:
        prompt = {"zh": "Translate this post into concise, natural Chinese. Output only the translation:\n", "en": "Translate this post into concise, natural English. Output only the translation:\n"}[m["need"]] + m["text"]
        try:
            o = subprocess.run(["pi", "-p", prompt], capture_output=True, text=True, timeout=120)
            if o.returncode == 0 and o.stdout.strip():
                g.setdefault(m["id"], {})[m["need"]] = o.stdout.strip()
                continue
        except (OSError, subprocess.SubprocessError):
            pass
        left += 1
        print("MISSING", m["need"], m["id"], m["text"][:200])
    dump_json(path, g, indent=1)
    print("gloss ok" if not left else "%d hot post(s) still need a translation (see MISSING)" % left)
    sys.exit(4 if left else 0)


if __name__ == "__main__":
    main()
