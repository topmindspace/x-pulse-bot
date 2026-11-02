import { useEffect, useRef, useState, useGrokTheme, Toggle } from "grok/canvas";
import type { ChangeEvent, PointerEvent } from "grok/canvas";

// =====================================================================================================
// X Pulse · daily replay renderer (generic, data-free)
// Renderer version 3.0.0 (2026-11-02): 1-7 calendar days in the owner's IANA time zone (DST-aware), date chips, slim compact posts,
// in-page EN / 中文 switch. Bump this line when the renderer changes.
//
// This file is a READ-ONLY, NO-NETWORK canvas page. Everything it shows comes from the single DATA object
// below. A Grok Bot fills DATA from the X API (and its own stored baseline), replaces ONLY the DATA block
// between the "BEGIN DATA" / "END DATA" markers, and passes the whole file to WriteCanvas.
// Do not add fetch / XMLHttpRequest / WebSocket / any external URL loading here. Do not touch anything
// outside the DATA block unless you are changing the renderer itself.
//
// DATA schema v3 (see README.md for the full description):
//   lang        "en" | "zh"                      Initial UI language (the owner's Grok Bot language; missing/unknown => "en"). The viewer can switch EN / 中文 on the page.
//   example     boolean                          true => placeholder data; the page says so in subtitle and footer.
//   account     { name, username }               display name and handle (with or without a leading "@").
//   avatar      { size, palette, indices } | null   96x96 pixels, see tools/build_avatar.py; null => a letter placeholder.
//   tz          { iana, label? }                 IANA zone of the owner, e.g. "Asia/Shanghai", "America/New_York", "Asia/Kathmandu".
//                                                Day boundaries (local 00:00 to the next local 00:00) and every displayed time come from it with
//                                                Intl, so DST (23 h / 25 h days) and half-hour / 45-minute offsets work. label is only a display name.
//                                                Fallback without iana: tz.offsetMinutes (fixed offset).
//   days        1..7 entries, oldest first, the LAST one is selected on load. Each entry:
//                 date       "YYYY-MM-DD" local calendar day
//                 posts      compact arrays, one per post (retweets are NOT included):
//                              [ t, flags, impressions, likes, reposts, replies, quotes, id, snippet ]
//                                t        unix seconds (number), seconds since the start of that local day (number < 1e8, shortest), or an ISO string
//                                flags    kind (0 post, 1 reply, 2 quote) + 4 when it is a reply to the owner's own post
//                                metrics  number or null (null = missing, never estimated)
//                                id       tweet id string (digits) or null; the link is built as https://x.com/i/status/<id>
//                                snippet  short text for the hover card (<= ~20 characters) or null; cut to 40 characters (by grapheme) if longer
//                              Legacy object posts { t, kind, selfThread, text, impressions, likes, reposts, replies, quotes, url } are also accepted.
//                 followers  { current, delta, baselineAt, firstRun, segments? }
//                              current   follower count (null if unknown); delta net change since the stored baseline (null when none);
//                              baselineAt ISO time or null; firstRun true when no baseline existed (delta must then be null);
//                              segments  optional [{ fromISO, toISO, delta }] snapshot intervals used to place follow particles
//                 status     { tier, ratio, note } | null    tier 0..4 (0 on fire, 1 rising, 2 steady, 3 charging up, 4 resting),
//                              ratio = that day / baseline multiple (number or null), note = string OR { en?, zh? } (a plain string is shown only
//                              while the page language matches it: CJK text => zh, otherwise en)
//   footnotes   { metricsFetchedAt, retweetsExcluded, extra }
//                 metricsFetchedAt ISO time or null (also decides which day counts as "Yesterday"); retweetsExcluded number or null;
//                 extra = (string | { en?, zh? })[] (plain strings are always shown).
// Legacy v2 DATA (window { startISO, endISO, tz{label, offsetMinutes} }, posts, followers, status at top level) still renders as one day.
// =====================================================================================================

type Num = number | null;
type Note = string | { en?: string; zh?: string };
type PostIn = (number | string | null)[] | { t: string | number; kind?: string; selfThread?: boolean; text?: string | null; impressions?: Num; likes?: Num; reposts?: Num; replies?: Num; quotes?: Num; url?: string | null };
interface FolIn {
  current: Num;
  delta: Num;
  baselineAt: string | null;
  firstRun: boolean;
  segments?: { fromISO: string; toISO: string; delta: number }[];
}
interface StatusIn {
  tier: number;
  ratio: Num;
  note: Note;
}
interface TzIn {
  iana?: string;
  label?: string;
  offsetMinutes?: number;
}
interface Data {
  lang: string;
  example: boolean;
  account: { name: string; username: string };
  avatar: { size: number; palette: string; indices: string } | null;
  tz?: TzIn;
  days?: { date: string; posts: PostIn[]; followers: FolIn; status: StatusIn | null }[];
  footnotes: { metricsFetchedAt: string | null; retweetsExcluded: Num; extra: Note[] };
  // legacy v2 (single rolling window)
  window?: { startISO: string; endISO: string; tz?: TzIn };
  posts?: PostIn[];
  followers?: FolIn;
  status?: StatusIn | null;
}

// ===== BEGIN DATA =====
// EXAMPLE DATA ONLY: a made-up account with made-up posts so that this file renders on its own.
// A Grok Bot must replace everything between BEGIN DATA and END DATA with the real data and set example: false.
const DATA: Data = {
  lang: "en",
  example: true,
  account: { name: "Example Account", username: "example_user" },
  avatar: null,
  tz: { iana: "Asia/Shanghai" },
  days: [
    {
      date: "2026-01-01",
      posts: [
        ["2026-01-01T08:12:00+08:00", 0, 1200, 14, 2, 3, 0, null, "Example post: good morning"],
        ["2026-01-01T09:40:00+08:00", 1, 85, 1, 0, 0, 0, null, "@someone Example reply"],
        ["2026-01-01T12:05:00+08:00", 2, 640, 9, 1, 1, 0, null, "Example quote post"],
        ["2026-01-01T12:20:00+08:00", 5, 210, 3, 0, 0, 0, null, "Example self-reply"],
        ["2026-01-01T15:30:00+08:00", 0, null, null, null, null, null, null, "Example, missing metrics"],
        ["2026-01-01T19:45:00+08:00", 0, 3100, 42, 6, 8, 2, null, "Example evening post"],
        ["2026-01-01T22:10:00+08:00", 1, 40, 0, 0, 0, 0, null, "@someone Example late reply"],
      ],
      followers: { current: 1000, delta: null, baselineAt: null, firstRun: true },
      status: null,
    },
  ],
  footnotes: { metricsFetchedAt: null, retweetsExcluded: null, extra: [] },
};
// ===== END DATA =====

// ---------- everything below is the renderer; it only reads DATA ----------
type Lang = "en" | "zh";
// Language is React state in <Replay>; LANG mirrors it for the module-level helpers and the canvas drawing code (set at the top of every render, read at call time).
function normLang(x: unknown): Lang {
  return typeof x === "string" && x.toLowerCase().indexOf("zh") === 0 ? "zh" : "en";
}
const LANG0: Lang = normLang(DATA.lang);
let LANG: Lang = LANG0;
function tx(zh: string, en: string): string {
  return LANG === "zh" ? zh : en;
}
// A bot-written note: { en, zh } picks the current language; a plain string counts as zh if it contains CJK characters, otherwise en, and is shown only in its own language
function pickNote(n: unknown): string {
  if (typeof n === "string") return /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(n) === (LANG === "zh") ? n : "";
  if (n !== null && typeof n === "object") {
    const v = (n as { en?: unknown; zh?: unknown })[LANG];
    return typeof v === "string" ? v : "";
  }
  return "";
}
const LANG_KEY = "xpulse.lang";
// The viewer's last choice is remembered only while DATA.lang is unchanged (so a changed Grok Bot language wins); every storage failure is ignored (sandboxed pages)
function initialLang(): Lang {
  try {
    const raw = window.localStorage.getItem(LANG_KEY);
    if (raw !== null) {
      const o = JSON.parse(raw) as { lang?: unknown; base?: unknown };
      if (o.base === LANG0 && (o.lang === "en" || o.lang === "zh")) return o.lang;
    }
  } catch {
    // no storage or bad value: use DATA.lang
  }
  return LANG0;
}
function saveLang(l: Lang): void {
  try {
    window.localStorage.setItem(LANG_KEY, JSON.stringify({ lang: l, base: LANG0 }));
  } catch {
    // storage not available
  }
}
// prefers-reduced-motion: no autoplay, no dial shake, no end-of-day flash (the viewer can still press Play)
const REDUCED: boolean = (() => {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
})();
const KIND_OF: Record<string, number> = { post: 0, reply: 1, quote: 2 };
const kindName = (i: number): string => [tx("发帖", "Posts"), tx("回复", "Replies"), tx("引用", "Quotes")][i];
const SAFE_URL = /^https:\/\/(x|twitter)\.com\//;
const NAME = DATA.account.name.trim();
const USERNAME = DATA.account.username.trim().replace(/^@+/, "");
const HANDLE = USERNAME === "" ? "" : "@" + USERNAME;
const MAX_DAYS = 7;
const SNIP = 40;

// ---------- time zone: everything goes through Intl, so DST and odd offsets (+05:30, +05:45, Lord Howe 30-min DST) just work ----------
interface LP {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}
const TZ_IN: TzIn = (DATA.tz ?? (DATA.window ? DATA.window.tz : undefined) ?? {}) as TzIn;
let TZ_ERR: string | null = null;
let TZ_FMT: Intl.DateTimeFormat | null = null;
let TZ_FIXED = 0; // seconds, used only when there is no iana
if (typeof TZ_IN.iana === "string" && TZ_IN.iana !== "") {
  try {
    TZ_FMT = new Intl.DateTimeFormat("en-US", { timeZone: TZ_IN.iana, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" } as Intl.DateTimeFormatOptions);
  } catch {
    TZ_ERR = "DATA.tz.iana “" + TZ_IN.iana + "” is not a known time zone";
  }
} else if (typeof TZ_IN.offsetMinutes === "number" && Number.isFinite(TZ_IN.offsetMinutes)) {
  TZ_FIXED = Math.round(TZ_IN.offsetMinutes * 60);
} else {
  TZ_ERR = "DATA.tz.iana is missing (for example \"Asia/Shanghai\")";
}
const TZ_LABEL: string = typeof TZ_IN.label === "string" && TZ_IN.label !== "" ? TZ_IN.label : TZ_FMT !== null ? (TZ_IN.iana as string) : "UTC" + (TZ_FIXED < 0 ? "−" : "+") + pad2(Math.floor(Math.abs(TZ_FIXED) / 3600)) + ":" + pad2(Math.round((Math.abs(TZ_FIXED) % 3600) / 60));
// Local wall-clock parts of a unix instant in the owner's zone
function lparts(utcS: number): LP {
  const sec = Math.floor(utcS);
  if (TZ_FMT === null) {
    const d = new Date((sec + TZ_FIXED) * 1000);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
  }
  const o: Record<string, number> = {};
  for (const p of TZ_FMT.formatToParts(new Date(sec * 1000))) if (p.type !== "literal") o[p.type] = parseInt(p.value, 10);
  return { y: o.year, mo: o.month, d: o.day, h: (o.hour || 0) % 24, mi: o.minute || 0, s: o.second || 0 };
}
const dkey = (p: { y: number; mo: number; d: number }): number => p.y * 10000 + p.mo * 100 + p.d;
// First instant whose local date is >= the given calendar day (handles a skipped or repeated local midnight)
function localDayStart(y: number, mo: number, d: number): number {
  const guess = Date.UTC(y, mo - 1, d) / 1000;
  if (TZ_FMT === null) return guess - TZ_FIXED;
  const target = y * 10000 + mo * 100 + d;
  const step = 900;
  for (let t = guess - 15 * 3600; t <= guess + 14 * 3600; t += step) {
    if (dkey(lparts(t)) >= target) {
      for (let b = t - step + 60; b < t; b += 60) if (dkey(lparts(b)) >= target) return b;
      return t;
    }
  }
  return guess;
}
function parseDay(s: unknown): [number, number, number] | null {
  const m = typeof s === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null;
  if (m === null) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  const c = new Date(Date.UTC(y, mo - 1, d));
  return c.getUTCFullYear() === y && c.getUTCMonth() === mo - 1 && c.getUTCDate() === d ? [y, mo, d] : null;
}
function nextDay(a: [number, number, number]): [number, number, number] {
  const c = new Date(Date.UTC(a[0], a[1] - 1, a[2] + 1));
  return [c.getUTCFullYear(), c.getUTCMonth() + 1, c.getUTCDate()];
}
const dstr = (a: [number, number, number]): string => a[0] + "-" + pad2(a[1]) + "-" + pad2(a[2]);

// ---------- input normalisation ----------
interface PostN {
  s: number; // unix seconds
  kind: number;
  self: boolean;
  text: string;
  v: Num;
  l: Num;
  r: Num;
  c: Num;
  q: Num;
  url: string | null;
}
interface DayM {
  date: string;
  ymd: [number, number, number];
  startS: number;
  len: number;
  posts: PostN[];
  fol: FolIn;
  status: StatusIn | null;
}
const num = (x: unknown): Num => (typeof x === "number" && Number.isFinite(x) ? x : null);
// Cut to n user-perceived characters (grapheme clusters when Intl.Segmenter exists, code points otherwise) so emoji and combining marks are never split
function clip(s: string, n: number): string {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (x: string) => Iterable<{ segment: string }> } }).Segmenter;
  const parts: string[] = [];
  if (Seg) {
    try {
      for (const g of new Seg(undefined, { granularity: "grapheme" }).segment(s)) parts.push(g.segment);
    } catch {
      parts.length = 0;
    }
  }
  const a = parts.length > 0 ? parts : Array.from(s);
  return a.length > n ? a.slice(0, n - 1).join("") + "…" : s;
}
function timeOf(t: unknown): number {
  if (typeof t === "number") return Number.isFinite(t) ? (t > 1e11 ? t / 1000 : t) : NaN;
  return typeof t === "string" ? Date.parse(t) / 1000 : NaN;
}
function normPost(raw: PostIn): PostN | null {
  if (raw === null || typeof raw !== "object") return null;
  if (Array.isArray(raw)) {
    const s = timeOf(raw[0]);
    if (!Number.isFinite(s)) return null;
    const fl = typeof raw[1] === "number" ? raw[1] : 0;
    const id = typeof raw[7] === "string" && /^\d{1,25}$/.test(raw[7]) ? raw[7] : null;
    return { s, kind: Math.min(2, fl & 3), self: (fl & 4) !== 0, text: typeof raw[8] === "string" ? clip(raw[8], SNIP) : "", v: num(raw[2]), l: num(raw[3]), r: num(raw[4]), c: num(raw[5]), q: num(raw[6]), url: id === null ? null : "https://x.com/i/status/" + id };
  }
  const s = timeOf(raw.t);
  if (!Number.isFinite(s)) return null;
  const txt = typeof raw.text === "string" ? raw.text : "";
  return { s, kind: KIND_OF[raw.kind ?? "post"] ?? 0, self: raw.selfThread === true, text: clip(txt, SNIP), v: num(raw.impressions), l: num(raw.likes), r: num(raw.reposts), c: num(raw.replies), q: num(raw.quotes), url: typeof raw.url === "string" && SAFE_URL.test(raw.url) ? raw.url : null };
}
function normFol(f: FolIn | undefined): FolIn {
  return f && typeof f === "object" ? f : { current: null, delta: null, baselineAt: null, firstRun: false };
}
function buildDays(): DayM[] {
  const out: DayM[] = [];
  if (TZ_ERR !== null) return out;
  const posts = (arr: PostIn[] | undefined, a: number, b: number): PostN[] => {
    const r: PostN[] = [];
    for (const p of Array.isArray(arr) ? arr : []) {
      // a numeric t below 1e8 is "seconds since the start of this local day" (shorter than a unix time)
      const n = normPost(Array.isArray(p) && typeof p[0] === "number" && p[0] < 1e8 ? [p[0] + a, ...p.slice(1)] : p);
      if (n !== null && n.s >= a && n.s <= b) r.push(n);
    }
    return r;
  };
  if (Array.isArray(DATA.days) && DATA.days.length > 0) {
    for (const d of DATA.days.slice(-MAX_DAYS)) {
      const ymd = parseDay(d.date);
      if (ymd === null) continue;
      const startS = localDayStart(ymd[0], ymd[1], ymd[2]);
      const nx = nextDay(ymd);
      const len = localDayStart(nx[0], nx[1], nx[2]) - startS;
      if (!(len > 3600 * 12 && len < 3600 * 36)) continue;
      out.push({ date: dstr(ymd), ymd, startS, len, posts: posts(d.posts, startS, startS + len), fol: normFol(d.followers), status: d.status ?? null });
    }
  } else if (DATA.window) {
    const startS = Date.parse(DATA.window.startISO) / 1000;
    if (Number.isFinite(startS)) {
      const lp = lparts(startS);
      const ymd: [number, number, number] = [lp.y, lp.mo, lp.d];
      out.push({ date: dstr(ymd), ymd, startS, len: 86400, posts: posts(DATA.posts, startS, startS + 86400), fol: normFol(DATA.followers), status: DATA.status ?? null });
    }
  }
  return out;
}
const DAYS: DayM[] = buildDays();
const BAD_DATA: string | null = TZ_ERR !== null ? TZ_ERR : DAYS.length === 0 ? "DATA.days is empty or has no valid date (use \"YYYY-MM-DD\")" : null;
// "Yesterday" = the local day before the day the metrics were fetched
const ASOF = typeof DATA.footnotes.metricsFetchedAt === "string" && BAD_DATA === null ? Date.parse(DATA.footnotes.metricsFetchedAt) / 1000 : NaN;
const ASOF_KEY = Number.isFinite(ASOF) ? dkey(lparts(ASOF)) : -1;
const isYesterday = (d: DayM): boolean => {
  const nx = nextDay(d.ymd);
  return ASOF_KEY > 0 && nx[0] * 10000 + nx[1] * 100 + nx[2] === ASOF_KEY;
};

