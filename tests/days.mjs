// Multi-day / time-zone tests: IANA day boundaries (DST 23 h / 25 h days, +05:30, +05:45, +14, -12, 30-minute DST, skipped local midnight),
// local-day bucketing, ticks, date chips, legacy v2 data, 7 days x 300 posts size + frame rate. Screenshots go to out/days/.
import fs from "fs";
import path from "path";
import esbuild from "esbuild";
import puppeteer from "puppeteer-core";

const SRC = process.argv[2] || "../renderer/x-pulse-replay.tsx";
const base = fs.readFileSync(SRC, "utf8");
const A = "// ===== BEGIN DATA =====", B = "// ===== END DATA =====";
const ai = base.indexOf(A), bi = base.indexOf(B);
const av = JSON.parse(fs.readFileSync("sample-avatar.json", "utf8"));
const HOOK = "\n;(window as unknown as { __ME: unknown }).__ME = { get DAYS() { return DAYS; }, get TICKS() { return TICKS; }, get NODES() { return NODES; }, get DAY() { return DAY; }, get START_S() { return START_S; }, get BAD() { return BAD_DATA; }, get LIVE() { return LIVE; }, get LIVE_T() { return LIVE_T; }, lparts };\n";
fs.mkdirSync("out/days", { recursive: true });
fs.mkdirSync("src", { recursive: true });
let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log("FAIL:", msg); } else console.log("ok:", msg); };
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
let n = 0;
async function load(data, vp = { width: 1100, height: 1500 }) {
  const id = "d" + n++;
  fs.writeFileSync("src/replay." + id + ".tsx", base.slice(0, ai + A.length) + "\nconst DATA: Data = " + JSON.stringify(data) + ";\n" + base.slice(bi) + HOOK);
  fs.writeFileSync("src/h." + id + ".tsx", fs.readFileSync("harness.tsx", "utf8").replace('"./replay"', '"./replay.' + id + '"'));
  await esbuild.build({ entryPoints: ["src/h." + id + ".tsx"], bundle: true, outfile: "out/b." + id + ".js", alias: { "grok/canvas": path.resolve("stub/grok-canvas.tsx") }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "error", jsx: "automatic", target: "es2020" });
  fs.writeFileSync("out/i." + id + ".html", '<!doctype html><html><body style="margin:0;background:#0b0f19"><div id="root"></div><script src="b.' + id + '.js"></script></body></html>');
  const page = await browser.newPage();
  await page.setViewport(vp);
  await page.evaluateOnNewDocument(() => { try { if (!sessionStorage.getItem("__k")) { localStorage.clear(); sessionStorage.setItem("__k", "1"); } } catch (e) { /* ignore */ } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) errs.push(m.text()); });
  await page.goto("file://" + path.resolve("out/i." + id + ".html"));
  await new Promise((r) => setTimeout(r, 600));
  page.errs = errs;
  return page;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const body = (p) => p.evaluate(() => document.body.innerText);
const baseData = (o = {}) => ({
  lang: "en", example: false, account: { name: "Test Name", username: "test_user" }, avatar: av, tz: { iana: "Asia/Shanghai" },
  days: [{ date: "2026-11-01", posts: [], followers: { current: 5000, delta: 10, baselineAt: null, firstRun: false }, status: { tier: 1, ratio: 1.2, note: { en: "n", zh: "n" } } }],
  footnotes: { metricsFetchedAt: "2026-11-02T09:00:00+08:00", retweetsExcluded: 0, extra: [] }, ...o,
});
const Z = (iso) => Date.parse(iso) / 1000;

