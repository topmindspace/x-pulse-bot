#!/usr/bin/env python3
"""X Pulse: turn raw X API data into the page file (minified renderer + DATA block).

Python 3.9+ standard library only (zoneinfo needs the system tz database; on Windows `pip install tzdata`).

  python3 tools/fill_data.py input.json --out page.tsx [--min dist/x-pulse-replay.min.tsx] [--max-bytes 205000]
  cat input.json | python3 tools/fill_data.py - --out page.tsx

INPUT JSON
  lang                   "en" | "zh"                 initial UI language of the page (the viewer can switch)
  account                {name, username}
  avatar                 {size, palette, indices} | null     (tools/build_avatar.py output)
  tz                     {iana, label?}              IANA zone of the owner, e.g. "Asia/Shanghai", "America/New_York", "Asia/Kathmandu"
  days_requested         1..7                        number of local calendar days, ending YESTERDAY (today is never included)
  now                    ISO time, optional          "now" (default: the system clock); yesterday = local date of `now` minus one day
  me_id                  owner's numeric user id (string)
  raw_posts              [X API v2 post objects]     id, created_at, text, author_id?, referenced_tweets?, in_reply_to_user_id?,
                                                     public_metrics{impression_count, like_count, retweet_count, reply_count, quote_count}
                                                     (non_public_metrics / organic_metrics are used for impressions when public_metrics lacks it)
  followers_snapshots    [{at: ISO time with offset, count: int}]   include the live count from get_users_me with at = now
  metricsFetchedAt       ISO time | null
  status_history         [{date: "YYYY-MM-DD", engagement: int}], optional   earlier days (before the requested range) for the baseline
  raw_posts_from         ISO time, optional          earliest instant raw_posts really covers; when it reaches back before the first requested
                                                     day, those earlier days (up to 7) feed the status baseline too
  snapshot_max_gap_hours number, optional (default 36)  how far a follower snapshot may be from the day boundary and still count as bracketing it
  snapshot_tolerance_minutes number, optional (default 30)  a snapshot up to this long INSIDE the day edge still counts for that edge
  max_bytes              int, optional                   size budget of the whole page file (default 205000 bytes; the canvas write limit is ~213 KB)
  example                bool, optional                  default false

The page always gets DATA.mode = "personal" (renderer 3.2.0+; older renderers ignore the field). The public edition has its own tools later (public/).

WHAT IT DOES
  * buckets posts into the owner's local calendar days (00:00 to the next local 00:00; 23/25 h DST days, +05:30 / +05:45 zones work)
  * drops pure retweets and counts them (footnotes.retweetsExcluded); posts of other authors are ignored
  * kind: replied_to => reply (flag +4 when it answers the owner's own post), else quoted => quote, else post
  * row = [t, flags, impressions, likes, reposts, replies, quotes, id, snippet]; t = seconds since the local day start;
    a metric the API did not return is null (never 0, never estimated); snippet <= 20 graphemes (leading @mentions and URLs removed)
  * followers per day: delta only when snapshots bracket the day: the one nearest to 00:00 (at/before it, or up to 30 min after) and the one nearest to 24:00
    (at/after it, or up to 30 min before), each within the max gap; baselineAt tells the viewer which snapshot was the baseline;
    otherwise delta null (renderer shows its localized "first replay" / "missing" text)
  * status per day: engagement total / median of up to 7 previous days (from status_history and the other requested days); needs >= 3
  * size budget: if the page would exceed max_bytes, keeps the top-N posts per day by engagement + impressions and says so in
    footnotes.extra (EN + ZH), never silently
Prints a JSON summary on stdout; exit code 2 for bad input, 3 when even 0 posts do not fit.
"""
import argparse
import html
import json
import os
import re
import statistics
import sys
import unicodedata
from datetime import date, datetime, timedelta, timezone

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None

MARK_B = "// ===== BEGIN DATA ====="
MARK_E = "// ===== END DATA ====="
DEFAULT_MAX = 205000