// ---------- the selected day (selectDay() at the bottom of the file fills these; the drawing code reads them at call time) ----------
let CUR_DAY = -1;
let DAY = 86400; // real length of the selected day in seconds (82800 / 90000 on DST days): one hand turn
let START_S = 0;
let FOL: FolIn = { current: null, delta: null, baselineAt: null, firstRun: false };
let HAS_FOL = false;
let FOLLOW_DELTA = 0;
let FOLLOW_NOW: Num = null;
let STATUS: StatusIn | null = null;
let HAS_STATUS = false;
let TIER = 2;
const tierRule = (): string => tx("≥1.5 高光 · 1.0–1.5 上扬 · 0.7–1.0 稳定 · 0.4–0.7 蓄力 · <0.4 充电", "≥1.5 standout · 1.0–1.5 rising · 0.7–1.0 steady · 0.4–0.7 building · <0.4 recharge");
// Word for "that day" in labels: Yesterday when the selected day is yesterday, otherwise a neutral word
let IS_YDAY = false;
const wday = (a: [number, number, number]): string => {
  try {
    return new Intl.DateTimeFormat(LANG === "zh" ? "zh-CN" : "en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(a[0], a[1] - 1, a[2], 12)));
  } catch {
    return "";
  }
};
const dayWord = (): string => (IS_YDAY ? tx("昨日", "Yesterday") : tx("当日", "That day"));

const COLS: number[][] = [
  [255, 183, 3],
  [76, 201, 240],
  [247, 37, 133],
];
const PART_RGB = [124, 255, 178];

interface Tier {
  name: string;
  line: string;
  rgb: number[];
}
const TIERS: Tier[] = [
  { get name() { return tx("高光日", "Standout day"); }, get line() { return tx("全天火力全开", "Full power all day"); }, rgb: [255, 170, 70] },
  { get name() { return tx("上扬日", "Rising day"); }, get line() { return tx("光环正在升起", "The glow is rising"); }, rgb: [255, 214, 102] },
  { get name() { return tx("稳定日", "Steady day"); }, get line() { return tx("心跳平稳，节奏在线", "Steady heartbeat, right on rhythm"); }, rgb: [255, 120, 150] },
  { get name() { return tx("蓄力日", "Building day"); }, get line() { return tx("积蓄能量，好戏在后面", "Gathering energy, the best is yet to come"); }, rgb: [124, 224, 150] },
  { get name() { return tx("充电日", "Recharge day"); }, get line() { return tx("静心充电，下次更精彩", "Recharging for a stronger next time"); }, rgb: [150, 175, 255] },
];
// Live status: how intense the playhead's last hour is. Every post adds a weight (1..3: its engagement and impressions relative to this day's
// median) that decays with a 20-minute time constant (about one hour of memory). The five levels are cut at quantiles of this day's own
// timeline with absolute floors (a sparse day never "erupts"); the shown level moves with smoothing, hysteresis and a minimum dwell time.
const LIVE_RGB: number[][] = [[150, 175, 255], [124, 224, 150], [255, 214, 102], [255, 150, 70], [255, 92, 110]];
const liveNames = (): string[] => [tx("静候", "Calm"), tx("升温", "Warming up"), tx("活跃", "Active"), tx("火热", "On fire"), tx("爆发", "Erupting")];
const LIVE_TAU = 1200;
const LIVE_WIN = 3600;
const LIVE_ABS = [0.15, 0.6, 1.5, 3];
const LIVE_Q = [0.4, 0.65, 0.85, 0.95];
let LIVE_T: number[] = LIVE_ABS.slice();
let NODE_P: number[] = [];
const LIVE: { raw: number; sm: number; lvl: number; k: number; t: number; cur: number; at: number; prev: number; init: boolean } = { raw: 0, sm: 0, lvl: 0, k: 0, t: 0, cur: 0, at: -1e9, prev: 0, init: false };

interface DrawOpts {
  tier: number;
  showFollow: boolean;
  showTime: boolean;
  style: number; // 0 Neuron  1 Galaxy  2 Neon wave
  fin: number; // end-of-turn flash progress 0..1, -1 = not triggered
  vis: Vis;
}
interface Vis {
  avatar: boolean;
  status: boolean;
  posts: boolean;
  handle: boolean;
  name: boolean;
  follow: boolean;
  fans: boolean;
  imp: boolean;
  eng: boolean;
  text: boolean;
  legend: boolean;
  time: boolean;
  foot: boolean;
}
// Items missing from the selected day's data (no status, no follower baseline, no follower count, no name, no post text) are switched off and hidden from the toggle panel
const VIS_TRUE: Vis = { avatar: true, status: true, posts: true, handle: true, name: true, follow: true, fans: true, imp: true, eng: true, text: true, legend: true, time: true, foot: true };
let AVAIL: Vis = VIS_TRUE;
let VIS_TOTAL = 0;
const VIS_NONE: Vis = { avatar: false, status: false, posts: false, handle: false, name: false, follow: false, fans: false, imp: false, eng: false, text: false, legend: false, time: false, foot: false };
const visGroups = (): { title: string; items: [keyof Vis, string][] }[] => [
  { title: tx("身份", "Identity"), items: [["avatar", tx("头像", "Avatar")], ["name", tx("账号名「" + NAME + "」", "Name “" + NAME + "”")], ["handle", tx("用户名 ", "Handle ") + HANDLE]] },
  { title: tx("核心指标", "Metrics"), items: [["follow", tx("关注变化", "Follower change")], ["fans", tx("粉丝数", "Followers")], ["imp", tx("曝光数", "Impressions")], ["eng", tx("互动数", "Engagement")], ["posts", tx("发帖/回复/引用条数", "Posts / replies / quotes")], ["status", tx("实时状态与当日评级", "Live status and day rating")]] },
  { title: tx("画面元素", "Elements"), items: [["text", tx("帖子文字", "Post text")], ["legend", tx("图例", "Legend")], ["time", tx("时间刻度与当前时间", "Time ticks and clock")], ["foot", tx("脚注", "Footnotes")]] },
].map((g) => ({ title: g.title, items: g.items.filter((it) => AVAIL[it[0] as keyof Vis]) as [keyof Vis, string][] }));

interface NodeT {
  idx: number;
  url: string | null;
  ts: number;
  kind: number;
  self: boolean;
  text: string;
  v: Num;
  l: Num;
  r: Num;
  c: Num;
  q: Num;
  ang: number;
  lr: number;
  bright: number;
  rip: number;
  tier: number; // 0 ordinary, 1 notable, 2 major shockwave (ranked by impressions + engagement relative to this day's data)
}
interface PartT {
  ts: number;
  a: number;
  s: number;
}

function frac(x: number): number {
  return x - Math.floor(x);
}

function iso2s(iso: string): number {
  return Date.parse(iso) / 1000 - START_S;
}

function buildNodes(): NodeT[] {
  const rows: { s: number; p: PostN }[] = [];
  for (const p of DAYS[CUR_DAY].posts) {
    const s = p.s - START_S;
    if (s >= 0 && s <= DAY) rows.push({ s, p });
  }
  rows.sort((a, b) => a.s - b.s);
  const eng = (p: PostN): number => (p.l ?? 0) + (p.r ?? 0) + (p.c ?? 0);
  let maxEng = 1;
  let maxV = 1;
  for (const w of rows) {
    if (eng(w.p) > maxEng) maxEng = eng(w.p);
    if ((w.p.v ?? 0) > maxV) maxV = w.p.v ?? 0;
  }
  const out = rows.map((w, i): NodeT => {
    const p = w.p;
    const lane = (i * 5) % 7;
    return {
      idx: i,
      url: p.url,
      ts: w.s,
      kind: p.kind,
      self: p.self,
      text: p.text,
      v: p.v,
      l: p.l,
      r: p.r,
      c: p.c,
      q: p.q,
      ang: (w.s / DAY) * Math.PI * 2 - Math.PI / 2,
      lr: 0.52 + 0.052 * lane + (((i * 37) % 11) / 11) * 0.02,
      bright: Math.log(1 + eng(p)) / Math.log(1 + maxEng),
      rip: p.v === null ? 0 : Math.log10(p.v + 1) / Math.log10(maxV + 1),
      tier: 0,
    };
  });
  // Shockwave tiers are relative to the day: the top ~1.2% (1..5 posts) are major, the next ~6% notable, and only if they clearly stand out
  const wt = (n: NodeT): number => (n.v === null ? 0.5 * n.bright : n.rip + 0.15 * n.bright);
  const rank = out.slice().sort((a, b) => wt(b) - wt(a) || a.idx - b.idx);
  const k2 = Math.max(1, Math.min(5, Math.round(out.length * 0.012)));
  const k1 = Math.max(1, Math.round(out.length * 0.06));
  rank.forEach((n, j) => {
    const w = wt(n);
    if (j < k2 && w >= 0.6) n.tier = 2;
    else if (j < k2 + k1 && w >= 0.45) n.tier = 1;
  });
  return out;
}

// Follower snapshot intervals [from, to (seconds from window start), delta in interval]; for an interval starting before the window only the share inside the window is used
function buildSegs(): [number, number, number][] {
  if (!HAS_FOL || FOLLOW_DELTA <= 0) return [];
  const out: [number, number, number][] = [];
  const raw = FOL.segments;
  if (raw && raw.length > 0) {
    for (const g of raw) {
      const a = iso2s(g.fromISO);
      const b = Math.min(DAY, iso2s(g.toISO));
      if (Number.isFinite(a) && Number.isFinite(b) && b > 0 && b > a && g.delta > 0) out.push([a, b, Math.round(g.delta)]);
    }
    return out;
  }
  const a = FOL.baselineAt !== null ? iso2s(FOL.baselineAt) : 0;
  out.push([Number.isFinite(a) && a < DAY ? a : 0, DAY, FOLLOW_DELTA]);
  return out;
}

function buildParts(): PartT[] {
  const out: PartT[] = [];
  buildSegs().forEach((sg, si) => {
    const a = sg[0];
    const b = sg[1];
    const lo = Math.max(0, a);
    const n = a < 0 ? Math.round((sg[2] * (b - lo)) / (b - a)) : sg[2];
    for (let j = 0; j < n; j++) {
      const ts = lo + ((j + 0.15 + 0.7 * frac(Math.sin((j + 1) * 12.9898 + si * 78.233) * 43758.5453)) / n) * (b - lo);
      out.push({
        ts,
        a: (ts / DAY) * Math.PI * 2 - Math.PI / 2,
        s: frac(Math.sin((j + 3) * 4.1414 + si * 9.17) * 9731.13),
      });
    }
  });
  return out;
}

let NODES: NodeT[] = [];
let PARTS: PartT[] = [];
const COUNT_BY_KIND: number[] = [0, 0, 0];
let SELF_N = 0;
let MISSING_N = 0;
let HAS_IMP = false;
let HAS_ENG = false;
let ANY_TEXT = false;
interface Tick {
  a: number;
  major: boolean;
  label: string;
}
let TICKS: Tick[] = [];

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}
// Seconds into the selected day -> MM-DD HH:mm(:ss) in the owner's time zone (the end of the day reads 24:00 of the same date)
function tzDT(off: number, withSec: boolean): string {
  if (off >= DAY && !withSec) return pad2(DAYS[CUR_DAY].ymd[1]) + "-" + pad2(DAYS[CUR_DAY].ymd[2]) + " 24:00";
  const d = lparts(START_S + off);
  const base = pad2(d.mo) + "-" + pad2(d.d) + " " + pad2(d.h) + ":" + pad2(d.mi);
  return withSec ? base + ":" + pad2(d.s) : base;
}
function tzHM(off: number): string {
  if (off >= DAY) return "24:00";
  const d = lparts(START_S + off);
  return pad2(d.h) + ":" + pad2(d.mi);
}
function fmtIso(iso: string): string {
  const s = iso2s(iso);
  return Number.isFinite(s) ? tzDT(s, false) + " " + TZ_LABEL : iso;
}
function rgba(c: number[], a: number): string {
  return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a.toFixed(3) + ")";
}
function geo(S: number): { cx: number; rim: number; margin: number; sc: number } {
  const margin = Math.max(22, S * 0.065);
  return { cx: S / 2, rim: S / 2 - margin, margin, sc: Math.max(0.55, S / 640) };
}
function nodeXY(i: number, S: number, style: number = 0): [number, number] {
  const g = geo(S);
  const n = NODES[i];
  let r = g.rim * n.lr;
  if (style === 1) r = g.rim * (0.46 + (n.lr - 0.52) * 1.25);
  if (style === 2) r = g.rim * (0.55 + 0.36 * n.rip);
  return [g.cx + Math.cos(n.ang) * r, g.cx + Math.sin(n.ang) * r];
}
function qpt(x0: number, y0: number, qx: number, qy: number, x1: number, y1: number, t: number): [number, number] {
  const u = 1 - t;
  return [u * u * x0 + 2 * u * t * qx + t * t * x1, u * u * y0 + 2 * u * t * qy + t * t * y1];
}

const TAU2 = Math.PI * 2;
const NEON_CY = [0, 245, 255];
const NEON_PK = [255, 46, 196];
const SWEEP_RGB: number[][] = [[150, 200, 255], [255, 214, 150], [255, 46, 196]];
const styleNames = (): string[] => [tx("神经元", "Neuron"), tx("星系", "Galaxy"), tx("霓虹声波", "Neon wave")];
const KCOLS: number[][][] = [
  COLS,
  [[255, 205, 110], [130, 210, 255], [255, 120, 190]],
  [[255, 225, 40], [0, 240, 255], [255, 50, 205]],
];
function kcol(style: number, k: number): number[] {
  return KCOLS[style][k];
}

const SPRM = new Map<number, HTMLCanvasElement>();
function sprite(c: number[]): HTMLCanvasElement {
  const key = c[0] * 65536 + c[1] * 256 + c[2];
  const had = SPRM.get(key);
  if (had) return had;
  const cv = document.createElement("canvas");
  cv.width = 64;
  cv.height = 64;
  const x = cv.getContext("2d");
  if (x) {
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.16, rgba(c, 0.95));
    gr.addColorStop(0.5, rgba(c, 0.28));
    gr.addColorStop(1, rgba(c, 0));
    x.fillStyle = gr;
    x.fillRect(0, 0, 64, 64);
  }
  SPRM.set(key, cv);
  return cv;
}
function glowAt(ctx: CanvasRenderingContext2D, c: number[], x: number, y: number, r: number, a: number): void {
  if (a <= 0.003 || r <= 0.3) return;
  ctx.globalAlpha = Math.min(1, a);
  ctx.drawImage(sprite(c), x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
}

function drawTicks(x: CanvasRenderingContext2D, S: number, c: number[], showTime: boolean, font: string): void {
  const g = geo(S);
  for (const tk of TICKS) {
    const a = tk.a;
    const major = tk.major;
    const len = (major ? 10 : 4) * g.sc;
    x.strokeStyle = rgba(c, major ? 0.7 : 0.28);
    x.lineWidth = 1;
    x.beginPath();
    x.moveTo(g.cx + Math.cos(a) * (g.rim - len), g.cx + Math.sin(a) * (g.rim - len));
    x.lineTo(g.cx + Math.cos(a) * g.rim, g.cx + Math.sin(a) * g.rim);
    x.stroke();
    if (major && showTime) {
      x.fillStyle = rgba(c, 0.85);
      x.font = Math.max(9, 11 * g.sc) + "px " + font;
      x.textAlign = "center";
      x.textBaseline = "middle";
      const lr = g.rim + g.margin * 0.55;
      x.fillText(tk.label, g.cx + Math.cos(a) * lr, g.cx + Math.sin(a) * lr);
    }
  }
}

// Static background layer cached on an offscreen canvas: stars, grid, orbits, ticks
const BG = new Map<string, HTMLCanvasElement>();
function bgLayer(style: number, S: number, showTime: boolean, font: string): HTMLCanvasElement | null {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const key = style + "|" + S + "|" + dpr + "|" + (showTime ? 1 : 0) + "|" + CUR_DAY;
  const had = BG.get(key);
  if (had) return had;
  if (BG.size > 9) BG.clear();
  const cv = document.createElement("canvas");
  cv.width = Math.round(S * dpr);
  cv.height = cv.width;
  const x = cv.getContext("2d");
  if (!x) return null;
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  const g = geo(S);
  const cx = g.cx;
  const stars = style === 0 ? 70 : style === 1 ? 170 : 0;
  for (let i = 0; i < stars; i++) {
    const sx = frac(Math.sin(i * 12.9898 + 1.3) * 43758.5453) * S;
    const sy = frac(Math.sin(i * 78.233 + 4.1) * 24634.6345) * S;
    const sz = 0.4 + frac(Math.sin(i * 3.7) * 9301.2) * (style === 1 ? 1.2 : 0.7);
    x.fillStyle = "rgba(200,215,255," + (0.15 + 0.4 * frac(Math.sin(i * 5.1) * 7771.7)).toFixed(2) + ")";
    x.beginPath();
    x.arc(sx, sy, sz * g.sc + 0.2, 0, TAU2);
    x.fill();
  }
  if (style === 0) {
    x.strokeStyle = "rgba(150,190,250,0.04)";
    x.lineWidth = 1;
    for (const tk of TICKS) {
      const a = tk.a;
      x.beginPath();
      x.moveTo(cx + Math.cos(a) * g.rim * 0.45, cx + Math.sin(a) * g.rim * 0.45);
      x.lineTo(cx + Math.cos(a) * g.rim, cx + Math.sin(a) * g.rim);
      x.stroke();
    }
  } else if (style === 1) {
    const nb = (px: number, py: number, r: number, c: number[], a: number) => {
      const gr = x.createRadialGradient(px, py, 0, px, py, r);
      gr.addColorStop(0, rgba(c, a));
      gr.addColorStop(1, rgba(c, 0));
      x.fillStyle = gr;
      x.fillRect(0, 0, S, S);
    };
    nb(S * 0.3, S * 0.3, S * 0.5, [140, 90, 255], 0.13);
    nb(S * 0.72, S * 0.74, S * 0.5, [60, 140, 255], 0.1);
    nb(cx, cx, g.rim * 0.55, [255, 190, 110], 0.16);
    x.strokeStyle = "rgba(190,175,255,0.09)";
    x.lineWidth = 1;
    for (let l = 0; l < 7; l++) {
      x.beginPath();
      x.arc(cx, cx, g.rim * (0.46 + 0.065 * l), 0, TAU2);
      x.stroke();
    }
    x.strokeStyle = "rgba(255,214,150,0.28)";
    x.beginPath();
    x.arc(cx, cx, g.rim, 0, TAU2);
    x.stroke();
    drawTicks(x, S, [255, 214, 150], showTime, font);
  } else {
    x.strokeStyle = rgba(NEON_CY, 0.05);
    x.lineWidth = 1;
    const step = S / 16;
    for (let k = 0; k <= 16; k++) {
      x.beginPath();
      x.moveTo(k * step, 0);
      x.lineTo(k * step, S);
      x.moveTo(0, k * step);
      x.lineTo(S, k * step);
      x.stroke();
    }
    x.strokeStyle = rgba(NEON_PK, 0.42);
    x.lineWidth = 1.2;
    x.beginPath();
    x.arc(cx, cx, g.rim, 0, TAU2);
    x.stroke();
    drawTicks(x, S, NEON_CY, showTime, font);
  }
  BG.set(key, cv);
  return cv;
}

function drawBg(ctx: CanvasRenderingContext2D, S: number, now: number, style: number, opts: DrawOpts, font: string): void {
  const cv = bgLayer(style, S, opts.showTime, font);
  const g = geo(S);
  if (cv) {
    ctx.globalAlpha = 0.78 + 0.22 * Math.sin(now / 1700);
    ctx.drawImage(cv, 0, 0, S, S);
    ctx.globalAlpha = 1;
  }
  if (style < 2) {
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 28; i++) {
      const sx = frac(Math.sin(i * 91.7 + 0.5) * 43758.5453) * S;
      const sy = frac(Math.sin(i * 53.3 + 2.2) * 24634.6345) * S;
      const tw = 0.5 + 0.5 * Math.sin(now / (400 + i * 37) + i);
      glowAt(ctx, [200, 215, 255], sx, sy, (2 + 2 * tw) * g.sc, 0.5 * tw);
    }
    ctx.globalCompositeOperation = "source-over";
  } else {
    const y = (now / 14) % (S + 60) - 30;
    ctx.fillStyle = rgba(NEON_CY, 0.06);
    ctx.fillRect(0, y, S, 2);
    ctx.fillStyle = rgba(NEON_CY, 0.025);
    ctx.fillRect(0, y - 14, S, 14);
  }
}

