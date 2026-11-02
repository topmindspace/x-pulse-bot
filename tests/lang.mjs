// Language switch tests: DATA.lang seeding, EN / 中文 toggle (button + L key), persistence rules, note/extra handling,
// no leftover other-language UI strings (DOM text and canvas text), no overflow of toolbar / stage at 1:1, 9:16, 16:9. Screenshots go to out/lang/.
import fs from "fs";
import path from "path";
import esbuild from "esbuild";
import puppeteer from "puppeteer-core";

const SRC = process.argv[2] || "../renderer/x-pulse-replay.tsx";
const base = fs.readFileSync(SRC, "utf8");
const A = "// ===== BEGIN DATA =====", B = "// ===== END DATA =====";
const ai = base.indexOf(A), bi = base.indexOf(B);
if (ai < 0 || bi < 0) throw new Error("markers missing");
const av = JSON.parse(fs.readFileSync("sample-avatar.json", "utf8"));
const START = "2026-11-01T16:26:00+08:00", END = "2026-11-02T16:26:00+08:00";
const tz = { label: "Beijing time (UTC+8)", offsetMinutes: 480 };
const iso = (m) => new Date(Date.UTC(2026, 10, 1, 8, 26) + m * 60000).toISOString();
let seed = 11;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const posts = Array.from({ length: 60 }, (_, i) => ({
  t: iso(Math.floor(rnd() * 1440)), kind: ["post", "reply", "quote"][i % 3], selfThread: i % 7 === 0 && i % 3 === 1,
  text: "Post #" + i, impressions: i % 9 === 0 ? null : Math.floor(rnd() * 20000), likes: Math.floor(rnd() * 90), reposts: Math.floor(rnd() * 12), replies: Math.floor(rnd() * 9), quotes: Math.floor(rnd() * 3),
  url: "https://x.com/i/status/" + (1000 + i),
}));
const baseData = (o = {}) => ({
  lang: "en", example: false, account: { name: "Test Name", username: "test_user" }, avatar: av,
  window: { startISO: START, endISO: END, tz }, posts,
  followers: { current: 5000, delta: 40, baselineAt: "2026-11-01T12:00:00+08:00", firstRun: false },
  status: { tier: 1, ratio: 1.23, note: { en: "vs median of the previous 7 windows.", zh: "对比前 7 个窗口中位数。" } },
  footnotes: { metricsFetchedAt: "2026-11-02T16:27:00+08:00", retweetsExcluded: 5, extra: ["Plain extra note", { en: "Extra EN", zh: "附加说明中文" }] }, ...o,
});
const variant = (data) => base.slice(0, ai + A.length) + "\nconst DATA: Data = " + JSON.stringify(data) + ";\n" + base.slice(bi);
fs.mkdirSync("out/lang", { recursive: true });
fs.mkdirSync("src", { recursive: true });

const CJK = /[\u3400-\u9fff]/;
const EN_UI = /\b(Display|Style|Ratio|Music|Play|Pause|Restart|Impressions|Engagement|Followers|Shortcuts|Replay progress|Today|Lit|Volume|Neuron|Galaxy|Neon wave|Posts|Replies|Quotes|Ripple)\b/;
let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log("FAIL:", msg); } };


