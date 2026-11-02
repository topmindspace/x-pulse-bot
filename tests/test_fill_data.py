#!/usr/bin/env python3
"""Tests for tools/fill_data.py (std-lib unittest).   python3 tests/test_fill_data.py"""
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "tools"))
import fill_data as fd  # noqa: E402

TPL = "import x;\n// ===== BEGIN DATA =====\nconst DATA: Data = {};\n// ===== END DATA =====\nconst tail = 1;\n"


def post(i, created, text="hello", refs=None, reply_to=None, pm=None, author="1"):
    p = {"id": str(1000 + i), "created_at": created, "text": text, "author_id": author}
    if refs:
        p["referenced_tweets"] = [{"type": t, "id": "9"} for t in refs]
    if reply_to:
        p["in_reply_to_user_id"] = reply_to
    p["public_metrics"] = pm if pm is not None else {"impression_count": 100, "like_count": 3, "retweet_count": 1, "reply_count": 2, "quote_count": 0}
    return p


def run(cfg, tpl=TPL, max_bytes=None):
    base = {"lang": "en", "account": {"name": "A", "username": "a"}, "avatar": None, "tz": {"iana": "Asia/Shanghai"}, "days_requested": 1,
            "me_id": "1", "raw_posts": [], "followers_snapshots": [], "metricsFetchedAt": None, "now": "2026-11-02T10:00:00+08:00"}
    base.update(cfg)
    page, summary = fd.build(base, tpl, max_bytes)
    m = re.search(r"const DATA: Data = (.*);\n// ===== END", page, re.S)
    return json.loads(m.group(1)), summary, page


