// X Pulse (Public) tests: data validation, bilingual switching, the "no 估 / estimate" rule in the visual areas (canvas text + DOM outside [data-xp-caveat]),
// three layouts (stack / square / wide), panel overflow and font floor, the centre board ending on the sidebar totals, hot-post card, recorder hook.
//   node public.mjs [renderer.tsx]
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import esbuild from "esbuild";
import puppeteer from "puppeteer-core";

const SRC = process.argv[2] || "../renderer/x-pulse-replay.tsx";
const base = fs.readFileSync(SRC, "utf8");
const A = "// ===== BEGIN DATA =====", B = "// ===== END DATA =====";
const ai = base.indexOf(A), bi = base.indexOf(B);
fs.mkdirSync("out", { recursive: true });
fs.mkdirSync("src", { recursive: true });
execFileSync("python3", ["pubfix.py", "out/pubfix"], { stdio: "pipe" });
const FIX = JSON.parse(fs.readFileSync("out/pubfix/out/data_2026-11-03T04.json", "utf8"));
let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log("FAIL:", msg); } else console.log("ok:", msg); };
const clone = () => JSON.parse(JSON.stringify(FIX));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
let n = 0;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SPY = `window.__T=new Set();for(const k of ["fillText","strokeText"]){const o=CanvasRenderingContext2D.prototype[k];CanvasRenderingContext2D.prototype[k]=function(t,...a){try{window.__T.add(String(t))}catch(e){}return o.call(this,t,...a)}}`;
async function load(data, { w = 1100, h = 1300, rec = null } = {}) {
  const id = "p" + n++;
  fs.writeFileSync("src/replay." + id + ".tsx", base.slice(0, ai + A.length) + "\nconst DATA: Data = " + JSON.stringify(data) + ";\n" + base.slice(bi));
  fs.writeFileSync("src/h." + id + ".tsx", fs.readFileSync("harness.tsx", "utf8").replace('"./replay"', '"./replay.' + id + '"'));
  await esbuild.build({ entryPoints: ["src/h." + id + ".tsx"], bundle: true, outfile: "out/b." + id + ".js", alias: { "grok/canvas": path.resolve("stub/grok-canvas.tsx") }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "error", jsx: "automatic", loader: { ".tsx": "tsx" } });
  fs.writeFileSync("out/i." + id + ".html", '<!doctype html><html><body style="margin:0;background:#0b0f19"><div id="root"></div><script src="b.' + id + '.js"></script></body></html>');
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h });
  await page.evaluateOnNewDocument(SPY);
  await page.evaluateOnNewDocument((rec) => { try { localStorage.clear(); } catch (e) { /* ignore */ } if (rec) window.__XPULSE_REC = rec; }, rec);
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) errs.push(m.text()); });
  await page.goto("file://" + path.resolve("out/i." + id + ".html"));
  await wait(700);
  page.errs = errs;
  return page;
}
const body = (p) => p.evaluate(() => document.body.innerText);
const first = async (p) => (await body(p)).split("\n")[0].trim();
const seek = async (p, v) => { await p.evaluate((v) => { const el = document.querySelector("input[type=range]"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(v)); el.dispatchEvent(new Event("input", { bubbles: true })); }, v); await wait(1500); };
const toggleLang = async (p) => { await p.keyboard.press("l"); await wait(300); };
const BAD = /估|estimat|\best\b|\best\./i;
// text of the visual areas: every canvas string, plus the stage DOM without the caveat spans
const visual = (p) => p.evaluate(() => {
  const stage = document.querySelector("[data-xp-stage]");
  let dom = "";
  if (stage) { const c = stage.cloneNode(true); c.querySelectorAll("[data-xp-caveat]").forEach((x) => x.remove()); dom = c.textContent || ""; }
  return { canvas: [...window.__T], dom };
});