// 7-day sample (compact posts) for the layout / screenshot section
const weekDays = () => {
  let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  return Array.from({ length: 7 }, (_, k) => {
    const ds = new Date(Date.UTC(2026, 9, 26 + k)).toISOString().slice(0, 10);
    const posts = Array.from({ length: 120 + k * 20 }, (_, i) => [Math.floor(rnd() * 86399), (i % 3) + (i % 7 === 0 && i % 3 === 1 ? 4 : 0), i % 9 === 0 ? null : Math.floor(rnd() * rnd() * 20000), Math.floor(rnd() * 90), Math.floor(rnd() * 12), Math.floor(rnd() * 9), Math.floor(rnd() * 3), null, "Post #" + i + " sample"]);
    return { date: ds, posts, followers: { current: 5000 + k, delta: 40 - k * 9, baselineAt: null, firstRun: false }, status: { tier: k % 5, ratio: 1.2, note: { en: "vs median of the previous 7 days.", zh: "对比前 7 天中位数。" } } };
  });
};
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
let n = 0;
async function load(data, { width = 1100, height = 1400, storage = null, noStorage = false } = {}) {
  const id = "v" + n++;
  fs.writeFileSync("src/replay." + id + ".tsx", variant(data));
  fs.writeFileSync("src/h." + id + ".tsx", fs.readFileSync("harness.tsx", "utf8").replace('"./replay"', '"./replay.' + id + '"'));
  await esbuild.build({ entryPoints: ["src/h." + id + ".tsx"], bundle: true, outfile: "out/b." + id + ".js", alias: { "grok/canvas": path.resolve("stub/grok-canvas.tsx") }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "error", jsx: "automatic", target: "es2020" });
  fs.writeFileSync("out/i." + id + ".html", '<!doctype html><html><body style="margin:0;background:#0b0f19"><div id="root"></div><script src="b.' + id + '.js"></script></body></html>');
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) errs.push(m.text()); });
  await page.evaluateOnNewDocument((storage, noStorage) => {
    if (noStorage) Object.defineProperty(window, "localStorage", { get() { throw new Error("denied"); } });
    else try { if (!sessionStorage.getItem("__k")) { sessionStorage.setItem("__k", "1"); localStorage.clear(); if (storage !== null) localStorage.setItem("xpulse.lang", storage); } } catch (e) { /* ignore */ }
    window.__ft = [];
    const f = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t, x, y, w) { if (window.__ft.length < 4000) window.__ft.push(String(t)); return f.call(this, t, x, y, w); };
  }, storage, noStorage);
  await page.goto("file://" + path.resolve("out/i." + id + ".html"));
  await new Promise((r) => setTimeout(r, 600));
  page.errs = errs;
  return page;
}
const body = (p) => p.evaluate(() => document.body.innerText);
const clickText = (p, t) => p.evaluate((t) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === t); if (b) { b.click(); return true; } return false; }, t);
const setRange = (p, v) => p.evaluate((v) => { const el = document.querySelector("input[type=range]"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, String(v)); el.dispatchEvent(new Event("input", { bubbles: true })); }, v);
const pressedLang = (p) => p.evaluate(() => { const g = document.querySelector('[data-lang="switch"]'); return g ? [...g.querySelectorAll("button")].find((b) => b.style.fontWeight === "600")?.textContent : null; });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Seeding from DATA.lang: en / zh / missing / unknown / "zh-CN"
for (const [label, lang, expectZh] of [["en", "en", false], ["zh", "zh", true], ["missing", undefined, false], ["unknown", "fr", false], ["zh-CN", "zh-CN", true]]) {
  const d = baseData(); if (lang === undefined) delete d.lang; else d.lang = lang;
  const p = await load(d);
  const t = await body(p);
  check(expectZh ? t.includes("显示设置") && !t.includes("Display ·") : t.includes("Display ·") && !t.includes("显示设置"), "seed " + label);
  check((await pressedLang(p)) === (expectZh ? "中文" : "EN"), "toggle state " + label);
  check(p.errs.length === 0, "errors seed " + label + ": " + p.errs.join("|"));
  await p.close();
}