# ---------- time ----------
def parse_iso(s):
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return datetime.fromtimestamp(s, timezone.utc)
    s = str(s).strip()
    if s.endswith("Z") or s.endswith("z"):
        s = s[:-1] + "+00:00"
    m = re.match(r"^(.*[T ]\d{2}:\d{2}:\d{2})\.(\d+)(.*)$", s)
    if m:  # python < 3.11 wants 3 or 6 fraction digits
        s = m.group(1) + "." + (m.group(2) + "000000")[:6] + m.group(3)
    d = datetime.fromisoformat(s)
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d


def iso_z(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class Zone:
    def __init__(self, iana):
        if ZoneInfo is None:
            raise ValueError("zoneinfo is not available")
        try:
            self.tz = ZoneInfo(iana)
        except Exception as e:  # noqa
            raise ValueError("unknown IANA time zone %r (%s)" % (iana, e))
        self.iana = iana

    def local_date(self, t):
        d = datetime.fromtimestamp(t, self.tz)
        return d.year * 10000 + d.month * 100 + d.day

    def day_start(self, d):
        """First instant whose local date is >= d (same scan as the renderer: 15-minute steps, then per minute)."""
        target = d.year * 10000 + d.month * 100 + d.day
        guess = int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp())
        step = 900
        t = guess - 15 * 3600
        while t <= guess + 14 * 3600:
            if self.local_date(t) >= target:
                b = t - step + 60
                while b < t:
                    if self.local_date(b) >= target:
                        return b
                    b += 60
                return t
            t += step
        return guess

    def today(self, now_ts):
        d = datetime.fromtimestamp(now_ts, self.tz)
        return date(d.year, d.month, d.day)


# ---------- text ----------
def graphemes(s):
    out = []
    i, n = 0, len(s)
    while i < n:
        j = i + 1
        cp = ord(s[i])
        if 0x1F1E6 <= cp <= 0x1F1FF and j < n and 0x1F1E6 <= ord(s[j]) <= 0x1F1FF:
            j += 1
        while j < n:
            d = s[j]
            dp = ord(d)
            cat = unicodedata.category(d)
            prev = ord(s[j - 1])
            if dp == 0x200D:
                j += 2
            elif cat in ("Mn", "Me", "Mc") or 0x1F3FB <= dp <= 0x1F3FF or 0xE0020 <= dp <= 0xE007F or dp == 0xFE0F:
                j += 1
            elif 0x1160 <= dp <= 0x11FF and 0x1100 <= prev <= 0x11FF:
                j += 1
            else:
                break
        j = min(j, n)
        out.append(s[i:j])
        i = j
    return out


URL_RE = re.compile(r"https?://\S+")
MENTIONS_RE = re.compile(r"^(?:@\w+\s*)+")


def snippet(text, is_reply, limit=20):
    t = html.unescape(text or "")
    t = URL_RE.sub(" ", t)
    t = re.sub(r"\s+", " ", t).strip()
    if is_reply:
        t2 = MENTIONS_RE.sub("", t).strip()
        if t2:
            t = t2
    if not t:
        return None
    g = graphemes(t)
    if len(g) <= limit:
        return t
    return "".join(g[: limit - 1]).rstrip() + "…"


# ---------- posts ----------
def num(v):
    return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 0 else None


def metric_impr(p):
    for k in ("public_metrics", "non_public_metrics", "organic_metrics"):
        m = p.get(k)
        if isinstance(m, dict):
            v = num(m.get("impression_count"))
            if v is not None:
                return v
    return None


def classify(p, me_id):
    """-> ('rt', None) | ('skip', None) | ('ok', (kind, self_flag))"""
    refs = p.get("referenced_tweets") or []
    types = [r.get("type") for r in refs if isinstance(r, dict)]
    text = p.get("text") or ""
    if "retweeted" in types or (not types and text.startswith("RT @")):
        return "rt", None
    aid = p.get("author_id")
    if aid is not None and me_id is not None and str(aid) != str(me_id):
        return "skip", None
    if "replied_to" in types:
        own = p.get("in_reply_to_user_id")
        return "ok", (1, own is not None and me_id is not None and str(own) == str(me_id))
    if "quoted" in types:
        return "ok", (2, False)
    return "ok", (0, False)


