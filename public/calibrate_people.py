#!/usr/bin/env python3
"""Calibrate the people ratios (posts per poster, replies per commenter) from X itself, instead of from any tracked accounts.

Why: the number of distinct posters is posts / (posts per poster). Tracked accounts are power users, so their ratio (1.3 posts per poster, 3.0
replies per commenter in the first version) is not the population's. Here the ratio comes from authors of a random post sample:

  A post drawn at random belongs to author i with probability n_i / N (n_i = that author's matching posts in the window, N = all posts), so
  E[1 / n_i] over sampled posts = (number of distinct authors) / N.  Hence  posts per person = 1 / mean(1 / n_i).
  Heavy posters (bots, 100+ replies a day) are thus weighted correctly and barely move the mean of 1/n_i.

Steps (about 20 count calls, one-time; the result lives in calibration.json and is reused by every run):
  python3 calibrate_people.py plan   --tag T [--per 5]     writes cache/calib_<T>.json (the queries to run: counts, granularity=day)
  python3 calibrate_people.py ingest --tag T id=file ...   stores the raw counts
  python3 calibrate_people.py compute --tag T [--write]    prints the estimate with a bootstrap 90% interval; --write updates calibration.json
Exit codes: 0 ok, 2 bad input.
"""
import argparse
import datetime as dt
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import FILTERS, HERE, die, dump_json, load_config, load_json, parse_tool_file  # noqa: E402

KIND_STRATA = {"pq": ("orig", "quote"), "rep": ("reply",)}
KIND_FILTER = {"pq": "-is:retweet -is:reply", "rep": "is:reply -is:retweet"}


def per_person(ns):
    inv = [1.0 / max(1, n) for n in ns]
    return len(inv) / sum(inv), sum(inv) / len(inv)


def bootstrap(ns, B=4000, seed=1):
    rnd = random.Random(seed)
    est = sorted(per_person([rnd.choice(ns) for _ in ns])[0] for _ in range(B))
    return est[int(0.05 * B)], est[int(0.95 * B)]


def plan(tag, cfg, cache, per):
    sample = load_json(os.path.join(cache, "sample_%s.json" % tag))
    pl = load_json(os.path.join(cache, "plan_%s.json" % tag))
    if sample is None or pl is None:
        die(2, "calibrate_people: sample/plan for %s missing" % tag)
    items = []
    for kind, strata in KIND_STRATA.items():
        for s in cfg["sets"]:
            pool, seen = [], set()
            for st in strata:
                for d in sample.get("%s_%s" % (s["id"], st), []):
                    if d["a"] not in seen:
                        seen.add(d["a"])
                        pool.append(d["a"])
            if len(pool) < per:
                die(2, "calibrate_people: only %d distinct %s/%s authors in the sample" % (len(pool), s["id"], kind))
            picks = [pool[int((i + 0.5) * len(pool) / per)] for i in range(per)]  # evenly spaced through the sample, deterministic
            for aid in picks:
                items.append(dict(id="%s.%s.%s" % (kind, s["id"], aid),
                                  args=dict(query="(%s) lang:%s from:%s %s" % (s["keywords"], s["lang"], aid, KIND_FILTER[kind]), start_time=pl["window"][0], end_time=pl["window"][1], granularity="day"),
                                  query="(%s) lang:%s from:%s %s" % (s["keywords"], s["lang"], aid, KIND_FILTER[kind])))
    dump_json(os.path.join(cache, "calib_%s.json" % tag), dict(tag=tag, window=pl["window"], tool="get_posts_counts_recent", items=items, counts={}), indent=1)
    print("%d count calls planned (tool get_posts_counts_recent, granularity day); ids:" % len(items))
    for x in items:
        print(" ", x["id"])


def ingest(tag, cache, pairs):
    f = os.path.join(cache, "calib_%s.json" % tag)
    c = load_json(f)
    if c is None:
        die(2, "calibrate_people: run plan first")
    ids = {x["id"] for x in c["items"]}
    for pr in pairs:
        sid, path = pr.split("=", 1)
        if sid not in ids:
            die(2, "unknown id " + sid)
        c["counts"][sid] = int(parse_tool_file(path)["meta"]["total_tweet_count"])
    dump_json(f, c, indent=1)
    print("%d/%d counts stored" % (len(c["counts"]), len(ids)))


def compute(tag, cache, write):
    c = load_json(os.path.join(cache, "calib_%s.json" % tag))
    if c is None or not c["counts"]:
        die(2, "calibrate_people: no counts stored")
    out = {}
    for kind in KIND_STRATA:
        ns = [n for k, n in c["counts"].items() if k.split(".")[0] == kind]
        if len(ns) < 6:
            die(2, "calibrate_people: only %d %s counts (need >= 6)" % (len(ns), kind))
        pp, mean_inv = per_person(ns)
        lo, hi = bootstrap([max(1, n) for n in ns])
        out[kind] = dict(n_authors=len(ns), counts=ns, mean_inverse=round(mean_inv, 4), per_person=round(pp, 3), ci90=[round(lo, 2), round(hi, 2)],
                         zero_counts=sum(1 for n in ns if n == 0))
        print("%s: authors=%d  posts per person=%.2f  90%% interval %.2f..%.2f  (counts %s)" % (kind, len(ns), pp, lo, hi, sorted(ns)))
    if write:
        res = dict(version=1, calibrated=dt.date.today().isoformat(), tag=tag, window=c["window"], topic_keywords="see config.sets",
                   method="posts per person = 1 / mean(1/n_i) over authors of randomly sampled posts; n_i = that author's matching posts in the window (count API, granularity day); zero counts are treated as 1",
                   posts_per_author=round(out["pq"]["per_person"], 1), replies_per_commenter=round(out["rep"]["per_person"], 1), kinds=out)
        dump_json(os.path.join(HERE, "calibration.json"), res, indent=1)
        print("wrote calibration.json: posts_per_author=%.1f replies_per_commenter=%.1f" % (res["posts_per_author"], res["replies_per_commenter"]))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["plan", "ingest", "compute"])
    ap.add_argument("--tag", required=True)
    ap.add_argument("--config", default=os.path.join(HERE, "config.json"))
    ap.add_argument("--cache", default=os.path.join(HERE, "cache"))
    ap.add_argument("--per", type=int, default=5, help="authors per language and kind")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("pairs", nargs="*")
    a = ap.parse_args(argv)
    cfg = load_config(a.config)
    if a.cmd == "plan":
        plan(a.tag, cfg, a.cache, a.per)
    elif a.cmd == "ingest":
        ingest(a.tag, a.cache, a.pairs)
    else:
        compute(a.tag, a.cache, a.write)


if __name__ == "__main__":
    main()
