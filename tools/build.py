#!/usr/bin/env python3
"""Build dist/x-pulse-replay.min.tsx from renderer/x-pulse-replay.tsx.

The minifier (tools/minify/minify.mjs, TypeScript 5 compiler API) strips comments and indentation and joins lines only where that is
provably safe. It never renames anything: every identifier, type and string is kept as written. The "BEGIN DATA" / "END DATA" markers are
kept. It self-checks that the token stream of the output equals the token stream of the input.

Needs: python3, node 18+, and `npm install` inside tools/minify (this script runs it if node_modules is missing).
Optional: with --typecheck it also runs tsc over the minified file (needs `npm install` inside tests/).

  python3 tools/build.py [--typecheck]
"""
import gzip
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "renderer", "x-pulse-replay.tsx")
OUT = os.path.join(ROOT, "dist", "x-pulse-replay.min.tsx")


def run(cmd, cwd):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(r.stdout + r.stderr)
        sys.exit(r.returncode)
    return r.stdout


def main():
    mdir = os.path.join(ROOT, "tools", "minify")
    if not os.path.isdir(os.path.join(mdir, "node_modules", "typescript")):
        run(["npm", "install", "--no-audit", "--no-fund"], mdir)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    run(["node", "minify.mjs", SRC, OUT], mdir)
    a = open(SRC, "rb").read()
    b = open(OUT, "rb").read()
    print("source   %7d bytes (%d gzip)" % (len(a), len(gzip.compress(a, 9))))
    print("minified %7d bytes (%d gzip)  -> %s" % (len(b), len(gzip.compress(b, 9)), os.path.relpath(OUT, ROOT)))
    if "--typecheck" in sys.argv:
        tdir = os.path.join(ROOT, "tests")
        os.makedirs(os.path.join(tdir, "src"), exist_ok=True)
        with open(os.path.join(tdir, "src", "replay.tsx"), "wb") as f:
            f.write(b)
        run([os.path.join(tdir, "node_modules", ".bin", "tsc"), "-p", "."], tdir)
        print("typecheck of the minified file: OK")


if __name__ == "__main__":
    main()