def row_of(p, kind, selfr, t_rel):
    m = p.get("public_metrics") if isinstance(p.get("public_metrics"), dict) else {}
    pid = p.get("id")
    pid = str(pid) if pid is not None and re.fullmatch(r"\d+", str(pid)) else None
    return [
        t_rel,
        kind + (4 if selfr else 0),
        metric_impr(p),
        num(m.get("like_count")),
        num(m.get("retweet_count")),
        num(m.get("reply_count")),
        num(m.get("quote_count")),
        pid,
        snippet(p.get("text"), kind == 1),
    ]


def eng(r):
    return sum(x for x in r[3:7] if x is not None)


def score(r):
    return eng(r) + (r[2] or 0)


# ---------- the build ----------
def build(cfg, template_text, max_bytes=None):
    lang = "zh" if str(cfg.get("lang", "en")).lower().startswith("zh") else "en"
    tzc = cfg.get("tz") or {}
    zone = Zone(tzc.get("iana") or "")
    n = cfg.get("days_requested", 1)
    if not isinstance(n, int) or isinstance(n, bool) or n < 1 or n > 7:
        raise ValueError("days_requested must be an integer 1..7")
    now = parse_iso(cfg.get("now")) if cfg.get("now") else datetime.now(timezone.utc)
    now_ts = int(now.timestamp())
    today = zone.today(now_ts)
    dates = [today - timedelta(days=n - k) for k in range(n)]  # oldest first, last = yesterday
    bounds = []
    for d in dates:
        bounds.append((zone.day_start(d), zone.day_start(d + timedelta(days=1))))
    # earlier days (only for the status baseline): used only when raw_posts_from says raw_posts really reaches back that far
    pre_dates, pre_bounds = [], []
    if cfg.get("raw_posts_from"):
        rf = int(parse_iso(cfg["raw_posts_from"]).timestamp())
        for k in range(7, 0, -1):
            d = dates[0] - timedelta(days=k)
            a, b = zone.day_start(d), zone.day_start(d + timedelta(days=1))
            if a >= rf:
                pre_dates.append(d)
                pre_bounds.append((a, b))
    pre_eng = [0 for _ in pre_dates]
    me_id = cfg.get("me_id")
    buckets = [dict() for _ in dates]  # id/key -> row
    rts = 0
    ignored = 0
    seen = set()
    for p in cfg.get("raw_posts") or []:
        if not isinstance(p, dict):
            ignored += 1
            continue
        pid = str(p.get("id"))
        try:
            ts = int(parse_iso(p.get("created_at")).timestamp())
        except Exception:  # noqa
            ignored += 1
            continue
        idx = None
        for k, (a, b) in enumerate(bounds):
            if a <= ts < b:
                idx = k
                break
        if idx is None:
            for k, (a, b) in enumerate(pre_bounds):
                if a <= ts < b and pid not in seen:
                    seen.add(pid)
                    verdict, info = classify(p, me_id)
                    if verdict == "ok":
                        r = row_of(p, info[0], info[1], 0)
                        pre_eng[k] += eng(r)
            continue
        if pid in seen:
            continue
        seen.add(pid)
        verdict, info = classify(p, me_id)
        if verdict == "rt":
            rts += 1
            continue
        if verdict == "skip":
            ignored += 1
            continue
        kind, selfr = info
        buckets[idx][pid] = row_of(p, kind, selfr, ts - bounds[idx][0])
    day_rows = [sorted(b.values(), key=lambda r: (r[0], r[7] or "")) for b in buckets]

    # status: engagement / median of up to 7 previous days
    eng_total = []
    for rows in day_rows:
        have = [r for r in rows if any(x is not None for x in r[2:7])]
        eng_total.append(sum(eng(r) for r in rows) if (have or not rows) else None)
    hist = {}
    for h in cfg.get("status_history") or []:
        try:
            if isinstance(h, dict) and h.get("engagement") is not None:
                hist[str(h["date"])] = float(h["engagement"])
        except Exception:  # noqa
            pass
    pool = dict(hist)
    for d, e in zip(pre_dates, pre_eng):
        pool[d.isoformat()] = float(e)
    for d, e in zip(dates, eng_total):
        if e is not None:
            pool[d.isoformat()] = float(e)
    statuses = []
    for d, e in zip(dates, eng_total):
        prev = sorted(k for k in pool if k < d.isoformat())[-7:]
        base = [pool[k] for k in prev]
        if e is None or len(base) < 3 or statistics.median(base) <= 0:
            statuses.append(None)
            continue
        ratio = round(e / statistics.median(base), 3)
        tier = 0 if ratio >= 1.5 else 1 if ratio >= 1.0 else 2 if ratio >= 0.7 else 3 if ratio >= 0.4 else 4
        statuses.append(
            {
                "tier": tier,
                "ratio": ratio,
                "note": {
                    "en": "Engagement vs the median of the previous %d days." % len(base),
                    "zh": "互动对比前 %d 天的中位数。" % len(base),
                },
            }
        )

    # followers
    gap = float(cfg.get("snapshot_max_gap_hours", 36)) * 3600
    tol = float(cfg.get("snapshot_tolerance_minutes", 30)) * 60
    snaps = []
    for s in cfg.get("followers_snapshots") or []:
        try:
            c = num(s.get("count"))
            if c is not None:
                snaps.append((int(parse_iso(s.get("at")).timestamp()), c))
        except Exception:  # noqa
            pass
    snaps.sort()
    fol = []
    for (a, b) in bounds:
        before = [s for s in snaps if s[0] <= a + tol]
        after = [s for s in snaps if s[0] >= b - tol]
        cb = [s for s in before if a - s[0] <= gap]
        ce = [s for s in after if s[0] - b <= gap]
        base = min(cb, key=lambda s: abs(s[0] - a)) if cb else None
        end = min(ce, key=lambda s: abs(s[0] - b)) if ce else None
        if base and end:
            chain = [s for s in snaps if base[0] <= s[0] <= end[0]]
            segs = []
            carry = 0  # a dip (unfollows) is netted against the next gain so that the segments never add up to more than the net delta
            for x, y in zip(chain, chain[1:]):
                d = y[1] - x[1] + carry
                if d <= 0:
                    carry = d
                    continue
                carry = 0
                segs.append({"fromISO": iso_z(x[0]), "toISO": iso_z(y[0]), "delta": d})
            over = sum(g["delta"] for g in segs) - (end[1] - base[1])
            while over > 0 and segs:
                cut = min(over, segs[-1]["delta"])
                segs[-1]["delta"] -= cut
                over -= cut
                if segs[-1]["delta"] == 0:
                    segs.pop()
            fol.append({"current": end[1], "delta": end[1] - base[1], "baselineAt": iso_z(base[0]), "firstRun": False, "segments": segs})
        else:
            fol.append({"current": end[1] if end else None, "delta": None, "baselineAt": None, "firstRun": len(before) == 0})

    avatar = cfg.get("avatar")
    acc = cfg.get("account") or {}
    mf = cfg.get("metricsFetchedAt")
    mfs = iso_z(int(parse_iso(mf).timestamp())) if mf else None
    max_bytes = max_bytes or int(cfg.get("max_bytes") or DEFAULT_MAX)

    bi = template_text.index(MARK_B)
    ei = template_text.index(MARK_E)
    head = template_text[: bi + len(MARK_B)]
    tail = template_text[ei:]

    def data_for(cap):
        days = []
        omitted = []
        for d, rows, st, fo in zip(dates, day_rows, statuses, fol):
            shown = rows
            if cap is not None and len(rows) > cap:
                top = sorted(rows, key=lambda r: (-score(r), r[0]))[:cap]
                shown = sorted(top, key=lambda r: (r[0], r[7] or ""))
                omitted.append((d.isoformat(), len(shown), len(rows)))
            days.append({"date": d.isoformat(), "posts": shown, "followers": fo, "status": st})
        extra = []
        if omitted:
            en = "Size limit: kept the top posts per day by engagement + impressions (" + "; ".join("%s: %d of %d" % o for o in omitted) + "). Omitted posts are not drawn and not counted in the board totals."
            zh = "体积上限：每天只保留互动 + 曝光最高的帖子（" + "；".join("%s：%d/%d 条" % o for o in omitted) + "）。未显示的帖子不绘制，也不计入中央累计。"
            extra.append({"en": en, "zh": zh})
        data = {
            "mode": "personal",
            "lang": lang,
            "example": bool(cfg.get("example", False)),
            "account": {"name": acc.get("name") or "", "username": acc.get("username") or ""},
            "avatar": avatar if avatar else None,
            "tz": {"iana": zone.iana, **({"label": tzc["label"]} if tzc.get("label") else {})},
            "days": days,
            "footnotes": {"metricsFetchedAt": mfs, "retweetsExcluded": rts, "extra": extra},
        }
        # one post row per line (readable diffs, and the page can be pasted in chunks); the rows are dumped separately so a newline can never land inside a string
        dump = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"))  # noqa: E731
        saved = [d["posts"] for d in days]
        for i, d in enumerate(days):
            d["posts"] = "@@ROWS%d@@" % i
        text = dump(data)
        for i, rows_i in enumerate(saved):
            days[i]["posts"] = rows_i
            text = text.replace('"@@ROWS%d@@"' % i, "[\n" + ",\n".join(dump(r) for r in rows_i) + "\n]" if rows_i else "[]", 1)
        block = "\n// Generated by tools/fill_data.py. Do not edit by hand.\nconst DATA: Data = " + text + ";\n"
        return block, omitted

    def page_for(cap):
        block, om = data_for(cap)
        return head + block + tail, om

    page, om = page_for(None)
    cap_used = None
    if len(page.encode("utf-8")) > max_bytes:
        lo, hi = 0, max(len(r) for r in day_rows)
        if len(page_for(0)[0].encode("utf-8")) > max_bytes:
            raise OverflowError("page does not fit %d bytes even without posts" % max_bytes)
        while lo < hi:  # largest cap that fits
            mid = (lo + hi + 1) // 2
            if len(page_for(mid)[0].encode("utf-8")) <= max_bytes:
                lo = mid
            else:
                hi = mid - 1
        cap_used = lo
        page, om = page_for(cap_used)
    summary = {
        "bytes": len(page.encode("utf-8")),
        "max_bytes": max_bytes,
        "lang": lang,
        "tz": zone.iana,
        "days": [
            {"date": d.isoformat(), "start": iso_z(a), "end": iso_z(b), "hours": round((b - a) / 3600, 2), "posts_total": len(rows),
             "posts_shown": len(rows) if cap_used is None else min(len(rows), cap_used), "tier": (st or {}).get("tier"), "ratio": (st or {}).get("ratio"),
             "followers_delta": fo.get("delta")}
            for d, (a, b), rows, st, fo in zip(dates, bounds, day_rows, statuses, fol)
        ],
        "retweets_dropped": rts,
        "ignored": ignored,
        "cap_per_day": cap_used,
        "omitted": [{"date": d, "shown": s, "total": t} for d, s, t in om],
    }
    return page, summary


