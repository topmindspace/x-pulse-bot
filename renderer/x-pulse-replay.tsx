import { useEffect, useRef, useState, useGrokTheme, Toggle } from "grok/canvas";
import type { ChangeEvent, PointerEvent } from "grok/canvas";

// =====================================================================================================
// X Pulse · 24-hour replay renderer (generic, data-free)
//
// This file is a READ-ONLY, NO-NETWORK canvas page. Everything it shows comes from the single DATA object
// below. A Grok Bot fills DATA from the X API (and its own stored baseline), replaces ONLY the DATA block
// between the "BEGIN DATA" / "END DATA" markers, and passes the whole file to WriteCanvas.
// Do not add fetch / XMLHttpRequest / WebSocket / any external URL loading here. Do not touch anything
// outside the DATA block unless you are changing the renderer itself.
//
// DATA schema (see README.md for the full description):
//   lang        "en" | "zh"                      UI language of the page.
//   example     boolean                          true => placeholder data; the page says so in subtitle and footer.
//   account     { name, username }               display name and handle (with or without a leading "@").
//   avatar      { size, palette, indices } | null
//                 size     pixels per side of the square image (96 recommended)
//                 palette  base64 of the colour table, 3 bytes (R,G,B) per colour (64 colours recommended)
//                 indices  base64 of size*size bytes, one palette index per pixel, row-major
//               null => a letter placeholder is drawn instead (see tools/build_avatar.py to build one).
//   window      { startISO, endISO, tz }         exactly 24 hours; tz = { label, offsetMinutes } is used only for display.
//   posts       [{ t, kind, selfThread, text, impressions, likes, reposts, replies, quotes, url }]
//                 t ISO time; kind "post" | "reply" | "quote"; selfThread true when replying to own post;
//                 every metric is a number or null (null = missing, never estimate); url = https://x.com/... or null.
//                 Pure retweets are NOT included.
//   followers   { current, delta, baselineAt, firstRun, segments? }
//                 current   follower count now (null if unknown)
//                 delta     net follower change since the stored baseline (null when there is no baseline)
//                 baselineAt ISO time of the baseline snapshot (null when none)
//                 firstRun  true when no baseline existed yet (delta must then be null)
//                 segments  optional [{ fromISO, toISO, delta }] snapshot intervals used to place follow
//                           particles on the dial; default = one interval baselineAt -> window end.
//   status      { tier, ratio, note } | null
//                 tier 0..4 (0 = on fire, 1 = rising, 2 = steady, 3 = charging up, 4 = resting)
//                 ratio today / baseline multiple (number or null), note = how it was computed (free text).
//   footnotes   { metricsFetchedAt, retweetsExcluded, extra }
//                 metricsFetchedAt ISO time or null; retweetsExcluded number or null; extra = string[].
// =====================================================================================================

type Num = number | null;
type PostKind = "post" | "reply" | "quote";
interface DataPost {
  t: string;
  kind: PostKind;
  selfThread: boolean;
  text: string;
  impressions: Num;
  likes: Num;
  reposts: Num;
  replies: Num;
  quotes: Num;
  url: string | null;
}
interface Data {
  lang: "en" | "zh";
  example: boolean;
  account: { name: string; username: string };
  avatar: { size: number; palette: string; indices: string } | null;
  window: { startISO: string; endISO: string; tz: { label: string; offsetMinutes: number } };
  posts: DataPost[];
  followers: {
    current: Num;
    delta: Num;
    baselineAt: string | null;
    firstRun: boolean;
    segments?: { fromISO: string; toISO: string; delta: number }[];
  };
  status: { tier: number; ratio: Num; note: string } | null;
  footnotes: { metricsFetchedAt: string | null; retweetsExcluded: Num; extra: string[] };
}