// 2. Switching: button, L key, DOM + canvas text have no other-language UI leftovers; panel, tooltip and footnotes switch too
{
  const p = await load(baseData());
  await clickText(p, "Display · 14/14 ▾").catch(() => {});
  await p.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.startsWith("Display")); if (b) b.click(); });
  await setRange(p, 600); await wait(500);
  // hover a node to get a tooltip
  const box = await p.evaluate(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width }; });
  let tip = false;
  for (let rr = 0.18; rr < 0.48 && !tip; rr += 0.01) for (let k = 0; k < 90 && !tip; k++) { const a = (k / 90) * 6.283; await p.mouse.move(box.x + box.w / 2 + Math.cos(a) * rr * box.w, box.y + box.w / 2 + Math.sin(a) * rr * box.w); if (k % 5 === 4) tip = (await body(p)).includes("Click the dot"); }
  check(tip, "tooltip found (en)");
  const en = await body(p);
  const enNoToggle = en.replace(/附加说明中文/g, "").split("\n").filter((l) => l.trim() !== "中文").join("\n");
  check(!CJK.test(enNoToggle), "en DOM has no CJK: " + (enNoToggle.split("\n").filter((l) => CJK.test(l)).slice(0, 3).join(" | ")));
  check(en.includes("Extra EN") && en.includes("Plain extra note") && !en.includes("附加说明中文"), "extra notes en");
  check(en.includes("vs median of the previous 7 windows.") && !en.includes("对比前"), "status note en");
  await p.evaluate(() => { window.__ft.length = 0; });
  await clickText(p, "中文"); await wait(500);
  const zh = await body(p);
  check(zh.includes("显示设置") && zh.includes("附加说明中文") && !zh.includes("Extra EN") && zh.includes("对比前 7 个窗口中位数。") && zh.includes("Plain extra note"), "zh switch: panel/extra/note");
  check(!EN_UI.test(zh), "zh DOM has English UI words: " + (zh.match(EN_UI) || [""])[0]);
  check(zh.includes("点击光点") || zh.includes("没有原帖链接") || zh.includes("打开原帖"), "tooltip text switched to zh");
  await p.evaluate(() => { window.__ft.length = 0; }); await wait(250);
  const ftZh = await p.evaluate(() => window.__ft);
  check(ftZh.length > 0 && !ftZh.some((s) => EN_UI.test(s)), "zh canvas text has English UI words: " + ftZh.filter((s) => EN_UI.test(s)).slice(0, 3));
  check(ftZh.some((s) => CJK.test(s)), "zh canvas has CJK");
  await p.evaluate(() => { window.__ft.length = 0; });
  await p.keyboard.press("l"); await wait(500);
  await p.evaluate(() => { window.__ft.length = 0; }); await wait(250);
  const en2 = await body(p);
  check(en2.includes("Display ·") && (await pressedLang(p)) === "EN", "L key back to en");
  const ftEn = await p.evaluate(() => window.__ft);
  check(ftEn.length > 0 && !ftEn.some((s) => CJK.test(s)), "en canvas text has CJK: " + ftEn.filter((s) => CJK.test(s)).slice(0, 3));
  // aria + title
  const aria = await p.evaluate(() => document.querySelector("canvas").getAttribute("aria-label"));
  check(/24-hour posting replay dial/.test(aria), "aria en");
  // persistence: choose zh, reload page with same DATA.lang -> zh remembered
  await clickText(p, "中文");
  const stored = await p.evaluate(() => localStorage.getItem("xpulse.lang"));
  check(stored === '{"lang":"zh","base":"en"}', "stored value " + stored);
  check(p.errs.length === 0, "errors switching: " + p.errs.join("|"));
  await p.close();
  const p2 = await load(baseData(), { storage: stored });
  check((await body(p2)).includes("显示设置"), "persisted zh restored when DATA.lang unchanged");
  await p2.close();
  const p3 = await load(baseData({ lang: "zh" }), { storage: stored });
  check((await pressedLang(p3)) === "中文", "stored base=en ignored when DATA.lang=zh: still zh (consistent)");
  await p3.close();
  const p4 = await load(baseData({ lang: "zh" }), { storage: '{"lang":"en","base":"en"}' });
  check((await body(p4)).includes("显示设置"), "stale stored choice dropped when DATA.lang changed");
  await p4.close();
  const p5 = await load(baseData(), { storage: "garbage{" });
  check((await body(p5)).includes("Display ·") && p5.errs.length === 0, "garbage storage ignored");
  await p5.close();
  const p6 = await load(baseData({ lang: "zh" }), { noStorage: true });
  check((await body(p6)).includes("显示设置"), "no storage: DATA.lang used");
  await clickText(p6, "EN"); await wait(300);
  check((await body(p6)).includes("Display ·") && p6.errs.filter((e) => !/denied/.test(e)).length === 0, "no storage: switching still works, no errors: " + p6.errs.join("|"));
  await p6.close();
}

