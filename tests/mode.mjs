// Edition tests (renderer 3.2.0): DATA.mode default / personal / public / invalid, corner title strings in both languages,
// old data without mode, and the rule that the public visual areas never contain "估" or "estimate".
//   node mode.mjs [renderer.tsx]
import fs from "fs";
import path from "path";
import esbuild from "esbuild";
import puppeteer from "puppeteer-core";

const SRC = process.argv[2] || "../renderer/x-pulse-replay.tsx";
const base = fs.readFileSync(SRC, "utf8");
const A = "// ===== BEGIN DATA =====", B = "// ===== END DATA =====";
const ai = base.indexOf(A), bi = base.indexOf(B);
fs.mkdirSync("out", { recursive: true });
fs.mkdirSync("src", { recursive: true });
let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log("FAIL:", msg); } else console.log("ok:", msg); };
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
let n = 0;
async function load(data) {
  const id = "m" + n++;
  fs.writeFileSync("src/replay." + id + ".tsx", base.slice(0, ai + A.length) + "\nconst DATA: Data = " + JSON.stringify(data) + ";\n" + base.slice(bi));
  fs.writeFileSync("src/h." + id + ".tsx", fs.readFileSync("harness.tsx", "utf8").replace('"./replay"', '"./replay.' + id + '"'));
  await esbuild.build({ entryPoints: ["src/h." + id + ".tsx"], bundle: true, outfile: "out/b." + id + ".js", alias: { "grok/canvas": path.resolve("stub/grok-canvas.tsx") }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "error", jsx: "automatic", loader: { ".tsx": "tsx" } });
  fs.writeFileSync("out/i." + id + ".html", '<!doctype html><html><body style="margin:0;background:#0b0f19"><div id="root"></div><script src="b.' + id + '.js"></script></body></html>');
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 1200 });
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
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
const first = async (p) => (await body(p)).split("\n")[0].trim();
const day = (date) => ({ date, posts: [[3600, 0, 10, 1, 0, 0, 0, null, "x"]], followers: { current: 5, delta: null, baselineAt: null, firstRun: true }, status: null });
const personal = (o = {}) => ({
  lang: "en", example: false, account: { name: "Test Name", username: "test_user" }, avatar: null, tz: { iana: "Asia/Shanghai" },
  days: [day("2026-11-01")], footnotes: { metricsFetchedAt: "2026-11-02T09:00:00+08:00", retweetsExcluded: 0, extra: [] }, ...o,
});
const pub = (o = {}) => ({ mode: "public", lang: "en", example: false, topic: { name: "AI agents" }, ...o });
const toggleLang = async (p) => { await p.keyboard.press("l"); await wait(300); };

// 1. personal titles: no mode (old data), mode "personal", one day / many days / older day, en + zh
for (const [label, mk] of [["no mode field", (o) => personal(o)], ["mode personal", (o) => personal({ mode: "personal", ...o })]]) {
  let p = await load(mk({}));
  check((await first(p)) === "X Pulse · Personal · @test_user · Yesterday's replay", label + " en title: " + (await first(p)));
  await toggleLang(p);
  check((await first(p)) === "X Pulse · Personal · @test_user · 昨日回放", label + " zh title: " + (await first(p)));
  check(p.errs.length === 0, label + " no console errors " + JSON.stringify(p.errs.slice(0, 2)));
  await p.close();
}
{
  let p = await load(personal({ days: [day("2026-10-30"), day("2026-10-31"), day("2026-11-01")] }));
  check((await first(p)) === "X Pulse · Personal · @test_user · Daily replay", "multi-day en title");
  await toggleLang(p);
  check((await first(p)) === "X Pulse · Personal · @test_user · 每日回放", "multi-day zh title");
  await p.close();
  p = await load(personal({ days: [day("2026-10-30")] }));
  check((await first(p)) === "X Pulse · Personal · @test_user · Replay of 2026-10-30", "older-day en title");
  await toggleLang(p);
  check((await first(p)) === "X Pulse · Personal · @test_user · 2026-10-30 回放", "older-day zh title");
  await p.close();
  p = await load(personal({ account: { name: "No Handle", username: "" } }));
  check((await first(p)) === "X Pulse · Personal · Yesterday's replay", "empty handle is skipped in the title");
  await p.close();
}
// 2. public: reserved shape validates, placeholder, title, no crash, no "估" / "estimate" in the visible areas
{
  let p = await load(pub());
  check((await first(p)) === "X Pulse · Public · AI agents", "public en title: " + (await first(p)));
  await toggleLang(p);
  check((await first(p)) === "X Pulse · Public · AI agents", "public zh title is the same string");
  let t = await body(p);
  check(p.errs.length === 0, "public: no console errors " + JSON.stringify(p.errs.slice(0, 2)));
  check(!/估|estimat/i.test(t), "public placeholder (zh) has no 估 / estimate");
  await toggleLang(p);
  t = await body(p);
  check(!/估|estimat/i.test(t), "public placeholder (en) has no 估 / estimate");
  check(t.includes("reserved"), "public placeholder explains it is reserved");
  check((await p.evaluate(() => document.querySelectorAll("canvas").length)) === 0, "public placeholder draws no canvas");
  await p.close();
  // estimate caveat appears only in the footnote text (DATA.footnotes.extra)
  p = await load(pub({ lang: "zh", footnotes: { extra: [{ en: "Numbers are estimated.", zh: "数字为估算口径。" }] } }));
  t = await body(p);
  check(t.includes("数字为估算口径。"), "public footnote caveat shown (zh)");
  check(t.split("\n").slice(0, 3).join(" ").indexOf("估") < 0, "public title / subtitle area has no 估");
  await p.close();
  // reserved shape may carry extra fields and no account / tz / days / footnotes at all
  p = await load(pub({ topic: { name: "  Topic  ", window: "24h" }, whatever: [1, 2, 3] }));
  check((await first(p)) === "X Pulse · Public · Topic", "public: extra fields ignored, topic trimmed");
  await p.close();
}
// 3. invalid
{
  let p = await load(pub({ topic: undefined }));
  check((await body(p)).includes("DATA.topic.name is required"), "public without topic.name -> message");
  await p.close();
  p = await load(pub({ topic: { name: "  " } }));
  check((await body(p)).includes("DATA.topic.name is required"), "public with blank topic.name -> message");
  await p.close();
  p = await load(personal({ mode: "private" }));
  check((await body(p)).includes("DATA.mode must be"), "unknown mode -> message");
  await p.close();
  p = await load(personal({ account: undefined }));
  check((await body(p)).includes("DATA.account is missing"), "personal without account -> message");
  await p.close();
  p = await load(personal({ mode: " Public ", topic: { name: "T" } }));
  check((await first(p)) === "X Pulse · Public · T", "mode is case / space tolerant");
  await p.close();
}
await browser.close();
console.log(fails ? "MODE TESTS FAILED: " + fails : "MODE TESTS OK");
if (fails) process.exit(1);
