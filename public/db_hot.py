#!/usr/bin/env python3
"""OPTIONAL: freeze hot-post candidates from a local SQLite database of tracked posts into cache/db_hot_<TAG>.json (no X calls).

  python3 db_hot.py --tag 2026-11-03T04 [--config config.json] [--db path.sqlite]

Needs config.db (or --db). Expected tables: posts(id, created_at, kind, text, impressions, likes, replies, author_id) with created_at as
'YYYY-MM-DDTHH:MM:SSZ' and kind in orig/reply/quote, and accounts(user_id, username). Only orig/quote posts that match hot.match (a regex over the
text, if set) and have impressions > 0 inside the window are kept (top 60 by views). fill_public.py reads this file like the X search candidates, so
the build never touches the database and stays reproducible. Without a database this step is simply skipped.
Exit codes: 0 ok, 2 no database / missing plan.
"""
import argparse
import os
import re
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import HERE, die, dump_json, load_config, load_json  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--config", default=os.path.join(HERE, "config.json"))
    ap.add_argument("--cache", default=os.path.join(HERE, "cache"))
    ap.add_argument("--db")
    a = ap.parse_args(argv)
    cfg = load_config(a.config)
    path = a.db or cfg.get("db")
    plan = load_json(os.path.join(a.cache, "plan_%s.json" % a.tag))
    if not path or not os.path.exists(path):
        die(2, "db_hot: no database (set config.db or --db); skipping is fine")
    if plan is None:
        die(2, "db_hot: plan_%s.json missing (run fetch_plan.py first)" % a.tag)
    s0, s1 = plan["window"]
    rx = re.compile(cfg["hot"]["match"], re.I) if cfg["hot"].get("match") else None
    db = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
    out = []
    for id_, ca, k, text, im, li, rp, un in db.execute(
        "select p.id,p.created_at,p.kind,p.text,p.impressions,p.likes,p.replies,a.username from posts p left join accounts a on a.user_id=p.author_id "
        "where p.created_at>=? and p.created_at<? and p.kind in ('orig','quote') and p.impressions>0 order by p.impressions desc", (s0, s1)):
        if rx and not rx.search(text or ""):
            continue
        out.append(dict(id=str(id_), u=un or "?", t=ca, v=im, l=li or 0, r=rp or 0, text=text or "", kind=1 if k == "quote" else 0))
        if len(out) >= 60:
            break
    dump_json(os.path.join(a.cache, "db_hot_%s.json" % a.tag), out)
    print("db_hot: %d candidates frozen" % len(out))


if __name__ == "__main__":
    main()
