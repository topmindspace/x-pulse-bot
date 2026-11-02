import fs from "fs";
import path from "path";
import esbuild from "esbuild";
import puppeteer from "puppeteer-core";

const SRC = process.argv[2] || "../renderer/x-pulse-replay.tsx";
const only = process.argv[3] || "";
const base = fs.readFileSync(SRC, "utf8");
const A = "// ===== BEGIN DATA =====", B = "// ===== END DATA =====";
const ai = base.indexOf(A), bi = base.indexOf(B);
if (ai < 0 || bi < 0) throw new Error("markers missing");
const av = JSON.parse(fs.readFileSync("sample-avatar.json", "utf8"));

const iso = (h, m = 0) => {
  const t = new Date(Date.UTC(2026, 10, 1, 8, 26) + (h * 60 + m) * 60000); // window start 2026-11-01 16:26 +08:00 = 08:26Z
  return t.toISOString();
};
const START = "2026-11-01T16:26:00+08:00", END = "2026-11-02T16:26:00+08:00";
const tz = { label: "Beijing time (UTC+8)", offsetMinutes: 480 };
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
function mkPosts(n, nullImp = false, unsafe = false) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const kind = ["post", "reply", "quote"][i % 3 === 0 ? 0 : i % 7 === 0 ? 2 : 1];
    out.push({
      t: iso(0, Math.floor(rnd() * 24 * 60)), kind, selfThread: i % 11 === 0 && kind === "reply",
      text: "Post #" + i + " " + "x".repeat(i % 5 === 0 ? 300 : 10) + " <b>not html</b>",
      impressions: nullImp ? null : (i % 9 === 0 ? null : Math.floor(rnd() * 5000)),
      likes: nullImp ? null : Math.floor(rnd() * 40), reposts: nullImp ? null : Math.floor(rnd() * 8), replies: nullImp ? null : Math.floor(rnd() * 8), quotes: nullImp ? null : Math.floor(rnd() * 3),
      url: unsafe ? "javascript:alert(1)" : "https://x.com/i/status/" + (1000 + i),
    });
  }
  return out;
}
const baseData = (o) => ({
  lang: "en", example: false, account: { name: "Test Name", username: "test_user" }, avatar: av,
  window: { startISO: START, endISO: END, tz }, posts: mkPosts(30),
  followers: { current: 5000, delta: 40, baselineAt: "2026-11-01T12:00:00+08:00", firstRun: false },
  status: { tier: 1, ratio: 1.23, note: "vs median of the previous 7 windows." },
  footnotes: { metricsFetchedAt: "2026-11-02T16:27:00+08:00", retweetsExcluded: 5, extra: ["Extra note A"] }, ...o,
});
const scenarios = {
  example: null,
  full_en: baseData({}),
  full_zh: baseData({ lang: "zh", account: { name: "测试账号", username: "@test_zh" }, status: { tier: 0, ratio: 1.8, note: "对比前 7 个窗口中位数。" } }),
  tier2: baseData({ status: { tier: 2, ratio: 0.8, note: "n" } }),
  tier3: baseData({ status: { tier: 3, ratio: 0.5, note: "n" } }),
  tier4: baseData({ status: { tier: 4, ratio: null, note: "n" } }),
  zero_posts: baseData({ posts: [] }),
  one_post: baseData({ posts: mkPosts(1) }),
  all_null: baseData({ posts: mkPosts(20, true) }),
  firstrun: baseData({ followers: { current: 777, delta: null, baselineAt: null, firstRun: true }, status: null }),
  fol_unknown: baseData({ followers: { current: null, delta: null, baselineAt: null, firstRun: false }, status: null }),
  delta_neg: baseData({ followers: { current: 4990, delta: -12, baselineAt: "2026-11-01T10:00:00+08:00", firstRun: false } }),
  delta_noBase: baseData({ followers: { current: 5000, delta: 25, baselineAt: null, firstRun: false } }),
  segments: baseData({ followers: { current: 5000, delta: 30, baselineAt: "2026-11-01T10:00:00+08:00", firstRun: false, segments: [{ fromISO: "2026-11-01T10:00:00+08:00", toISO: "2026-11-01T20:00:00+08:00", delta: 20 }, { fromISO: "2026-11-01T20:00:00+08:00", toISO: "2026-11-02T16:26:00+08:00", delta: 10 }] } }),
  long_name: baseData({ account: { name: "Extremely Long Display Name That Goes On 50 chars!!", username: "a_very_long_user_n" } }),
  emoji_name: baseData({ account: { name: "🐔🐱 cat", username: "u" }, avatar: null }),
  no_name: baseData({ account: { name: "", username: "" } }),
  many_600: baseData({ posts: mkPosts(600) }),
  bad_avatar: baseData({ avatar: { size: 96, palette: "AAAA", indices: "AAAA" } }),
  garbage_avatar: baseData({ avatar: { size: 96, palette: "!!!", indices: "???" } }),
  unsafe_url: baseData({ posts: mkPosts(5, false, true) }),
  bad_window: baseData({ window: { startISO: "nonsense", endISO: END, tz } }),
  out_of_window: baseData({ posts: [...mkPosts(5), { ...mkPosts(1)[0], t: "2026-10-30T00:00:00+08:00" }, { ...mkPosts(1)[0], t: "2026-11-05T00:00:00+08:00" }, { ...mkPosts(1)[0], t: "garbage" }] }),
  no_audio: baseData({}),
  other_tz: baseData({ window: { startISO: "2026-11-01T10:00:00Z", endISO: "2026-11-02T10:00:00Z", tz: { label: "PST", offsetMinutes: -480 } }, posts: [{ ...mkPosts(1)[0], t: "2026-11-01T12:00:00Z" }] }),
};