// ===== BEGIN DATA =====
// EXAMPLE DATA ONLY: a made-up account with made-up posts so that this file renders on its own.
// A Grok Bot must replace everything between BEGIN DATA and END DATA with the real data and set example: false.
const DATA: Data = {
  lang: "en",
  example: true,
  account: { name: "Example Account", username: "example_user" },
  avatar: null,
  window: { startISO: "2026-01-01T00:00:00+08:00", endISO: "2026-01-02T00:00:00+08:00", tz: { label: "UTC+8", offsetMinutes: 480 } },
  posts: [
    { t: "2026-01-01T08:12:00+08:00", kind: "post", selfThread: false, text: "Example post: good morning, world", impressions: 1200, likes: 14, reposts: 2, replies: 3, quotes: 0, url: null },
    { t: "2026-01-01T09:40:00+08:00", kind: "reply", selfThread: false, text: "@someone Example reply", impressions: 85, likes: 1, reposts: 0, replies: 0, quotes: 0, url: null },
    { t: "2026-01-01T12:05:00+08:00", kind: "quote", selfThread: false, text: "Example quote post", impressions: 640, likes: 9, reposts: 1, replies: 1, quotes: 0, url: null },
    { t: "2026-01-01T12:20:00+08:00", kind: "reply", selfThread: true, text: "Example self-reply continuing a thread", impressions: 210, likes: 3, reposts: 0, replies: 0, quotes: 0, url: null },
    { t: "2026-01-01T15:30:00+08:00", kind: "post", selfThread: false, text: "Example post with missing metrics", impressions: null, likes: null, reposts: null, replies: null, quotes: null, url: null },
    { t: "2026-01-01T19:45:00+08:00", kind: "post", selfThread: false, text: "Example evening post", impressions: 3100, likes: 42, reposts: 6, replies: 8, quotes: 2, url: null },
    { t: "2026-01-01T22:10:00+08:00", kind: "reply", selfThread: false, text: "@someone Example late reply", impressions: 40, likes: 0, reposts: 0, replies: 0, quotes: 0, url: null },
  ],
  followers: { current: 1000, delta: null, baselineAt: null, firstRun: true },
  status: null,
  footnotes: { metricsFetchedAt: null, retweetsExcluded: null, extra: [] },
};
// ===== END DATA =====

// ---------- everything below is the renderer; it only reads DATA ----------
const EN = DATA.lang !== "zh";
function tx(zh: string, en: string): string {
  return EN ? en : zh;
}
const DAY = 86400;
const START_S = Math.floor(Date.parse(DATA.window.startISO) / 1000);
const TZ_S = Math.round(DATA.window.tz.offsetMinutes * 60);
const BAD_DATA: string | null =
  Number.isNaN(START_S) || !Number.isFinite(TZ_S) ? "DATA.window.startISO / DATA.window.tz.offsetMinutes is invalid" : null;
const NAME = DATA.account.name.trim();
const USERNAME = DATA.account.username.trim().replace(/^@+/, "");
const HANDLE = USERNAME === "" ? "" : "@" + USERNAME;
const KIND_OF: Record<string, number> = { post: 0, reply: 1, quote: 2 };
const KIND_NAME = [tx("发帖", "Posts"), tx("回复", "Replies"), tx("引用", "Quotes")];
const SAFE_URL = /^https:\/\/(x|twitter)\.com\//;