function setup(canvas: HTMLCanvasElement, S: number): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const px = Math.round(S * dpr);
  if (canvas.width !== px) {
    canvas.width = px;
    canvas.height = px;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.shadowBlur = 0;
  ctx.setLineDash([]);
  ctx.clearRect(0, 0, S, S);
  return ctx;
}

// Hand radar sweep: fading wedge trail + bright edge
function sweep(ctx: CanvasRenderingContext2D, cx: number, r0: number, rim: number, ah: number, c: number[]): void {
  ctx.globalCompositeOperation = "lighter";
  const K = 28;
  for (let k = 0; k < K; k++) {
    const a1 = ah - (k / K) * 1.0;
    const a0 = ah - ((k + 1) / K) * 1.0 - 0.004;
    ctx.fillStyle = rgba(c, 0.15 * Math.pow(1 - k / K, 2));
    ctx.beginPath();
    ctx.arc(cx, cx, rim, a0, a1);
    ctx.arc(cx, cx, r0, a1, a0, true);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = rgba(c, 0.9);
  ctx.lineWidth = 1.6;
  ctx.shadowColor = rgba(c, 1);
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(ah) * r0, cx + Math.sin(ah) * r0);
  ctx.lineTo(cx + Math.cos(ah) * rim, cx + Math.sin(ah) * rim);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = "source-over";
}

function handLabel(ctx: CanvasRenderingContext2D, S: number, ah: number, cur: number, font: string, c: number[]): void {
  const g = geo(S);
  const r = g.rim + g.margin * 0.55;
  const x = g.cx + Math.cos(ah) * r;
  const y = g.cx + Math.sin(ah) * r;
  const txt = tzHM(cur);
  ctx.font = "600 " + Math.max(10, 12 * g.sc) + "px " + font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(txt).width + 10;
  const h = Math.max(10, 12 * g.sc) + 6;
  ctx.fillStyle = "rgba(6,9,18,0.88)";
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.strokeStyle = rgba(c, 0.6);
  ctx.lineWidth = 1;
  ctx.strokeRect(x - w / 2, y - h / 2, w, h);
  ctx.fillStyle = rgba(c, 1);
  ctx.fillText(txt, x, y);
}


// Shockwave life in seconds of dial time (24 h = 30 s of playback at 1x, so 11000 s is about 3.8 s of playback)
const LIFE = [3200, 8000, 11000];
const WHITE = [255, 248, 235];
let BIG_IDX: number[] = [];

// Dial shake and pulse for the major shockwaves: a few pixels, decays within a fraction of a second
function shakeOf(cur: number, sc: number): [number, number, number] {
  if (REDUCED) return [0, 0, 1];
  let dx = 0;
  let dy = 0;
  let k = 1;
  for (const i of BIG_IDX) {
    const n = NODES[i];
    if (n.tier < 2) continue;
    const age = cur - n.ts;
    if (age < 0 || age > 1500) continue;
    const d = Math.pow(1 - age / 1500, 2);
    dx += Math.sin(age * 0.11 + i) * 2.6 * sc * d;
    dy += Math.cos(age * 0.093 + i * 2) * 2.2 * sc * d;
    k += 0.012 * d;
  }
  return [Math.max(-4 * sc, Math.min(4 * sc, dx)), Math.max(-4 * sc, Math.min(4 * sc, dy)), Math.min(1.03, k)];
}
function shakeOn(ctx: CanvasRenderingContext2D, S: number, cur: number): boolean {
  const g = geo(S);
  const s = shakeOf(cur, g.sc);
  if (s[0] === 0 && s[1] === 0 && s[2] === 1) return false;
  ctx.save();
  ctx.translate(g.cx + s[0], g.cx + s[1]);
  ctx.scale(s[2], s[2]);
  ctx.translate(-g.cx, -g.cx);
  return true;
}

// One thin, crisp ring: a faint wider trail, the coloured edge and a hot white leading edge. Radius/alpha come from the caller.
function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: number[], a: number, w: number, hot: number): void {
  if (a <= 0.01 || r <= 0.5) return;
  ctx.strokeStyle = rgba(col, a * 0.16);
  ctx.lineWidth = w * 3.4;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU2);
  ctx.stroke();
  ctx.strokeStyle = rgba(col, Math.min(1, a));
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU2);
  ctx.stroke();
  if (hot > 0.02) {
    ctx.strokeStyle = rgba(WHITE, Math.min(1, a * hot));
    ctx.lineWidth = w * 0.55;
    ctx.beginPath();
    ctx.arc(x, y, r + w * 0.45, 0, TAU2);
    ctx.stroke();
  }
}

// Light-up: flash + crisp ripples. Hierarchy: ordinary posts get one small ring; notable posts two rings and a flash;
// major posts a multi-ring shockwave with a bright leading edge, chromatic split, light bloom and sparks.
// Budget: at most 40 ordinary rings, 8 notable and 4 major shockwaves are drawn at once (newest first); busy hours also dim ordinary glow.
function fxNodes(ctx: CanvasRenderingContext2D, S: number, cur: number, xs: number[], ys: number[], st: number): void {
  const g = geo(S);
  const sc = g.sc;
  let act0 = 0;
  for (let i = NODES.length - 1; i >= 0; i--) {
    const age = cur - NODES[i].ts;
    if (age < 0) continue;
    if (age > LIFE[0]) break;
    act0 += 1;
  }
  const dens = 1 / Math.sqrt(1 + act0 / 16);
  ctx.globalCompositeOperation = "lighter";
  let rings0 = 0;
  for (let i = NODES.length - 1; i >= 0; i--) {
    const n = NODES[i];
    const age = cur - n.ts;
    if (age < 0) continue;
    const col = kcol(st, n.kind);
    const flash = age < 1500 ? 1 - age / 1500 : 0;
    // Resting glow of a lit dot; flash is dimmed in dense hours so the overlap does not wash out
    const fd = n.tier > 0 ? 1 : dens;
    glowAt(ctx, col, xs[i], ys[i], (4.5 + 8 * n.bright + 14 * flash * (n.tier > 0 ? 1.4 : 1)) * sc, Math.min(0.85, (0.24 + 0.4 * n.bright) * (n.tier > 0 ? 1 : 0.5 + 0.5 * dens) + 0.45 * flash * fd));
    if (st === 1 && n.rip > 0) glowAt(ctx, col, xs[i], ys[i], (6 + 30 * n.rip) * sc, (0.04 + 0.1 * n.rip) * (0.5 + 0.5 * dens));
    if (n.tier === 0 && age < LIFE[0] && rings0 < 40) {
      rings0 += 1;
      const u = age / LIFE[0];
      const e = 1 - Math.pow(1 - u, 2.4);
      ring(ctx, xs[i], ys[i], (3 + 14 * n.rip) * sc * (0.35 + 0.65 * e) + sc, col, Math.pow(1 - u, 1.6) * (0.3 + 0.5 * n.bright) * (0.4 + 0.6 * dens) * 1.15, 0.95 * sc, 0);
    }
  }
  // Notable and major: only the indexed few
  let big1 = 0;
  let big2 = 0;
  for (let q = BIG_IDX.length - 1; q >= 0; q--) {
    const i = BIG_IDX[q];
    const n = NODES[i];
    const age = cur - n.ts;
    if (age < 0) continue;
    let tier = n.tier;
    if (tier === 2) {
      if (age < LIFE[2]) {
        big2 += 1;
        if (big2 > 4) tier = 1;
      }
    }
    if (tier === 1) {
      if (age < LIFE[1]) {
        big1 += 1;
        if (big1 > 8) continue;
      }
    }
    const life = LIFE[tier];
    if (age >= life) continue;
    const t = age / life;
    const col = kcol(st, n.kind);
    const x = xs[i];
    const y = ys[i];
    if (tier === 2) {
      const f = age < 1400 ? 1 - age / 1400 : 0;
      // Light bloom: a white-hot core and a wide soft flash that decay fast
      glowAt(ctx, WHITE, x, y, (9 + 28 * f) * sc, 0.9 * f * f + 0.12 * (1 - t));
      glowAt(ctx, col, x, y, (40 + 110 * (1 - f * f)) * sc, 0.4 * f * f * f);
      for (let j = 0; j < 4; j++) {
        const d = j * 0.1;
        const u = (t - d) / (1 - d);
        if (u <= 0 || u >= 1) continue;
        const rm = (62 + 78 * n.rip) * (1 - 0.17 * j) * sc;
        const e = 1 - Math.pow(1 - u, 3.2);
        const a = Math.pow(1 - u, 1.35) * (1 - 0.18 * j);
        const w = (2.2 - 0.35 * j) * sc * (0.6 + 0.4 * (1 - u));
        ring(ctx, x, y, rm * e, col, a, w, j === 0 ? 0.95 : 0.45);
        if (j === 0) {
          // Chromatic split on the leading ring
          const o = 1.8 * sc * (1 - u);
          ring(ctx, x, y, rm * e + o, st === 2 ? NEON_PK : [255, 90, 120], a * 0.5, w * 0.6, 0);
          ring(ctx, x, y, rm * e - o, st === 2 ? NEON_CY : [90, 170, 255], a * 0.5, w * 0.6, 0);
        }
      }
      // Sparks fly out as short streaks
      const su = Math.min(1, age / 6200);
      if (su < 1) {
        for (let k = 0; k < 14; k++) {
          const a = frac(Math.sin((i * 7 + k) * 12.9898) * 43758.5453) * TAU2;
          const sp = 0.55 + 0.9 * frac(Math.sin((i + k * 3) * 78.233) * 12345.6);
          const d1 = (10 + 78 * sp * (1 - Math.pow(1 - su, 2.4))) * sc;
          const d0 = Math.max(0, d1 - (10 + 12 * sp) * (1 - su) * sc);
          ctx.strokeStyle = rgba(k % 3 === 0 ? WHITE : col, (1 - su) * 0.85);
          ctx.lineWidth = 1.1 * sc;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(a) * d0, y + Math.sin(a) * d0);
          ctx.lineTo(x + Math.cos(a) * d1, y + Math.sin(a) * d1);
          ctx.stroke();
          glowAt(ctx, WHITE, x + Math.cos(a) * d1, y + Math.sin(a) * d1, (1.6 + 1.6 * (1 - su)) * sc, (1 - su) * 0.9);
        }
      }
    } else {
      const f = age < 800 ? 1 - age / 800 : 0;
      glowAt(ctx, WHITE, x, y, (8 + 20 * f) * sc, 0.7 * f * f);
      glowAt(ctx, col, x, y, (22 + 36 * (1 - f)) * sc, 0.28 * f);
      for (let j = 0; j < 2; j++) {
        const d = j * 0.16;
        const u = (t - d) / (1 - d);
        if (u <= 0 || u >= 1) continue;
        const rm = (28 + 30 * n.rip) * (1 - 0.25 * j) * sc;
        ring(ctx, x, y, rm * (1 - Math.pow(1 - u, 2.8)), col, Math.pow(1 - u, 1.4) * (0.85 - 0.2 * j), 1.5 * sc, j === 0 ? 0.7 : 0.2);
      }
    }
  }
  ctx.globalCompositeOperation = "source-over";
}

// Neuron: discharge trails and flicker along the paths
function fxPaths(ctx: CanvasRenderingContext2D, cur: number, now: number, xs: number[], ys: number[], cx: number, sc: number): void {
  const RECENT = 14400;
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < NODES.length - 1; i++) {
    const age = cur - NODES[i + 1].ts;
    if (age < 0 || age >= RECENT) continue;
    const qx = cx + ((xs[i] + xs[i + 1]) / 2 - cx) * 0.8;
    const qy = cx + ((ys[i] + ys[i + 1]) / 2 - cx) * 0.8;
    const col = COLS[NODES[i + 1].kind];
    const fade = 1 - age / RECENT;
    const fl = 0.55 + 0.45 * Math.sin(now / 45 + i * 1.7) * Math.sin(now / 110 + i);
    ctx.strokeStyle = rgba(col, 0.12 * fade * fl);
    ctx.lineWidth = 3.4 * sc;
    ctx.beginPath();
    ctx.moveTo(xs[i], ys[i]);
    ctx.quadraticCurveTo(qx, qy, xs[i + 1], ys[i + 1]);
    ctx.stroke();
    for (let k = 0; k < 4; k++) {
      const t = frac(now / 1100 + i * 0.37) - k * 0.05;
      if (t < 0) continue;
      const pt = qpt(xs[i], ys[i], qx, qy, xs[i + 1], ys[i + 1], t);
      glowAt(ctx, col, pt[0], pt[1], (5 - k) * sc, 0.7 * fade * (1 - k * 0.22));
    }
  }
  ctx.globalCompositeOperation = "source-over";
}

// Follow particles: comet trail drawn into the centre, a bright head, and an arrival burst when it reaches the avatar ring
function fxFollow(ctx: CanvasRenderingContext2D, S: number, cur: number, st: number): number {
  const g = geo(S);
  const PW = 14400;
  const BW = 2400;
  let arriving = 0;
  ctx.globalCompositeOperation = "lighter";
  for (const p of PARTS) {
    const age = cur - p.ts;
    if (age < 0 || age >= PW + BW) continue;
    const pt = (uu: number): [number, number] => {
      const e = uu * uu * (3 - 2 * uu);
      const rr = g.rim * 0.97 + (g.rim * 0.46 - g.rim * 0.97) * e;
      const aa = p.a + (p.s - 0.5) * 0.6 * e;
      return [g.cx + Math.cos(aa) * rr, g.cx + Math.sin(aa) * rr];
    };
    if (age >= PW) {
      // Arrival burst: short radial streaks, a flash and a ring expanding along the avatar ring
      const b = (age - PW) / BW;
      const h = pt(1);
      const ang = Math.atan2(h[1] - g.cx, h[0] - g.cx);
      glowAt(ctx, WHITE, h[0], h[1], (5 + 16 * b) * g.sc, 0.95 * Math.pow(1 - b, 2));
      glowAt(ctx, PART_RGB, h[0], h[1], (10 + 26 * b) * g.sc, 0.5 * Math.pow(1 - b, 2));
      ctx.strokeStyle = rgba(PART_RGB, 0.85 * (1 - b));
      ctx.lineWidth = 1.2 * g.sc;
      ctx.beginPath();
      ctx.arc(g.cx, g.cx, g.rim * 0.46 + 2 * g.sc, ang - 0.05 - 0.5 * b, ang + 0.05 + 0.5 * b);
      ctx.stroke();
      for (let k = 0; k < 5; k++) {
        const a2 = ang + (k - 2) * 0.32 + (p.s - 0.5) * 0.3;
        const d0 = (3 + 10 * b) * g.sc;
        const d1 = (6 + 22 * b) * g.sc;
        ctx.strokeStyle = rgba(k === 2 ? WHITE : PART_RGB, (1 - b) * 0.9);
        ctx.beginPath();
        ctx.moveTo(h[0] + Math.cos(a2) * d0, h[1] + Math.sin(a2) * d0);
        ctx.lineTo(h[0] + Math.cos(a2) * d1, h[1] + Math.sin(a2) * d1);
        ctx.stroke();
      }
      continue;
    }
    const u = age / PW;
    const al = 1 - Math.pow(u, 6);
    if (u > 0.85) arriving += 1;
    const h = pt(u);
    // Tapered comet tail: 8 segments, narrower and dimmer away from the head
    let prev = h;
    for (let k = 1; k <= 8; k++) {
      const q = pt(Math.max(0, u - k * 0.016));
      const f = 1 - k / 9;
      ctx.strokeStyle = rgba(PART_RGB, al * 0.8 * f * f);
      ctx.lineWidth = (3.0 * f + 0.4) * g.sc;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(prev[0], prev[1]);
      ctx.lineTo(q[0], q[1]);
      ctx.stroke();
      prev = q;
    }
    ctx.lineCap = "butt";
    glowAt(ctx, PART_RGB, h[0], h[1], (6.5 + 3 * u) * g.sc, al * 0.85);
    glowAt(ctx, WHITE, h[0], h[1], 2.4 * g.sc, al * 0.9);
  }
  ctx.globalCompositeOperation = "source-over";
  return arriving;
}

// After a full turn: all paths / orbits / dots flash together
function fxFinale(ctx: CanvasRenderingContext2D, S: number, f: number, st: number, xs: number[], ys: number[]): void {
  if (f < 0 || f > 1) return;
  const g = geo(S);
  const w = Math.sin(Math.PI * f);
  ctx.globalCompositeOperation = "lighter";
  if (st === 0) {
    ctx.strokeStyle = rgba([190, 220, 255], 0.6 * w);
    ctx.lineWidth = 1.6 * g.sc;
    ctx.beginPath();
    for (let i = 0; i < NODES.length - 1; i++) {
      const qx = g.cx + ((xs[i] + xs[i + 1]) / 2 - g.cx) * 0.8;
      const qy = g.cx + ((ys[i] + ys[i + 1]) / 2 - g.cx) * 0.8;
      ctx.moveTo(xs[i], ys[i]);
      ctx.quadraticCurveTo(qx, qy, xs[i + 1], ys[i + 1]);
    }
    ctx.stroke();
  }
  if (st === 1) {
    ctx.strokeStyle = rgba([255, 214, 150], 0.5 * w);
    ctx.lineWidth = 1.6 * g.sc;
    for (let l = 0; l < 7; l++) {
      ctx.beginPath();
      ctx.arc(g.cx, g.cx, g.rim * (0.46 + 0.065 * l), 0, TAU2);
      ctx.stroke();
    }
  }
  for (let i = 0; i < NODES.length; i++) {
    glowAt(ctx, kcol(st, NODES[i].kind), xs[i], ys[i], 10 * g.sc * (1 + w), 0.8 * w);
  }
  ctx.strokeStyle = rgba(st === 2 ? NEON_CY : [220, 235, 255], (1 - f) * 0.8);
  ctx.lineWidth = (4 * (1 - f) + 1) * g.sc;
  ctx.beginPath();
  ctx.arc(g.cx, g.cx, g.rim * f, 0, TAU2);
  ctx.stroke();
  ctx.globalCompositeOperation = "source-over";
}

// Per-style big numerals: Neuron solid, Galaxy soft thin glow, Neon RGB split
function bigText(ctx: CanvasRenderingContext2D, txt: string, x: number, y: number, size: number, c: number[], st: number, now: number, font: string): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (st === 1) {
    ctx.font = "300 " + size + "px " + font;
    ctx.shadowColor = rgba(c, 0.9);
    ctx.shadowBlur = size * 0.6;
    ctx.fillStyle = rgba([Math.min(255, c[0] + 70), Math.min(255, c[1] + 70), Math.min(255, c[2] + 70)], 1);
    ctx.fillText(txt, x, y);
    ctx.shadowBlur = 0;
  } else if (st === 2) {
    const o = (now % 3400 < 140 ? 3.4 : 1.1) * Math.max(0.7, size / 40);
    ctx.font = "700 " + size + "px " + font;
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = rgba(NEON_CY, 0.85);
    ctx.fillText(txt, x - o, y);
    ctx.fillStyle = rgba(NEON_PK, 0.85);
    ctx.fillText(txt, x + o, y);
    ctx.globalCompositeOperation = "source-over";
    ctx.shadowColor = rgba(c, 1);
    ctx.shadowBlur = size * 0.5;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(txt, x, y);
    ctx.shadowBlur = 0;
  } else {
    ctx.font = "600 " + size + "px " + font;
    ctx.fillStyle = rgba(c, 1);
    ctx.fillText(txt, x, y);
  }
}