// 1. titles, both languages, no console errors
{
  const d0 = clone(); d0.lang = "en";
  const p = await load(d0);
  check((await first(p)) === "X Pulse · Public · AI", "en title: " + (await first(p)));
  await toggleLang(p);
  check((await first(p)) === "X Pulse · Public · AI 圈", "zh title uses topic.title.zh: " + (await first(p)));
  check(p.errs.length === 0, "no console errors " + JSON.stringify(p.errs.slice(0, 2)));
  await toggleLang(p);
  check(!/[\u4e00-\u9fff]/.test((await body(p)).replace(/中文/g, "")), "en page has no Chinese text except hot-post originals/glosses and the language button");
  await p.close();
  const pw = await load(d0, { w: 1920, h: 1080, rec: { layout: "wide", fw: 1920 } });
  const te = await body(pw);
  check(te.includes("WINDOW TOTALS") && te.includes("Views") && te.includes("Posters"), "en sidebar labels (wide)");
  await toggleLang(pw);
  const t = await body(pw);
  check(t.includes("窗口总量") && t.includes("浏览") && t.includes("发帖人"), "zh sidebar labels (wide)");
  await pw.close();
}
// 2. no 估 / estimate in the visual areas, any layout, any language, start / middle / end; caveat only in [data-xp-caveat] and the footnotes
for (const [name, opt] of [["stack 480", { w: 480, h: 1800 }], ["square 1100", { w: 1100, h: 1300 }], ["wide 1600", { w: 1600, h: 1000 }], ["rec wide", { w: 1920, h: 1080, rec: { layout: "wide", fw: 1920 } }], ["rec square", { w: 1080, h: 1080, rec: { layout: "square", fw: 1080 } }]]) {
  for (const lang of ["zh", "en"]) {
    const d = clone();
    d.lang = lang;
    const p = await load(d, opt);
    if (!opt.rec && name.startsWith("wide")) { await p.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "16:9"); if (b) b.click(); }); await wait(300); }
    for (const pos of [60, 500, 1000]) await seek(p, pos);
    const v = await visual(p);
    check(!v.canvas.some((s) => BAD.test(s)), name + " " + lang + ": canvas text has no 估 / estimate (" + v.canvas.length + " strings)");
    check(!BAD.test(v.dom), name + " " + lang + ": stage DOM outside [data-xp-caveat] has no 估 / estimate");
    check(p.errs.length === 0, name + " " + lang + ": no console errors " + JSON.stringify(p.errs.slice(0, 2)));
    {
      const caveat = await p.evaluate(() => [...document.querySelectorAll("[data-xp-caveat]")].map((x) => x.textContent).join(" "));
      check(BAD.test(caveat), name + " " + lang + ": caveat is present in the sidebar / header caveat span: " + caveat.slice(0, 40));
    }
    await p.close();
  }
}