// 1. Day boundaries per zone: [iana, date, expected start (UTC ISO), expected length seconds]
const cases = [
  ["Asia/Shanghai", "2026-11-02", "2026-11-01T16:00:00Z", 86400],
  ["America/New_York", "2026-03-08", "2026-03-08T05:00:00Z", 82800],   // spring forward: 23 h
  ["America/New_York", "2026-11-01", "2026-11-01T04:00:00Z", 90000],   // fall back: 25 h
  ["America/New_York", "2026-11-02", "2026-11-02T05:00:00Z", 86400],
  ["Europe/London", "2026-03-29", "2026-03-29T00:00:00Z", 82800],
  ["Europe/Berlin", "2026-10-25", "2026-10-24T22:00:00Z", 90000],
  ["Asia/Kolkata", "2026-11-02", "2026-11-01T18:30:00Z", 86400],       // +05:30
  ["Asia/Kathmandu", "2026-11-02", "2026-11-01T18:15:00Z", 86400],     // +05:45
  ["Pacific/Kiritimati", "2026-11-02", "2026-11-01T10:00:00Z", 86400], // +14
  ["Etc/GMT+12", "2026-11-02", "2026-11-02T12:00:00Z", 86400],         // -12
  ["Australia/Lord_Howe", "2026-04-05", "2026-04-04T13:00:00Z", 88200], // 30-minute DST change: 24.5 h
  ["Australia/Lord_Howe", "2026-10-04", "2026-10-03T13:30:00Z", 84600], // 23.5 h
  ["Pacific/Auckland", "2026-09-27", "2026-09-26T12:00:00Z", 82800],
  ["America/Sao_Paulo", "2018-11-04", "2018-11-04T03:00:00Z", 82800],  // local midnight skipped: the day starts at 01:00 local
  ["UTC", "2026-11-02", "2026-11-02T00:00:00Z", 86400],
];
for (const [iana, date, start, len] of cases) {
  const p = await load(baseData({ tz: { iana }, days: [{ ...baseData().days[0], date }] }));
  const r = await p.evaluate(() => ({ d: window.__ME.DAYS.map((d) => [d.startS, d.len]), ticks: window.__ME.TICKS.length, major: window.__ME.TICKS.filter((t) => t.major).map((t) => t.label), bad: window.__ME.BAD }));
  const ok = r.bad === null && r.d[0][0] === Z(start) && r.d[0][1] === len;
  check(ok, `${iana} ${date}: start ${start} len ${len}s -> ` + JSON.stringify(r.d[0]) + " ticks " + r.ticks + " majors " + r.major.join(","));
  if (iana === "America/New_York" || iana === "Asia/Kathmandu" || iana === "Australia/Lord_Howe") fs.writeFileSync(`out/days/ticks_${iana.replace("/", "_")}_${date}.json`, JSON.stringify(r));
  check(p.errs.length === 0, iana + " no page errors " + p.errs.join("|"));
  await p.close();
}
// Tick counts: one per real local hour
{
  const get = async (iana, date) => { const p = await load(baseData({ tz: { iana }, days: [{ ...baseData().days[0], date }] })); const r = await p.evaluate(() => window.__ME.TICKS.map((t) => t.label)); await p.close(); return r; };
  const ny23 = await get("America/New_York", "2026-03-08"), ny25 = await get("America/New_York", "2026-11-01"), kt = await get("Asia/Kathmandu", "2026-11-02");
  check(ny23.length === 23 && !ny23.includes("02:00") && ny23.includes("03:00"), "NY spring day: 23 ticks, 02:00 skipped: " + ny23.join(" "));
  check(ny25.length === 25 && ny25.filter((l) => l === "01:00").length === 2, "NY fall day: 25 ticks, 01:00 twice");
  check(kt.length === 24 && kt[0] === "00:00" && kt[23] === "23:00", "Kathmandu: 24 hourly ticks local 00:00..23:00");
}