// Style decorations for today's status: Galaxy = orbiting dots, Neon = HUD corners and scan lines
function decor(ctx: CanvasRenderingContext2D, st: number, ax: number, ay: number, R: number, now: number, c: number[]): void {
  if (st === 1) {
    ctx.strokeStyle = rgba(c, 0.28);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(ax, ay + R * 0.1, R * 0.62, R * 0.2, -0.35, 0, TAU2);
    ctx.stroke();
    const a = now / 1400;
    const ox = Math.cos(a) * R * 0.62;
    const oy = Math.sin(a) * R * 0.2;
    const rx = ox * Math.cos(-0.35) - oy * Math.sin(-0.35);
    const ry = ox * Math.sin(-0.35) + oy * Math.cos(-0.35);
    ctx.globalCompositeOperation = "lighter";
    glowAt(ctx, [255, 255, 255], ax + rx, ay + R * 0.1 + ry, R * 0.07, 0.9);
    ctx.globalCompositeOperation = "source-over";
  } else if (st === 2) {
    const hw = R * 0.56;
    const hh = R * 0.5;
    const yc = ay + R * 0.1;
    const L = R * 0.14;
    ctx.strokeStyle = rgba(NEON_CY, 0.6);
    ctx.lineWidth = 1.2;
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sy = -1; sy <= 1; sy += 2) {
        ctx.beginPath();
        ctx.moveTo(ax + sx * hw, yc + sy * (hh - L));
        ctx.lineTo(ax + sx * hw, yc + sy * hh);
        ctx.lineTo(ax + sx * (hw - L), yc + sy * hh);
        ctx.stroke();
      }
    }
    const ly = yc + Math.sin(now / 700) * hh * 0.9;
    ctx.fillStyle = rgba(NEON_PK, 0.3);
    ctx.fillRect(ax - hw, ly, hw * 2, 1.5);
  }
}

// ---------- Core board: avatar + name + today's status + rolling metrics ----------
let FOL0 = 0; // follows that happened before the day start (prorated from the snapshot interval)
let ROLL = { imp: 0, eng: 0, fol: 0, t: 0 };
const TINT: number[][] = [[70, 120, 210], [160, 96, 210], [230, 40, 170]];
const RING: number[][] = [[150, 205, 255], [255, 214, 150], NEON_CY];
let AV_W = 0;
let AV_CV: HTMLCanvasElement | null = null;
let AV_PX: Uint8ClampedArray | null = null;
let AV_TRIED = false;

function fmtN(x: number): string {
  return String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function ease(a: number, t: number, k: number): number {
  const d = t - a;
  return Math.abs(d) < 0.5 ? t : a + d * k;
}
function tipW(): number {
  return Math.min(250, (typeof window !== "undefined" ? window.innerWidth : 360) - 16);
}
// Decode the embedded pixels: base64 -> palette + indices -> RGBA, then putImageData on an offscreen canvas; wrong lengths or indices make the whole avatar count as missing
function avatarPixels(): Uint8ClampedArray | null {
  if (AV_TRIED) return AV_PX;
  AV_TRIED = true;
  const av = DATA.avatar;
  if (av === null) return null;
  try {
    const pal = atob(av.palette);
    const idx = atob(av.indices);
    const w = Math.round(av.size);
    const n = w * w;
    const nc = Math.floor(pal.length / 3);
    if (w < 8 || w > 512 || nc < 1 || idx.length !== n) return null;
    const px = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      const k = idx.charCodeAt(i);
      if (k >= nc) return null;
      px[i * 4] = pal.charCodeAt(k * 3);
      px[i * 4 + 1] = pal.charCodeAt(k * 3 + 1);
      px[i * 4 + 2] = pal.charCodeAt(k * 3 + 2);
      px[i * 4 + 3] = 255;
    }
    AV_W = w;
    AV_PX = px;
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = w;
      const x = c.getContext("2d");
      if (x) {
        x.putImageData(new ImageData(px, w, w), 0, 0);
        AV_CV = c;
      }
    }
  } catch (err) {
    AV_CV = null;
    AV_PX = null;
  }
  return AV_PX;
}
// Draw the avatar into the square centred at (cx, cy) with half-size r (the caller clips to a circle); falls back to per-pixel fills without an offscreen canvas; returns false when pixels are missing
function drawAvatar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): boolean {
  const px = avatarPixels();
  if (px === null) return false;
  if (AV_CV !== null) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(AV_CV, cx - r, cy - r, r * 2, r * 2);
    return true;
  }
  const cell = (r * 2) / AV_W;
  for (let y = 0; y < AV_W; y++) {
    for (let x = 0; x < AV_W; x++) {
      const o = (y * AV_W + x) * 4;
      ctx.fillStyle = "rgb(" + px[o] + "," + px[o + 1] + "," + px[o + 2] + ")";
      ctx.fillRect(cx - r + x * cell, cy - r + y * cell, cell + 0.6, cell + 0.6);
    }
  }
  return true;
}
// Running totals up to the hand; followers accrue as particles are absorbed (at 85% of their flight) and settle on the final value after a full turn
function boardAt(cur: number): { imp: number; eng: number; fol: number; n: number[] } {
  let imp = 0;
  let eng = 0;
  const n = [0, 0, 0];
  for (const x of NODES) {
    if (x.ts > cur) continue;
    imp += x.v ?? 0;
    eng += (x.l ?? 0) + (x.r ?? 0) + (x.c ?? 0) + (x.q ?? 0);
    n[x.kind] += 1;
  }
  let fol = FOL0;
  if (cur >= DAY - 1) fol = FOLLOW_DELTA;
  else for (const p of PARTS) if (cur - p.ts >= 12240) fol += 1;
  return { imp, eng, fol, n };
}
function pieceRow(ctx: CanvasRenderingContext2D, ps: { t: string; c: string }[], x: number, y: number, maxW: number, size: number, font: string, fw: string): void {
  let sz = size;
  let w = 0;
  for (let k = 0; k < 2; k++) {
    ctx.font = fw + sz + "px " + font;
    w = 0;
    for (const p of ps) w += ctx.measureText(p.t).width;
    if (w <= maxW) break;
    sz = Math.max(6.5, sz * (maxW / w));
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let px = x - w / 2;
  for (const p of ps) {
    ctx.fillStyle = p.c;
    ctx.fillText(p.t, px, y);
    px += ctx.measureText(p.t).width;
  }
}
// Today's status: small motion around the avatar (one per tier)
// (variant: 0 fire, 1 rising rings, 2 heartbeat, 3 petals, 4 twinkle; k scales how much is drawn)
function statusAura(ctx: CanvasRenderingContext2D, ax: number, ay: number, ra: number, tier: number, tc: number[], k: number, now: number, sc: number): void {
  const br = 0.5 + 0.5 * Math.sin(now / 900);
  ctx.globalCompositeOperation = "lighter";
  if (tier === 0) {
    glowAt(ctx, tc, ax, ay, ra * (1.9 + 0.2 * br), 0.4 * k);
    for (let i = 0; i < Math.round(16 * k); i++) {
      const per = 1500 + (i % 5) * 240;
      const ph = ((now + i * 397) % per) / per;
      const a = frac(Math.sin(i * 12.9898) * 43758.5453) * TAU2;
      const d = ra * (1.05 + ph * 0.9);
      ctx.fillStyle = "rgba(255," + Math.round(120 + 110 * ph) + ",60," + (1 - ph).toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(ax + Math.cos(a) * d, ay + Math.sin(a) * d - ph * ra * 0.5, (1 - ph) * 2 * sc + 0.5, 0, TAU2);
      ctx.fill();
    }
  } else if (tier === 1) {
    glowAt(ctx, tc, ax, ay, ra * 1.7, 0.3 + 0.12 * br);
    for (let k = 0; k < 3; k++) {
      const ph = (now / 2600 + k / 3) % 1;
      ctx.strokeStyle = rgba(tc, (1 - ph) * 0.8);
      ctx.lineWidth = 1.4 * sc + 0.4;
      ctx.beginPath();
      ctx.arc(ax, ay, ra * (1.08 + ph * 0.75), 0, TAU2);
      ctx.stroke();
    }
  } else if (tier === 2) {
    const t = (now % 1100) / 1100;
    const beat = Math.exp(-Math.pow((t - 0.1) / 0.06, 2)) + 0.6 * Math.exp(-Math.pow((t - 0.32) / 0.06, 2));
    glowAt(ctx, tc, ax, ay, ra * (1.5 + 0.35 * beat), 0.2 + 0.25 * beat);
    ctx.strokeStyle = rgba(tc, (1 - t) * 0.6);
    ctx.lineWidth = 1.4 * sc + 0.4;
    ctx.beginPath();
    ctx.arc(ax, ay, ra * (1.08 + t * 0.6), 0, TAU2);
    ctx.stroke();
  } else if (tier === 3) {
    glowAt(ctx, tc, ax, ay, ra * (1.6 + 0.2 * br), 0.18 + 0.16 * br);
    for (let i = 0; i < 3; i++) {
      const a = now / 2400 + (i * TAU2) / 3;
      ctx.fillStyle = rgba(tc, 0.85);
      ctx.save();
      ctx.translate(ax + Math.cos(a) * ra * 1.3, ay + Math.sin(a) * ra * 1.3);
      ctx.rotate(a + 1.2);
      ctx.beginPath();
      ctx.ellipse(0, 0, ra * 0.16, ra * 0.07, 0, 0, TAU2);
      ctx.fill();
      ctx.restore();
    }
  } else {
    glowAt(ctx, tc, ax, ay, ra * (1.6 + 0.2 * br), 0.28);
    for (let i = 0; i < 7; i++) {
      const a = frac(Math.sin(i * 7.31) * 9301.7) * TAU2;
      const d = ra * (1.2 + 0.7 * frac(Math.sin(i * 3.77) * 5471.3));
      ctx.fillStyle = rgba([220, 230, 255], 0.2 + 0.8 * (0.5 + 0.5 * Math.sin(now / 500 + i * 2)));
      ctx.beginPath();
      ctx.arc(ax + Math.cos(a) * d, ay + Math.sin(a) * d, 1.3 * sc + 0.4, 0, TAU2);
      ctx.fill();
    }
  }
  ctx.globalCompositeOperation = "source-over";
}

// Centre background: slow aurora blobs and faint inner ripples, strength follows the live level (kept very low so the numbers stay readable)
function liveBg(ctx: CanvasRenderingContext2D, cx: number, zr: number, lvl: number, k: number, now: number): void {
  const t = REDUCED ? 0 : now;
  const c1 = LIVE_RGB[lvl];
  const c2 = LIVE_RGB[Math.min(4, lvl + 1)];
  const amp = (REDUCED ? 0.5 : 1) * (0.06 + 0.16 * k) * (0.85 + 0.15 * Math.sin(t / (3000 - lvl * 380)));
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cx, zr - 0.6, 0, TAU2);
  ctx.clip();
  ctx.globalCompositeOperation = "lighter";
  const sp = 11000 - lvl * 1500;
  for (let i = 0; i < 3; i++) {
    const ph = t / sp + i * 2.1;
    glowAt(ctx, i === 1 ? c2 : c1, cx + Math.cos(ph + i) * zr * 0.4, cx + Math.sin(ph * 0.8 + i * 1.7) * zr * 0.3 - zr * 0.1, zr * (0.8 + 0.12 * i), amp * (i === 0 ? 1 : 0.7));
  }
  if (lvl >= 1 && !REDUCED) {
    const per = 4600 - lvl * 700;
    for (let i = 0; i < 2; i++) {
      const f = (t / per + i / 2) % 1;
      ctx.strokeStyle = rgba(c1, amp * 1.2 * (1 - f));
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cx - zr * 0.08, zr * (0.25 + 0.75 * f), 0, TAU2);
      ctx.stroke();
    }
  }
  ctx.restore();
}
// The live status word: the stronger the level, the stronger the glow pulse, the shimmer sweep and the beat
function liveWord(ctx: CanvasRenderingContext2D, txt: string, x: number, y: number, size: number, maxW: number, lvl: number, now: number, st: number, font: string, alpha: number): void {
  if (alpha <= 0.01) return;
  const t = REDUCED ? 0 : now;
  const c = LIVE_RGB[lvl];
  const per = [4200, 2800, 1900, 1200, 800][lvl];
  const beat = 0.5 + 0.5 * Math.sin((t / per) * TAU2);
  const wt = st === 1 ? "400 " : "700 ";
  ctx.font = wt + size + "px " + font;
  const w0 = ctx.measureText(txt).width;
  const fit = Math.min(1, maxW / Math.max(1, w0));
  const sx = fit * (1 + (lvl >= 3 ? 0.012 * (lvl - 2) * beat : 0));
  ctx.save();
  ctx.translate(x + (lvl === 4 && t % 800 < 90 ? 0.7 : 0), y);
  ctx.scale(sx, sx);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.globalAlpha = alpha * (lvl === 0 ? 0.78 + 0.22 * beat : 1);
  const base = rgba([Math.min(255, c[0] + 40), Math.min(255, c[1] + 40), Math.min(255, c[2] + 40)], 1);
  if (st === 2) {
    const o = (0.8 + 0.4 * lvl) * Math.max(0.7, size / 40);
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = rgba(NEON_CY, 0.7);
    ctx.fillText(txt, -o, 0);
    ctx.fillStyle = rgba(NEON_PK, 0.7);
    ctx.fillText(txt, o, 0);
    ctx.globalCompositeOperation = "source-over";
  }
  let fill: string | CanvasGradient = base;
  const shp = [0, 0, 3600, 2400, 1500][lvl];
  if (shp > 0 && !REDUCED) {
    const p = ((t % shp) / shp) * 1.7 - 0.35;
    const g = ctx.createLinearGradient(-w0 / 2, 0, w0 / 2, 0);
    const q = (v: number): number => Math.max(0, Math.min(1, v));
    g.addColorStop(0, base);
    g.addColorStop(q(p - 0.16), base);
    g.addColorStop(q(p), "#ffffff");
    g.addColorStop(q(p + 0.16), base);
    g.addColorStop(1, base);
    fill = g;
  }
  ctx.shadowColor = rgba(c, 0.45 + 0.1 * lvl);
  ctx.shadowBlur = size * (0.18 + 0.17 * lvl) * (0.55 + 0.45 * beat);
  ctx.fillStyle = fill;
  ctx.fillText(txt, 0, 0);
  ctx.shadowBlur = 0;
  ctx.restore();
}
// Five pips under the word: the filled ones carry the level colours
function livePips(ctx: CanvasRenderingContext2D, cx: number, y: number, zr: number, lvl: number, now: number): void {
  const gap = zr * 0.085;
  const r = Math.max(1.6, zr * 0.016);
  const beat = REDUCED ? 0 : 0.5 + 0.5 * Math.sin(now / 420);
  for (let i = 0; i < 5; i++) {
    const x = cx + (i - 2) * gap;
    if (i <= lvl) {
      ctx.fillStyle = rgba(LIVE_RGB[i], i === lvl ? 0.8 + 0.2 * beat : 0.75);
      ctx.beginPath();
      ctx.arc(x, y, r * (i === lvl ? 1.25 + 0.2 * beat : 1), 0, TAU2);
      ctx.fill();
    } else {
      ctx.fillStyle = "rgba(160,180,210,0.25)";
      ctx.beginPath();
      ctx.arc(x, y, r * 0.8, 0, TAU2);
      ctx.fill();
    }
  }
}