def main(argv=None):
    ap = argparse.ArgumentParser(description="Build the X Pulse page file from raw X API data.")
    ap.add_argument("input", help="input JSON file, or - for stdin")
    ap.add_argument("--out", required=True, help="page file to write (tsx)")
    here = os.path.dirname(os.path.abspath(__file__))
    cands = [os.path.join(here, "..", "dist", "x-pulse-replay.min.tsx"), os.path.join(here, "..", "x-pulse-replay.min.tsx")]
    ap.add_argument("--min", default=next((c for c in cands if os.path.exists(c)), cands[0]), help="minified renderer (default: ../dist/x-pulse-replay.min.tsx)")
    ap.add_argument("--max-bytes", type=int, default=None)
    a = ap.parse_args(argv)
    try:
        cfg = json.load(sys.stdin if a.input == "-" else open(a.input, encoding="utf-8"))
        tpl = open(a.min, encoding="utf-8").read()
        page, summary = build(cfg, tpl, a.max_bytes)
    except OverflowError as e:
        sys.stderr.write("fill_data: %s\n" % e)
        return 3
    except Exception as e:  # noqa
        sys.stderr.write("fill_data: bad input: %s: %s\n" % (type(e).__name__, e))
        return 2
    with open(a.out, "w", encoding="utf-8") as f:
        f.write(page)
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
