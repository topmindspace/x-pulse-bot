"""Shared helpers for the X Pulse (Public) scripts. Standard library only."""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ISO = "%Y-%m-%dT%H:%M:%SZ"
SLOT_KINDS = ("orig", "reply", "quote")
FILTERS = {
    "all": "",
    "orig": "-is:retweet -is:reply -is:quote",
    "reply": "is:reply -is:retweet",
    "quote": "is:quote -is:reply -is:retweet",
}
POST_FIELDS = "created_at,public_metrics,author_id,lang,referenced_tweets"


class ConfigError(Exception):
    pass


def load_config(path=None):
    """Read and validate the config; every problem is reported at once (exit code 2 in the CLIs)."""
    path = path or os.path.join(HERE, "config.json")
    with open(path, encoding="utf8") as f:
        c = json.load(f)
    bad = []

    def need(cond, msg):
        if not cond:
            bad.append(msg)

    need(isinstance(c.get("topic"), dict) and str(c["topic"].get("name", "")).strip() != "", "topic.name is required")
    need(isinstance(c.get("sets"), list) and len(c["sets"]) >= 1, "sets must list at least one keyword set")
    ids = set()
    for s in c.get("sets") or []:
        need(isinstance(s, dict) and all(isinstance(s.get(k), str) and s[k].strip() for k in ("id", "lang", "keywords")), "every set needs id, lang, keywords")
        if isinstance(s, dict):
            need(s.get("id") not in ids, "duplicate set id " + str(s.get("id")))
            ids.add(s.get("id"))
    need(len({s.get("lang") for s in c.get("sets") or []}) == len(c.get("sets") or []), "sets must use different lang filters (they must not overlap)")
    b = c.setdefault("budget", {})
    b.setdefault("max_calls", 25)
    b.setdefault("se_stop", 0.3)
    i = c.setdefault("inject", {})
    i.setdefault("nodes_range", [600, 900])
    i.setdefault("comets_target", 40)
    i.setdefault("winsor_cap", 0.975)
    need(len(i["nodes_range"]) == 2 and 0 < i["nodes_range"][0] < i["nodes_range"][1], "inject.nodes_range must be [min, max]")
    need(0.5 < i["winsor_cap"] <= 1, "inject.winsor_cap must be in (0.5, 1]")
    h = c.setdefault("hot", {})
    h.setdefault("max", 8)
    h.setdefault("floor_views", 2000)
    h.setdefault("min_gap_h", 2.0)
    h.setdefault("card_hours", 1.9)
    h.setdefault("match", "")
    need(1 <= h["max"] <= 8, "hot.max must be 1..8")
    p = c.setdefault("people", {})
    p.setdefault("source", "calibration")
    p.setdefault("posts_per_author", 2.0)
    p.setdefault("replies_per_commenter", 2.7)
    need(p["source"] in ("calibration", "fixed"), 'people.source must be "calibration" or "fixed"')
    c.setdefault("hours", 24)
    need(c["hours"] == 24, "hours must be 24 (the dial is one 24 h turn)")
    tz = c.setdefault("display_tz", {"iana": "UTC", "label": {"zh": "UTC", "en": "UTC"}})
    need(isinstance(tz.get("iana"), str), "display_tz.iana is required")
    c.setdefault("db", None)
    if bad:
        raise ConfigError("\n".join(bad))
    return c


def load_json(path, default=None):
    if os.path.exists(path):
        with open(path, encoding="utf8") as f:
            return json.load(f)
    return default


def dump_json(path, obj, **kw):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf8") as f:
        json.dump(obj, f, ensure_ascii=False, **kw)
    os.replace(tmp, path)


def keyword_query(s, kind):
    """The exact X query for one keyword set and one mutually exclusive post kind (all = every post incl. reposts)."""
    return ("(%s) lang:%s %s" % (s["keywords"], s["lang"], FILTERS[kind])).strip()


NICE = (1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10)


def nice_ceil(x):
    """Smallest 'nice' number (1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 x 10^k) that is >= x."""
    e = 10 ** math.floor(math.log10(max(x, 1)))
    for m in NICE:
        if m * e >= x:
            return int(round(m * e))
    return int(round(10 * e))


def nice_near(x):
    """Nice number closest to x on a log scale."""
    e = 10 ** math.floor(math.log10(max(x, 1)))
    return int(round(min((m * e for m in NICE), key=lambda v: abs(math.log(v / max(x, 1e-9))))))


def parse_tool_file(path):
    """Read a saved X tool result (the text file written by write_to_file) and return its JSON object."""
    with open(path, encoding="utf8") as f:
        t = f.read()
    i = t.find('{"data"')
    if i < 0:
        i = t.find("{")
    if i < 0:
        raise ValueError("no JSON in " + path)
    return json.JSONDecoder().raw_decode(t[i:])[0]


def die(code, msg):
    sys.stderr.write(msg.rstrip() + "\n")
    sys.exit(code)