// Dial centre board; the avatar ring pulses when a follow particle arrives, and the whole ring flashes at the end of a turn
function drawCenter(ctx: CanvasRenderingContext2D, cx: number, zr: number, S: number, now: number, font: string, opts: DrawOpts, N: number, arriving: number, cur: number): void {
  const st = opts.style;
  const v = opts.vis;
  const sc = Math.max(0.55, S / 640);
  const pulse = Math.min(1, arriving * 0.22);
  const fin = opts.fin >= 0 && opts.fin <= 1 ? opts.fin : -1;
  const boost = pulse * 0.7 + (fin >= 0 ? Math.sin(Math.PI * fin) : 0);
  let tc = LIVE_RGB[0];
  ctx.globalCompositeOperation = "lighter";
  if (opts.showFollow) {
    glowAt(ctx, PART_RGB, cx, cx, zr * (1.05 + 0.35 * pulse), 0.07 + 0.3 * pulse);
    if (arriving > 0) {
      const f = frac(now / 650);
      ctx.strokeStyle = rgba(PART_RGB, pulse * (1 - f) * 0.8);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(cx, cx, zr * (0.9 + 0.3 * f), 0, TAU2);
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = "source-over";
  // Base disc: translucent dark disc that dims the dots and paths beneath
  const rg = ctx.createRadialGradient(cx, cx, zr * 0.2, cx, cx, zr);
  rg.addColorStop(0, "rgba(6,10,22,0.55)");
  rg.addColorStop(1, "rgba(6,10,22,0.86)");
  ctx.fillStyle = rg;
  ctx.beginPath();
  ctx.arc(cx, cx, zr, 0, TAU2);
  ctx.fill();
  ctx.strokeStyle = rgba(st === 2 ? NEON_CY : opts.showFollow ? PART_RGB : [160, 190, 230], opts.showFollow ? 0.2 + 0.4 * pulse : 0.18);
  ctx.lineWidth = 1.2;
  if (st === 2) ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.arc(cx, cx, zr, 0, TAU2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (N === 0) {
    ctx.fillStyle = "#dbe6f5";
    ctx.font = Math.max(12, S * 0.03) + "px " + font;
    ctx.fillText(tx("这 24 小时没有发帖", "No posts in these 24 hours"), cx, cx);
    return;
  }
  // Metrics: running totals up to the hand, numbers ease as they roll
  const b = boardAt(cur);
  const kk = 1 - Math.exp(-Math.min(120, Math.max(0, now - ROLL.t)) / 150);
  ROLL.t = now;
  ROLL.imp = ease(ROLL.imp, b.imp, kk);
  ROLL.eng = ease(ROLL.eng, b.eng, kk);
  ROLL.fol = ease(ROLL.fol, b.fol, kk);
  const fol = Math.round(ROLL.fol);
  // Live status first: the aura, the background layer and the word all follow it
  liveStep(cur, now);
  const lvl = LIVE.lvl;
  const lk = LIVE.k;
  tc = LIVE_RGB[lvl];
  if (v.status) liveBg(ctx, cx, zr, lvl, lk, now);
  // Hierarchy: primary = engagement (falls back to the first enabled metric), then the post counts, then the secondary metrics (impressions, followers, follower change)
  type Item = { l: string; v: string; c: number[] };
  const na = tx("缺失", "n/a");
  const mEng: Item | null = v.eng ? { l: tx("互动", "Engagement"), v: HAS_ENG ? fmtN(ROLL.eng) : na, c: [255, 150, 180] } : null;
  const mImp: Item | null = v.imp ? { l: tx("曝光", "Impressions"), v: HAS_IMP ? fmtN(ROLL.imp) : na, c: [255, 206, 130] } : null;
  const mFans: Item | null = v.fans && FOLLOW_NOW !== null ? { l: tx("粉丝", "Followers"), v: fmtN(FOLLOW_NOW - FOLLOW_DELTA + fol), c: [226, 236, 250] } : null;
  const mFol: Item | null = v.follow ? { l: tx("关注变化", "Followers Δ"), v: (fol > 0 ? "+" : "") + fol, c: PART_RGB } : null;
  const order = [mEng, mImp, mFans, mFol];
  const prim = order.find((x) => x !== null) ?? null;
  const sec = order.filter((x) => x !== null && x !== prim) as Item[];
  const rows: { ps: { t: string; c: string }[]; sz: number }[] = [];
  if (v.posts) {
    const kn = [tx("发帖 ", "Posts "), tx("回帖 ", "Replies "), tx("引用 ", "Quotes ")];
    const ps: { t: string; c: string }[] = [];
    for (let kd = 0; kd < 3; kd++) {
      if (kd > 0) ps.push({ t: "  ", c: "#9fb2cc" });
      ps.push({ t: kn[kd], c: "#a9bbd3" });
      ps.push({ t: String(b.n[kd]), c: rgba(kcol(st, kd), 1) });
    }
    rows.push({ ps, sz: 0.118 });
  }
  const secRow = (xs: Item[], sz: number) => {
    const ps: { t: string; c: string }[] = [];
    xs.forEach((m, i) => {
      if (i > 0) ps.push({ t: "   ", c: "#7f93b0" });
      ps.push({ t: m.l + " ", c: "#7f93b0" });
      ps.push({ t: m.v, c: rgba(m.c, 0.92) });
    });
    rows.push({ ps, sz });
  };
  if (sec.length === 3) {
    secRow(sec.slice(0, 2), 0.105);
    secRow(sec.slice(2), 0.1);
  } else if (sec.length > 0) secRow(sec, 0.105);
  const nr = rows.length;
  const hasM = prim !== null || nr > 0;
  const slots = nr === 3 ? [0.53, 0.67, 0.79] : nr === 2 ? [0.57, 0.72] : nr === 1 ? [0.66] : [];
  const mainY = prim === null ? 0 : [0.46, 0.38, 0.32, 0.27][nr];
  const chord = (f: number): number => Math.max(24, 2 * Math.sqrt(Math.max(0.02, 1 - Math.pow(Math.abs(f) + 0.08, 2))) * zr * 0.9);
  if (hasM) {
    // Lower-half gradient mask
    const top = cx + zr * (prim !== null ? mainY - 0.3 : slots[0] - 0.12);
    const mg = ctx.createLinearGradient(0, top, 0, cx + zr);
    mg.addColorStop(0, rgba(TINT[st], 0));
    mg.addColorStop(1, rgba(TINT[st], 0.42));
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cx, zr - 0.6, 0, TAU2);
    ctx.clip();
    ctx.fillStyle = mg;
    ctx.fillRect(cx - zr, top, zr * 2, cx + zr - top);
    ctx.restore();
  }
  // Avatar (or the status badge) + status motion + stylised halo
  const ay = cx + zr * (hasM ? (v.status ? -0.43 : -0.48) : -0.06);
  const ra = zr * (hasM ? (v.status ? 0.175 : 0.23) : 0.42) * (v.avatar ? 1 : 0.55);
  if (v.avatar || v.status) {
    if (v.status) {
      statusAura(ctx, cx, ay, ra, [4, 1, 2, 0, 0][lvl], tc, [1, 1, 1, 0.55, 1][lvl], now, sc);
      if (st > 0) decor(ctx, st, cx, ay - ra * 0.19, ra * 1.9, now, tc);
    }
    const rc = RING[st];
    const rr = ra + 2.5 * sc;
    ctx.globalCompositeOperation = "lighter";
    glowAt(ctx, rc, cx, ay, ra * (1.45 + 0.5 * boost), 0.22 + 0.4 * boost);
    ctx.lineWidth = (1.5 + 1.2 * boost) * sc + 0.4;
    if (st === 1) {
      ctx.strokeStyle = rgba(rc, 0.35 + 0.4 * boost);
      ctx.beginPath();
      ctx.arc(cx, ay, rr, 0, TAU2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(cx, ay, rr, now / 1600, now / 1600 + 1.1);
      ctx.stroke();
    } else if (st === 2) {
      ctx.strokeStyle = rgba(NEON_CY, 0.85);
      ctx.beginPath();
      ctx.arc(cx - 1.4 * sc, ay, rr, 0, TAU2);
      ctx.stroke();
      ctx.strokeStyle = rgba(NEON_PK, 0.85);
      ctx.beginPath();
      ctx.arc(cx + 1.4 * sc, ay, rr, 0, TAU2);
      ctx.stroke();
    } else {
      ctx.strokeStyle = rgba(rc, 0.55 + 0.4 * boost);
      ctx.beginPath();
      ctx.arc(cx, ay, rr, 0, TAU2);
      ctx.stroke();
      ctx.strokeStyle = rgba(rc, 0.2);
      ctx.beginPath();
      ctx.arc(cx, ay, rr + 3 * sc, 0, TAU2);
      ctx.stroke();
    }
    if (pulse > 0) {
      const f = frac(now / 650);
      ctx.strokeStyle = rgba(PART_RGB, pulse * (1 - f) * 0.7);
      ctx.beginPath();
      ctx.arc(cx, ay, ra * (1.1 + 0.6 * f), 0, TAU2);
      ctx.stroke();
    }
    if (fin >= 0) {
      ctx.strokeStyle = rgba([255, 255, 255], (1 - fin) * 0.9);
      ctx.beginPath();
      ctx.arc(cx, ay, rr + ra * 1.4 * fin, 0, TAU2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
    if (v.avatar) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, ay, ra, 0, TAU2);
      ctx.clip();
      if (!drawAvatar(ctx, cx, ay, ra)) {
        const pg = ctx.createLinearGradient(cx - ra, ay - ra, cx + ra, ay + ra);
        pg.addColorStop(0, "#3b5887");
        pg.addColorStop(1, "#1b2a46");
        ctx.fillStyle = pg;
        ctx.fillRect(cx - ra, ay - ra, ra * 2, ra * 2);
        ctx.fillStyle = "#eaf2ff";
        ctx.font = "600 " + ra * 1.1 + "px " + font;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(Array.from(NAME || USERNAME || "?")[0].toUpperCase(), cx, ay + ra * 0.04);
      }
      ctx.restore();
    } else {
      ctx.globalCompositeOperation = "lighter";
      glowAt(ctx, tc, cx, ay, ra * 1.1, 0.9);
      ctx.globalCompositeOperation = "source-over";
    }
  }
  // Account name / handle
  const nameOn = v.name && NAME !== "";
  const handleOn = v.handle && HANDLE !== "";
  if (nameOn || handleOn) {
    const ny = v.avatar || v.status ? ay + ra + Math.max(zr * 0.09, 7 * sc) : cx + zr * (hasM ? -0.34 : 0);
    const fs = Math.max(8, zr * 0.11);
    const mw = chord((ny - cx) / zr);
    ctx.font = "600 " + fs + "px " + font;
    const w1 = ctx.measureText(NAME + "  " + HANDLE).width;
    if (nameOn && handleOn && w1 > mw && mw / w1 < 0.8) {
      // If one line does not fit, split into two (name above, handle below), each scaled to fit, never truncated
      pieceRow(ctx, [{ t: NAME, c: "#eaf2ff" }], cx, ny - fs * 0.62, mw, fs, font, "600 ");
      pieceRow(ctx, [{ t: HANDLE, c: "#8fa6c4" }], cx, ny + fs * 0.62, mw, fs, font, "600 ");
    } else {
      const ps: { t: string; c: string }[] = [];
      if (nameOn) ps.push({ t: NAME, c: "#eaf2ff" });
      if (nameOn && handleOn) ps.push({ t: "  ", c: "#eaf2ff" });
      if (handleOn) ps.push({ t: HANDLE, c: "#8fa6c4" });
      pieceRow(ctx, ps, cx, ny, mw, fs, font, "600 ");
    }
  }
  // Live status word with a short cross-fade when the level changes, plus the level pips
  if (v.status) {
    const names = liveNames();
    const wy = cx - zr * 0.8;
    const wsz = Math.max(9, zr * 0.13);
    const u = Math.min(1, (now - LIVE.at) / 450);
    if (u < 1 && !REDUCED) {
      liveWord(ctx, names[LIVE.prev], cx, wy + zr * 0.04 * u, wsz, zr * 0.9, LIVE.prev, now, st, font, 1 - u);
      liveWord(ctx, names[lvl], cx, wy - zr * 0.04 * (1 - u), wsz, zr * 0.9, lvl, now, st, font, u);
    } else liveWord(ctx, names[lvl], cx, wy, wsz, zr * 0.9, lvl, now, st, font, 1);
    livePips(ctx, cx, cx - zr * 0.69, zr, lvl, now);
  }
  // Primary metric: the large number with its label above it
  if (prim !== null) {
    const my = cx + zr * mainY;
    const msz = Math.max(13, zr * 0.29);
    const lsz = Math.max(8.5, zr * 0.095);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "600 " + lsz + "px " + font;
    ctx.fillStyle = "#b8c8de";
    ctx.fillText(prim.l, cx, my - msz * 0.72);
    ctx.font = "600 " + msz + "px " + font;
    const wv = ctx.measureText(prim.v).width;
    const s1 = Math.min(1, chord(mainY) / Math.max(1, wv));
    ctx.save();
    ctx.translate(cx, my);
    ctx.scale(s1, s1);
    bigText(ctx, prim.v, 0, 0, msz, prim.c, st, now, font);
    ctx.restore();
  }
  for (let r = 0; r < nr; r++) pieceRow(ctx, rows[r].ps, cx, cx + zr * slots[r], chord(slots[r]), Math.max(8, zr * rows[r].sz), font, "");
}

// Galaxy / Neon wave styles: same data and encoding, only the visual language changes
function drawStyled(canvas: HTMLCanvasElement, S: number, cur: number, now: number, hov: number, font: string, opts: DrawOpts): void {
  const ctx = setup(canvas, S);
  if (!ctx) return;
  const st = opts.style;
  const g = geo(S);
  const cx = g.cx;
  const rim = g.rim;
  const sc = g.sc;
  const N = NODES.length;
  const fin = opts.fin >= 0 && opts.fin <= 1 ? Math.sin(Math.PI * opts.fin) : 0;
  const R0 = rim * 0.5;
  const shk = shakeOn(ctx, S, cur);
  drawBg(ctx, S, now, st, opts, font);
  const ah = (cur / DAY) * TAU2 - Math.PI / 2;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < N; i++) {
    const p = nodeXY(i, S, st);
    xs.push(p[0]);
    ys.push(p[1]);
  }
  sweep(ctx, cx, st === 2 ? R0 * 0.8 : rim * 0.2, rim, ah, SWEEP_RGB[st]);

  if (st === 1) {
    // Swept bodies trail an arc along their own orbit
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 1.3 * sc;
    for (let i = 0; i < N; i++) {
      const n = NODES[i];
      const age = cur - n.ts;
      if (age < 0 || age > 21600) continue;
      ctx.strokeStyle = rgba(kcol(1, n.kind), 0.34 * (1 - age / 21600));
      ctx.beginPath();
      ctx.arc(cx, cx, Math.hypot(xs[i] - cx, ys[i] - cx), n.ang, Math.min(ah, n.ang + 0.7));
      ctx.stroke();
    }
    glowAt(ctx, [255, 200, 130], cx, cx, rim * 0.5 * (1 + 0.03 * Math.sin(now / 800)), 0.22 + 0.12 * fin);
    ctx.globalCompositeOperation = "source-over";
    for (let i = 0; i < N; i++) {
      const n = NODES[i];
      const col = kcol(1, n.kind);
      if (cur - n.ts < 0) {
        ctx.fillStyle = rgba(col, 0.16);
        ctx.beginPath();
        ctx.arc(xs[i], ys[i], 1.3 * sc, 0, TAU2);
        ctx.fill();
        continue;
      }
      const r = (1.5 + 1.8 * n.bright) * sc * (1 + 0.5 * fin);
      ctx.fillStyle = rgba(col, 0.55 + 0.45 * n.bright);
      ctx.beginPath();
      ctx.arc(xs[i], ys[i], r, 0, TAU2);
      ctx.fill();
      ctx.fillStyle = rgba([255, 255, 255], 0.4 + 0.5 * n.bright);
      ctx.beginPath();
      ctx.arc(xs[i], ys[i], r * 0.45, 0, TAU2);
      ctx.fill();
    }
  } else {
    // Wave ring: lit posts raise ripples on the base ring
    const act: { a: number; amp: number; w: number }[] = [];
    for (let i = 0; i < N; i++) {
      const n = NODES[i];
      const age = cur - n.ts;
      if (age < 0 || age >= 9000) continue;
      const u = age / 9000;
      const ab = n.tier === 2 ? 16 + 26 * n.rip : n.tier === 1 ? 8 + 14 * n.rip : 1.5 + 5 * n.rip;
      act.push({ a: n.ang, amp: ab * sc * Math.pow(1 - u, 1.3) * Math.cos(u * 9), w: 0.05 + 0.05 * n.rip + 0.02 * n.tier });
    }
    ctx.globalCompositeOperation = "lighter";
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = rgba(pass === 0 ? NEON_CY : NEON_PK, pass === 0 ? 0.9 : 0.5);
      ctx.lineWidth = (pass === 0 ? 1.8 : 1.2) * sc;
      ctx.shadowColor = rgba(NEON_CY, 1);
      ctx.shadowBlur = pass === 0 ? 8 : 0;
      ctx.beginPath();
      for (let k = 0; k <= 240; k++) {
        const a = (k / 240) * TAU2 - Math.PI / 2;
        let d = Math.sin(a * 14 + now / 260) * 0.9 * sc;
        for (const q of act) {
          const da = Math.atan2(Math.sin(a - q.a), Math.cos(a - q.a));
          d += q.amp * Math.exp(-(da * da) / (q.w * q.w));
        }
        const r = R0 + d + (pass === 1 ? 1.5 * sc : 0);
        if (k === 0) ctx.moveTo(cx + Math.cos(a) * r, cx + Math.sin(a) * r);
        else ctx.lineTo(cx + Math.cos(a) * r, cx + Math.sin(a) * r);
      }
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    // Fan wave: more impressions spread wider
    for (let i = 0; i < N; i++) {
      const n = NODES[i];
      const age = cur - n.ts;
      if (age < 0 || age >= 9000) continue;
      if (n.tier === 0 && age > 3200) continue;
      const u = age / 9000;
      const w = (0.06 + 0.4 * n.rip) * (n.tier === 0 ? 0.6 : 1);
      ctx.strokeStyle = rgba(kcol(2, n.kind), (1 - u) * (n.tier === 0 ? 0.16 + 0.2 * n.rip : 0.45 + 0.4 * n.rip));
      ctx.lineWidth = (n.tier === 0 ? 1 : 1.5) * sc;
      ctx.beginPath();
      ctx.arc(cx, cx, R0 + (rim * 0.93 - R0) * (1 - Math.pow(1 - u, 1.8)), n.ang - w, n.ang + w);
      ctx.stroke();
    }
    // Spectrum spikes
    for (let i = 0; i < N; i++) {
      const n = NODES[i];
      const age = cur - n.ts;
      const col = kcol(2, n.kind);
      const ca = Math.cos(n.ang);
      const sa = Math.sin(n.ang);
      const rt = Math.hypot(xs[i] - cx, ys[i] - cx);
      if (age < 0) {
        ctx.strokeStyle = rgba(col, 0.14);
        ctx.lineWidth = sc;
        ctx.beginPath();
        ctx.moveTo(cx + ca * (R0 + 2), cx + sa * (R0 + 2));
        ctx.lineTo(cx + ca * (R0 + (rt - R0) * 0.3), cx + sa * (R0 + (rt - R0) * 0.3));
        ctx.stroke();
        continue;
      }
      const r1 = R0 + (rt - R0) * Math.min(1, 0.3 + age / 1400) * (1 + 0.12 * fin);
      ctx.strokeStyle = rgba(col, Math.min(1, 0.45 + 0.55 * n.bright + 0.4 * fin));
      ctx.lineWidth = (1.3 + 1.1 * n.bright) * sc;
      ctx.beginPath();
      ctx.moveTo(cx + ca * (R0 + 1), cx + sa * (R0 + 1));
      ctx.lineTo(cx + ca * r1, cx + sa * r1);
      ctx.stroke();
      ctx.strokeStyle = rgba(col, 0.4 * (0.5 + 0.5 * n.bright));
      ctx.beginPath();
      ctx.moveTo(cx + ca * (R0 - 1), cx + sa * (R0 - 1));
      ctx.lineTo(cx + ca * (R0 - (r1 - R0) * 0.18), cx + sa * (R0 - (r1 - R0) * 0.18));
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  fxNodes(ctx, S, cur, xs, ys, st);
  const arriving = opts.showFollow ? fxFollow(ctx, S, cur, st) : 0;
  if (shk) ctx.restore();
  drawCenter(ctx, cx, rim * 0.45, S, now, font, opts, N, arriving, cur);
  if (hov >= 0 && hov < N) {
    ctx.lineWidth = 1.4;
    if (st === 2) {
      ctx.strokeStyle = rgba(NEON_CY, 0.8);
      ctx.beginPath();
      ctx.arc(xs[hov] - 2, ys[hov], 7 * sc + 2, 0, TAU2);
      ctx.stroke();
      ctx.strokeStyle = rgba(NEON_PK, 0.8);
      ctx.beginPath();
      ctx.arc(xs[hov] + 2, ys[hov], 7 * sc + 2, 0, TAU2);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(xs[hov], ys[hov], 7 * sc + 2, 0, TAU2);
    ctx.stroke();
  }
  fxFinale(ctx, S, opts.fin, st, xs, ys);
  if (opts.showTime) handLabel(ctx, S, ah, cur, font, SWEEP_RGB[st]);
  if (st === 2 && hov >= 0 && now % 900 < 150) {
    const dpr = canvas.width / S;
    const k = Math.floor(now / 50);
    const sy = frac(Math.sin(k * 91.7) * 4375.5) * S * 0.8;
    ctx.drawImage(canvas, 0, sy * dpr, canvas.width, S * 0.05 * dpr, (frac(Math.sin(k * 17.3) * 999.1) - 0.5) * 16, sy, S, S * 0.05);
  }
}

function draw(canvas: HTMLCanvasElement, S: number, cur: number, now: number, hov: number, font: string, opts: DrawOpts): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const px = Math.round(S * dpr);
  if (canvas.width !== px) {
    canvas.width = px;
    canvas.height = px;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, S, S);
  const shk = shakeOn(ctx, S, cur);
  drawBg(ctx, S, now, 0, opts, font);
  const g = geo(S);
  const cx = g.cx;
  const rim = g.rim;
  const sc = g.sc;
  const TAU = Math.PI * 2;

  // Dial
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(160,190,230,0.16)";
  ctx.beginPath();
  ctx.arc(cx, cx, rim, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = "rgba(160,190,230,0.07)";
  ctx.beginPath();
  ctx.arc(cx, cx, rim * 0.45, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cx, rim * 0.9, 0, TAU);
  ctx.stroke();
  for (const tk of TICKS) {
    const a = tk.a;
    const major = tk.major;
    const len = (major ? 10 : 4) * sc;
    ctx.strokeStyle = major ? "rgba(190,215,255,0.55)" : "rgba(160,190,230,0.22)";
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (rim - len), cx + Math.sin(a) * (rim - len));
    ctx.lineTo(cx + Math.cos(a) * rim, cx + Math.sin(a) * rim);
    ctx.stroke();
    if (major && opts.showTime) {
      ctx.fillStyle = "rgba(190,210,240,0.8)";
      ctx.font = Math.max(9, 11 * sc) + "px " + font;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lr = rim + g.margin * 0.55;
      ctx.fillText(tk.label, cx + Math.cos(a) * lr, cx + Math.sin(a) * lr);
    }
  }

  // Hand and the swept wedge
  const ah = (cur / DAY) * TAU - Math.PI / 2;
  ctx.fillStyle = "rgba(120,170,255,0.05)";
  ctx.beginPath();
  ctx.moveTo(cx, cx);
  ctx.arc(cx, cx, rim, ah - 0.4, ah);
  ctx.closePath();
  ctx.fill();
  for (let k = 0; k < 12; k++) {
    const a = ah - k * 0.01;
    ctx.strokeStyle = "rgba(200,225,255," + (0.5 * (1 - k / 12)).toFixed(3) + ")";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * rim * 0.45, cx + Math.sin(a) * rim * 0.45);
    ctx.lineTo(cx + Math.cos(a) * rim, cx + Math.sin(a) * rim);
    ctx.stroke();
  }

  sweep(ctx, cx, rim * 0.45, rim, ah, SWEEP_RGB[0]);

  const N = NODES.length;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < N; i++) {
    const p = nodeXY(i, S);
    xs.push(p[0]);
    ys.push(p[1]);
  }
  const ctl = (i: number): [number, number] => [cx + ((xs[i] + xs[i + 1]) / 2 - cx) * 0.8, cx + ((ys[i] + ys[i + 1]) / 2 - cx) * 0.8];

  // Neural paths: not yet reached, already passed
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(130,165,220,0.05)";
  ctx.beginPath();
  for (let i = 0; i < N - 1; i++) {
    if (NODES[i + 1].ts > cur) {
      const q = ctl(i);
      ctx.moveTo(xs[i], ys[i]);
      ctx.quadraticCurveTo(q[0], q[1], xs[i + 1], ys[i + 1]);
    }
  }
  ctx.stroke();
  ctx.strokeStyle = "rgba(150,190,250,0.13)";
  ctx.beginPath();
  for (let i = 0; i < N - 1; i++) {
    if (NODES[i + 1].ts <= cur) {
      const q = ctl(i);
      ctx.moveTo(xs[i], ys[i]);
      ctx.quadraticCurveTo(q[0], q[1], xs[i + 1], ys[i + 1]);
    }
  }
  ctx.stroke();

  // Recent discharge: dashed line flowing along the path
  const RECENT = 14400;
  ctx.setLineDash([3 * sc, 8 * sc]);
  ctx.lineDashOffset = -(now / 35) * sc;
  for (let i = 0; i < N - 1; i++) {
    const te = NODES[i + 1].ts;
    const age = cur - te;
    if (age >= 0 && age < RECENT) {
      const q = ctl(i);
      ctx.strokeStyle = rgba(COLS[NODES[i + 1].kind], 0.75 * (1 - age / RECENT));
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(xs[i], ys[i]);
      ctx.quadraticCurveTo(q[0], q[1], xs[i + 1], ys[i + 1]);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  // The segment the hand is on: pulse head
  for (let i = 0; i < N - 1; i++) {
    if (NODES[i].ts <= cur && cur < NODES[i + 1].ts) {
      const f = (cur - NODES[i].ts) / (NODES[i + 1].ts - NODES[i].ts);
      const q = ctl(i);
      const col = COLS[NODES[i + 1].kind];
      ctx.strokeStyle = rgba(col, 0.8);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(xs[i], ys[i]);
      for (let s = 1; s <= 16; s++) {
        const pt = qpt(xs[i], ys[i], q[0], q[1], xs[i + 1], ys[i + 1], (f * s) / 16);
        ctx.lineTo(pt[0], pt[1]);
      }
      ctx.stroke();
      const hd = qpt(xs[i], ys[i], q[0], q[1], xs[i + 1], ys[i + 1], f);
      ctx.fillStyle = rgba(col, 1);
      ctx.shadowColor = rgba(col, 1);
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(hd[0], hd[1], 2.6 * sc, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
      break;
    }
  }

  // Dots
  for (let i = 0; i < N; i++) {
    const n = NODES[i];
    const col = COLS[n.kind];
    const age = cur - n.ts;
    if (age < 0) {
      ctx.fillStyle = rgba(col, 0.17);
      ctx.beginPath();
      ctx.arc(xs[i], ys[i], 1.5 * sc, 0, TAU);
      ctx.fill();
      continue;
    }
    if (n.tier > 0) {
      ctx.fillStyle = rgba(col, 0.03 + 0.05 * n.rip);
      ctx.beginPath();
      ctx.arc(xs[i], ys[i], (5 + 30 * n.rip) * sc * 0.42, 0, TAU);
      ctx.fill();
    }
    let r = (1.7 + 1.8 * n.bright) * sc;
    const flash = age < 1500 ? 1 - age / 1500 : 0;
    r *= 1 + flash * 1.1;
    if (flash > 0) {
      ctx.shadowColor = rgba(col, 1);
      ctx.shadowBlur = 14 * flash;
    }
    ctx.fillStyle = rgba(col, 0.38 + 0.62 * n.bright);
    ctx.beginPath();
    ctx.arc(xs[i], ys[i], r, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  if (hov >= 0 && hov < N) {
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(xs[hov], ys[hov], 7 * sc + 2, 0, TAU);
    ctx.stroke();
  }

  fxPaths(ctx, cur, now, xs, ys, cx, sc);
  fxNodes(ctx, S, cur, xs, ys, 0);

  // Follow particles: only inside snapshot intervals with a real delta; triggered by the hand, drawn into the centre
  const arriving = opts.showFollow ? fxFollow(ctx, S, cur, 0) : 0;
  if (shk) ctx.restore();

  // Centre
  drawCenter(ctx, cx, rim * 0.45, S, now, font, opts, N, arriving, cur);
  fxFinale(ctx, S, opts.fin, 0, xs, ys);
  if (opts.showTime) handLabel(ctx, S, ah, cur, font, SWEEP_RGB[0]);
}

// =====================================================================================================
// Background music: generated live with Web Audio (no audio files, no network, nothing copyrighted).
// Every lit dot plays one soft note on a tempo grid (A minor pentatonic, pitch and loudness follow engagement); major
// shockwaves add a bell chord and a low swell; follower particles chime on arrival; a quiet bed (chords, pulse, arpeggio)
// gets denser with the posting activity of the current hour. It follows play / pause / scrub / speed, starts only after a
// click on the music buttons, and is routed through a compressor, a limiter and a soft clipper so it cannot clip.
// If AudioContext is unavailable (sandboxed page, old browser) the buttons stay inert and everything else works.
// =====================================================================================================
const musicNames = (): string[] => [tx("关", "Off"), tx("律动", "Pulse"), tx("钢琴", "Piano"), tx("古典", "Classical")];
const BPM = 100;
const SLOT = 60 / BPM / 4; // sixteenth note
const PENT = [0, 3, 5, 7, 10]; // A minor pentatonic
const CHORDS: number[][] = [
  [45, 52, 57, 60], // Am
  [41, 48, 53, 57], // F
  [48, 55, 60, 64], // C
  [43, 50, 55, 59], // G
];
let NODE_TS: number[] = [];
let ARR_AT: number[] = [];
let ACT: number[] = [];
function actAt(cur: number): number {
  const x = Math.max(0, Math.min(23.999, (cur / DAY) * 24 - 0.5));
  const a = Math.floor(x);
  const f = x - a;
  return ACT[a] * (1 - f) + ACT[Math.min(23, a + 1)] * f;
}
function hz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}
function hsh(i: number): number {
  return frac(Math.sin(i * 12.9898 + 4.1) * 43758.5453);
}
function liveRaw(cur: number): number {
  let r = 0;
  for (let i = lowerBound(NODE_TS, cur) - 1; i >= 0; i--) {
    const d = cur - NODE_TS[i];
    if (d > LIVE_WIN) break;
    r += NODE_P[i] * Math.exp(-d / LIVE_TAU);
  }
  return r;
}
function liveStep(cur: number, now: number): void {
  const L = LIVE;
  const raw = liveRaw(cur);
  const dt = Math.min(250, Math.max(0, now - L.t));
  L.t = now;
  const jump = !L.init || cur < L.cur || cur - L.cur > 900;
  L.cur = cur;
  L.raw = raw;
  const T = LIVE_T;
  if (jump) {
    L.sm = raw;
    let l = 0;
    while (l < 4 && raw >= T[l]) l++;
    L.lvl = l;
    L.prev = l;
    L.at = -1e9;
    L.init = true;
  } else {
    L.sm = ease(L.sm, raw, 1 - Math.exp(-dt / 600));
    // hysteresis: step up when the smoothed score reaches the next cut, step down only after it falls 35% below the cut under the current level; minimum dwell per step
    const dwell = now - L.at;
    if (L.lvl < 4 && L.sm >= T[L.lvl] && dwell > 600) {
      L.prev = L.lvl;
      L.lvl++;
      L.at = now;
    } else if (L.lvl > 0 && L.sm < T[L.lvl - 1] * 0.65 && dwell > 1500) {
      L.prev = L.lvl;
      L.lvl--;
      L.at = now;
    }
  }
  const lo = L.lvl === 0 ? 0 : T[L.lvl - 1];
  const hi = L.lvl === 4 ? T[3] * 1.8 : T[L.lvl];
  const f = Math.max(0, Math.min(1, (L.sm - lo) / Math.max(1e-6, hi - lo)));
  L.k = Math.max(0, Math.min(1, (L.lvl + 0.6 * f) / 4));
}
function lowerBound(arr: number[], v: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m] <= v) lo = m + 1;
    else hi = m;
  }
  return lo;
}

class MusicEngine {
  ctx: BaseAudioContext;
  master: GainNode;
  dry: GainNode;
  send: GainNode;
  noise: AudioBuffer;
  style = 0;
  private nextBed = 0;
  private wasPlaying = false;
  private slotUse = new Map<number, number>();
  private ends: number[] = [];
  private vol = 0.7;
  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -4;
    lim.knee.value = 0;
    lim.ratio.value = 20;
    lim.attack.value = 0.001;
    lim.release.value = 0.08;
    const clip = ctx.createWaveShaper();
    const cv = new Float32Array(2049);
    for (let k = 0; k < cv.length; k++) {
      const x = (k / 1024 - 1) * 1.4;
      cv[k] = Math.tanh(x) / Math.tanh(1.4) * 0.92;
    }
    clip.curve = cv;
    this.master = ctx.createGain();
    this.master.gain.value = this.vol;
    this.dry = ctx.createGain();
    this.dry.gain.value = 1;
    this.send = ctx.createGain();
    this.send.gain.value = 0.3;
    // Small synthetic room: decaying stereo noise impulse
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 1.7);
    const ir = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let s = 12345 + ch * 777;
      for (let k = 0; k < len; k++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        d[k] = ((s / 4294967296) * 2 - 1) * Math.pow(1 - k / len, 2.6);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    const wlp = ctx.createBiquadFilter();
    wlp.type = "lowpass";
    wlp.frequency.value = 3200;
    this.send.connect(wlp);
    wlp.connect(conv);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    conv.connect(wet);
    wet.connect(this.master);
    this.dry.connect(this.master);
    this.master.connect(comp);
    comp.connect(lim);
    lim.connect(clip);
    clip.connect(ctx.destination);
    this.noise = ctx.createBuffer(1, sr, sr);
    const nd = this.noise.getChannelData(0);
    let s2 = 99991;
    for (let k = 0; k < nd.length; k++) {
      s2 = (s2 * 1664525 + 1013904223) >>> 0;
      nd[k] = (s2 / 4294967296) * 2 - 1;
    }
  }
  setVolume(v: number): void {
    this.vol = Math.max(0, Math.min(1, v));
    this.master.gain.value = this.vol;
  }
  setStyle(s: number): void {
    if (s !== this.style) {
      this.style = s;
      this.wasPlaying = false;
      this.slotUse.clear();
    }
  }
  // Voice limiter: at most 26 sounding voices; extra ones are skipped
  private ok(t: number, dur: number): boolean {
    this.ends = this.ends.filter((e) => e > t);
    if (this.ends.length >= 26) return false;
    this.ends.push(t + dur);
    return true;
  }
  private tone(type: OscillatorType, f: number, t: number, a: number, dur: number, peak: number, dst: AudioNode, wet: number, cut?: [number, number, number]): void {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
    let last: AudioNode = o;
    if (cut) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(cut[0], t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(80, cut[1]), t + cut[2]);
      o.connect(lp);
      last = lp;
    }
    last.connect(g);
    g.connect(dst);
    if (wet > 0) {
      const w = this.ctx.createGain();
      w.gain.value = wet;
      g.connect(w);
      w.connect(this.send);
    }
    o.start(t);
    o.stop(t + a + dur + 0.05);
  }
  private note(m: number, t: number, vel: number, role: number): void {
    const f = hz(m);
    const st = this.style;
    const dur = Math.max(0.5, Math.min(2.4, 2.4 * Math.pow(220 / f, 0.6)));
    if (!this.ok(t, dur + 0.1)) return;
    if (st === 1) {
      // electronic pluck
      this.tone("sawtooth", f, t, 0.003, 0.2 + 0.1 * vel, 0.1 * vel, this.dry, 0.25, [5200, 500, 0.18]);
      this.tone("square", f * 1.004, t, 0.003, 0.15, 0.04 * vel, this.dry, 0.15, [3000, 500, 0.12]);
    } else if (st === 2) {
      // felt piano: triangle body + decaying harmonics
      this.tone("triangle", f, t, 0.004, dur, 0.2 * vel, this.dry, 0.35, [4200, 900, 0.5]);
      this.tone("sine", f * 2, t, 0.003, dur * 0.5, 0.06 * vel, this.dry, 0.3);
      this.tone("sine", f * 3.01, t, 0.002, dur * 0.25, 0.025 * vel, this.dry, 0.3);
    } else {
      // plucked strings / harp
      this.tone("triangle", f, t, 0.006, dur * 0.8, 0.17 * vel, this.dry, 0.45, [3200, 700, 0.6]);
      this.tone("sine", f * 2, t, 0.004, dur * 0.3, 0.05 * vel, this.dry, 0.4);
      if (role === 1) this.tone("sawtooth", f, t, 0.18, dur * 0.7, 0.035 * vel, this.dry, 0.5, [1600, 900, 1]);
    }
  }
  private bell(m: number, t: number, vel: number): void {
    const f = hz(m);
    if (!this.ok(t, 3.5)) return;
    const R = [1, 2.76, 5.4, 8.93];
    const G = [1, 0.5, 0.22, 0.1];
    const D = [3.2, 2.2, 1.3, 0.8];
    for (let k = 0; k < 4; k++) this.tone("sine", f * R[k], t, 0.002, D[k], 0.11 * vel * G[k], this.dry, 0.55);
  }
  private swell(t: number, m: number, vel: number): void {
    if (!this.ok(t, 3.5)) return;
    this.tone("sine", hz(m - 12), t, 0.09, 2.6, 0.28 * vel, this.dry, 0.2);
    const o = this.ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.45);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.34 * vel, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.connect(g);
    g.connect(this.dry);
    o.start(t);
    o.stop(t + 0.8);
    const ns = this.ctx.createBufferSource();
    ns.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(3200, t + 0.7);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(0.1 * vel, t + 0.25);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    ns.connect(bp);
    bp.connect(ng);
    ng.connect(this.dry);
    ng.connect(this.send);
    ns.start(t);
    ns.stop(t + 1);
  }
  private chime(t: number, k: number): void {
    if (!this.ok(t, 1.2)) return;
    const m = 81 + PENT[Math.floor(hsh(k * 3 + 1) * 5)] + (hsh(k) > 0.6 ? 12 : 0);
    this.tone("sine", hz(m), t, 0.002, 0.9, 0.07, this.dry, 0.6);
    this.tone("sine", hz(m + 12.02), t + 0.045, 0.002, 0.5, 0.035, this.dry, 0.6);
  }
  private kick(t: number): void {
    const o = this.ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g);
    g.connect(this.dry);
    o.start(t);
    o.stop(t + 0.3);
  }
  private hat(t: number, v: number): void {
    const ns = this.ctx.createBufferSource();
    ns.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.09 * v, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    ns.connect(hp);
    hp.connect(g);
    g.connect(this.dry);
    ns.start(t, (t * 7.3) % 0.8);
    ns.stop(t + 0.07);
  }
  private pad(ms: number[], t: number, dur: number, v: number): void {
    for (const m of ms) {
      if (!this.ok(t, dur + 1)) return;
      for (const dc of [-7, 7]) {
        const o = this.ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = hz(m + 12) * Math.pow(2, dc / 1200);
        const lp = this.ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 1100;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.022 * v, t + dur * 0.35);
        g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.9);
        o.connect(lp);
        lp.connect(g);
        g.connect(this.dry);
        g.connect(this.send);
        o.start(t);
        o.stop(t + dur + 1);
      }
    }
  }
  private bed(slot: number, cur: number): void {
    const t = slot * SLOT;
    const step = slot % 16;
    const bar = Math.floor(slot / 16);
    const ch = CHORDS[bar % 4];
    const act = actAt(cur);
    const lvl = act < 0.2 ? 0 : act < 0.45 ? 1 : act < 0.72 ? 2 : 3;
    const st = this.style;
    const arp = (m: number, v: number, role: number) => this.note(m, t, v, role);
    if (st === 1) {
      if (step % 4 === 0) this.kick(t);
      if (step % 4 === 2 && lvl >= 1) this.hat(t, 0.8);
      if (lvl >= 2 && step % 2 === 1 && hsh(slot) < 0.35 + 0.4 * act) this.hat(t, 0.4);
      if (step === 0 || (lvl >= 2 && (step === 6 || step === 10))) this.tone("sawtooth", hz(ch[0]), t, 0.004, 0.32, 0.12, this.dry, 0.08, [700, 160, 0.25]);
      const pat = lvl === 0 ? [] : lvl === 1 ? [3, 11] : lvl === 2 ? [3, 7, 11, 14] : [1, 3, 5, 7, 9, 11, 13, 15];
      if (pat.indexOf(step) >= 0) arp(ch[1 + (step % 3)] + 12, 0.34, 0);
    } else if (st === 2) {
      const pat = lvl === 0 ? [0] : lvl === 1 ? [0, 8] : lvl === 2 ? [0, 4, 8, 12] : [0, 2, 4, 6, 8, 10, 12, 14];
      const k = pat.indexOf(step);
      if (k >= 0) arp(step === 0 ? ch[0] + 12 : ch[1 + (k % 3)] + 12, step === 0 ? 0.5 : 0.3, 0);
    } else {
      if (step === 0) this.pad(ch, t, 16 * SLOT, 1);
      const pat = lvl === 0 ? [] : lvl === 1 ? [4, 12] : lvl === 2 ? [2, 6, 10, 14] : [0, 2, 4, 6, 8, 10, 12, 14];
      const k = pat.indexOf(step);
      if (k >= 0) arp(ch[k % 4] + 12 + (k % 8 >= 4 ? 12 : 0), 0.3, 0);
      if (step === 0) arp(ch[0], 0.5, 1);
    }
  }
  // Called once per animation frame with the audio-clock time t. prevCur/cur: dial time in seconds (0..86400).
  frame(t: number, prevCur: number, cur: number, playing: boolean, speed: number, dtMs: number, follow: boolean): void {
    if (this.style === 0) return;
    if (!playing) {
      this.wasPlaying = false;
      return;
    }
    const expect = ((Math.max(1, dtMs) * speed) / 30000) * DAY;
    const dl = cur - prevCur;
    const jump = dl < 0 || dl > expect * 4 + 150;
    if (!this.wasPlaying) {
      this.wasPlaying = true;
      this.nextBed = Math.ceil((t + 0.06) / SLOT);
    }
    if (this.slotUse.size > 64) {
      const lo = Math.floor(t / SLOT) - 8;
      for (const k of Array.from(this.slotUse.keys())) if (k < lo) this.slotUse.delete(k);
    }
    if (!jump && dl > 0) {
      const lat = t + 0.025;
      let slot = Math.round(lat / SLOT);
      if (slot * SLOT < lat) slot += 1;
      const when = slot * SLOT;
      const a = lowerBound(NODE_TS, prevCur);
      for (let i = a; i < NODES.length && NODES[i].ts <= cur; i++) {
        const n = NODES[i];
        const used = this.slotUse.get(slot) ?? 0;
        const cap = this.style === 1 ? 1 : 2;
        if (n.tier === 2) {
          const root = CHORDS[Math.floor(slot / 16) % 4];
          this.swell(t + 0.025, root[0], 1);
          this.bell(root[2] + 12, t + 0.025, 1);
          this.bell(root[3] + 24, t + 0.045, 0.7);
        } else if (n.tier === 1) {
          const k = Math.min(11, 5 + Math.floor(n.bright * 5));
          this.bell(57 + 12 * Math.floor(k / 5) + PENT[k % 5], t + 0.025, 0.55);
        }
        if (used >= cap && n.tier === 0) continue;
        this.slotUse.set(slot, used + 1);
        const k = Math.max(0, Math.min(11, Math.floor((0.3 * n.rip + 0.7 * n.bright) * 7) + Math.floor(hsh(i) * 3) + (n.kind === 2 ? 2 : n.kind === 0 ? 1 : 0)));
        const vel = 0.35 + 0.65 * Math.max(n.bright, 0.45 * n.rip) + (n.tier > 0 ? 0.2 : 0);
        this.note(57 + 12 * Math.floor(k / 5) + PENT[k % 5], when, Math.min(1, vel), 0);
      }
      if (follow) {
        const b0 = lowerBound(ARR_AT, prevCur);
        for (let q = b0; q < ARR_AT.length && ARR_AT[q] <= cur; q++) this.chime(when + 0.01, q);
      }
      if (prevCur < DAY && cur >= DAY) {
        const root = CHORDS[0];
        this.swell(t + 0.03, root[0], 1);
        for (let q = 0; q < 4; q++) this.bell(root[q] + 24, t + 0.03 + q * 0.07, 0.8);
      }
    }
    while (this.nextBed * SLOT < t + 0.25) {
      if (this.nextBed * SLOT >= t) this.bed(this.nextBed, cur);
      this.nextBed += 1;
    }
  }
}