const FOL = DATA.followers;
const HAS_FOL = FOL.delta !== null && Number.isFinite(FOL.delta);
const FOLLOW_DELTA = HAS_FOL ? Math.round(FOL.delta as number) : 0;
const FOLLOW_NOW: Num = FOL.current !== null && Number.isFinite(FOL.current) ? FOL.current : null;
const STATUS = DATA.status;
const HAS_STATUS = STATUS !== null;
const TIER = STATUS === null || !Number.isFinite(STATUS.tier) ? 2 : Math.max(0, Math.min(4, Math.round(STATUS.tier)));
const TIER_RULE = tx("≥1.5 火热 · 1.0–1.5 上扬 · 0.7–1.0 在线 · 0.4–0.7 蓄力 · <0.4 充电", "≥1.5 on fire · 1.0–1.5 rising · 0.7–1.0 steady · 0.4–0.7 charging · <0.4 resting");

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
  { name: tx("状态火热", "On fire"), line: tx("火力全开，今天很燃", "Full power, today burns bright"), rgb: [255, 170, 70] },
  { name: tx("势头上扬", "Rising"), line: tx("光环正在升起", "The glow is rising"), rgb: [255, 214, 102] },
  { name: tx("稳稳在线", "Steady"), line: tx("心跳平稳，节奏在线", "Steady heartbeat, right on rhythm"), rgb: [255, 120, 150] },
  { name: tx("蓄力中", "Charging up"), line: tx("蓄力日，明天放大招", "A charging day, big moves ahead"), rgb: [124, 224, 150] },
  { name: tx("静心充电", "Recharging"), line: tx("好戏在后面", "The best is yet to come"), rgb: [150, 175, 255] },
];
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
// Items missing from the data (no status, no follower baseline, no follower count, no name) default to off and are hidden from the toggle panel
const VIS_ALL: Vis = { avatar: true, status: HAS_STATUS, posts: true, handle: HANDLE !== "", name: NAME !== "", follow: HAS_FOL, fans: FOLLOW_NOW !== null, imp: true, eng: true, text: true, legend: true, time: true, foot: true };
const VIS_NONE: Vis = { avatar: false, status: false, posts: false, handle: false, name: false, follow: false, fans: false, imp: false, eng: false, text: false, legend: false, time: false, foot: false };
const VIS_TOTAL = Object.values(VIS_ALL).filter((x) => x).length;
const VIS_GROUPS: { title: string; items: [keyof Vis, string][] }[] = [
  { title: tx("身份", "Identity"), items: [["avatar", tx("头像", "Avatar")], ["name", tx("账号名「" + NAME + "」", "Name “" + NAME + "”")], ["handle", tx("用户名 ", "Handle ") + HANDLE]] },
  { title: tx("核心指标", "Metrics"), items: [["follow", tx("关注变化", "Follower change")], ["fans", tx("粉丝数", "Followers")], ["imp", tx("曝光数", "Impressions")], ["eng", tx("互动数", "Engagement")], ["posts", tx("发帖/回复/引用条数", "Posts / replies / quotes")], ["status", tx("今日状态", "Today's status")]] },
  { title: tx("画面元素", "Elements"), items: [["text", tx("帖子文字", "Post text")], ["legend", tx("图例", "Legend")], ["time", tx("时间刻度与当前时间", "Time ticks and clock")], ["foot", tx("脚注", "Footnotes")]] },
].map((g) => ({ title: g.title, items: g.items.filter((it) => VIS_ALL[it[0] as keyof Vis]) as [keyof Vis, string][] }));

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
  const rows: { s: number; p: DataPost }[] = [];
  for (const p of DATA.posts) {
    const s = iso2s(p.t);
    if (Number.isFinite(s) && s >= 0 && s <= DAY) rows.push({ s, p });
  }
  rows.sort((a, b) => a.s - b.s);
  const eng = (p: DataPost): number => (p.likes ?? 0) + (p.reposts ?? 0) + (p.replies ?? 0);
  let maxEng = 1;
  let maxV = 1;
  for (const w of rows) {
    if (eng(w.p) > maxEng) maxEng = eng(w.p);
    if ((w.p.impressions ?? 0) > maxV) maxV = w.p.impressions ?? 0;
  }
  return rows.map((w, i): NodeT => {
    const p = w.p;
    const lane = (i * 5) % 7;
    return {
      idx: i,
      url: p.url !== null && SAFE_URL.test(p.url) ? p.url : null,
      ts: w.s,
      kind: KIND_OF[p.kind] ?? 0,
      self: p.selfThread === true,
      text: p.text.length > 140 ? p.text.slice(0, 139) + "…" : p.text,
      v: p.impressions,
      l: p.likes,
      r: p.reposts,
      c: p.replies,
      q: p.quotes,
      ang: (w.s / DAY) * Math.PI * 2 - Math.PI / 2,
      lr: 0.52 + 0.052 * lane + (((i * 37) % 11) / 11) * 0.02,
      bright: Math.log(1 + eng(p)) / Math.log(1 + maxEng),
      rip: p.impressions === null ? 0 : Math.log10(p.impressions + 1) / Math.log10(maxV + 1),
    };
  });
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

const NODES: NodeT[] = buildNodes();
const PARTS: PartT[] = buildParts();
const COUNT_BY_KIND: number[] = [0, 0, 0];
let SELF_N = 0;
let MISSING_N = 0;
let HAS_IMP = false;
let HAS_ENG = false;
for (const n of NODES) {
  COUNT_BY_KIND[n.kind] += 1;
  if (n.self) SELF_N += 1;
  if (n.v === null || n.l === null || n.r === null || n.c === null || n.q === null) MISSING_N += 1;
  if (n.v !== null) HAS_IMP = true;
  if (n.l !== null || n.r !== null || n.c !== null || n.q !== null) HAS_ENG = true;
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}
// Seconds into the window -> MM-DD HH:mm(:ss) in the account's time zone
function tzDT(off: number, withSec: boolean): string {
  const d = new Date((START_S + off + TZ_S) * 1000);
  const base = pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate()) + " " + pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes());
  return withSec ? base + ":" + pad2(d.getUTCSeconds()) : base;
}
function tzHM(off: number): string {
  const d = new Date((START_S + off + TZ_S) * 1000);
  return pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes());
}
function fmtIso(iso: string): string {
  const s = iso2s(iso);
  return Number.isFinite(s) ? tzDT(s, false) + " " + DATA.window.tz.label : iso;
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
const STYLE_NAMES = [tx("神经元", "Neuron"), tx("星系", "Galaxy"), tx("霓虹声波", "Neon wave")];
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
  for (let h = 0; h < 24; h++) {
    const a = (h / 24) * TAU2 - Math.PI / 2;
    const major = h % 3 === 0;
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
      x.fillText(tzHM(h * 3600), g.cx + Math.cos(a) * lr, g.cx + Math.sin(a) * lr);
    }
  }
}