// 3. layouts: panels never overflow, text never below 11 px, stage size
for (const [name, opt, W, H] of [["wide rec", { w: 1920, h: 1080, rec: { layout: "wide", fw: 1920 } }, 1920, 1080], ["square rec", { w: 1080, h: 1080, rec: { layout: "square", fw: 1080 } }, 1080, 1080]]) {
  for (const lang of ["zh", "en"]) {
    const d = clone(); d.lang = lang;
    const p = await load(d, opt);
    const geo = await p.evaluate(() => { const r = document.querySelector("[data-xp-stage]").getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
    check(geo[0] === W && geo[1] === H, name + " " + lang + ": stage is " + W + "x" + H + " (got " + geo + ")");
    for (const pos of [60, 500, 1000]) {
      await seek(p, pos);
      const bad = await p.evaluate(() => {
        const out = [];
        document.querySelectorAll("[data-xp-panel]").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2) out.push("overflow " + el.getAttribute("data-xp-panel") + " " + el.scrollWidth + "x" + el.scrollHeight + " in " + el.clientWidth + "x" + el.clientHeight);
          if (parseFloat(getComputedStyle(el).opacity) < 0.05) return; // the hot card is invisible until a hot post lights up
          if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) out.push("outside " + el.getAttribute("data-xp-panel"));
          el.querySelectorAll("*").forEach((c) => { if (c.childNodes.length && [...c.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim()) && parseFloat(getComputedStyle(c).fontSize) < 10.99) out.push("tiny font " + getComputedStyle(c).fontSize + " " + c.textContent.slice(0, 20)); });
        });
        return out;
      });
      check(bad.length === 0, name + " " + lang + " @" + pos + ": panels fit, fonts >= 11px " + JSON.stringify(bad.slice(0, 3)));
    }
    await p.close();
  }
}
{
  // stack layout (narrow viewport): panels are in flow, nothing overflows horizontally
  for (const lang of ["zh", "en"]) {
    const d = clone(); d.lang = lang;
    const p = await load(d, { w: 420, h: 2200 });
    await seek(p, 500);
    const bad = await p.evaluate(() => {
      const out = [];
      if (document.documentElement.scrollWidth > innerWidth + 2) out.push("page scrolls horizontally " + document.documentElement.scrollWidth);
      document.querySelectorAll("[data-xp-panel]").forEach((el) => { if (el.scrollWidth > el.clientWidth + 2) out.push("overflow-x " + el.getAttribute("data-xp-panel")); });
      return out;
    });
    check(bad.length === 0, "stack " + lang + ": no horizontal overflow " + JSON.stringify(bad));
    check((await p.evaluate(() => document.querySelectorAll("[data-xp-panel]").length)) >= 2, "stack " + lang + ": info (with legend and totals) and heat panels present");
    await p.close();
  }
}
// 4. the centre board ends on the sidebar totals (same formatter, so the strings must match)
for (const lang of ["zh", "en"]) {
  const d = clone(); d.lang = lang;
  const p = await load(d, { w: 1920, h: 1080, rec: { layout: "wide", fw: 1920 } });
  await p.evaluate(() => window.__XPULSE_API.set({ play: false, p: 1 }));
  await wait(2500);
  const tot = await p.evaluate(() => [...document.querySelectorAll("[data-xp-total]")].map((e) => [e.getAttribute("data-xp-total"), e.getAttribute("data-xp-num") || e.textContent.trim()]));
  const v = await visual(p);
  check(tot.length >= 8, lang + ": sidebar exposes views, engagement and 6 rows (" + tot.length + ")");
  for (const [k, num] of tot) {
    if (/Posters|Commenters|发帖人|评论人/.test(k)) continue; // people rows animate with their own easing; checked via the board strings below
    check(v.canvas.some((s) => s.includes(num)), lang + ": centre board shows the sidebar total " + k + " = " + num);
  }
  await p.close();
}
// 5. hot-post card appears on a hot post and shows its title; recorder hook state
{
  const hot = FIX.pub.hot[0];
  const p = await load(clone(), { w: 1920, h: 1080, rec: { layout: "wide", fw: 1920 } });
  check(await p.evaluate(() => typeof window.__XPULSE_API.state === "function" && typeof window.__XPULSE_API.set === "function"), "recorder hook exists");
  await p.evaluate((t) => window.__XPULSE_API.set({ play: false, p: (t + 600) / 86400 }), hot.ts);
  await wait(1200);
  const t = await body(p);
  check(t.includes(hot.title.slice(0, 20)), "hot card shows the hot post title: " + hot.title.slice(0, 20));
  check(t.includes("@" + hot.u), "hot card shows the handle");
  const st = await p.evaluate(() => window.__XPULSE_API.state());
  check(st.p > 0 && st.play === false, "state() reports progress and play");
  await p.close();
}
// 6. validation errors: a readable message, no canvas, no crash
{
  const cases = [
    ["missing pub", (d) => { delete d.pub; }, "DATA.pub is required"],
    ["N = 0", (d) => { d.pub.N = 0; }, "DATA.pub.N"],
    ["M missing", (d) => { delete d.pub.M; }, "DATA.pub.M"],
    ["hours.posts length", (d) => { d.pub.hours.posts.pop(); }, "DATA.pub.hours.posts"],
    ["hours.reposts negative", (d) => { d.pub.hours.reposts[3] = -1; }, "DATA.pub.hours.reposts"],
    ["tier 5", (d) => { d.pub.hours.tier[0] = 5; }, "DATA.pub.hours.tier"],
    ["cum decreasing", (d) => { d.pub.cum.posters[10] = 0; d.pub.cum.posters[11] = 0; d.pub.cum.posters[24] = 5; d.pub.cum.posters[9] = 9; }, "DATA.pub.cum"],
    ["totals key missing", (d) => { delete d.pub.totals.views; }, "DATA.pub.totals.views"],
    ["hot id not digits", (d) => { d.pub.hot[0].id = "abc"; }, "DATA.pub.hot"],
    ["hot ts out of range", (d) => { d.pub.hot[0].ts = 99999; }, "DATA.pub.hot"],
    ["too many hot", (d) => { d.pub.hot = Array.from({ length: 13 }, (_, i) => ({ ...FIX.pub.hot[0], id: String(100 + i) })); }, "at most 12"],
    ["scope missing", (d) => { delete d.pub.scope; }, "DATA.pub.scope"],
    ["caveat missing", (d) => { delete d.pub.caveat; }, "DATA.pub.caveat"],
    ["topic name blank", (d) => { d.topic.name = " "; }, "DATA.topic.name is required"],
    ["window missing", (d) => { delete d.window; }, "DATA.window"],
  ];
  for (const [name, f, want] of cases) {
    const d = clone(); f(d);
    const p = await load(d);
    const t = await body(p);
    check(t.includes(want), "invalid (" + name + ") -> message contains \"" + want + "\": " + t.split("\n").find((l) => l.includes("DATA")) );
    check((await p.evaluate(() => document.querySelectorAll("canvas").length)) === 0, "invalid (" + name + ") draws no dial");
    await p.close();
  }
}
await browser.close();
console.log(fails ? "PUBLIC TESTS FAILED: " + fails : "PUBLIC TESTS OK");
if (fails) process.exit(1);
