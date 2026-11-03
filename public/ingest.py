#!/usr/bin/env python3
"""Turn the raw X tool results (files written by write_to_file) into the cache, without putting anything into the chat context.

  python3 ingest.py --tag 2026-11-03T04 c.en.all=/path/a.txt s.en.orig.1=/path/b.txt h.1=/path/c.txt ...

  c.<set>.<kind>        hourly counts          -> cache/counts_<TAG>.json   (also stores the exact queries)
  s.<set>.<kind>.<slot> sampled posts          -> cache/sample_<TAG>.json   (de-duplicated per stratum)
  h.<n>                 hot-post candidates    -> cache/tail_hot_<TAG>.json (keeps the 40 most viewed)

Safe to repeat: results are merged by id. Prints sample size, relative standard error and NEED_SLOT2 per stratum, and, once all counts are in,
the peak hour (the last hot step's arguments are written back into the plan). Exit codes: 0 ok, 2 bad input (unknown step, unreadable file, error result).
"""
import argparse
import datetime as dt
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import HERE, ISO, POST_FIELDS, die, dump_json, load_config, load_json, parse_tool_file  # noqa: E402


def trimmed_se(vals, cap_q=0.9):
    n = len(vals)
    if n < 2:
        return None, None
    v = sorted(vals)
    cap = v[min(n - 1, int(cap_q * n))]
    w = [min(x, cap) for x in v]
    mu = sum(w) / n
    sd = math.sqrt(sum((x - mu) ** 2 for x in w) / (n - 1))
    return mu, sd / math.sqrt(n) / max(mu, 1e-9)


def ingest(tag, pairs, cache):
    P = lambda name: os.path.join(cache, "%s_%s.json" % (name, tag))
    plan = load_json(P("plan"))
    if plan is None:
        die(2, "ingest: %s not found (run fetch_plan.py first)" % P("plan"))
    cfg = load_config(plan["config"] or None)
    counts = load_json(P("counts"), dict(window=plan["window"], fetched=None, q={}, queries={}))
    sample = load_json(P("sample"), {})
    hot = load_json(P("tail_hot"), [])
    seen_hot = {h["id"] for h in hot}
    for key in list(counts["q"]):  # archive the exact queries next to the numbers (also for caches written before queries were stored)
        counts.setdefault("queries", {}).setdefault(key, plan["queries"].get("c.%s.%s" % tuple(key.split("_", 1)), ""))
    known = {s["id"] for s in plan["steps"]}
    for pr in pairs:
        if "=" not in pr:
            die(2, "ingest: expected <step id>=<file>, got " + pr)
        sid, path = pr.split("=", 1)
        if sid not in known:
            die(2, "ingest: unknown step id " + sid)
        try:
            j = parse_tool_file(path)
        except (OSError, ValueError) as e:
            die(2, "ingest: cannot read %s: %s" % (path, e))
        if not isinstance(j, dict) or "data" not in j and "meta" not in j:
            die(2, "ingest: %s (%s) is not a data result: %s" % (sid, path, str(j)[:160]))
        kind = sid[0]
        if kind == "c":
            _, s, k = sid.split(".")
            counts["q"]["%s_%s" % (s, k)] = dict(buckets=[[b["start"][:19] + ".000Z", b["tweet_count"]] for b in j.get("data", [])], total=j["meta"]["total_tweet_count"])
            counts["queries"]["%s_%s" % (s, k)] = next(x for x in plan["steps"] if x["id"] == sid)["args"]["query"]
            counts["fetched"] = dt.datetime.now(dt.timezone.utc).strftime(ISO)
        elif kind == "s":
            _, s, k, slot = sid.split(".")
            L = sample.setdefault("%s_%s" % (s, k), [])
            have = {d["i"] for d in L}
            for p in j.get("data", []):
                if p["id"] in have:
                    continue
                m = p["public_metrics"]
                L.append(dict(i=p["id"], a=p["author_id"], t=p["created_at"], v=m["impression_count"], l=m["like_count"], r=m["reply_count"], rt=m["retweet_count"], q=m["quote_count"], b=m.get("bookmark_count", 0), slot=int(slot)))
        elif kind == "h":
            for p in j.get("data", []):
                if p["id"] in seen_hot:
                    continue
                m = p["public_metrics"]
                seen_hot.add(p["id"])
                hot.append(dict(id=p["id"], u=p["url"].split("/")[3] if p.get("url") else "?", t=p["created_at"], v=m["impression_count"], l=m["like_count"], r=m["reply_count"], text=p["text"], lang=p.get("lang")))
    hot = sorted(hot, key=lambda h: -h["v"])[:40]
    dump_json(P("counts"), counts)
    dump_json(P("sample"), sample, separators=(",", ":"))
    dump_json(P("tail_hot"), hot)
    # ---- report ----
    nsets = len(cfg["sets"])
    print("counts:", ", ".join("%s=%d" % (k, v["total"]) for k, v in sorted(counts["q"].items())) or "none", "(%d/%d)" % (len(counts["q"]), 4 * nsets))
    need = []
    for k, L in sorted(sample.items()):
        mu, rel = trimmed_se([d["v"] for d in L])
        if mu is None:
            print("sample %s: n=%d" % (k, len(L)))
            continue
        slots = len({d.get("slot", 1) for d in L})
        flag = "OK" if (rel <= cfg["budget"]["se_stop"] or slots >= 2) else "NEED_SLOT2"
        if flag != "OK":
            need.append(k)
        print("sample %s: n=%d slots=%d trimmed mean views=%.0f rel. SE=%.2f -> %s" % (k, len(L), slots, mu, rel, flag))
    if need:
        print("second slot needed:", " ".join("s.%s.2" % k.replace("_", ".") for k in need))
    if len(counts["q"]) >= 4 * nsets:
        W0 = dt.datetime.strptime(plan["window"][0], ISO)
        tot = [0] * 24
        for s in cfg["sets"]:
            for kk in ("orig", "reply", "quote"):
                dd = {b[0]: b[1] for b in counts["q"]["%s_%s" % (s["id"], kk)]["buckets"]}
                for i in range(24):
                    tot[i] += dd.get((W0 + dt.timedelta(hours=i)).strftime("%Y-%m-%dT%H:00:00.000Z"), 0)
        pi = max(range(24), key=lambda i: tot[i])
        ps = W0 + dt.timedelta(hours=pi)
        pe = ps + dt.timedelta(hours=1)
        last = plan["steps"][-1]
        s0 = cfg["sets"][0]
        last["args"] = dict(query="(%s) lang:%s -is:retweet -is:reply" % (s0["keywords"], s0["lang"]), start_time=ps.strftime(ISO), end_time=pe.strftime(ISO), max_results=25, sort_order="relevancy", **{"post.fields": POST_FIELDS})
        plan["queries"][last["id"]] = last["args"]["query"]
        dump_json(P("plan"), plan, indent=1)
        print("peak hour (UTC) %s-%s, %d posts; arguments of hot step %s written into the plan" % (ps.strftime("%H:00"), pe.strftime("%H:00"), tot[pi], last["id"]))
    print("hot candidates", len(hot))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--cache", default=os.path.join(HERE, "cache"))
    ap.add_argument("pairs", nargs="*")
    a = ap.parse_args(argv)
    ingest(a.tag, a.pairs, a.cache)


if __name__ == "__main__":
    main()