// 3. Notes: plain strings shown only in their own language, objects per language, missing -> built-in text only
{
  const p = await load(baseData({ status: { tier: 2, ratio: 0.8, note: "对比前 7 个窗口中位数。" }, footnotes: { metricsFetchedAt: null, retweetsExcluded: null, extra: [] } }));
  await p.evaluate(() => { document.body.scrollTo(0, 99999); });
  let t = await body(p);
  check(!t.includes("对比前") && t.includes("Multiple 0.80× (≥1.5 standout") && t.includes("Rated “Steady day”."), "zh note hidden in en, built-in text kept: " + t.split("\n").filter((l) => l.includes("Multiple")).join());
  await clickText(p, "中文"); await wait(300);
  t = await body(p);
  check(t.includes("状态：对比前 7 个窗口中位数。") && t.includes("评为「稳定日」"), "zh note shown in zh");
  await p.close();
  const q = await load(baseData({ status: { tier: 2, ratio: null, note: { zh: "只有中文" } } }));
  check(!(await body(q)).includes("只有中文"), "object note missing en -> omitted");
  await q.close();
}

// 4. Layout, both languages, three aspect ratios: toolbar / stage / legend overflow + screenshots
const data = baseData();
for (const [aname, aText, vp] of [["1x1", "1:1", { width: 1100, height: 1500 }], ["9x16", "9:16", { width: 700, height: 1700 }], ["16x9", "16:9", { width: 1100, height: 1500 }], ["mobile", "9:16", { width: 390, height: 1700 }]]) {
  for (const lang of ["en", "zh"]) {
    const p = await load(baseData({ lang, window: undefined, posts: undefined, followers: undefined, status: undefined, tz: { iana: "Asia/Shanghai" }, days: weekDays() }), vp);
    await clickText(p, aText); await wait(300);
    await p.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /^(Display|显示设置)/.test(x.textContent)); if (b) b.click(); });
    await setRange(p, 1000); await wait(700);
    const m = await p.evaluate(() => {
      const out = { hscroll: document.scrollingElement.scrollWidth > window.innerWidth + 1, btnOverflow: [], outside: [] };
      for (const b of document.querySelectorAll("button")) if (b.scrollWidth > b.clientWidth + 1) out.btnOverflow.push(b.textContent);
      const cv = document.querySelector("canvas"); const stage = cv.parentElement.parentElement; const sr = stage.getBoundingClientRect();
      for (const el of stage.querySelectorAll("*")) { const r = el.getBoundingClientRect(); if (r.width && (r.left < sr.left - 1 || r.right > sr.right + 1 || r.bottom > sr.bottom + 1 || r.top < sr.top - 1)) out.outside.push((el.textContent || el.tagName).slice(0, 30)); }
      const first = stage.children[0]; const cr = cv.getBoundingClientRect();
      out.legendOverlap = first && first !== cv.parentElement ? first.getBoundingClientRect().bottom > cr.top + 1 : false;
      const status = [...stage.children].find((c) => c !== first && c !== cv.parentElement);
      out.statusOverlap = status ? status.getBoundingClientRect().top < cr.bottom - 1 : false;
      out.statusClipped = status ? status.scrollWidth > status.clientWidth + 1 : false;
      return out;
    });
    check(!m.hscroll && !m.btnOverflow.length && !m.outside.length && !m.legendOverlap && !m.statusOverlap && !m.statusClipped, aname + " " + lang + " layout " + JSON.stringify(m));
    const stageClip = await p.evaluate(() => { const r = document.querySelector("canvas").parentElement.parentElement.getBoundingClientRect(); return { x: r.left, y: r.top + window.scrollY, width: r.width, height: r.height }; });
    await p.screenshot({ path: `out/lang/${aname}_${lang}_page.png`, fullPage: true });
    await p.screenshot({ path: `out/lang/${aname}_${lang}_stage.png`, clip: stageClip, captureBeyondViewport: true });
    // the stage must also hold with the center dashboard fully visible and in the other tiers
    await p.close();
  }
}
await browser.close();
console.log(fails ? "LANG TESTS FAILED: " + fails : "LANG TESTS OK");
if (fails) process.exit(1);
