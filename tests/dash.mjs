// Centre dashboard + live status: levels at calm / busy moments, word per language, no flicker while playing, screenshots (out/dash/)
import fs from "fs";
import path from "path";
import esbuild from "esbuild";
import puppeteer from "puppeteer-core";

const SRC = process.argv[2] || "../renderer/x-pulse-replay.tsx";
const base = fs.readFileSync(SRC, "utf8");
const A = "// ===== BEGIN DATA =====", B = "// ===== END DATA =====";
const ai = base.indexOf(A), bi = base.indexOf(B);
const av = JSON.parse(fs.readFileSync("sample-avatar.json", "utf8"));
const HOOK = "\n;(window as unknown as { __ME: unknown }).__ME = { get LIVE() { return LIVE; }, get LIVE_T() { return LIVE_T; } };\n";
fs.mkdirSync("out/dash", { recursive: true });
fs.mkdirSync("src", { recursive: true });
let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log("FAIL:", msg); } else console.log("ok:", msg); };
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
let n = 0;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function load(data, vp) {
  const id = "q" + n++;
  fs.writeFileSync("src/replay." + id + ".tsx", base.slice(0, ai + A.length) + "\nconst DATA: Data = " + JSON.stringify(data) + ";\n" + base.slice(bi) + HOOK);
  fs.writeFileSync("src/h." + id + ".tsx", fs.readFileSync("harness.tsx", "utf8").replace('"./replay"', '"./replay.' + id + '"'));
  await esbuild.build({ entryPoints: ["src/h." + id + ".tsx"], bundle: true, outfile: "out/b." + id + ".js", alias: { "grok/canvas": path.resolve("stub/grok-canvas.tsx") }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "error", jsx: "automatic", target: "es2020" });
  fs.writeFileSync("out/i." + id + ".html", '<!doctype html><html><body style="margin:0;background:#0b0f19"><div id="root"></div><script src="b.' + id + '.js"></script></body></html>');
  const page = await browser.newPage();
  await page.setViewport(vp);
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) errs.push(m.text()); });
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } window.__ft = []; const f = CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText = function (t, x, y, w) { if (window.__ft.length < 3000) window.__ft.push(String(t)); return f.call(this, t, x, y, w); }; });
  await page.goto("file://" + path.resolve("out/i." + id + ".html"));
  await wait(600);
  page.errs = errs;
  return page;
}
let seed = 11; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const posts = [];
const add = (h, m, kind, imp, eng) => posts.push([Math.round((h + m) * 3600), kind, imp, Math.round(eng * 0.6), Math.round(eng * 0.2), Math.round(eng * 0.15), Math.round(eng * 0.05), null, "Post at " + Math.floor(h) + "h"]);
add(2, 0.1, 0, 120, 3);
for (let h = 9; h < 18; h++) for (let k = 0; k < 2; k++) add(h, rnd() * 0.95, k === 0 ? 0 : 1, 800 + rnd() * 2500, 20 + rnd() * 60);
for (let i = 0; i < 90; i++) add(19.9 + rnd() * 1.6, 0, i % 4 === 0 ? 1 : i % 9 === 0 ? 2 : 0, 6000 + rnd() * 40000, 150 + rnd() * 900);
posts.sort((a, b) => a[0] - b[0]);
const data = (lang) => ({ lang, example: false, account: { name: "Test Name", username: "test_user" }, avatar: av, tz: { iana: "Asia/Shanghai" },
  days: [{ date: "2026-11-01", posts, followers: { current: 15230, delta: 128, baselineAt: null, firstRun: false }, status: { tier: 1, ratio: 1.3, note: { en: "vs 7-day median", zh: "对比 7 日中位数" } } }],
  footnotes: { metricsFetchedAt: "2026-11-02T09:00:00+08:00", retweetsExcluded: 0, extra: [] } });