// 2. Local-day bucketing: instants around local midnight and the repeated hour
{
  const nyStart = Z("2026-11-01T04:00:00Z"); // 00:00 EDT
  const posts = [
    [nyStart - 1, 0, 1, 1, 0, 0, 0, null, "before"],             // 23:59:59 on 10-31, outside
    [nyStart, 0, 1, 1, 0, 0, 0, null, "first second"],           // 00:00:00
    [Z("2026-11-01T05:30:00Z"), 0, 1, 1, 0, 0, 0, null, "01:30 EDT"],
    [Z("2026-11-01T06:30:00Z"), 1, 1, 1, 0, 0, 0, null, "01:30 EST"], // the repeated hour
    [Z("2026-11-02T04:59:59Z"), 2, 1, 1, 0, 0, 0, null, "23:59:59 EST"],
    [Z("2026-11-02T05:00:01Z"), 0, 1, 1, 0, 0, 0, null, "next day"], // outside
    ["garbage", 0, 1, 1, 0, 0, 0, null, "bad t"],
  ];
  const p = await load(baseData({ tz: { iana: "America/New_York" }, days: [{ ...baseData().days[0], date: "2026-11-01", posts }] }));
  const r = await p.evaluate(() => ({ n: window.__ME.NODES.map((x) => [x.ts, x.text]), len: window.__ME.DAY }));
  check(r.n.length === 4 && r.n[0][0] === 0 && r.n[3][0] === 90000 - 1 && r.n[1][0] === 5400 && r.n[2][0] === 9000, "bucketing 25 h NY day: " + JSON.stringify(r.n));
  const t = await body(p);
  check(t.includes("25-hour day"), "25-hour day note shown");
  await p.close();
}