// Switch the whole module state to day i (called from <Replay> before it renders with that day)
function selectDay(i: number): void {
  const d = DAYS[i];
  CUR_DAY = i;
  DAY = d.len;
  START_S = d.startS;
  FOL = d.fol;
  HAS_FOL = FOL.delta !== null && Number.isFinite(FOL.delta);
  FOLLOW_DELTA = HAS_FOL ? Math.round(FOL.delta as number) : 0;
  FOLLOW_NOW = FOL.current !== null && Number.isFinite(FOL.current) ? FOL.current : null;
  STATUS = d.status !== null && typeof d.status === "object" ? d.status : null;
  HAS_STATUS = STATUS !== null;
  TIER = STATUS === null || !Number.isFinite(STATUS.tier) ? 2 : Math.max(0, Math.min(4, Math.round(STATUS.tier)));
  IS_YDAY = isYesterday(d);
  NODES = buildNodes();
  PARTS = buildParts();
  COUNT_BY_KIND[0] = 0;
  COUNT_BY_KIND[1] = 0;
  COUNT_BY_KIND[2] = 0;
  SELF_N = 0;
  MISSING_N = 0;
  HAS_IMP = false;
  HAS_ENG = false;
  ANY_TEXT = false;
  for (const n of NODES) {
    COUNT_BY_KIND[n.kind] += 1;
    if (n.self) SELF_N += 1;
    if (n.v === null || n.l === null || n.r === null || n.c === null || n.q === null) MISSING_N += 1;
    if (n.v !== null) HAS_IMP = true;
    if (n.l !== null || n.r !== null || n.c !== null || n.q !== null) HAS_ENG = true;
    if (n.text !== "") ANY_TEXT = true;
  }
  // Dial ticks sit on real local hours (a 23 h / 25 h day has 23 / 25 of them; a skipped hour is simply missing); every third local hour is labelled
  TICKS = [];
  for (let t = 0; t < DAY - 1; t += 900) {
    const lp = lparts(START_S + t);
    if (lp.mi !== 0 && t > 0) continue;
    TICKS.push({ a: (t / DAY) * TAU2 - Math.PI / 2, major: lp.mi === 0 && lp.h % 3 === 0, label: pad2(lp.h) + ":" + pad2(lp.mi) });
  }
  AVAIL = { ...VIS_TRUE, handle: HANDLE !== "", name: NAME !== "", follow: HAS_FOL, fans: FOLLOW_NOW !== null, text: ANY_TEXT };
  VIS_TOTAL = Object.values(AVAIL).filter((x) => x).length;
  FOL0 = FOLLOW_DELTA - PARTS.length;
  ROLL = { imp: 0, eng: 0, fol: FOL0, t: 0 };
  BIG_IDX = NODES.filter((n) => n.tier > 0).map((n) => n.idx);
  NODE_TS = NODES.map((n) => n.ts);
  {
    const eng = (n: NodeT): number => (n.l ?? 0) + (n.r ?? 0) + (n.c ?? 0) + (n.q ?? 0);
    const med = (a: number[]): number => {
      const b = a.filter((x) => x > 0).sort((x, y) => x - y);
      return b.length === 0 ? 1 : Math.max(1, b[b.length >> 1]);
    };
    const mE = med(NODES.map(eng));
    const mV = med(NODES.map((n) => n.v ?? 0));
    NODE_P = NODES.map((n) => 1 + eng(n) / (eng(n) + mE) + (n.v ?? 0) / ((n.v ?? 0) + mV));
    const grid: number[] = [];
    for (let g = 0; g < 288; g++) grid.push(liveRaw((g / 288) * DAY));
    grid.sort((a, b) => a - b);
    LIVE_T = LIVE_Q.map((q, i) => Math.max(LIVE_ABS[i], grid[Math.floor(q * grid.length)]));
    for (let i = 1; i < 4; i++) LIVE_T[i] = Math.max(LIVE_T[i], LIVE_T[i - 1] * 1.2);
    LIVE.init = false;
  }
  ARR_AT = PARTS.map((p) => p.ts + 14400).sort((a, b) => a - b);
  const c: number[] = [];
  for (let h = 0; h < 24; h++) c.push(0);
  for (const n of NODES) c[Math.min(23, Math.floor((n.ts / DAY) * 24))] += 1 + 2 * n.bright;
  const mx = Math.max(1, ...c);
  ACT = c.map((v) => Math.sqrt(v / mx));
}
if (BAD_DATA === null) selectDay(DAYS.length - 1);

