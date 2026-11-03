#!/usr/bin/env python3
"""X Pulse (Public): turn the cache into the renderer's DATA and write the page file.

  python3 fill_public.py --tag 2026-11-03T04 [--config config.json] [--cache cache] [--out out]
                         [--renderer ../dist/x-pulse-replay.min.tsx] [--allow-missing-gloss]

Reads   cache/counts_<TAG>.json   hourly counts per keyword set and mutually exclusive kind (orig / reply / quote / all)
        cache/sample_<TAG>.json   stratified post samples (per-post metrics)
        cache/tail_hot_<TAG>.json hot candidates from X search; cache/db_hot_<TAG>.json optional frozen candidates; cache/gloss.json translations
        calibration.json          posts per poster / replies per commenter (measured, see calibrate_people.py)
Writes  out/data_<TAG>.json       the DATA object (aggregates, ~600-900 scaled sample dots, <= 8 real hot posts)
        out/page_<TAG>.tsx        the renderer with its DATA block replaced (this is what a Bot passes to WriteCanvas)
        out/summary_<TAG>.json    every number, range, queue of caveats and check, for the human report
Method (see README.md "Public edition"): retweets = all - orig - reply - quote per hour; views = trimmed (winsorised, p97.5) sample mean x post count per
stratum, range = p95-trimmed .. untrimmed; people = posts / measured posts-per-person; 1 dot = N posts (nice N, 600-900 dots); 1 comet = M people (~40).
Exit codes: 0 ok, 2 cache or config incomplete, 3 self-check failed, 4 gloss missing for a hot post (output is still written; --allow-missing-gloss makes it 0).
"""
import argparse
import datetime as dt
import hashlib
import json
import math
import os
import random
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import HERE, ISO, SLOT_KINDS, ConfigError, die, dump_json, load_config, load_json, nice_ceil, nice_near  # noqa: E402

KINDS = list(SLOT_KINDS)  # orig, reply, quote
MET = ["v", "l", "r", "rt", "q"]  # views, likes, replies, reposts, quotes of a sampled post
CJK = re.compile(r"[\u4e00-\u9fff]")
BEGIN, END = "// ===== BEGIN DATA =====", "// ===== END DATA ====="


class CacheError(Exception):
    pass


def winsor_cap(x, p):
    x = sorted(x)
    return x[min(len(x) - 1, int(p * len(x)))]


def winsor_mean(x, p):
    c = winsor_cap(x, p)
    return sum(min(v, c) for v in x) / len(x)


def check_cache(cfg, counts, sample):
    bad = []
    for s in cfg["sets"]:
        for k in ("all", "orig", "reply", "quote"):
            if "%s_%s" % (s["id"], k) not in counts.get("q", {}):
                bad.append("counts missing %s_%s" % (s["id"], k))
        for k in KINDS:
            if len(sample.get("%s_%s" % (s["id"], k), [])) < 25:
                bad.append("sample too small for %s_%s (< 25)" % (s["id"], k))
    return bad


def hourly(counts, key, w0):
    d = {b[0]: b[1] for b in counts["q"][key]["buckets"]}
    return [d.get((w0 + dt.timedelta(hours=i)).strftime("%Y-%m-%dT%H:00:00.000Z"), 0) for i in range(24)]


def clean_text(t):
    return re.sub(r"\s+", " ", re.sub(r"https?://\S+", "", t or "")).strip()


def title_of(t, n=56):
    return t if len(t) <= n else t[:n].rstrip() + "…"


def gloss_get(gl, pid):
    g = gl.get(pid)
    if isinstance(g, str):  # legacy gloss.json: Chinese only
        return {"zh": g}
    return g if isinstance(g, dict) else {}