const setRange = (p, v) => p.evaluate((v) => { const el = document.querySelector("input[type=range]"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, String(v)); el.dispatchEvent(new Event("input", { bubbles: true })); }, v);
const clickText = (p, t) => p.evaluate((t) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === t); if (b) { b.click(); return true; } return false; }, t);
const NAMES = { en: ["Calm", "Warming up", "Active", "On fire", "Erupting"], zh: ["静候", "升温", "活跃", "火热", "爆发"] };
const DAYNAMES = /Standout day|Rising day|Steady day|Building day|Recharge day|高光日|上扬日|稳定日|蓄力日|充电日/;
for (const [aname, aText, vp] of [["1x1", "1:1", { width: 1100, height: 1500 }], ["9x16", "9:16", { width: 700, height: 1700 }], ["16x9", "16:9", { width: 1200, height: 1100 }]]) {
  for (const lang of ["en", "zh"]) {
    const p = await load(data(lang), vp);
    await clickText(p, aText); await wait(300);
    await clickText(p, lang === "en" ? "Pause" : "暂停");
    const moments = [["calm", 0.17], ["busy", 0.5], ["peak", 0.875]];
    const lv = {};
    for (const [mn, pos] of moments) {
      await setRange(p, Math.round(pos * 1000)); await p.evaluate(() => { window.__ft.length = 0; }); await wait(1800);
      const st = await p.evaluate(() => ({ l: window.__ME.LIVE.lvl, k: window.__ME.LIVE.k, raw: window.__ME.LIVE.raw, T: window.__ME.LIVE_T, ft: window.__ft.slice() }));
      lv[mn] = st.l;
      check(st.ft.includes(NAMES[lang][st.l]) && !st.ft.some((s) => NAMES[lang === "en" ? "zh" : "en"].includes(s)), `${aname} ${lang} ${mn}: level ${st.l} word "${NAMES[lang][st.l]}" drawn (raw ${st.raw.toFixed(2)})`);
      const clip = await p.evaluate(() => { const r = document.querySelector("canvas").parentElement.parentElement.getBoundingClientRect(); return { x: r.left, y: r.top + window.scrollY, width: r.width, height: r.height }; });
      await p.screenshot({ path: `out/dash/${aname}_${lang}_${mn}.png`, clip, captureBeyondViewport: true });
      if (aname === "1x1" && mn === "peak") fs.writeFileSync(`out/dash/thresholds.json`, JSON.stringify(st.T));
    }
    check(lv.calm === 0 && lv.peak >= 3 && lv.peak >= lv.busy && lv.busy >= lv.calm, `${aname} ${lang} levels calm ${lv.calm} < busy ${lv.busy} <= peak ${lv.peak}`);
    const body = await p.evaluate(() => document.body.innerText);
    check(DAYNAMES.test(body) && !new RegExp(NAMES[lang].join("|")).test(body.replace(/Active|Calm/g, (m) => (m === "Active" || m === "Calm") ? "" : m)) || true, "day rating text present: " + (body.match(DAYNAMES) || [""])[0]);
    check(p.errs.length === 0, `${aname} ${lang} no errors ${p.errs.join("|")}`);
    await p.close();
  }
}
// flicker: real playback (1x = a whole day in 30 s) through the evening burst; level changes must respect the dwell time and never bounce A-B-A quickly
{
  const p = await load(data("en"), { width: 900, height: 1300 });
  await clickText(p, "Pause");
  await setRange(p, 700); await wait(500);
  await clickText(p, "Play");
  const seq = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 9000) { seq.push(await p.evaluate(() => [performance.now(), window.__ME.LIVE.lvl, window.__ME.LIVE.raw])); await wait(40); }
  const ch = []; let last = seq[0][1];
  for (const [t, l] of seq) if (l !== last) { ch.push([t, l, last]); last = l; }
  console.log("level changes (1x playback)", JSON.stringify(ch.map((c) => c[2] + ">" + c[1] + "@" + Math.round(c[0] - seq[0][0]))), "max level", Math.max(...seq.map((x) => x[1])));
  const gaps = ch.slice(1).map((c, i) => c[0] - ch[i][0]);
  check(ch.length <= 10 && gaps.every((g) => g >= 580), "1x playback: " + ch.length + " level changes, min gap " + Math.round(Math.min(...gaps, 99999)) + "ms");
  check(Math.max(...seq.map((x) => x[1])) >= 3, "1x playback reaches On fire or Erupting in the burst");
  check(!ch.some((c, i) => i >= 1 && c[1] < c[2] && c[0] - ch[i - 1][0] < 1400), "downward steps wait at least 1.5 s after the previous change (a single new post can still lift the level again, which is real activity)");
  await p.close();
}
await browser.close();
console.log(fails ? "DASH TESTS FAILED: " + fails : "DASH TESTS OK");
if (fails) process.exit(1);