// Static background layer cached on an offscreen canvas: stars, grid, orbits, ticks
const BG = new Map<string, HTMLCanvasElement>();
function bgLayer(style: number, S: number, showTime: boolean, font: string): HTMLCanvasElement | null {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const key = style + "|" + S + "|" + dpr + "|" + (showTime ? 1 : 0);
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
    for (let h = 0; h < 24; h++) {
      const a = (h / 24) * TAU2 - Math.PI / 2;
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

// Light-up: glow + layered impression ripples + shockwave and sparks for high-impression posts
function fxNodes(ctx: CanvasRenderingContext2D, S: number, cur: number, xs: number[], ys: number[], st: number, ripples: boolean): void {
  const g = geo(S);
  const sc = g.sc;
  const RW = 9000;
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < NODES.length; i++) {
    const n = NODES[i];
    const age = cur - n.ts;
    if (age < 0) continue;
    const col = kcol(st, n.kind);
    const flash = age < 1500 ? 1 - age / 1500 : 0;
    glowAt(ctx, col, xs[i], ys[i], (5 + 9 * n.bright + 16 * flash) * sc, 0.3 + 0.45 * n.bright + 0.5 * flash);
    if (st === 1) glowAt(ctx, col, xs[i], ys[i], (8 + 40 * n.rip) * sc, 0.07 + 0.16 * n.rip);
    if (ripples && age < RW) {
      const rmax = (5 + 34 * n.rip) * sc;
      for (let j = 0; j < 3; j++) {
        const a2 = age - j * 900;
        if (a2 <= 0) continue;
        const u = a2 / RW;
        if (u >= 1) continue;
        ctx.strokeStyle = rgba(col, Math.pow(1 - u, 1.6) * (0.6 - 0.15 * j) * (0.4 + 0.6 * n.bright));
        ctx.lineWidth = (1.6 - 0.35 * j) * sc;
        ctx.beginPath();
        ctx.arc(xs[i], ys[i], Math.max(1, rmax * (1 - Math.pow(1 - u, 2.2)) * (1 + 0.3 * j)), 0, TAU2);
        ctx.stroke();
      }
    }
    if (n.rip > 0.78 && age < 5200) {
      const u = age / 5200;
      ctx.strokeStyle = rgba(col, (1 - u) * 0.85);
      ctx.lineWidth = (3.2 * (1 - u) + 0.6) * sc;
      ctx.beginPath();
      ctx.arc(xs[i], ys[i], (4 + (60 + 40 * n.rip) * (1 - Math.pow(1 - u, 3))) * sc, 0, TAU2);
      ctx.stroke();
      for (let k = 0; k < 10; k++) {
        const a = frac(Math.sin((i * 7 + k) * 12.9898) * 43758.5453) * TAU2;
        const d = (8 + 46 * frac(Math.sin((i + k * 3) * 78.233) * 12345.6)) * sc * (1 - Math.pow(1 - u, 2));
        glowAt(ctx, [255, 245, 220], xs[i] + Math.cos(a) * d, ys[i] + Math.sin(a) * d, (2.6 * (1 - u) + 0.8) * sc, 1 - u);
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

// Galaxy / Neon: follow particles drawn into the centre
function fxFollow(ctx: CanvasRenderingContext2D, S: number, cur: number, st: number): number {
  const g = geo(S);
  const PW = 14400;
  let arriving = 0;
  ctx.globalCompositeOperation = "lighter";
  for (const p of PARTS) {
    const age = cur - p.ts;
    if (age < 0 || age >= PW) continue;
    const u = age / PW;
    const pt = (uu: number): [number, number] => {
      const e = uu * uu * (3 - 2 * uu);
      const rr = g.rim * 0.97 + (g.rim * 0.46 - g.rim * 0.97) * e;
      const aa = p.a + (p.s - 0.5) * 0.6 * e;
      return [g.cx + Math.cos(aa) * rr, g.cx + Math.sin(aa) * rr];
    };
    const al = 1 - Math.pow(u, 3);
    if (u > 0.85) arriving += 1;
    const h = pt(u);
    if (st === 1) {
      let prev = h;
      for (let k = 1; k <= 6; k++) {
        const q = pt(Math.max(0, u - k * 0.02));
        ctx.strokeStyle = rgba(PART_RGB, al * (0.7 - k * 0.1));
        ctx.lineWidth = (2.6 - k * 0.35) * g.sc;
        ctx.beginPath();
        ctx.moveTo(prev[0], prev[1]);
        ctx.lineTo(q[0], q[1]);
        ctx.stroke();
        prev = q;
      }
      glowAt(ctx, PART_RGB, h[0], h[1], 7 * g.sc, al * 0.9);
    } else {
      for (let k = 0; k < 4; k++) {
        const q = pt(Math.max(0, u - k * 0.025));
        const s = (3.4 - k * 0.6) * g.sc;
        ctx.fillStyle = rgba(k === 0 ? [255, 255, 255] : PART_RGB, al * (0.9 - k * 0.2));
        ctx.fillRect(q[0] - s / 2, q[1] - s / 2, s, s);
      }
      glowAt(ctx, PART_RGB, h[0], h[1], 6 * g.sc, al * 0.6);
    }
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
const FOL0 = FOLLOW_DELTA - PARTS.length; // follows that happened before the window start (prorated from the snapshot interval)
const ROLL = { imp: 0, eng: 0, fol: FOL0, t: 0 };
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
function statusAura(ctx: CanvasRenderingContext2D, ax: number, ay: number, ra: number, tier: number, now: number, sc: number): void {
  const tc = TIERS[tier].rgb;
  const br = 0.5 + 0.5 * Math.sin(now / 900);
  ctx.globalCompositeOperation = "lighter";
  if (tier === 0) {
    glowAt(ctx, [255, 140, 40], ax, ay, ra * (1.9 + 0.2 * br), 0.4);
    for (let i = 0; i < 16; i++) {
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

// Dial centre board; the avatar ring pulses when a follow particle arrives, and the whole ring flashes at the end of a turn
function drawCenter(ctx: CanvasRenderingContext2D, cx: number, zr: number, S: number, now: number, font: string, opts: DrawOpts, N: number, arriving: number, cur: number): void {
  const st = opts.style;
  const v = opts.vis;
  const sc = Math.max(0.55, S / 640);
  const pulse = Math.min(1, arriving * 0.22);
  const fin = opts.fin >= 0 && opts.fin <= 1 ? opts.fin : -1;
  const boost = pulse * 0.7 + (fin >= 0 ? Math.sin(Math.PI * fin) : 0);
  const tc = TIERS[opts.tier].rgb;
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
  const items: { l: string; v: string; c: number[] }[] = [];
  const na = tx("缺失", "n/a");
  if (v.follow) items.push({ l: tx("关注变化", "Followers Δ"), v: (fol > 0 ? "+" : "") + fol, c: PART_RGB });
  if (v.fans && FOLLOW_NOW !== null) items.push({ l: tx("粉丝", "Followers"), v: fmtN(FOLLOW_NOW - FOLLOW_DELTA + fol), c: [226, 236, 250] });
  if (v.imp) items.push({ l: tx("曝光", "Impressions"), v: HAS_IMP ? fmtN(ROLL.imp) : na, c: [255, 206, 130] });
  if (v.eng) items.push({ l: tx("互动", "Engagement"), v: HAS_ENG ? fmtN(ROLL.eng) : na, c: [255, 150, 180] });
  if (v.posts) items.push({ l: tx("发帖/回复/引用", "Posts/replies/quotes"), v: b.n[0] + "/" + b.n[1] + "/" + b.n[2], c: [190, 205, 228] });
  const hasM = items.length > 0;
  const nr = items.length > 3 ? 2 : items.length > 1 ? 1 : 0;
  const mainY = [0.52, 0.44, 0.38][nr];
  const r1Y = nr === 1 ? 0.7 : 0.62;
  const chord = (f: number): number => Math.max(24, 2 * Math.sqrt(Math.max(0.02, 1 - Math.pow(Math.abs(f) + 0.08, 2))) * zr * 0.9);
  if (hasM) {
    // Lower-half gradient mask
    const top = cx + zr * (mainY - 0.24);
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
  const ay = cx + zr * (hasM ? -0.34 : -0.06);
  const ra = zr * (hasM ? 0.3 : 0.42) * (v.avatar ? 1 : 0.55);
  if (v.avatar || v.status) {
    if (v.status) {
      statusAura(ctx, cx, ay, ra, opts.tier, now, sc);
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
    const ny = v.avatar || v.status ? ay + ra + Math.max(zr * 0.12, 8 * sc) : cx + zr * (hasM ? -0.34 : 0);
    const fs = Math.max(8, zr * 0.125);
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
  // Today's status label
  if (v.status) {
    bigText(ctx, TIERS[opts.tier].name, cx, cx - zr * 0.84, Math.max(8.5, zr * 0.14), tc, st, now, font);
  }
  // Core metrics: main metric large, secondary metrics as two small lines
  if (hasM) {
    const m = items[0];
    const msz = Math.max(11, zr * 0.27);
    const lsz = Math.max(8, msz * 0.42);
    ctx.font = lsz + "px " + font;
    const wl = ctx.measureText(m.l).width;
    ctx.font = "600 " + msz + "px " + font;
    const wv = ctx.measureText(m.v).width;
    const gap = 5 * sc;
    const tot = wl + gap + wv;
    const s = Math.min(1, chord(mainY) / tot);
    ctx.save();
    ctx.translate(cx, cx + zr * mainY);
    ctx.scale(s, s);
    ctx.font = lsz + "px " + font;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#8fa6c4";
    ctx.fillText(m.l, -tot / 2, 0);
    bigText(ctx, m.v, -tot / 2 + wl + gap + wv / 2, 0, msz, m.c, st, now, font);
    ctx.restore();
    const rows = [r1Y, 0.8];
    for (let r = 0; r < 2; r++) {
      const a = items[1 + r * 2];
      const c2 = items[2 + r * 2];
      if (!a) continue;
      const ps: { t: string; c: string }[] = [
        { t: a.l + " ", c: "#8fa6c4" },
        { t: a.v, c: rgba(a.c, 1) },
      ];
      if (c2) {
        ps.push({ t: "   " + c2.l + " ", c: "#8fa6c4" });
        ps.push({ t: c2.v, c: rgba(c2.c, 1) });
      }
      pieceRow(ctx, ps, cx, cx + zr * rows[r], chord(rows[r]), Math.max(8, zr * 0.125), font, "");
    }
  }
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
      act.push({ a: n.ang, amp: (3 + 30 * n.rip) * sc * (1 - u) * Math.cos(u * 9), w: 0.06 + 0.06 * n.rip });
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
      const u = age / 9000;
      const w = 0.1 + 0.5 * n.rip;
      ctx.strokeStyle = rgba(kcol(2, n.kind), (1 - u) * (0.3 + 0.4 * n.rip));
      ctx.lineWidth = 1.4 * sc;
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

  fxNodes(ctx, S, cur, xs, ys, st, st === 1);
  const arriving = opts.showFollow ? fxFollow(ctx, S, cur, st) : 0;
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
  for (let h = 0; h < 24; h++) {
    const a = (h / 24) * TAU - Math.PI / 2;
    const major = h % 3 === 0;
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
      ctx.fillText(tzHM(h * 3600), cx + Math.cos(a) * lr, cx + Math.sin(a) * lr);
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
  const RW = 9000;
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
    const rmax = (5 + 30 * n.rip) * sc;
    ctx.fillStyle = rgba(col, 0.04 + 0.08 * n.rip);
    ctx.beginPath();
    ctx.arc(xs[i], ys[i], rmax * 0.42, 0, TAU);
    ctx.fill();
    if (age < RW) {
      const u = age / RW;
      const e = 1 - Math.pow(1 - u, 2.2);
      ctx.strokeStyle = rgba(col, Math.pow(1 - u, 1.5) * (0.35 + 0.55 * n.bright));
      ctx.lineWidth = 1.3 * sc;
      ctx.beginPath();
      ctx.arc(xs[i], ys[i], Math.max(1, rmax * e), 0, TAU);
      ctx.stroke();
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
  fxNodes(ctx, S, cur, xs, ys, 0, true);

  // Follow particles: only inside snapshot intervals with a real delta; triggered by the hand, drawn into the centre
  const PW = 14400;
  let arriving = 0;
  const partList: PartT[] = opts.showFollow ? PARTS : [];
  for (const p of partList) {
    const age = cur - p.ts;
    if (age < 0 || age >= PW) continue;
    const u = age / PW;
    const e = u * u * (3 - 2 * u);
    const rr = rim * 0.97 + (rim * 0.46 - rim * 0.97) * e;
    const aa = p.a + (p.s - 0.5) * 0.6 * e;
    const x = cx + Math.cos(aa) * rr;
    const y = cx + Math.sin(aa) * rr;
    const al = 1 - Math.pow(u, 3);
    if (u > 0.85) arriving += 1;
    ctx.fillStyle = rgba(PART_RGB, 0.9 * al);
    ctx.shadowColor = rgba(PART_RGB, 1);
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(x, y, 2 * sc, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = rgba(PART_RGB, 0.25 * al);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(cx + Math.cos(aa) * (rr + 9 * sc), cx + Math.sin(aa) * (rr + 9 * sc));
    ctx.stroke();
  }

  // Centre
  drawCenter(ctx, cx, rim * 0.45, S, now, font, opts, N, arriving, cur);
  fxFinale(ctx, S, opts.fin, 0, xs, ys);
  if (opts.showTime) handLabel(ctx, S, ah, cur, font, SWEEP_RGB[0]);
}

function Replay() {
  const theme = useGrokTheme();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [avail, setAvail] = useState<number>(360);
  const [aspect, setAspect] = useState<number>(0);
  const [panel, setPanel] = useState<boolean>(false);
  const [prog, setProg] = useState<number>(0);
  const [playing, setPlaying] = useState<boolean>(true);
  const [speed, setSpeed] = useState<number>(1);
  const [tip, setTip] = useState<{ idx: number; pinned: boolean; left: number } | null>(null);
  const [vis, setVis] = useState<Vis>(VIS_ALL);
  const [style, setStyle] = useState<number>(0);
  const tipElRef = useRef<HTMLDivElement>(null);
  const [tipDy, setTipDy] = useState<number>(0);
  const actRef = useRef<{ toggle: () => void; step: (d: number) => void }>({ toggle: () => {}, step: () => {} });
  // Aspect ratios: 1:1 / 9:16 / 16:9 fixed frames; the dial size is the frame minus legend and status line
  const fw = Math.max(280, Math.min(avail, aspect === 0 ? 800 : aspect === 1 ? 460 : 1040));
  const fh0 = aspect === 0 ? fw : aspect === 1 ? Math.round((fw * 16) / 9) : Math.round((fw * 9) / 16);
  const lh = vis.legend ? (fw < 560 ? 64 : 46) : 0;
  const sh = vis.status ? 26 : 0;
  const size = Math.floor(Math.max(220, Math.min(fw - 24, fh0 - 24 - lh - sh)));
  const fh = Math.max(fh0, size + 24 + lh + sh);

  const progRef = useRef<number>(0);
  const playRef = useRef<boolean>(true);
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
  const optsRef = useRef<DrawOpts>({ tier: TIER, showFollow: true, showTime: true, style: 0, fin: -1, vis: VIS_ALL });
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
      const cv = canvasRef.current;
      const o = optsRef.current;
      o.fin = endAtRef.current > 0 ? (now - endAtRef.current) / 2400 : -1;
      if (cv) (o.style === 0 ? draw : drawStyled)(cv, sizeRef.current, progRef.current * DAY, now, tipRef.current, fontRef.current, o);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

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
  actRef.current = { toggle: togglePlay, step };

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
          {vis.time ? tzDT(tn.ts, true) + " " + DATA.window.tz.label + " · " : ""}
          {KIND_NAME[tn.kind]}
          {tn.self ? tx(" · 续写自己", " · self-thread") : ""}
        </div>
        {vis.text ? <div style={{ fontSize: 13, lineHeight: "19px", marginBottom: 6, wordBreak: "break-all" }}>{tn.text}</div> : null}
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
  const ratioOk = STATUS !== null && STATUS.ratio !== null && Number.isFinite(STATUS.ratio);
  const statusNote =
    STATUS === null
      ? ""
      : [
          tx("今日状态：", "Today's status: ") + STATUS.note,
          ratioOk ? tx("今日倍数 ", "Multiple ") + (STATUS.ratio as number).toFixed(2) + "×（" + TIER_RULE + "）" + tx("。", ".") : "",
          tx("当前为「" + TIERS[TIER].name + "」。", "Currently “" + TIERS[TIER].name + "”."),
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

  return (
    <div style={{ background: theme.bg.base, color: theme.text.primary, padding: "24px 16px 36px", fontFamily: theme.font.family }}>
      <div style={{ maxWidth: 1040, margin: "0 auto" }}>
        <div style={{ ...theme.font.heading2, color: theme.text.primary, fontWeight: theme.weight.semibold }}>{tx("X 脉搏 · 24 小时回放", "X Pulse · 24-hour replay")}</div>
        <div style={{ ...theme.font.subtext, color: theme.text.secondary, marginTop: 6, marginBottom: 18, lineHeight: "20px" }}>
          {[DATA.example ? tx("示例数据", "EXAMPLE DATA") : "", vis.name ? NAME : "", vis.handle ? HANDLE : "", DATA.window.tz.label, vis.time ? tzDT(0, false) + " → " + tzDT(DAY, false) : "", tx("起点 " + tzHM(0) + " 在顶部，指针转一圈 = 24 小时", "Start (" + tzHM(0) + ") at the top, one hand turn = 24 hours")]
            .filter((s) => s !== "")
            .join(" · ")}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 18px", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ ...theme.font.label, color: theme.text.tertiary }}>{tx("风格", "Style")}</span>
              {seg(STYLE_NAMES, style, (i) => {
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
            <button onClick={() => setPanel(!panel)} style={tbtn(panel)}>
              {tx("显示设置 · ", "Display · ") + nOn + "/" + VIS_TOTAL + (panel ? " ▴" : " ▾")}
            </button>
          </div>

        {!panel ? null : (
          <div data-kp="1" style={{ marginBottom: 12, border: "1px solid " + theme.border.subtle, borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
              <span style={{ ...theme.font.subtext, color: theme.text.secondary }}>{tx("每项独立开关，舞台画面完全按这里的勾选；录屏只录中间舞台", "Each item is an independent switch; the stage follows these checks. Record only the stage.")}</span>
              <span style={{ display: "inline-flex", gap: 8 }}>
                <button style={tbtn(false)} onClick={() => setVis(VIS_ALL)}>
                  {tx("全开", "All on")}
                </button>
                <button style={tbtn(false)} onClick={() => setVis(VIS_NONE)}>
                  {tx("仅画面", "Visuals only")}
                </button>
              </span>
            </div>
            {VIS_GROUPS.map((g) => (
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
                {legendItem(kcol(style, 0), KIND_NAME[0], COUNT_BY_KIND[0])}
                {legendItem(kcol(style, 1), KIND_NAME[1], COUNT_BY_KIND[1])}
                {legendItem(kcol(style, 2), KIND_NAME[2], COUNT_BY_KIND[2])}
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
                aria-label={tx("24 小时发帖回放表盘 · " + STYLE_NAMES[style] + "风格", "24-hour posting replay dial · " + STYLE_NAMES[style] + " style")}
                style={{ width: size, height: size, display: "block", touchAction: "manipulation", cursor: "pointer" }}
                onPointerMove={onMove}
                onPointerLeave={onLeave}
                onPointerUp={onUp}
              />
              {tipEl}
            </div>

          {vis.status ? (
            <div style={{ textAlign: "center", fontSize: 13, lineHeight: "22px", height: 22, color: "#9fb2cc" }}>
              <span style={{ color: rgba(TIERS[TIER].rgb, 1), fontWeight: 600 }}>{tx("今日状态 · ", "Today · ")}{TIERS[TIER].name}</span>
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
                {vis.time ? tzDT(cur, false) + " " + DATA.window.tz.label + " · " : ""}{tx("已亮 ", "Lit ")}{fired}/{NODES.length}
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
          <div style={{ fontSize: 12, color: "#6f829c", marginTop: 8 }}>{tx("快捷键：空格 播放/暂停 · ← → 微调进度 10 分钟（Shift 1 小时）", "Shortcuts: Space play/pause · ← → step 10 minutes (Shift: 1 hour)")}</div>
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
            {fn.extra.map((x, i) => (
              <div key={i} style={{ marginBottom: 6 }}>
                {x}
              </div>
            ))}
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
