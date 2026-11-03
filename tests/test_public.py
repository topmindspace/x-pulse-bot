"""Unit tests for the X Pulse (Public) data tools (public/*.py) on a synthetic cache. Run: python3 test_public.py"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(HERE, "..", "public")
sys.path.insert(0, HERE)
sys.path.insert(0, PUB)
import pubfix  # noqa: E402
from common import ConfigError, load_config, keyword_query, nice_ceil, nice_near  # noqa: E402
import calibrate_people  # noqa: E402
import fill_public  # noqa: E402

TAG = pubfix.TAG
RENDERER = os.path.join(HERE, "..", "renderer", "x-pulse-replay.tsx")


def data(root, tag=TAG):
    return json.load(open(os.path.join(root, "out", "data_%s.json" % tag), encoding="utf8"))


def summary(root, tag=TAG):
    return json.load(open(os.path.join(root, "out", "summary_%s.json" % tag), encoding="utf8"))


class Base(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="xpp_")

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def ok(self, **kw):
        pubfix.make_cache(self.root, **kw)
        pubfix.gloss(self.root, pubfix.FULL_GLOSS)
        r = pubfix.fill(self.root, renderer=RENDERER)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        return data(self.root)


class Config(unittest.TestCase):
    def cfg(self, **kw):
        c = json.load(open(os.path.join(PUB, "config.json"), encoding="utf8"))
        c.update(kw)
        p = tempfile.mktemp(suffix=".json")
        json.dump(c, open(p, "w"))
        self.addCleanup(lambda: os.path.exists(p) and os.remove(p))
        return p

    def test_shipped_config_is_valid_and_has_two_languages(self):
        c = load_config()
        self.assertEqual({s["lang"] for s in c["sets"]}, {"en", "zh"})
        self.assertEqual(c["hours"], 24)
        self.assertLessEqual(c["budget"]["max_calls"], 25)
        self.assertIn("zh", c["topic"]["title"])
        self.assertIn("en", c["topic"]["title"])

    def test_problems_are_reported_together(self):
        p = self.cfg(topic={"name": " "}, hours=12, sets=[{"id": "a", "lang": "en", "keywords": "x"}, {"id": "a", "lang": "en", "keywords": "y"}])
        with self.assertRaises(ConfigError) as e:
            load_config(p)
        m = str(e.exception)
        for part in ("topic.name", "duplicate set id", "different lang", "hours must be 24"):
            self.assertIn(part, m)

    def test_keyword_queries_are_exclusive(self):
        s = {"id": "en", "lang": "en", "keywords": "AI OR LLM"}
        qs = {k: keyword_query(s, k) for k in ("all", "orig", "reply", "quote")}
        self.assertIn("lang:en", qs["all"])
        for k in ("orig", "reply", "quote"):
            self.assertIn("-is:retweet", qs[k])
        self.assertIn(" is:reply", qs["reply"])
        self.assertIn(" is:quote", qs["quote"])
        self.assertIn("-is:reply -is:quote", qs["orig"])
        self.assertNotIn("-is:retweet", qs["all"])

    def test_nice_numbers(self):
        self.assertEqual(nice_ceil(1234), 1500)
        self.assertGreaterEqual(nice_ceil(1234), 1234)
        self.assertGreater(nice_near(777), 0)


class Fill(Base):
    def test_invariants_and_schema(self):
        d = self.ok()
        p = d["pub"]
        t = p["totals"]
        self.assertEqual(d["mode"], "public")
        self.assertFalse(d["example"])
        self.assertEqual(sum(p["hours"]["posts"]), t["orig"] + t["reply"] + t["quote"])
        self.assertEqual(sum(p["hours"]["reposts"]), t["reposts"])
        self.assertEqual(len(p["hours"]["tier"]), 24)
        self.assertTrue(all(0 <= x <= 4 for x in p["hours"]["tier"]))
        for k in ("posters", "commenters", "reposts"):
            c = p["cum"][k]
            self.assertEqual(len(c), 25)
            self.assertEqual(c, sorted(c))
        self.assertEqual(p["cum"]["reposts"][-1], t["reposts"])
        self.assertLessEqual(t["viewsLow"], t["views"])
        self.assertLessEqual(t["views"], t["viewsHigh"])
        self.assertLessEqual(t["postersLow"], t["posters"])
        self.assertLessEqual(t["posters"], t["postersHigh"])
        dots = [r for r in d["posts"] if r[7] is None]
        hot = [r for r in d["posts"] if r[7] is not None]
        lo, hi = fill_public.load_config()["inject"]["nodes_range"]
        self.assertLessEqual(len(dots), hi)
        self.assertGreaterEqual(len(dots), lo)
        self.assertEqual(len(hot), len(p["hot"]))
        self.assertLessEqual(len(p["hot"]), 8)
        self.assertTrue(all(0 <= r[0] <= 86400 for r in d["posts"]))
        self.assertEqual(d["followers"]["delta"], sum(s["delta"] for s in d["followers"]["segments"]))

    def test_window_and_timezone_are_real(self):
        d = self.ok()
        self.assertEqual(d["window"]["startISO"], "2026-11-02T04:00:00Z")
        self.assertEqual(d["window"]["endISO"], "2026-11-03T04:00:00Z")
        self.assertEqual(d["tz"]["iana"], "Asia/Shanghai")
        self.assertIn("zh", d["tz"]["label"])
        self.assertIn("en", d["tz"]["label"])

    def test_bilingual_strings_and_no_estimate_in_title_fields(self):
        d = self.ok()
        p = d["pub"]
        for k in ("scope", "caveat"):
            self.assertTrue(p[k]["zh"] and p[k]["en"])
        self.assertIn("估", p["caveat"]["zh"])  # the caveat is allowed to say it (sidebar only)
        self.assertTrue(d["topic"]["title"]["zh"] and d["topic"]["title"]["en"])
        # nothing that is drawn in the dial / board may carry an estimate wording: titles of hot posts and topic names
        for h in p["hot"]:
            self.assertNotRegex(h["title"], r"估")
        self.assertNotRegex(json.dumps(d["topic"], ensure_ascii=False), r"估")

    def test_only_aggregates_samples_and_scaled_results_are_injected(self):
        d = self.ok()
        raw = json.dumps(d, ensure_ascii=False)
        sample = json.load(open(os.path.join(self.root, "cache", "sample_%s.json" % TAG)))
        authors = {x["a"] for v in sample.values() for x in v}
        self.assertFalse(any('"%s"' % a in raw for a in authors), "sampled author ids must not be injected")
        for r in d["posts"]:
            if r[7] is None:
                self.assertIsNone(r[8])  # dots carry no text
        self.assertLess(len(raw.encode()), 120000)

    def test_hot_posts_are_real_and_filtered(self):
        d = self.ok()
        ids = {h["id"] for h in d["pub"]["hot"]}
        self.assertNotIn("9000000000000000004", ids, "off-topic post (gardening) must be filtered by hot.match")
        self.assertTrue(ids <= {"9000000000000000001", "9000000000000000002", "9000000000000000003"})
        ts = sorted(h["ts"] for h in d["pub"]["hot"])
        self.assertTrue(all(b - a >= 2 * 3600 - 1 for a, b in zip(ts, ts[1:])))
        for h in d["pub"]["hot"]:
            self.assertNotIn("https://", h["title"])

    def test_deterministic(self):
        a = json.dumps(self.ok(), sort_keys=True)
        b = json.dumps(self.ok(), sort_keys=True)
        self.assertEqual(a, b)

    def test_negative_retweet_difference_is_clamped_and_reported(self):
        self.ok(retweet_negative=True)
        s = summary(self.root)
        self.assertGreater(s["retweet_clamped_slots"], 0)
        self.assertTrue(any("negative" in w for w in s["warnings"]))
        self.assertGreaterEqual(data(self.root)["pub"]["totals"]["reposts"], 0)

    def test_queries_are_archived(self):
        self.ok()
        s = summary(self.root)
        self.assertTrue(s["queries"])

    def test_page_file_replaces_only_the_data_block(self):
        self.ok()
        page = open(os.path.join(self.root, "out", "page_%s.tsx" % TAG), encoding="utf8").read()
        src = open(RENDERER, encoding="utf8").read()
        A, B = "// ===== BEGIN DATA =====", "// ===== END DATA ====="
        self.assertEqual(page[: page.index(A)], src[: src.index(A)])
        self.assertEqual(page[page.index(B):], src[src.index(B):])
        self.assertIn('"mode":"public"', page)


class Failures(Base):
    def test_missing_cache_exits_2(self):
        os.makedirs(os.path.join(self.root, "cache"))
        pubfix.make_cache(self.root)
        os.remove(os.path.join(self.root, "cache", "counts_%s.json" % TAG))
        r = pubfix.fill(self.root, renderer=RENDERER)
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)

    def test_small_sample_exits_2(self):
        pubfix.make_cache(self.root, small_sample=True)
        r = pubfix.fill(self.root, renderer=RENDERER)
        self.assertEqual(r.returncode, 2)
        self.assertIn("sample too small", r.stdout + r.stderr)

    def test_missing_gloss_exits_4_but_writes_output(self):
        pubfix.make_cache(self.root)
        r = pubfix.fill(self.root, renderer=RENDERER)
        self.assertEqual(r.returncode, 4, r.stdout + r.stderr)
        self.assertIn("MISSING gloss", r.stdout)
        self.assertTrue(os.path.exists(os.path.join(self.root, "out", "page_%s.tsx" % TAG)))
        r = pubfix.fill(self.root, TAG, "--allow-missing-gloss", renderer=RENDERER)
        self.assertEqual(r.returncode, 0)

    def test_gloss_script_reports_missing(self):
        pubfix.make_cache(self.root)
        pubfix.fill(self.root, renderer=RENDERER)
        r = subprocess.run([sys.executable, os.path.join(PUB, "gloss.py"), "--tag", TAG, "--cache", os.path.join(self.root, "cache"), "--out", os.path.join(self.root, "out")], capture_output=True, text=True, env={**os.environ, "PATH": "/nonexistent"})
        self.assertEqual(r.returncode, 4, r.stdout + r.stderr)

    def test_bad_window_exits_2(self):
        pubfix.make_cache(self.root)
        p = os.path.join(self.root, "cache", "counts_%s.json" % TAG)
        c = json.load(open(p))
        c["window"][0] = "2026-11-02T10:00:00Z"
        json.dump(c, open(p, "w"))
        pubfix.gloss(self.root, pubfix.FULL_GLOSS)
        self.assertEqual(pubfix.fill(self.root, renderer=RENDERER).returncode, 2)


class People(unittest.TestCase):
    def test_posts_per_person_is_the_harmonic_mean(self):
        # a sample of authors by author -> their posts n_i: the population ratio is posts / people = 1 / mean(1 / n_i)
        r = calibrate_people.per_person([1, 2, 4])[0]
        self.assertAlmostEqual(r, 1 / ((1 + 0.5 + 0.25) / 3), places=6)
        self.assertAlmostEqual(calibrate_people.per_person([5, 5, 5])[0], 5)

    def test_bootstrap_interval_brackets_the_estimate(self):
        ns = [1, 1, 2, 2, 3, 5, 8, 1, 2, 4]
        lo, hi = calibrate_people.bootstrap(ns)
        est = calibrate_people.per_person(ns)[0]
        self.assertLessEqual(lo, est)
        self.assertLessEqual(est, hi)
        self.assertEqual(calibrate_people.bootstrap(ns), calibrate_people.bootstrap(ns))  # fixed seed

    def test_shipped_calibration_is_sane(self):
        with open(os.path.join(PUB, "calibration.json")) as f:
            c = json.load(f)
        self.assertGreaterEqual(c["posts_per_author"], 1)
        self.assertGreaterEqual(c["replies_per_commenter"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=1)
