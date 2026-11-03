"""Synthetic cache for the X Pulse (Public) tests (no real posts, no network).

  python3 pubfix.py <outdir> [tag]     writes <outdir>/cache/*, <outdir>/config.json and runs ../public/fill_public.py -> <outdir>/out/
"""
import datetime as dt
import json
import os
import random
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(HERE, "..", "public")
TAG = "2026-11-03T04"
ISO = "%Y-%m-%dT%H:%M:%S.000Z"


def make_cache(root, tag=TAG, seed=7, hot=True, retweet_negative=False, small_sample=False):
    rnd = random.Random(seed)
    cache = os.path.join(root, "cache")
    os.makedirs(cache, exist_ok=True)
    w1 = dt.datetime.strptime(tag, "%Y-%m-%dT%H").replace(tzinfo=dt.timezone.utc)
    w0 = w1 - dt.timedelta(hours=24)
    q = {}
    for sid, base in (("en", 4000), ("zh", 1500)):
        kinds = {"orig": [], "reply": [], "quote": [], "all": []}
        for i in range(24):
            t = (w0 + dt.timedelta(hours=i)).strftime(ISO)
            f = 1 + 0.6 * (1 if 8 <= i <= 14 else 0)
            o, r, qq = int(base * 0.2 * f), int(base * 0.75 * f), int(base * 0.05 * f)
            rt = int(base * 0.5 * f)
            a = o + r + qq + (rt if not (retweet_negative and i == 3) else -50)
            for k, v in (("orig", o), ("reply", r), ("quote", qq), ("all", a)):
                kinds[k].append([t, v])
        for k, b in kinds.items():
            q["%s_%s" % (sid, k)] = {"buckets": b}
    counts = {"window": [w0.strftime("%Y-%m-%dT%H:%M:%SZ"), w1.strftime("%Y-%m-%dT%H:%M:%SZ")], "fetched": (w1 + dt.timedelta(minutes=45)).strftime("%Y-%m-%dT%H:%M:%SZ"), "queries": sorted(q), "q": q}
    sample = {}
    for sid in ("en", "zh"):
        for k in ("orig", "reply", "quote"):
            n = 10 if small_sample else 40
            sample["%s_%s" % (sid, k)] = [
                {"a": str(1000 + rnd.randrange(60)), "t": (w0 + dt.timedelta(seconds=rnd.randrange(86400))).strftime(ISO), "v": int(rnd.paretovariate(1.2) * 80), "l": rnd.randrange(30), "r": rnd.randrange(5), "rt": rnd.randrange(6), "q": rnd.randrange(3), "b": rnd.randrange(3)}
                for _ in range(n)
            ]
    tail = []
    if hot:
        tail = [
            {"id": "9000000000000000001", "u": "alice", "t": (w0 + dt.timedelta(hours=3)).strftime(ISO), "v": 900000, "l": 4000, "r": 300, "text": "AI agents are shipping fast https://t.co/x", "lang": "en"},
            {"id": "9000000000000000002", "u": "bob", "t": (w0 + dt.timedelta(hours=9)).strftime(ISO), "v": 500000, "l": 2000, "r": 100, "text": "大模型新进展，AI 圈今天很热闹", "lang": "zh"},
            {"id": "9000000000000000003", "u": "carol", "t": (w0 + dt.timedelta(hours=15)).strftime(ISO), "v": 700000, "l": 3000, "r": 200, "text": "Another AI model release", "lang": "en"},
            {"id": "9000000000000000004", "u": "dave", "t": (w0 + dt.timedelta(hours=16)).strftime(ISO), "v": 100000, "l": 300, "r": 20, "text": "gardening tips for spring", "lang": "en"},
        ]
    def dump(name, obj):
        with open(os.path.join(cache, name), "w", encoding="utf8") as f:
            json.dump(obj, f, ensure_ascii=False)
    dump("counts_%s.json" % tag, counts)
    dump("sample_%s.json" % tag, sample)
    dump("tail_hot_%s.json" % tag, tail)
    cfg = json.load(open(os.path.join(PUB, "config.json"), encoding="utf8"))
    cfg["topic"] = {"name": "AI", "title": {"zh": "AI 圈", "en": "AI"}}
    with open(os.path.join(root, "config.json"), "w", encoding="utf8") as f:
        json.dump(cfg, f, ensure_ascii=False)
    return cache


def gloss(root, items):
    with open(os.path.join(root, "cache", "gloss.json"), "w", encoding="utf8") as f:
        json.dump(items, f, ensure_ascii=False)


FULL_GLOSS = {
    "9000000000000000001": {"zh": "AI 智能体发布得很快"},
    "9000000000000000002": {"en": "Big model news; the AI scene is busy today"},
    "9000000000000000003": {"zh": "又一个 AI 模型发布"},
}


def fill(root, tag=TAG, *extra, renderer=None):
    cmd = [sys.executable, os.path.join(PUB, "fill_public.py"), "--tag", tag, "--config", os.path.join(root, "config.json"), "--cache", os.path.join(root, "cache"), "--out", os.path.join(root, "out"), "--calibration", os.path.join(PUB, "calibration.json")]
    if renderer:
        cmd += ["--renderer", renderer]
    return subprocess.run(cmd + list(extra), capture_output=True, text=True)


if __name__ == "__main__":
    out = os.path.abspath(sys.argv[1])
    tag = sys.argv[2] if len(sys.argv) > 2 else TAG
    make_cache(out, tag)
    gloss(out, FULL_GLOSS)
    r = fill(out, tag)
    sys.stdout.write(r.stdout + r.stderr)
    sys.exit(r.returncode)