// 3. Multi-day: chips, selection, switching, legacy data, bad data
const ids = (i) => "17" + String(1000000000000000 + i * 7919).slice(0, 17);
const mkDay = (date, startS, count, seedBase) => {
  let seed = seedBase;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const posts = [];
  for (let i = 0; i < count; i++) {
    const k = i % 3 === 0 ? 0 : i % 7 === 0 ? 2 : 1;
    posts.push([startS + Math.floor(rnd() * 86399), k + (i % 11 === 0 && k === 1 ? 4 : 0), i % 13 === 0 ? null : Math.floor(rnd() * rnd() * 30000), Math.floor(rnd() * 60), Math.floor(rnd() * 9), Math.floor(rnd() * 9), Math.floor(rnd() * 3), ids(i + seedBase), "Snippet text " + String(i).padStart(3, "0") + " ab"]);
  }
  return { date, posts, followers: { current: 12000 + seedBase, delta: seedBase % 40, baselineAt: null, firstRun: false }, status: { tier: seedBase % 5, ratio: 1.1, note: { en: "vs 7-day median", zh: "对比 7 日中位数" } } };
};
const week = (count) => {
  const days = [];
  for (let k = 0; k < 7; k++) { const d = new Date(Date.UTC(2026, 9, 26 + k)); const ds = d.toISOString().slice(0, 10); days.push(mkDay(ds, Date.UTC(2026, 9, 26 + k) / 1000 - 8 * 3600, count, 100 + k * 17)); }
  return days;
};
{
  const data = baseData({ days: week(300), footnotes: { metricsFetchedAt: "2026-11-02T20:00:00+08:00", retweetsExcluded: 3, extra: [] } });
  const bytes = JSON.stringify(data).length, bytesDays = JSON.stringify(data.days).length;
  const noSnip = JSON.stringify({ ...data, days: data.days.map((d) => ({ ...d, posts: d.posts.map((q) => q.slice(0, 8).concat([null])) })) }).length;
  console.log(`size: DATA ${bytes} bytes for 7 days x 300 posts (days only ${bytesDays}); without snippets ${noSnip}`);
  const rel = (keepId, keepSnip) => JSON.stringify({ ...data, days: data.days.map((d, k) => ({ ...d, posts: d.posts.map((q) => [q[0] - Date.UTC(2026, 9, 26 + k) / 1000 + 8 * 3600, q[1], q[2], q[3], q[4], q[5], q[6], keepId ? q[7] : null, keepSnip ? q[8] : null]) })) }).length;
  const sizes = { full_unix_t: bytes, noSnippet: noSnip, relT_id_snippet: rel(true, true), relT_id: rel(true, false), relT_snippet: rel(false, true), relT_only: rel(false, false) };
  console.log("sizes (DATA bytes, 7 days x 300 posts):", JSON.stringify(sizes));
  fs.writeFileSync("out/days/size.json", JSON.stringify({ bytes, bytesDays, noSnip, sizes, rendererBytes: fs.statSync(SRC).size }));
  {
    const d2 = baseData({ days: data.days.map((d, k) => ({ ...d, posts: d.posts.map((q) => [q[0] - Date.UTC(2026, 9, 26 + k) / 1000 + 8 * 3600, ...q.slice(1)]) })) });
    const pa = await load(data), pb = await load(d2);
    const ja = await pa.evaluate(() => window.__ME.NODES.map((x) => x.ts + ":" + x.text).join()), jb = await pb.evaluate(() => window.__ME.NODES.map((x) => x.ts + ":" + x.text).join());
    check(ja === jb && ja.length > 1000, "relative t (seconds since local day start) gives identical nodes to unix t");
    await pa.close(); await pb.close();
  }
  for (const [aname, vp] of [["1x1", { width: 1100, height: 1500 }], ["9x16", { width: 700, height: 1700 }], ["mobile", { width: 390, height: 1800 }]]) {
    const p = await load(data, vp);
    const t0 = await body(p);
    const chips = await p.evaluate(() => [...document.querySelectorAll("[data-day]")].map((b) => [b.getAttribute("data-day"), b.textContent, b.getAttribute("aria-pressed")]));
    check(chips.length === 7 && chips[6][2] === "true" && chips[6][1].startsWith("Yesterday") && chips[0][2] === "false", aname + " chips: " + JSON.stringify(chips.map((c) => c[1])));
    check(t0.includes("Daily replay") && !t0.includes("NaN") && !t0.includes("undefined"), aname + " title multi-day");
    const lay = await p.evaluate(() => ({ h: document.scrollingElement.scrollWidth > window.innerWidth + 1, over: [...document.querySelectorAll("[data-day]")].some((b) => b.scrollWidth > b.clientWidth + 1) }));
    check(!lay.h && !lay.over, aname + " chips fit, no horizontal scroll");
    // switch day: restarts playback, labels follow
    await p.evaluate(() => document.querySelector('[data-day="2026-10-28"]').click());
    await wait(500);
    const t1 = await body(p);
    const sel = await p.evaluate(() => document.querySelector('[data-day="2026-10-28"]').getAttribute("aria-pressed"));
    const lit = (t1.match(/Lit (\d+)\/(\d+)/) || []);
    check(sel === "true" && t1.includes("10-28") && lit.length === 3 && +lit[2] === 300 && +lit[1] < 150, aname + " switched to 10-28, playback restarted: " + lit[0]);
    const nodes = await p.evaluate(() => window.__ME.NODES.length);
    check(nodes === 300, "nodes after switch " + nodes);
    await p.screenshot({ path: `out/days/week_${aname}.png`, fullPage: true });
    // switch through every day twice with music running on one pass
    for (const d of ["2026-10-26", "2026-10-27", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]) { await p.evaluate((d) => document.querySelector('[data-day="' + d + '"]').click(), d); await wait(120); }
    const fps = await p.evaluate(() => new Promise((res) => { let k = 0; const t0 = performance.now(); const f = () => { k++; if (performance.now() - t0 > 1500) res(k / 1.5); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
    check(fps > 25, aname + " fps with 300 posts on last day: " + Math.round(fps));
    check(p.errs.length === 0, aname + " no errors " + p.errs.join("|"));
    await p.close();
  }
  // fps on a day with 600 posts
  const big = baseData({ days: [mkDay("2026-11-01", Z("2026-10-31T16:00:00Z"), 600, 5)] });
  const p = await load(big);
  const fps = await p.evaluate(() => new Promise((res) => { let k = 0; const t0 = performance.now(); const f = () => { k++; if (performance.now() - t0 > 1500) res(k / 1.5); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
  check(fps > 25, "fps with 600 posts: " + Math.round(fps));
  await p.close();
}
{
  // single day = yesterday -> Yesterday title; single non-yesterday -> dated title; no chips; zh
  let p = await load(baseData({ days: [mkDay("2026-11-01", Z("2026-10-31T16:00:00Z"), 20, 3)] }));
  let t = await body(p);
  check(t.includes("Yesterday's replay") && (await p.evaluate(() => document.querySelectorAll("[data-day]").length)) === 0, "single yesterday title, no chips");
  await p.keyboard.press("l"); await wait(300); t = await body(p);
  check(t.includes("昨日回放"), "zh title 昨日回放");
  await p.close();
  p = await load(baseData({ days: [mkDay("2026-10-30", Z("2026-10-29T16:00:00Z"), 20, 3)] }));
  t = await body(p);
  check(t.includes("Replay of 2026-10-30") && !t.includes("Yesterday"), "single older day dated title");
  await p.close();
  // legacy v2 DATA still renders
  const legacy = { lang: "en", example: false, account: { name: "L", username: "l" }, avatar: null, window: { startISO: "2026-11-01T16:26:00+08:00", endISO: "2026-11-02T16:26:00+08:00", tz: { label: "Beijing time (UTC+8)", offsetMinutes: 480 } },
    posts: [{ t: "2026-11-02T08:00:00+08:00", kind: "post", selfThread: false, text: "legacy text that is rather long and goes past forty characters for sure", impressions: 100, likes: 1, reposts: 0, replies: 0, quotes: 0, url: "https://x.com/i/status/1" }],
    followers: { current: 10, delta: null, baselineAt: null, firstRun: true }, status: null, footnotes: { metricsFetchedAt: null, retweetsExcluded: null, extra: [] } };
  p = await load(legacy);
  t = await body(p);
  check(t.includes("Beijing time (UTC+8)") && p.errs.length === 0 && !t.includes("NaN"), "legacy v2 data renders as one day " + p.errs.join("|"));
  await p.close();
  // bad data messages
  p = await load(baseData({ tz: { iana: "Mars/Olympus" } }));
  check((await body(p)).includes("not a known time zone"), "unknown IANA zone -> message");
  await p.close();
  p = await load(baseData({ tz: undefined }));
  check((await body(p)).includes("DATA.tz.iana is missing"), "missing tz -> message");
  await p.close();
  p = await load(baseData({ days: [{ date: "2026-13-45", posts: [] }] }));
  check((await body(p)).includes("DATA.days"), "bad date -> message");
  await p.close();
  // posts without text / snippet tolerated; emoji & CJK cut by grapheme
  const posts = [[Z("2026-10-31T17:00:00Z"), 0, 10, 1, 0, 0, 0, "123", null], [Z("2026-10-31T18:00:00Z"), 0, 10, 1, 0, 0, 0, "124", "👨‍👩‍👧‍👦".repeat(60)], [Z("2026-10-31T19:00:00Z"), 0, 10, 1, 0, 0, 0, null, "中文".repeat(40)]];
  p = await load(baseData({ days: [{ ...baseData().days[0], posts }] }));
  const sn = await p.evaluate(() => window.__ME.NODES.map((x) => x.text));
  check(sn[0] === "" && sn[1].endsWith("…") && Array.from(sn[1]).length < 40 * 7 + 2 && sn[1].split("👨‍👩‍👧‍👦").length - 1 === 39 && sn[2] === "中文".repeat(19) + "中…", "snippet cut by grapheme: " + sn.map((x) => x.length).join(","));
  const noText = await p.evaluate(() => [...document.querySelectorAll("label")].map((l) => l.textContent));
  await p.close();
}
await browser.close();
console.log(fails ? "DAYS TESTS FAILED: " + fails : "DAYS TESTS OK");
if (fails) process.exit(1);