class T(unittest.TestCase):
    def test_day_boundaries_shanghai(self):
        d, s, page = run({"raw_posts": [
            post(1, "2026-10-31T15:59:59Z"),  # 23:59:59 on 10-31 local: before the day
            post(2, "2026-10-31T16:00:00Z"),  # 00:00:00 11-01: first second of the day
            post(3, "2026-11-01T15:59:59Z"),  # 23:59:59 11-01: last second
            post(4, "2026-11-01T16:00:00Z"),  # 00:00:00 11-02 = today: excluded
        ]})
        self.assertEqual([x["date"] for x in d["days"]], ["2026-11-01"])
        rows = d["days"][0]["posts"]
        self.assertEqual([r[0] for r in rows], [0, 86399])
        self.assertEqual(s["days"][0]["hours"], 24.0)
        self.assertTrue(page.startswith("import x;\n// ===== BEGIN DATA ====="))
        self.assertTrue(page.endswith("// ===== END DATA =====\nconst tail = 1;\n"))

    def test_seven_days_and_today_excluded(self):
        d, s, _ = run({"days_requested": 7})
        self.assertEqual([x["date"] for x in d["days"]], ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"])
        with self.assertRaises(ValueError):
            run({"days_requested": 8})

    def test_dst_fall_back_25h_new_york(self):
        # 2026-11-01 is 25 h long in New York: EDT midnight = 04:00Z, next midnight (EST) = 05:00Z on 11-02
        d, s, _ = run({"tz": {"iana": "America/New_York"}, "days_requested": 2, "now": "2026-11-03T12:00:00Z", "raw_posts": [
            post(1, "2026-11-01T03:59:59Z"),  # 23:59:59 on 10-31
            post(2, "2026-11-01T04:00:00Z"),  # 00:00 on 11-01, t=0
            post(3, "2026-11-02T04:59:59Z"),  # 23:59:59 EST on 11-01: t = 25h - 1s
            post(4, "2026-11-02T05:00:00Z"),  # 00:00 on 11-02
        ]})
        self.assertEqual([x["hours"] for x in s["days"]], [25.0, 24.0])
        self.assertEqual([x["date"] for x in d["days"]], ["2026-11-01", "2026-11-02"])
        self.assertEqual([r[0] for r in d["days"][0]["posts"]], [0, 25 * 3600 - 1])
        self.assertEqual([r[0] for r in d["days"][1]["posts"]], [0])

    def test_dst_spring_forward_23h_new_york(self):
        d, s, _ = run({"tz": {"iana": "America/New_York"}, "now": "2026-03-09T12:00:00Z", "raw_posts": [
            post(1, "2026-03-09T03:59:59Z"), post(2, "2026-03-08T04:59:59Z")]})
        self.assertEqual(s["days"][0]["date"], "2026-03-08")
        self.assertEqual(s["days"][0]["hours"], 23.0)
        self.assertEqual([r[0] for r in d["days"][0]["posts"]], [23 * 3600 - 1])  # 04:59:59Z is on 03-07, so only the 03:59:59Z post is in

    def test_kathmandu_545(self):
        # +05:45: local midnight 11-01 = 2026-10-31T18:15:00Z
        d, s, _ = run({"tz": {"iana": "Asia/Kathmandu"}, "now": "2026-11-02T00:00:00Z", "raw_posts": [
            post(1, "2026-10-31T18:14:59Z"), post(2, "2026-10-31T18:15:00Z"), post(3, "2026-11-01T18:14:59Z"), post(4, "2026-11-01T18:15:00Z")]})
        self.assertEqual(s["days"][0]["date"], "2026-11-01")
        self.assertEqual(s["days"][0]["start"], "2026-10-31T18:15:00Z")
        self.assertEqual([r[0] for r in d["days"][0]["posts"]], [0, 86399])

    def test_half_hour_and_extremes(self):
        for iana, off in (("Asia/Kolkata", 5.5), ("Pacific/Kiritimati", 14), ("Etc/GMT+12", -12), ("Australia/Lord_Howe", None)):
            _, s, _ = run({"tz": {"iana": iana}})
            self.assertIn(s["days"][0]["hours"], (24.0, 23.5, 24.5), iana)
        _, s, _ = run({"tz": {"iana": "Asia/Kolkata"}, "now": "2026-11-02T00:00:00Z"})
        self.assertEqual(s["days"][0]["start"], "2026-10-31T18:30:00Z")

    def test_empty_day(self):
        d, s, _ = run({"days_requested": 3, "raw_posts": [post(1, "2026-11-01T01:00:00Z")]})
        self.assertEqual([len(x["posts"]) for x in d["days"]], [0, 0, 1])
        self.assertEqual(s["days"][0]["posts_total"], 0)

    def test_classify_and_rt(self):
        d, s, _ = run({"raw_posts": [
            post(1, "2026-11-01T01:00:00Z"),
            post(2, "2026-11-01T02:00:00Z", refs=["replied_to"], reply_to="99", text="@bob @amy yes sure"),
            post(3, "2026-11-01T03:00:00Z", refs=["replied_to"], reply_to="1", text="@a thread part 2"),
            post(4, "2026-11-01T04:00:00Z", refs=["quoted"]),
            post(5, "2026-11-01T05:00:00Z", refs=["retweeted"], text="RT @x: hi"),
            post(6, "2026-11-01T06:00:00Z", text="RT @y: old style"),
            post(7, "2026-11-01T07:00:00Z", author="555"),
            post(1, "2026-11-01T01:00:00Z"),  # duplicate id
        ]})
        rows = d["days"][0]["posts"]
        self.assertEqual([r[1] for r in rows], [0, 1, 5, 2])
        self.assertEqual(rows[1][8], "yes sure")
        self.assertEqual(d["footnotes"]["retweetsExcluded"], 2)
        self.assertEqual(s["ignored"], 1)

    def test_missing_metrics_are_null(self):
        d, _, _ = run({"raw_posts": [
            post(1, "2026-11-01T01:00:00Z", pm={"like_count": 5, "retweet_count": 0, "reply_count": 1, "quote_count": 0}),  # no impressions
            post(2, "2026-11-01T02:00:00Z", pm={}),
        ]})
        a, b = d["days"][0]["posts"]
        self.assertEqual(a[2:7], [None, 5, 0, 1, 0])
        self.assertEqual(b[2:7], [None] * 5)
        self.assertIsNone(d["days"][0]["status"])

    def test_snippet_graphemes(self):
        fam = "\U0001F468\u200D\U0001F469\u200D\U0001F467\u200D\U0001F466"
        s = fd.snippet(fam * 25, False)
        g = fd.graphemes(s)
        self.assertEqual(len(g), 20)
        self.assertEqual(g[0], fam)
        self.assertEqual(g[-1], "…")
        self.assertTrue(fd.snippet("你好，世界" * 10, False).startswith("你好，世界你好"))
        self.assertEqual(len(fd.graphemes(fd.snippet("你好，世界" * 10, False))), 20)
        self.assertEqual(fd.snippet("flag \U0001F1E8\U0001F1F3 here https://t.co/abc", False), "flag \U0001F1E8\U0001F1F3 here")
        self.assertEqual(fd.snippet("e\u0301" * 30, False).count("\u0301"), 19)
        self.assertEqual(fd.snippet("https://t.co/x", False), None)
        self.assertEqual(fd.snippet("a &amp; b", False), "a & b")

    def test_followers_bracket(self):
        snaps = [{"at": "2026-10-31T15:48:09Z", "count": 3576}, {"at": "2026-11-01T04:37:51Z", "count": 3586}, {"at": "2026-11-01T15:46:18Z", "count": 3618},
                 {"at": "2026-11-02T12:37:03Z", "count": 3656}]
        d, _, _ = run({"followers_snapshots": snaps})
        f = d["days"][0]["followers"]
        self.assertEqual((f["current"], f["delta"], f["baselineAt"], f["firstRun"]), (3618, 42, "2026-10-31T15:48:09Z", False))
        self.assertEqual([g["delta"] for g in f["segments"]], [10, 32])
        # not bracketing: only snapshots after the day
        d, _, _ = run({"followers_snapshots": snaps[2:]})
        f = d["days"][0]["followers"]
        self.assertIsNone(f["delta"])
        self.assertEqual((f["firstRun"], f["current"]), (True, 3618))  # no baseline before the day at all
        d, _, _ = run({"followers_snapshots": snaps[3:]})
        f = d["days"][0]["followers"]
        self.assertEqual((f["delta"], f["current"], f["firstRun"]), (None, 3656, True))  # 12:37Z 11-02 is 20 h after the day: inside the 36 h gap, so it is the end value
        d, _, _ = run({"followers_snapshots": []})
        self.assertEqual(d["days"][0]["followers"], {"current": None, "delta": None, "baselineAt": None, "firstRun": True})

    def test_status(self):
        posts = []
        k = 0
        for day, n in (("2026-10-28", 2), ("2026-10-29", 2), ("2026-10-30", 2), ("2026-10-31", 2), ("2026-11-01", 10)):
            for j in range(n):
                k += 1
                posts.append(post(k, day + "T0%d:00:00Z" % (j % 9 + 1), pm={"impression_count": 10, "like_count": 5, "retweet_count": 0, "reply_count": 0, "quote_count": 0}))
        d, _, _ = run({"days_requested": 5, "raw_posts": posts})
        st = d["days"][-1]["status"]
        self.assertEqual(st["tier"], 0)  # 50 vs median 10
        self.assertAlmostEqual(st["ratio"], 5.0)
        self.assertIsNone(d["days"][0]["status"])  # fewer than 3 earlier days
        self.assertIsNotNone(d["days"][3]["status"])
        self.assertEqual(set(st["note"]), {"en", "zh"})
        # explicit history
        d, _, _ = run({"status_history": [{"date": "2026-10-%d" % x, "engagement": 100} for x in (27, 28, 29)],
                       "raw_posts": [post(1, "2026-11-01T01:00:00Z", pm={"like_count": 50})]})
        self.assertEqual(d["days"][0]["status"]["tier"], 3)

    def test_cap_is_recorded_not_silent(self):
        posts = [post(i, "2026-11-01T%02d:%02d:00Z" % (i // 60 % 24, i % 60), text="post number %d" % i,
                      pm={"impression_count": i, "like_count": i % 7, "retweet_count": 0, "reply_count": 0, "quote_count": 0}) for i in range(600)]
        d, s, page = run({"raw_posts": posts})
        full = s["bytes"]
        self.assertIsNone(s["cap_per_day"])
        d, s, page = run({"raw_posts": posts}, max_bytes=full // 2)
        self.assertLessEqual(len(page.encode()), full // 2)
        self.assertIsNotNone(s["cap_per_day"])
        shown = len(d["days"][0]["posts"])
        self.assertEqual(shown, s["cap_per_day"])
        self.assertEqual(s["omitted"][0]["total"], 600)
        self.assertGreater(s["omitted"][0]["total"], shown)
        note = d["footnotes"]["extra"][0]
        self.assertIn("%d of %d" % (shown, s["omitted"][0]["total"]), note["en"])
        self.assertIn("%d/%d" % (shown, s["omitted"][0]["total"]), note["zh"])
        # the kept ones are the best ones
        kept = sorted(r[2] for r in d["days"][0]["posts"])
        allimp = sorted((r[2] for r in run({"raw_posts": posts})[0]["days"][0]["posts"]), reverse=True)
        self.assertGreaterEqual(kept[0] + 7, allimp[shown - 1])
        # chronological order kept
        ts = [r[0] for r in d["days"][0]["posts"]]
        self.assertEqual(ts, sorted(ts))
        with self.assertRaises(OverflowError):
            run({"raw_posts": posts}, max_bytes=len(TPL) + 20)

    def test_cli_and_real_template(self):
        mn = os.path.join(ROOT, "dist", "x-pulse-replay.min.tsx")
        if not os.path.exists(mn):
            self.skipTest("dist not built")
        with tempfile.TemporaryDirectory() as td:
            inp = os.path.join(td, "in.json")
            out = os.path.join(td, "page.tsx")
            with open(inp, "w", encoding="utf-8") as f:
              json.dump({"lang": "zh", "account": {"name": "测试", "username": "t"}, "avatar": None, "tz": {"iana": "Asia/Kathmandu", "label": "加德满都"},
                       "days_requested": 2, "me_id": "1", "now": "2026-11-02T10:00:00Z", "metricsFetchedAt": "2026-11-02T09:00:00Z",
                       "raw_posts": [post(1, "2026-11-01T01:00:00Z", text="你好 🌏")], "followers_snapshots": []}, f, ensure_ascii=False)
            r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "fill_data.py"), inp, "--out", out, "--min", mn], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            with open(out, encoding="utf-8") as f:
                page = f.read()
            self.assertEqual(page.count("// ===== BEGIN DATA ====="), 1)
            self.assertIn('"label":"加德满都"', page)
            bad = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "fill_data.py"), inp, "--out", out, "--min", mn, "--max-bytes", "10"], capture_output=True, text=True)
            self.assertEqual(bad.returncode, 3)
            with open(inp, "w") as f:
                json.dump({"tz": {"iana": "Mars/Base"}}, f)
            bad = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "fill_data.py"), inp, "--out", out, "--min", mn], capture_output=True, text=True)
            self.assertEqual(bad.returncode, 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