function Replay() {
  const theme = useGrokTheme();
  const [lang, setLangState] = useState<Lang>(initialLang);
  LANG = lang; // before anything below calls tx()
  const [dayIdx, setDayIdx] = useState<number>(DAYS.length - 1);
  if (CUR_DAY !== dayIdx) selectDay(dayIdx); // module state follows the selected day before anything below reads it
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [avail, setAvail] = useState<number>(360);
  const [aspect, setAspect] = useState<number>(0);
  const [panel, setPanel] = useState<boolean>(false);
  const [prog, setProg] = useState<number>(0);
  const [playing, setPlaying] = useState<boolean>(!REDUCED);
  const [speed, setSpeed] = useState<number>(1);
  const [tip, setTip] = useState<{ idx: number; pinned: boolean; left: number } | null>(null);
  const [vis0, setVis] = useState<Vis>(VIS_TRUE);
  // Effective switches: the viewer's choice AND the item exists for the selected day
  const vis: Vis = { ...vis0 };
  for (const k of Object.keys(vis) as (keyof Vis)[]) vis[k] = vis0[k] && AVAIL[k];
  const [style, setStyle] = useState<number>(0);
  const [music, setMusic] = useState<number>(0);
  const [vol, setVol] = useState<number>(70);
  const [audioErr, setAudioErr] = useState<boolean>(false);
  const tipElRef = useRef<HTMLDivElement>(null);
  const [tipDy, setTipDy] = useState<number>(0);
  const actRef = useRef<{ toggle: () => void; step: (d: number) => void; lang: () => void }>({ toggle: () => {}, step: () => {}, lang: () => {} });
  // Aspect ratios: 1:1 / 9:16 / 16:9 fixed frames; the dial size is the frame minus legend and status line
  const fw = Math.max(280, Math.min(avail, aspect === 0 ? 800 : aspect === 1 ? 460 : 1040));
  const fh0 = aspect === 0 ? fw : aspect === 1 ? Math.round((fw * 16) / 9) : Math.round((fw * 9) / 16);
  const lh = vis.legend ? (fw < 560 ? 64 : 46) : 0;
  const sh = vis.status && HAS_STATUS ? 26 : 0;
  const size = Math.floor(Math.max(220, Math.min(fw - 24, fh0 - 24 - lh - sh)));
  const fh = Math.max(fh0, size + 24 + lh + sh);

  const progRef = useRef<number>(0);
  const playRef = useRef<boolean>(!REDUCED);
  const speedRef = useRef<number>(1);
  const sizeRef = useRef<number>(360);
  const tipRef = useRef<number>(-1);
  const fontRef = useRef<string>("sans-serif");
  playRef.current = playing;
  speedRef.current = speed;
  sizeRef.current = size;
  tipRef.current = tip ? tip.idx : -1;
  fontRef.current = theme.font.family;
  const endAtRef = useRef<number>(0);
  const musicRef = useRef<number>(0);
  const lastMusicRef = useRef<number>(2);
  const audRef = useRef<{ ctx: AudioContext; eng: MusicEngine } | null>(null);
  const lastCurRef = useRef<number>(0);
  musicRef.current = music;
  const optsRef = useRef<DrawOpts>({ tier: TIER, showFollow: true, showTime: true, style: 0, fin: -1, vis: VIS_TRUE });
  optsRef.current = { tier: TIER, showFollow: vis.follow, showTime: vis.time, style, fin: optsRef.current.fin, vis };

  useEffect(() => {
    const measure = () => {
      const w = wrapRef.current ? wrapRef.current.clientWidth : 360;
      setAvail(w);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    const inKit = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      return el !== null && typeof el.closest === "function" && el.closest("[data-kp]") !== null;
    };
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el ? el.tagName : "";
      const isRange = tag === "INPUT" && (el as HTMLInputElement).type === "range";
      if (tag === "TEXTAREA" || tag === "SELECT" || inKit(e.target)) return;
      if (e.key === " " && (tag !== "INPUT" || isRange)) {
        e.preventDefault();
        actRef.current.toggle();
      } else if (tag !== "INPUT" && (e.key === "l" || e.key === "L") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        actRef.current.lang();
      } else if (tag !== "INPUT" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        actRef.current.step((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 / 24 : 1 / 144));
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === " " && el && el.tagName === "BUTTON" && !inKit(e.target)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
    };
  }, []);

  // Vertically clamp the tooltip: measure its real height and shift it back if it leaves the viewport (the top stays visible first)
  useEffect(() => {
    const el = tipElRef.current;
    if (!tip || !el) {
      if (tipDy !== 0) setTipDy(0);
      return;
    }
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const top0 = r.top - tipDy;
    const bot0 = r.bottom - tipDy;
    let dy = 0;
    if (bot0 > vh - 8) dy = vh - 8 - bot0;
    if (top0 + dy < 8) dy = 8 - top0;
    if (Math.abs(dy - tipDy) > 0.5) setTipDy(dy);
  });

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      const cur0 = lastCurRef.current;
      const wasPlay = playRef.current;
      if (playRef.current) {
        let p = progRef.current + (dt * speedRef.current) / 30000;
        if (p >= 1) {
          p = 1;
          playRef.current = false;
          setPlaying(false);
          if (endAtRef.current === 0) endAtRef.current = now;
        }
        progRef.current = p;
        setProg(p);
      }
      const au = audRef.current;
      if (au && musicRef.current > 0) {
        try {
          au.eng.frame(au.ctx.currentTime, cur0, progRef.current * DAY, wasPlay, speedRef.current, dt, optsRef.current.showFollow);
        } catch {
          // audio problems must never break the picture
        }
      }
      lastCurRef.current = progRef.current * DAY;
      const cv = canvasRef.current;
      const o = optsRef.current;
      o.fin = endAtRef.current > 0 && !REDUCED ? (now - endAtRef.current) / 2400 : -1;
      if (cv) (o.style === 0 ? draw : drawStyled)(cv, sizeRef.current, progRef.current * DAY, now, tipRef.current, fontRef.current, o);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      const au = audRef.current;
      if (au) {
        try {
          void au.ctx.close().catch(() => undefined);
        } catch {
          // ignore
        }
        audRef.current = null;
      }
    };
  }, []);

  // Music: the audio context is only created inside a click on the music buttons (browser autoplay rule); any failure degrades to silence
  const pickMusic = (i: number) => {
    try {
      if (i > 0) lastMusicRef.current = i;
      if (i > 0 && !audRef.current) {
        const W = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
        const AC = W.AudioContext || W.webkitAudioContext;
        if (!AC) {
          setAudioErr(true);
          return;
        }
        const ctx = new AC();
        const eng = new MusicEngine(ctx);
        eng.setVolume(vol / 100);
        audRef.current = { ctx, eng };
      }
      const au = audRef.current;
      if (au) {
        au.eng.setStyle(i);
        if (i > 0) void au.ctx.resume().catch(() => undefined);
        else void au.ctx.suspend().catch(() => undefined);
      }
      musicRef.current = i;
      setMusic(i);
    } catch {
      setAudioErr(true);
      musicRef.current = 0;
      setMusic(0);
    }
  };
  // Volume is a small custom slider (not an <input type=range>) so the progress bar stays the page's only range input.
  const applyVol = (v: number) => {
    setVol(v);
    const au = audRef.current;
    if (au) au.eng.setVolume(v / 100);
  };
  const volAt = (e: PointerEvent<HTMLDivElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    if (b.width > 0) applyVol(Math.round(Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)) * 100));
  };

  const hit = (e: PointerEvent<HTMLCanvasElement>): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let best = -1;
    let bd = 14 * 14;
    for (let i = 0; i < NODES.length; i++) {
      const p = nodeXY(i, size, style);
      const d = (p[0] - mx) * (p[0] - mx) + (p[1] - my) * (p[1] - my);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  };
  const mkTip = (e: PointerEvent<HTMLCanvasElement>, h: number, pinned: boolean) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const p = nodeXY(h, size, style);
    const tw = tipW();
    const iw = typeof window !== "undefined" ? window.innerWidth : 360;
    const left = Math.max(8 - rect.left, Math.min(iw - 8 - tw - rect.left, p[0] - tw / 2));
    setTip({ idx: h, pinned, left });
  };
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (tip && tip.pinned) return;
    const h = hit(e);
    if (h < 0) {
      if (tip) setTip(null);
    } else if (!tip || tip.idx !== h) {
      mkTip(e, h, false);
    }
  };
  const onLeave = () => {
    if (tip && !tip.pinned) setTip(null);
  };
  const onUp = (e: PointerEvent<HTMLCanvasElement>) => {
    const h = hit(e);
    if (h < 0) setTip(null);
    else mkTip(e, h, true);
  };

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (progRef.current >= 1) {
      progRef.current = 0;
      setProg(0);
    }
    endAtRef.current = 0;
    setPlaying(true);
  };
  const restart = () => {
    progRef.current = 0;
    setProg(0);
    endAtRef.current = 0;
    playRef.current = true;
    setTip(null);
    setPlaying(true);
  };
  const onScrub = (e: ChangeEvent<HTMLInputElement>) => {
    const p = Number(e.target.value) / 1000;
    endAtRef.current = 0;
    progRef.current = p;
    setProg(p);
    setPlaying(false);
  };

  const step = (d: number) => {
    const p = Math.max(0, Math.min(1, progRef.current + d));
    endAtRef.current = 0;
    progRef.current = p;
    playRef.current = false;
    setProg(p);
    setPlaying(false);
  };
  const pickDay = (i: number) => {
    if (i === dayIdx) return;
    selectDay(i);
    setDayIdx(i);
    progRef.current = 0;
    setProg(0);
    endAtRef.current = 0;
    playRef.current = true;
    setTip(null);
    setPlaying(true);
  };
  const setLang = (l: Lang) => {
    LANG = l;
    setLangState(l);
    saveLang(l);
  };
  actRef.current = { toggle: togglePlay, step, lang: () => setLang(lang === "zh" ? "en" : "zh") };

  const cur = prog * DAY;
  let fired = 0;
  for (const n of NODES) if (n.ts <= cur) fired += 1;

  const stageBg = [
    "radial-gradient(circle at 50% 42%, #111c33 0%, #0a1020 55%, #060912 100%)",
    "radial-gradient(circle at 50% 45%, #1d1238 0%, #0d0a22 55%, #04030c 100%)",
    "radial-gradient(circle at 50% 45%, #1a0830 0%, #0a0218 50%, #020008 100%)",
  ][style];
  const btn = (active: boolean) => ({
    background: active ? "rgba(76,201,240,0.22)" : "rgba(255,255,255,0.06)",
    color: active ? "#e8f6ff" : "#a9bad2",
    border: "1px solid " + (active ? "rgba(76,201,240,0.7)" : "rgba(255,255,255,0.14)"),
    borderRadius: 10,
    padding: "0 16px",
    minHeight: 40,
    fontSize: 14,
    cursor: "pointer",
    fontFamily: theme.font.family,
  });

  const tn = tip ? NODES[tip.idx] : null;
  let tipEl = null;
  if (tn && tip) {
    const p = nodeXY(tn.idx, size, style);
    const tw = tipW();
    const left = tip.left;
    const above = p[1] > size * 0.55;
    const m = (v: Num) => (v === null ? tx("缺失", "missing") : String(v));
    const col = kcol(style, tn.kind);
    tipEl = (
      <div
        ref={tipElRef}
        style={{
          position: "absolute",
          left,
          top: (above ? p[1] - 14 : p[1] + 14) + tipDy,
          transform: above ? "translateY(-100%)" : undefined,
          width: tw,
          background: "rgba(8,13,26,0.96)",
          border: "1px solid " + rgba(col, 0.6),
          borderRadius: 10,
          padding: "10px 12px",
          color: "#e6edf7",
          fontSize: 12,
          lineHeight: "18px",
          pointerEvents: tip.pinned ? "auto" : "none",
          boxSizing: "border-box",
          zIndex: 5,
        }}
      >
        <div style={{ color: rgba(col, 1), marginBottom: 4 }}>
          {vis.time ? tzDT(tn.ts, true) + " " + TZ_LABEL + " · " : ""}
          {kindName(tn.kind)}
          {tn.self ? tx(" · 续写自己", " · self-thread") : ""}
        </div>
        {vis.text && tn.text !== "" ? <div style={{ fontSize: 13, lineHeight: "19px", marginBottom: 6, wordBreak: "break-all" }}>{tn.text}</div> : null}
        {vis.imp || vis.eng ? (
          <div style={{ color: "#a9bad2", marginBottom: 4 }}>
            {[
              vis.imp ? tx("曝光 ", "Impressions ") + m(tn.v) : "",
              vis.eng ? tx("赞 ", "Likes ") + m(tn.l) + tx(" · 转发 ", " · Reposts ") + m(tn.r) + tx(" · 回复 ", " · Replies ") + m(tn.c) + tx(" · 引用 ", " · Quotes ") + m(tn.q) : "",
            ]
              .filter((s) => s !== "")
              .join(" · ")}
          </div>
        ) : null}
        {tn.url === null ? (
          <div style={{ color: "#6f829c" }}>{tx("没有原帖链接", "No link for this post")}</div>
        ) : tip.pinned ? (
          <a href={tn.url} target="_blank" rel="noopener noreferrer" style={{ color: "#7cc4ff", wordBreak: "break-all" }}>
            {tx("打开原帖 ↗", "Open post ↗")}
          </a>
        ) : (
          <div style={{ color: "#6f829c" }}>{tx("点击光点固定并打开原帖链接", "Click the dot to pin it and open the post")}</div>
        )}
      </div>
    );
  }

  const legendItem = (c: number[], label: string, n: number) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginRight: 14 }}>
      <span style={{ width: 9, height: 9, borderRadius: 9, background: rgba(c, 1), display: "inline-block" }} />
      {label}
      {n > 0 ? " " + n : ""}
    </span>
  );

  const fmtInt = (x: number): string => String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fn = DATA.footnotes;
  const metricsNote = [
    fn.metricsFetchedAt !== null
      ? tx("指标抓取于 " + fmtIso(fn.metricsFetchedAt) + "，新帖的曝光与互动仍在增长。", "Metrics fetched at " + fmtIso(fn.metricsFetchedAt) + "; recent posts are still gathering impressions and engagement.")
      : "",
    fn.retweetsExcluded !== null ? tx("转推 " + fn.retweetsExcluded + " 条未计入。", "Retweets excluded: " + fn.retweetsExcluded + ".") : "",
    tx("回复含续写自己 " + SELF_N + " 条。", "Self-thread replies: " + SELF_N + "."),
    MISSING_N > 0
      ? tx(MISSING_N + " 条帖子有缺失指标：浮层标“缺失”，不计入累计，也不做估算。", "Posts with missing metrics: " + MISSING_N + " (shown as “missing” in tooltips, not counted in totals, never estimated).")
      : "",
  ]
    .filter((x) => x !== "")
    .join(" ");
  let followNote = "";
  if (HAS_FOL) {
    const sign = FOLLOW_DELTA > 0 ? "+" : "";
    const when = FOL.baselineAt !== null ? fmtIso(FOL.baselineAt) : "";
    followNote =
      FOLLOW_NOW !== null
        ? tx(
            "关注变化 " + sign + FOLLOW_DELTA + " = 当前粉丝 " + fmtInt(FOLLOW_NOW) + " − 基线 " + fmtInt(FOLLOW_NOW - FOLLOW_DELTA) + (when !== "" ? "（快照 " + when + "）" : "") + "；关注粒子按快照区间分布，不代表单个关注的确切时刻。",
            "Follower change " + sign + FOLLOW_DELTA + " = current followers " + fmtInt(FOLLOW_NOW) + " − baseline " + fmtInt(FOLLOW_NOW - FOLLOW_DELTA) + (when !== "" ? " (snapshot " + when + ")" : "") + ". Follow particles are spread across the snapshot interval and do not mark exact follow times.",
          )
        : tx("关注变化 " + sign + FOLLOW_DELTA + (when !== "" ? "（相对 " + when + " 的快照）" : "") + "。", "Follower change " + sign + FOLLOW_DELTA + (when !== "" ? " (since the snapshot at " + when + ")" : "") + ".");
  } else if (FOL.firstRun) {
    followNote = tx("首次回放：还没有粉丝基线，所以不显示关注变化，下一次回放起才有。", "First replay: no follower baseline is stored yet, so follower change is hidden. It appears from the next replay.");
  } else {
    followNote = tx("本次窗口的关注变化缺失，未显示。", "Follower change is missing for this window and is not shown.");
  }
  const boardNote = tx(
    "中心看板：曝光、互动是窗口内全部 " + NODES.length + " 条（发帖+回复+引用）累计到指针位置，数字随回放滚动" + (HAS_FOL ? "；关注变化随关注粒子被吸入时累加，播完停在 " + (FOLLOW_DELTA > 0 ? "+" : "") + FOLLOW_DELTA + "，粉丝数 = 基线 + 关注变化（净增量，不含取关拆分）。" : "。"),
    "Center board: impressions and engagement are running totals of all " + NODES.length + " posts (posts + replies + quotes) up to the hand, rolling as the replay plays" + (HAS_FOL ? ". Follower change counts up as particles arrive and rests at " + (FOLLOW_DELTA > 0 ? "+" : "") + FOLLOW_DELTA + "; followers = baseline + change (net change, follows and unfollows are not split)." : "."),
  );
  const statusTxt = STATUS === null ? "" : pickNote(STATUS.note);
  const ratioOk = STATUS !== null && STATUS.ratio !== null && Number.isFinite(STATUS.ratio);
  const statusNote =
    STATUS === null
      ? ""
      : [
          statusTxt !== "" ? (LANG === "zh" ? dayWord() + "状态：" : dayWord() + "'s status: ") + statusTxt : "",
          ratioOk ? (LANG === "zh" ? dayWord() + "倍数 " : "Multiple ") + (STATUS.ratio as number).toFixed(2) + tx("×（", "× (") + tierRule() + tx("）。", ").") : "",
          tx("评为「" + TIERS[TIER].name + "」。", "Rated “" + TIERS[TIER].name + "”."),
        ]
          .filter((x) => x !== "")
          .join(" ");
  const nOn = (Object.keys(vis) as (keyof Vis)[]).filter((k) => vis[k]).length;
  const tbtn = (active: boolean) => ({
    background: active ? "rgba(76,201,240,0.2)" : "transparent",
    color: theme.text.primary,
    border: "1px solid " + (active ? "rgba(76,201,240,0.7)" : theme.border.subtle),
    borderRadius: 10,
    padding: "0 16px",
    minHeight: 40,
    fontSize: 14,
    cursor: "pointer",
    fontFamily: theme.font.family,
  });
  const seg = (names: string[], sel: number, on: (i: number) => void) => (
    <div style={{ display: "inline-flex", border: "1px solid " + theme.border.subtle, borderRadius: 10, overflow: "hidden" }}>
      {names.map((nm, i) => (
        <button
          key={nm}
          onClick={() => on(i)}
          style={{
            background: sel === i ? "rgba(76,201,240,0.22)" : "transparent",
            color: sel === i ? theme.text.primary : theme.text.secondary,
            border: "none",
            padding: "0 14px",
            minHeight: 40,
            fontSize: 14,
            fontWeight: sel === i ? 600 : 400,
            cursor: "pointer",
            fontFamily: theme.font.family,
          }}
        >
          {nm}
        </button>
      ))}
    </div>
  );

  const dd = DAYS[CUR_DAY];
  const hrs = Math.round((DAY / 3600) * 100) / 100;
  const dayLenNote = DAY === 86400 ? "" : tx("该日 " + hrs + " 小时（夏令时切换）", hrs + "-hour day (clock change)");
  const title = DAYS.length > 1 ? tx("X 脉搏 · 每日回放", "X Pulse · Daily replay") : IS_YDAY ? tx("X 脉搏 · 昨日回放", "X Pulse · Yesterday's replay") : tx("X 脉搏 · " + dd.date + " 回放", "X Pulse · Replay of " + dd.date);
  return (
    <div style={{ background: theme.bg.base, color: theme.text.primary, padding: "24px 16px 36px", fontFamily: theme.font.family }}>
      <div style={{ maxWidth: 1040, margin: "0 auto" }}>
        <div style={{ ...theme.font.heading2, color: theme.text.primary, fontWeight: theme.weight.semibold }}>{title}</div>
        <div style={{ ...theme.font.subtext, color: theme.text.secondary, marginTop: 6, marginBottom: 18, lineHeight: "20px" }}>
          {[DATA.example ? tx("示例数据", "EXAMPLE DATA") : "", vis.name ? NAME : "", vis.handle ? HANDLE : "", TZ_LABEL, vis.time ? DAYS[CUR_DAY].date + " " + wday(DAYS[CUR_DAY].ymd) : "", dayLenNote, tx("0 点在顶部，指针转一圈 = 一整天", "Midnight at the top, one hand turn = the whole day")]
            .filter((s) => s !== "")
            .join(" · ")}
        </div>

        {DAYS.length > 1 ? (
          <div data-days="1" role="group" aria-label={tx("选择日期", "Select a day")} style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {DAYS.map((d, i) => (
              <button key={d.date} data-day={d.date} aria-pressed={i === dayIdx} onClick={() => pickDay(i)} style={{ ...tbtn(i === dayIdx), minHeight: 34, padding: "0 12px", fontSize: 13, fontWeight: i === dayIdx ? 600 : 400 }}>
                {(isYesterday(d) ? tx("昨日", "Yesterday") : wday(d.ymd)) + " " + d.date.slice(5)}
              </button>
            ))}
          </div>
        ) : null}

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 18px", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ ...theme.font.label, color: theme.text.tertiary }}>{tx("风格", "Style")}</span>
              {seg(styleNames(), style, (i) => {
                setStyle(i);
                setTip(null);
              })}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ ...theme.font.label, color: theme.text.tertiary }}>{tx("画幅", "Ratio")}</span>
              {seg(["1:1", "9:16", "16:9"], aspect, (i) => {
                setAspect(i);
                setTip(null);
              })}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <button data-music="toggle" aria-pressed={music > 0} disabled={audioErr} title={audioErr ? tx("此环境不支持音频", "Audio is not available here") : ""} onClick={() => pickMusic(music > 0 ? 0 : lastMusicRef.current)} style={{ ...tbtn(music > 0), opacity: audioErr ? 0.45 : 1 }}>
                {tx("🎵 音乐 · ", "🎵 Music · ") + (music > 0 ? tx("开", "On") : tx("关", "Off"))}
              </button>
              {seg(musicNames().slice(1), music - 1, (i) => pickMusic(i + 1))}
              <div
                role="slider"
                aria-label={tx("音量", "Volume")}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={vol}
                data-music="volume"
                onPointerDown={(e) => { if (audioErr) return; try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* no active pointer */ } volAt(e); }}
                onPointerMove={(e) => { if (!audioErr && e.buttons === 1) volAt(e); }}
                style={{ width: 84, height: 22, display: "flex", alignItems: "center", cursor: audioErr ? "default" : "pointer", opacity: audioErr ? 0.4 : music > 0 ? 1 : 0.5, touchAction: "none" }}
              >
                <div style={{ position: "relative", width: "100%", height: 4, borderRadius: 2, background: "rgba(128,140,165,.35)" }}>
                  <div style={{ width: vol + "%", height: "100%", borderRadius: 2, background: "#4cc9f0" }} />
                  <div style={{ position: "absolute", left: "calc(" + vol + "% - 6px)", top: -4, width: 12, height: 12, borderRadius: 6, background: "#e8f6fb", boxShadow: "0 0 0 1px rgba(0,0,0,.25)" }} />
                </div>
              </div>
            </div>
            <button onClick={() => setPanel(!panel)} style={tbtn(panel)}>
              {tx("显示设置 · ", "Display · ") + nOn + "/" + VIS_TOTAL + (panel ? " ▴" : " ▾")}
            </button>
            <div data-lang="switch" role="group" aria-label={tx("界面语言", "Language")} title={tx("界面语言（快捷键 L）", "Language (shortcut: L)")}>
              {seg(["EN", "中文"], lang === "zh" ? 1 : 0, (i) => setLang(i === 1 ? "zh" : "en"))}
            </div>
          </div>

        {!panel ? null : (
          <div data-kp="1" style={{ marginBottom: 12, border: "1px solid " + theme.border.subtle, borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
              <span style={{ ...theme.font.subtext, color: theme.text.secondary }}>{tx("每项独立开关，舞台画面完全按这里的勾选；录屏只录中间舞台", "Each item is an independent switch; the stage follows these checks. Record only the stage.")}</span>
              <span style={{ display: "inline-flex", gap: 8 }}>
                <button style={tbtn(false)} onClick={() => setVis(VIS_TRUE)}>
                  {tx("全开", "All on")}
                </button>
                <button style={tbtn(false)} onClick={() => setVis(VIS_NONE)}>
                  {tx("仅画面", "Visuals only")}
                </button>
              </span>
            </div>
            {visGroups().map((g) => (
              <div key={g.title} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 22px", padding: "10px 0", borderTop: "1px solid " + theme.border.subtle }}>
                <span style={{ ...theme.font.label, color: theme.text.tertiary, minWidth: 64 }}>{g.title}</span>
                {g.items.map((it) => (
                  <Toggle key={it[0]} label={it[1]} value={vis[it[0]]} onChange={(on) => setVis((p) => ({ ...p, [it[0]]: on }))} />
                ))}
              </div>
            ))}
          </div>
        )}

        <div ref={wrapRef} style={{ width: "100%" }}>
        <div style={{ width: fw, height: fh, margin: "0 auto", position: "relative", background: stageBg, borderRadius: 16, padding: 12, boxSizing: "border-box", display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "space-evenly", color: "#dbe6f5" }}>
          {vis.legend ? (
            <div>
              <div style={{ fontSize: 13, lineHeight: "22px", marginBottom: 4 }}>
                {legendItem(kcol(style, 0), kindName(0), COUNT_BY_KIND[0])}
                {legendItem(kcol(style, 1), kindName(1), COUNT_BY_KIND[1])}
                {legendItem(kcol(style, 2), kindName(2), COUNT_BY_KIND[2])}
                {vis.follow ? legendItem(PART_RGB, tx("新增关注", "New followers"), 0) : null}
              </div>
              <div style={{ fontSize: 11, color: "#7f93ae", marginBottom: 6 }}>
                {[
                  tx("涟漪半径 = 曝光（log₁₀）· 亮度 = 赞 + 转发 + 回复（log）", "Ripple radius = impressions (log₁₀) · brightness = likes + reposts + replies (log)"),
                  tx("星云光晕 = 曝光（log₁₀）· 亮度 = 互动 · 角度 = 时刻", "Nebula glow = impressions (log₁₀) · brightness = engagement · angle = time"),
                  tx("尖峰高度与声波扩散 = 曝光（log₁₀）· 亮度 = 互动 · 角度 = 时刻", "Spike height and wave spread = impressions (log₁₀) · brightness = engagement · angle = time"),
                ][style]}
              </div>
            </div>
          ) : null}

            <div style={{ width: size, height: size, margin: "0 auto", position: "relative", flexShrink: 0 }}>
              <canvas
                ref={canvasRef}
                aria-label={tx("24 小时发帖回放表盘 · " + styleNames()[style] + "风格", "24-hour posting replay dial · " + styleNames()[style] + " style")}
                style={{ width: size, height: size, display: "block", touchAction: "manipulation", cursor: "pointer" }}
                onPointerMove={onMove}
                onPointerLeave={onLeave}
                onPointerUp={onUp}
              />
              {tipEl}
            </div>

          {vis.status && HAS_STATUS ? (
            <div style={{ textAlign: "center", fontSize: 13, lineHeight: "22px", height: 22, color: "#9fb2cc" }}>
              <span style={{ color: rgba(TIERS[TIER].rgb, 1), fontWeight: 600 }}>{LANG === "zh" ? dayWord() + "状态 · " : dayWord() + " · "}{TIERS[TIER].name}</span>
              {" · " + TIERS[TIER].line}
            </div>
          ) : null}
        </div>
        </div>

        <div style={{ marginTop: 12, background: "#0c1322", borderRadius: 14, padding: "14px 14px 12px", color: "#dbe6f5" }}>
          <div>
            <div>

          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button style={{ ...btn(playing), minWidth: 96, minHeight: 44, fontWeight: 600 }} onClick={togglePlay}>
                {playing ? tx("暂停", "Pause") : prog >= 1 ? tx("重播", "Replay") : tx("播放", "Play")}
              </button>
              <button style={{ ...btn(false), minHeight: 44 }} onClick={restart}>
                {tx("从头播放", "Restart")}
              </button>
              <span style={{ fontSize: 13, color: "#c9d6e8", fontVariantNumeric: "tabular-nums", lineHeight: "20px" }}>
                {vis.time ? tzDT(cur, false) + " " + TZ_LABEL + " · " : ""}{tx("已亮 ", "Lit ")}{fired}/{NODES.length}
              </span>
            </div>
            <div style={{ display: "inline-flex", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, overflow: "hidden" }}>
              {[0.5, 1, 2, 4].map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  style={{
                    background: speed === s ? "rgba(76,201,240,0.24)" : "transparent",
                    color: speed === s ? "#e8f6ff" : "#a9bad2",
                    border: "none",
                    padding: "0 16px",
                    minHeight: 40,
                    fontSize: 14,
                    cursor: "pointer",
                    fontFamily: theme.font.family,
                  }}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(prog * 1000)}
            onChange={onScrub}
            aria-label={tx("回放进度", "Replay progress")}
            style={{ width: "100%", marginTop: 14, accentColor: "#4cc9f0" }}
          />
          {vis.time ? (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#6f829c", marginTop: 2 }}>
              <span>{tzDT(0, false)}</span>
              <span>{tzDT(DAY, false)}</span>
            </div>
          ) : null}
          <div style={{ fontSize: 12, color: "#6f829c", marginTop: 8 }}>{tx("快捷键：空格 播放/暂停 · ← → 微调进度 10 分钟（Shift 1 小时）· L 切换语言", "Shortcuts: Space play/pause · ← → step 10 minutes (Shift: 1 hour) · L switch language")}</div>
            </div>
          </div>
        </div>

        {vis.foot ? (
          <div style={{ ...theme.font.caption, color: theme.text.tertiary, marginTop: 16, lineHeight: "20px" }}>
            {DATA.example ? (
              <div style={{ marginBottom: 6, color: "#e0b050" }}>
                {tx("示例数据：占位数字，仅用于让页面能渲染，不是真实账号。", "EXAMPLE DATA: placeholder numbers so this page renders. This is not a real account.")}
              </div>
            ) : null}
            <div style={{ marginBottom: 6 }}>{metricsNote}</div>
            <div style={{ marginBottom: 6 }}>{followNote}</div>
            <div style={{ marginBottom: 6 }}>{boardNote}</div>
            {statusNote !== "" ? <div style={{ marginBottom: 6 }}>{statusNote}</div> : null}
            {fn.extra.map((x, i) => {
              const t = typeof x === "string" ? x : pickNote(x);
              return t === "" ? null : (
                <div key={i} style={{ marginBottom: 6 }}>
                  {t}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function App() {
  if (BAD_DATA !== null) return <div style={{ padding: 24, color: "#e0b050", fontFamily: "sans-serif" }}>X Pulse: {BAD_DATA}</div>;
  return <Replay />;
}