function variant(data) {
  if (data === null) return base;
  return base.slice(0, ai + A.length) + "\nconst DATA: Data = " + JSON.stringify(data) + ";\n" + base.slice(bi);
}
// Test-only hook (appended to the bundle, not part of the renderer): lets the harness render the music offline
const HOOK = "\n;(window as unknown as { __ME: unknown }).__ME = { MusicEngine, NODES, DAY };\n";
fs.mkdirSync("out", { recursive: true });
fs.mkdirSync("src", { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
let fails = 0;
for (const [name, data] of Object.entries(scenarios)) {
  if (only && name !== only) continue;
  fs.writeFileSync("src/replay.tsx.tmp.tsx", variant(data) + HOOK);
  fs.copyFileSync("src/replay.tsx.tmp.tsx", "src/replay.tmp.tsx");
  fs.writeFileSync("src/h.tsx", fs.readFileSync("harness.tsx", "utf8").replace('"./replay"', '"./replay.tmp"'));
  await esbuild.build({ entryPoints: ["src/h.tsx"], bundle: true, outfile: "out/bundle.js", alias: { "grok/canvas": path.resolve("stub/grok-canvas.tsx") }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "error", jsx: "automatic", target: "es2020" });
  fs.writeFileSync("out/index.html", '<!doctype html><html><body style="margin:0;background:#0b0f19"><div id="root"></div><script src="bundle.js"></script></body></html>');
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 1400 });
  if (name === "no_audio") await page.evaluateOnNewDocument(() => { delete window.AudioContext; delete window.webkitAudioContext; });
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) errs.push(m.type() + ": " + m.text()); });
  const net = [];
  page.on("request", (r) => { if (!r.url().startsWith("file://") && !r.url().startsWith("data:")) net.push(r.url()); });
  await page.goto("file://" + path.resolve("out/index.html"));
  await new Promise((r) => setTimeout(r, 700));
  const click = async (text) => page.evaluate((t) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === t || x.textContent.trim().startsWith(t)); if (b) { b.click(); return true; } return false; }, text);
  // seek to ~60%, screenshot
  const setRange = (v) => page.evaluate((v) => { const el = document.querySelector('input[type=range]'); if (!el) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, String(v)); el.dispatchEvent(new Event("input", { bubbles: true })); return true; }, v);
  const hasRange = await setRange(600);
  await new Promise((r) => setTimeout(r, 400));
  // hover/click nodes: scan canvas
  const box = await page.evaluate(() => { const c = document.querySelector("canvas"); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  let tip = false;
  if (box) {
    outer: for (let rr = 0.18; rr < 0.48 && !tip; rr += 0.012) {
      for (let k = 0; k < 90; k++) {
        const ang = (k / 90) * Math.PI * 2;
        await page.mouse.move(box.x + box.w / 2 + Math.cos(ang) * rr * box.w, box.y + box.h / 2 + Math.sin(ang) * rr * box.w);
        if (k % 6 === 5) {
          tip = await page.evaluate(() => document.body.innerText.includes("Click the dot") || document.body.innerText.includes("点击光点") || document.body.innerText.includes("No link for"));
          if (tip) break outer;
        }
      }
    }
    if (tip) { await page.mouse.down(); await page.mouse.up(); await new Promise((r) => setTimeout(r, 100)); }
  }
  const pinnedLinks = await page.evaluate(() => [...document.querySelectorAll('a')].map((a) => a.href));
  await page.screenshot({ path: `out/${name}_1.png` });
  // toolbars
  await click("Display"); await click("显示设置");
  for (const t of ["All on", "全开", "Visuals only", "仅画面", "All on", "全开"]) await click(t);
  await page.screenshot({ path: `out/${name}_panel.png` });
  for (const t of ["Galaxy", "星系", "Neon wave", "霓虹声波", "9:16", "16:9", "1:1", "Neuron", "神经元"]) { await click(t); await new Promise((r) => setTimeout(r, 250)); if (["Galaxy","星系","Neon wave","霓虹声波"].includes(t)) await page.screenshot({ path: `out/${name}_${t.replace(/\W/g, "") || "s"}.png` }); }
  await page.keyboard.press("Space"); await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowLeft");
  await click("Restart"); await click("从头播放"); await click("2x");
  await setRange(995); await click("Play"); await click("播放");
  await new Promise((r) => setTimeout(r, 2200)); // finale
  for (const sty of ["Galaxy", "Neon wave", "星系", "霓虹声波", "Neuron", "神经元"]) { await click(sty); await new Promise((r) => setTimeout(r, 150)); await setRange(500); await new Promise((r) => setTimeout(r, 150)); }
  // frame rate
  const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 > 1500) res(n / 1.5); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
  // Music: toggle on, every style, scrub / pause / speed, volume, off; then a deterministic offline render per style (no clipping, no NaN)
  let noAudioOk = true;
  const music = { volume: false, toggled: false, styles: 0, fpsMusic: 0, off: false, render: [] };
  music.toggled = await page.evaluate(() => { const b = document.querySelector('[data-music="toggle"]'); if (!b) return false; b.click(); return true; });
  await new Promise((r) => setTimeout(r, 200));
  if (name === "no_audio") noAudioOk = await page.evaluate(() => { const b = document.querySelector('[data-music="toggle"]'); return !!b && b.disabled && typeof AudioContext === "undefined"; });
  for (const nm of ["律动", "Pulse", "钢琴", "Piano", "古典", "Classical"]) { if (await click(nm)) music.styles++; await new Promise((r) => setTimeout(r, 120)); await click("Restart"); await click("从头播放"); await new Promise((r) => setTimeout(r, 500)); await setRange(300); await click("Play"); await click("播放"); await new Promise((r) => setTimeout(r, 300)); await click("4x"); await click("Pause"); await click("暂停"); await setRange(800); await new Promise((r) => setTimeout(r, 100)); }
  await page.evaluate(() => { const v = document.querySelector('[data-music="volume"]'); if (!v) return; const b = v.getBoundingClientRect(); v.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: b.left + b.width * 0.3, clientY: b.top + 5, pointerId: 1, buttons: 1 })); });
  await new Promise((r) => setTimeout(r, 150));
  music.volume = await page.evaluate(() => { const v = document.querySelector('[data-music="volume"]'); return !!v && document.querySelectorAll("input[type=range]").length === 1 && v.getAttribute("aria-valuenow") === "30"; });
  await click("Restart"); await click("从头播放"); await click("1x"); await new Promise((r) => setTimeout(r, 600));
  music.fpsMusic = Math.round(await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 > 1500) res(n / 1.5); else requestAnimationFrame(f); }; requestAnimationFrame(f); })));
  music.off = await page.evaluate(() => { const b = document.querySelector('[data-music="toggle"]'); if (!b) return false; b.click(); return true; });
  await new Promise((r) => setTimeout(r, 200));
  for (const sty of [1, 2, 3]) {
    const rr = await page.evaluate(async (sty) => {
      const { MusicEngine, DAY } = window.__ME;
      const sr = 22050, speed = 4, frames = 225;
      const ctx = new OfflineAudioContext(2, sr * 9, sr);
      const eng = new MusicEngine(ctx); eng.setStyle(sty);
      let prev = 0;
      for (let k = 0; k < frames; k++) { const cur = Math.min(DAY, (k + 1) * speed * DAY / 900); eng.frame(k / 30, prev, cur, true, speed, 1000 / 30, true); prev = cur; }
      // a scrub (jump) and a paused stretch must stay silent apart from decay
      eng.frame(7.6, prev, DAY * 0.2, true, speed, 33, true); eng.frame(7.7, DAY * 0.2, DAY * 0.2, false, speed, 33, true);
      const b = await ctx.startRendering();
      let peak = 0, bad = 0, e = 0;
      for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = d[i]; if (!Number.isFinite(v)) bad++; else { if (Math.abs(v) > peak) peak = Math.abs(v); e += v * v; } } }
      return { peak: +peak.toFixed(3), bad, rms: +Math.sqrt(e / (2 * b.length)).toFixed(3) };
    }, sty);
    music.render.push(rr);
    if (rr.bad > 0 || rr.peak > 0.999) music.clip = true;
  }
  // avatar pixel check (stage 1:1 neuron): center top of dial
  const avatarOk = await page.evaluate(() => { const c = document.querySelector("canvas"); if (!c) return null; const x = c.getContext("2d"); const w = c.width, h = c.height; const d = x.getImageData(w * 0.5 - 20, h * 0.5 - 60, 40, 40).data; const set = new Set(); for (let i = 0; i < d.length; i += 4) set.add(d[i] + "," + d[i + 1] + "," + d[i + 2]); return set.size; });
  const bodyTxt = await page.evaluate(() => document.body.innerText);
  const res = { name, errors: errs.length ? errs.slice(0, 4) : "none", net: net.length, hasRange, tip, fps: Math.round(fps), music, uniqCols: avatarOk, links: pinnedLinks.slice(0, 2), hasNaN: /NaN|undefined|Infinity|\[object/.test(bodyTxt) };
  if (errs.length || net.length || res.hasNaN || music.clip || !noAudioOk || (hasRange && name !== "no_audio" && (!music.toggled || !music.volume || music.styles < 3))) fails++;
  console.log(JSON.stringify(res));
  if (name === "example" || name === "zero_posts" || name === "firstrun") fs.writeFileSync(`out/${name}.txt`, bodyTxt);
  await page.close();
}
await browser.close();
console.log("FAIL scenarios:", fails);
if (fails) process.exit(1);
