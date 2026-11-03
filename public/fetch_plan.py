#!/usr/bin/env python3
"""Plan the X calls for one run (<= budget.max_calls, default 25) and ARCHIVE the exact queries.

  python3 fetch_plan.py [--config config.json] [--end 2026-11-03T04:00:00Z] [--cache cache]

Writes cache/plan_<TAG>.json: every step with its tool, arguments (query text included) and note. The bot executes the steps with the `x` MCP tools
(write_to_file = true, never read the result into the chat) and passes the saved file paths to ingest.py. TAG = window end, UTC, to the hour.

Phases: A counts (hourly, per keyword set x 4 mutually exclusive kinds) | B stratified samples (25 newest posts of one hour slice per stratum)
        C second slot, only where ingest.py says NEED_SLOT2 | D hot-post candidates (relevancy Top 25; the last step is filled in by ingest.py).
Exit codes: 0 ok, 2 bad config / over budget.
"""
import argparse
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import HERE, ISO, POST_FIELDS, ConfigError, die, dump_json, keyword_query, load_config  # noqa: E402


def build_plan(cfg, end, config_path=""):
    hours = cfg["hours"]
    start = end - dt.timedelta(hours=hours)
    tag = end.strftime("%Y-%m-%dT%H")
    steps = []
    for s in cfg["sets"]:
        for k in ("all", "orig", "reply", "quote"):
            steps.append(dict(id="c.%s.%s" % (s["id"], k), phase="A-counts", tool="get_posts_counts_recent", calls=1,
                              args=dict(query=keyword_query(s, k), start_time=start.strftime(ISO), end_time=end.strftime(ISO), granularity="hour"),
                              note="hourly volume; keep meta.total_tweet_count and data[].tweet_count"))
    strata = [(s["id"], k) for s in cfg["sets"] for k in ("orig", "reply", "quote")]
    # Slot hours are placed symmetrically around the window midpoint, so every stratum has the same mean post age (no bias from sampling only recent hours)
    anchors = ([3, 5, 7, 9, 11, 1] + [1] * 10)[: len(strata)]
    for i, (sid, k) in enumerate(strata):
        s = next(x for x in cfg["sets"] if x["id"] == sid)
        for j, h in enumerate((anchors[i], hours - anchors[i])):
            e = start + dt.timedelta(hours=h)
            steps.append(dict(id="s.%s.%s.%d" % (sid, k, j + 1), phase="B-sample" if j == 0 else "C-sample-slot2", tool="search_posts_all", calls=1, conditional=bool(j),
                              args=dict(query=keyword_query(s, k), start_time=(e - dt.timedelta(hours=1)).strftime(ISO), end_time=e.strftime(ISO), max_results=25, sort_order="recency", **{"post.fields": POST_FIELDS}),
                              note="newest 25 posts of that hour; keep per-post metrics and author_id (only when ingest prints NEED for C)" if j else "newest 25 posts of that hour; keep per-post metrics and author_id"))
    for j, s in enumerate(cfg["sets"]):
        steps.append(dict(id="h.%d" % (j + 1), phase="D-hot", tool="search_posts_all", calls=1,
                          args=dict(query="(%s) lang:%s -is:retweet -is:reply" % (s["keywords"], s["lang"]), start_time=start.strftime(ISO), end_time=end.strftime(ISO), max_results=25, sort_order="relevancy", **{"post.fields": POST_FIELDS}),
                          note="relevancy Top 25 of the whole window; the most-viewed, time-spread ones become hot cards"))
    steps.append(dict(id="h.%d" % (len(cfg["sets"]) + 1), phase="D-hot", tool="search_posts_all", calls=1,
                      args="(filled in by ingest.py once the counts are in: the peak-hour slice)", note="relevancy Top 25 inside the peak hour"))
    need = sum(1 for x in steps if not x.get("conditional"))
    worst = len(steps)
    mx = cfg["budget"]["max_calls"]
    if worst > mx:
        raise ConfigError("plan needs up to %d calls but budget.max_calls is %d (use fewer keyword sets)" % (worst, mx))
    return dict(tag=tag, window=[start.strftime(ISO), end.strftime(ISO)], config=os.path.abspath(config_path) if config_path else "",
                budget=dict(max=mx, minimum=need, worst=worst),
                queries={x["id"]: x["args"]["query"] for x in steps if isinstance(x["args"], dict)},
                how=["Each step: CallDynamicTool(namespace=x, toolName=tool, arguments=args, write_to_file=true); note only the returned file path, never read results into the chat.",
                     "After phase A (8 steps) and B (6 steps): python3 ingest.py --tag %s <step id>=<file> ...  ingest prints NEED_SLOT2 per stratum." % tag,
                     "Run phase C only for strata marked NEED_SLOT2, ingest again, then phase D (3 steps), ingest again.",
                     "Then: bash make_public.sh %s" % tag,
                     "People ratios are NOT fetched per run: they come from calibration.json (see calibrate_people.py)."],
                steps=steps)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=os.path.join(HERE, "config.json"))
    ap.add_argument("--cache", default=os.path.join(HERE, "cache"))
    ap.add_argument("--end", help="window end, UTC, e.g. 2026-11-03T04:00:00Z (default: the current hour)")
    a = ap.parse_args(argv)
    try:
        cfg = load_config(a.config)
        end = dt.datetime.strptime(a.end, ISO) if a.end else dt.datetime.now(dt.timezone.utc).replace(tzinfo=None, minute=0, second=0, microsecond=0)
        plan = build_plan(cfg, end, a.config)
    except (ConfigError, ValueError) as e:
        die(2, "fetch_plan: " + str(e))
    dump_json(os.path.join(a.cache, "plan_%s.json" % plan["tag"]), plan, indent=1)
    print("TAG=%s window %s -> %s, calls %d..%d (budget %d)" % (plan["tag"], plan["window"][0], plan["window"][1], plan["budget"]["minimum"], plan["budget"]["worst"], plan["budget"]["max"]))
    for x in plan["steps"]:
        print("  %-12s%-10s%-26s%s" % (x["id"], x["phase"][:8], x["tool"], x["args"]["query"][:70] if isinstance(x["args"], dict) else x["args"]))


if __name__ == "__main__":
    main()