def build(cfg, tag, cache, cal, w_renderer_ok=True):
    counts = load_json(os.path.join(cache, "counts_%s.json" % tag))
    sample = load_json(os.path.join(cache, "sample_%s.json" % tag))
    if counts is None or sample is None:
        raise CacheError("counts_%s.json / sample_%s.json not found in %s" % (tag, tag, cache))
    bad = check_cache(cfg, counts, sample)
    if bad:
        raise CacheError("cache incomplete:\n  " + "\n  ".join(bad))
    tail = load_json(os.path.join(cache, "tail_hot_%s.json" % tag), [])
    dbhot = load_json(os.path.join(cache, "db_hot_%s.json" % tag), [])
    gl = load_json(os.path.join(cache, "gloss.json"), {})
    sets = [s["id"] for s in cfg["sets"]]
    inj, hc = cfg["inject"], cfg["hot"]
    w0 = dt.datetime.strptime(counts["window"][0], ISO).replace(tzinfo=dt.timezone.utc)
    w1 = dt.datetime.strptime(counts["window"][1], ISO).replace(tzinfo=dt.timezone.utc)
    if (w1 - w0) != dt.timedelta(hours=24):
        raise CacheError("the window must be exactly 24 hours")
    rnd = random.Random(int(hashlib.sha256((tag + "|" + cfg["topic"]["name"]).encode()).hexdigest()[:12], 16))  # fixed per cache, so a rebuild is identical
    warnings = []

    # 1. hourly counts; retweets are the difference (all - orig - reply - quote), clamped at 0 and reported
    H, clamped = {}, 0
    for sid in sets:
        a, o, r, q = (hourly(counts, "%s_%s" % (sid, k), w0) for k in ("all", "orig", "reply", "quote"))
        rt = []
        for i in range(24):
            d = a[i] - o[i] - r[i] - q[i]
            if d < 0:
                clamped += 1
                d = 0
            rt.append(d)
        H[sid] = dict(orig=o, reply=r, quote=q, rt=rt)
    if clamped:
        warnings.append("retweet difference was negative in %d hour slots (clamped to 0)" % clamped)
    hk = {k: [sum(H[s][k][i] for s in sets) for i in range(24)] for k in KINDS + ["rt"]}
    tot = {k: sum(hk[k]) for k in KINDS + ["rt"]}
    posts_h = [sum(hk[k][i] for k in KINDS) for i in range(24)]
    n_posts = sum(posts_h)
    if n_posts <= 0:
        raise CacheError("no posts in the window")

    # 2. sample means -> totals (trimmed mean x count per stratum); range = p95-trimmed .. untrimmed
    def estimate(p):
        t = {m: {k: 0.0 for k in KINDS} for m in MET}
        for sid in sets:
            for k in KINDS:
                smp = sample["%s_%s" % (sid, k)]
                n = sum(H[sid][k])
                for m in MET:
                    t[m][k] += n * winsor_mean([d[m] for d in smp], p)
        return t

    EST, LOW, HIGH = estimate(inj["winsor_cap"]), estimate(0.95), estimate(1.0)
    views = sum(EST["v"].values())
    engagement = sum(EST[m][k] for m in ("l", "rt", "r", "q") for k in KINDS)

    # 3. people: measured ratios (calibration.json) or fixed config values
    pe = cfg["people"]
    if pe["source"] == "calibration" and cal:
        ppa, rpc = cal["posts_per_author"], cal["replies_per_commenter"]
        ci_pq, ci_rep = cal["kinds"]["pq"]["ci90"], cal["kinds"]["rep"]["ci90"]
        people_src = "calibration:%s" % cal.get("tag", "?")
    else:
        if pe["source"] == "calibration":
            warnings.append("calibration.json missing: fell back to the fixed people values in config")
        ppa, rpc, ci_pq, ci_rep, people_src = pe["posts_per_author"], pe["replies_per_commenter"], None, None, "fixed"
    pq_n, rep_n = tot["orig"] + tot["quote"], tot["reply"]
    posters, commenters = pq_n / ppa, rep_n / rpc
    # 90% interval from the calibration's bootstrap interval of the ratio (a larger ratio means fewer people)
    people_rng = None if ci_pq is None else dict(postersLow=round(pq_n / ci_pq[1]), postersHigh=round(pq_n / ci_pq[0]), commentersLow=round(rep_n / ci_rep[1]), commentersHigh=round(rep_n / ci_rep[0]))

    # 4. scaling: 1 dot = N posts, 1 comet = M people
    lo_n, hi_n = inj["nodes_range"]
    N = nice_ceil(n_posts / hi_n)
    M = max(1, nice_near(posters / inj["comets_target"]))
    if n_posts / N < lo_n:
        warnings.append("only %d dots (below %d): quiet window" % (round(n_posts / N), lo_n))
    cum = lambda arr: [0.0] + [float(sum(arr[: i + 1])) for i in range(24)]
    cpost = cum([hk["orig"][i] + hk["quote"][i] for i in range(24)])
    crep, crt = cum(hk["reply"]), cum(hk["rt"])
    srt = sorted(posts_h)
    tier = [min(4, srt.index(x) * 5 // 24) for x in posts_h]
    peak = max(range(24), key=lambda i: posts_h[i])

    # 5. hot posts: real posts (<= 8, >= min_gap apart), the peak-hour one first
    s0, s1 = counts["window"][0], counts["window"][1]
    cand, seen = [], set()
    for d, src in [(x, "db") for x in dbhot] + [(x, "x_search") for x in tail]:
        t = d["t"][:19] + "Z"
        if not (s0 <= t < s1) or d["id"] in seen or not d.get("v"):
            continue
        seen.add(d["id"])
        ts = (dt.datetime.strptime(t, ISO).replace(tzinfo=dt.timezone.utc) - w0).total_seconds()
        text = clean_text(d["text"])
        cand.append(dict(id=d["id"], u=d.get("u") or "?", ts=ts, v=int(d["v"]), l=int(d.get("l") or 0), r=int(d.get("r") or 0), kind=int(d.get("kind", 0)), text=text, src=src))
    cand.sort(key=lambda c: -c["v"])
    gap = hc["min_gap_h"] * 3600
    ok = [c for c in cand if 1800 <= c["ts"] <= 86400 - 900 and c["v"] >= hc["floor_views"] and len(c["text"]) >= 3]
    HOT = []
    pk = [c for c in ok if int(c["ts"] // 3600) == peak]
    if pk:
        HOT.append(pk[0])
    for c in ok:
        if len(HOT) >= hc["max"]:
            break
        if c not in HOT and all(abs(c["ts"] - h["ts"]) >= gap for h in HOT):
            HOT.append(c)
    HOT.sort(key=lambda c: c["ts"])
    gloss_missing = []
    hot_out = []
    for c in HOT:
        lang = "zh" if CJK.search(c["text"]) else "en"
        other = "en" if lang == "zh" else "zh"
        g = gloss_get(gl, c["id"])
        if not g.get(other):
            gloss_missing.append(dict(id=c["id"], lang=lang, need=other, text=c["text"]))
        hot_out.append(dict(id=c["id"], u=c["u"], ts=round(c["ts"]), v=c["v"], l=c["l"], r=c["r"], lang=lang, title=title_of(c["text"]),
                            gloss={other: g[other]} if g.get(other) else {}))

    # 6. synthetic dots: joint resampling of sampled posts per kind, scaled so the dots sum to the estimated totals
    def alloc(vals, total, d):
        q = [v / d for v in vals]
        f = [int(x) for x in q]
        rem = total - sum(f)
        for i in sorted(range(len(q)), key=lambda i: -(q[i] - f[i]))[: max(0, rem)]:
            f[i] += 1
        return f

    nodes = []
    for ki, k in enumerate(KINDS):
        K = alloc(hk[k], round(tot[k] / N), N)
        pool = []
        for sid in sets:
            smp = sample["%s_%s" % (sid, k)]
            w = sum(H[sid][k]) / max(1, tot[k])
            caps = {m: winsor_cap([d[m] for d in smp], inj["winsor_cap"]) for m in MET}
            for d in smp:
                pool.append((w / len(smp), {m: min(d[m], caps[m]) for m in MET}))
        ws = [p[0] for p in pool]
        for i in range(24):
            for j in range(K[i]):
                rec = rnd.choices(pool, weights=ws)[0][1]
                jit = math.exp(rnd.gauss(0, 0.22))
                nodes.append(dict(ts=(i + (j + rnd.random()) / K[i]) * 3600, kind=ki, **{m: rec[m] * jit for m in MET}))
    real_v = sum(c["v"] for c in HOT)
    for ki, k in enumerate(KINDS):
        for m in MET:
            target = EST[m][k] - (real_v if (m == "v" and ki == 0) else 0)
            cur = sum(n[m] for n in nodes if n["kind"] == ki) * N
            f = target / cur if cur > 0 and target > 0 else 1
            for n in nodes:
                if n["kind"] == ki:
                    n[m] *= f
    rows = [[round(n["ts"]), n["kind"], round(n["v"]), round(n["l"]), round(n["rt"]), round(n["r"]), round(n["q"]), None, None] for n in sorted(nodes, key=lambda n: n["ts"])]
    for c in HOT:
        rows.append([round(c["ts"]), c["kind"], c["v"], c["l"], 0, c["r"], 0, c["id"], "@%s %s" % (c["u"], title_of(c["text"], 30)) if c["u"] != "?" else title_of(c["text"], 30)])
    rows.sort(key=lambda r: r[0])

    # comets = posters, 1 per M people, spread over the hours by the share of original + quote posts
    P = round(posters / M)
    cp = [hk["orig"][i] + hk["quote"][i] for i in range(24)]
    dseg = alloc([c * (posters / sum(cp)) for c in cp], P, M) if sum(cp) > 0 and P > 0 else [0] * 24
    iso = lambda i: (w0 + dt.timedelta(hours=i)).strftime(ISO)
    segs = [dict(fromISO=iso(i), toISO=iso(i + 1), delta=dseg[i]) for i in range(24) if dseg[i] > 0]

    # 7. text for the sidebar (the only place with caveats)
    names = {"en": ("English", "英文"), "zh": ("Chinese", "中文")}
    langs = [s["lang"] for s in cfg["sets"]]
    scope = {"zh": " + ".join(names.get(l, (l, l))[1] for l in langs) + "关键词 · 不含转推的帖子", "en": " + ".join(names.get(l, (l, l))[0] for l in langs) + " keywords · original posts, replies and quotes (reposts counted separately)"}
    people_note_zh = "人数按实测的人均帖数折算，给出 90% 区间" if people_rng else "人数按固定的人均帖数折算"
    people_note_en = "people are scaled with a measured posts-per-person ratio and shown with a 90% range" if people_rng else "people are scaled with a fixed posts-per-person ratio"
    caveat = {"zh": "口径：帖量为 X 计数接口逐小时数据；浏览、互动为抽样均值折算的估算值；%s。" % people_note_zh,
              "en": "Method: post counts are X's hourly count API; views and engagement are estimates scaled from sample means; %s." % people_note_en}
    tzc = cfg["display_tz"]
    DATA = {
        "mode": "public", "lang": "zh", "example": False,
        "topic": {"name": cfg["topic"]["name"], "title": cfg["topic"].get("title") or {"zh": cfg["topic"]["name"], "en": cfg["topic"]["name"]}},
        "tz": {"iana": tzc["iana"], "label": tzc.get("label", tzc["iana"])},
        "window": {"startISO": counts["window"][0], "endISO": counts["window"][1], "tz": {"iana": tzc["iana"]}},
        "posts": rows,
        "followers": {"current": P, "delta": P, "baselineAt": None, "firstRun": False, "segments": segs},
        "footnotes": {"metricsFetchedAt": counts.get("fetched"), "retweetsExcluded": None, "extra": []},
        "pub": {
            "N": N, "M": M, "cardHours": hc["card_hours"],
            "hours": {"posts": posts_h, "reposts": hk["rt"], "tier": tier},
            "cum": {"posters": [round(posters * x / cpost[-1], 1) for x in cpost], "commenters": [round(commenters * x / crep[-1], 1) for x in crep], "reposts": [int(x) for x in crt]},
            "totals": {"orig": tot["orig"], "reply": tot["reply"], "quote": tot["quote"], "reposts": tot["rt"], "views": round(views), "viewsLow": round(sum(LOW["v"].values())),
                       "viewsHigh": round(sum(HIGH["v"].values())), "engagement": round(engagement), "posters": round(posters), "commenters": round(commenters), **(people_rng or {})},
            "hot": hot_out, "scope": scope, "caveat": caveat,
        },
    }
    summary = dict(
        tag=tag, window_utc=counts["window"], fetched=counts.get("fetched"), topic=cfg["topic"]["name"], totals=DATA["pub"]["totals"],
        retweet_clamped_slots=clamped, ratios=dict(posts_per_author=ppa, replies_per_commenter=rpc, source=people_src, ci90_posts_per_author=ci_pq, ci90_replies_per_commenter=ci_rep),
        peak=dict(hour_index=peak, posts=posts_h[peak], start_utc=iso(peak)), inject=dict(N=N, M=M, dots=len(rows) - len(HOT), hot=len(HOT), comets=P, data_bytes=0),
        hot=[dict(h, src=next(c["src"] for c in HOT if c["id"] == h["id"])) for h in hot_out], gloss_missing=gloss_missing, warnings=warnings,
        queries=counts.get("queries", {}), sample_n={k: len(v) for k, v in sorted(sample.items())},
    )
    return DATA, summary


def self_check(DATA, cfg):
    """Cheap invariants of the injected data; returns a list of problems."""
    bad = []
    p, rows = DATA["pub"], DATA["posts"]
    lo, hi = cfg["inject"]["nodes_range"]
    dots = [r for r in rows if r[7] is None]
    if len(dots) > hi:
        bad.append("%d dots > %d" % (len(dots), hi))
    if len(p["hot"]) > cfg["hot"]["max"]:
        bad.append("too many hot posts")
    hs = sorted(h["ts"] for h in p["hot"])
    if any(b - a < cfg["hot"]["min_gap_h"] * 3600 - 1 for a, b in zip(hs, hs[1:])):
        bad.append("hot posts closer than the minimum gap")
    for key, n in (("posts", 24), ("reposts", 24), ("tier", 24)):
        if len(p["hours"][key]) != n:
            bad.append("hours.%s must have %d values" % (key, n))
    for key in ("posters", "commenters", "reposts"):
        c = p["cum"][key]
        if len(c) != 25 or any(b < a for a, b in zip(c, c[1:])):
            bad.append("cum.%s must be 25 non-decreasing values" % key)
    for r in rows:
        if not (0 <= r[0] <= 86400) or any(isinstance(x, float) and not math.isfinite(x) for x in r):
            bad.append("bad row %s" % (r,))
            break
    t = p["totals"]
    if sum(p["hours"]["posts"]) != t["orig"] + t["reply"] + t["quote"]:
        bad.append("hourly posts do not add up to the totals")
    if not (t["viewsLow"] <= t["views"] <= t["viewsHigh"] * 1.0001):
        bad.append("views outside its range")
    if DATA["followers"]["delta"] != sum(s["delta"] for s in DATA["followers"]["segments"]):
        bad.append("comet segments do not add up")
    return bad


def page_text(renderer_path, DATA):
    r = open(renderer_path, encoding="utf8").read()
    a, b = r.find(BEGIN), r.find(END)
    if a < 0 or b < a:
        raise CacheError("renderer %s has no BEGIN/END DATA markers" % renderer_path)
    return r[: a + len(BEGIN)] + "\nconst DATA: Data = " + json.dumps(DATA, ensure_ascii=False, separators=(",", ":")) + ";\n" + r[b:]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--config", default=os.path.join(HERE, "config.json"))
    ap.add_argument("--cache", default=os.path.join(HERE, "cache"))
    ap.add_argument("--out", default=os.path.join(HERE, "out"))
    ap.add_argument("--calibration", default=os.path.join(HERE, "calibration.json"))
    ap.add_argument("--renderer", default=os.path.join(HERE, "..", "dist", "x-pulse-replay.min.tsx"))
    ap.add_argument("--allow-missing-gloss", action="store_true")
    a = ap.parse_args(argv)
    try:
        cfg = load_config(a.config)
        DATA, summary = build(cfg, a.tag, a.cache, load_json(a.calibration))
        bad = self_check(DATA, cfg)
        if bad:
            die(3, "self-check failed:\n  " + "\n  ".join(bad))
        page = page_text(a.renderer, DATA)
    except (ConfigError, CacheError, OSError, json.JSONDecodeError) as e:
        die(2, "fill_public: %s" % e)
    summary["inject"]["data_bytes"] = len(json.dumps(DATA, ensure_ascii=False, separators=(",", ":")).encode())
    os.makedirs(a.out, exist_ok=True)
    dump_json(os.path.join(a.out, "data_%s.json" % a.tag), DATA, separators=(",", ":"))
    dump_json(os.path.join(a.out, "summary_%s.json" % a.tag), summary, indent=1)
    with open(os.path.join(a.out, "page_%s.tsx" % a.tag), "w", encoding="utf8") as f:
        f.write(page)
    t = summary["totals"]
    print("window %s -> %s | posts %d (orig %d, reply %d, quote %d) reposts %d" % (summary["window_utc"][0], summary["window_utc"][1], t["orig"] + t["reply"] + t["quote"], t["orig"], t["reply"], t["quote"], t["reposts"]))
    print("views %d (%d..%d) engagement %d posters %d commenters %d | ratios %s" % (t["views"], t["viewsLow"], t["viewsHigh"], t["engagement"], t["posters"], t["commenters"], json.dumps(summary["ratios"])))
    print("inject: %s" % json.dumps(summary["inject"]))
    for h in summary["hot"]:
        print("  hot %6ds %-14s %8d %-8s %s%s" % (h["ts"], h["u"], h["v"], h["src"], h["title"][:48], "" if h["gloss"] else "  [no gloss needed or missing]"))
    for w in summary["warnings"]:
        print("warning:", w)
    if summary["gloss_missing"]:
        for g in summary["gloss_missing"]:
            print("MISSING gloss (%s): %s %s" % (g["need"], g["id"], g["text"][:100]))
        if not a.allow_missing_gloss:
            sys.exit(4)


if __name__ == "__main__":
    main()
