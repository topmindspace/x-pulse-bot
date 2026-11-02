// Render a finished page file (output of tools/fill_data.py) headlessly, fail on errors / NaN / undefined text, and save screenshots.
//   node page.mjs <page.tsx> [outdir] [lang]
import fs from "fs";
import path from "path";
import esbuild from "esbuild";
import puppeteer from "puppeteer-core";

const page_ = path.resolve(process.argv[2] || "");
const outDir = path.resolve(process.argv[3] || "out/page");
const lang = process.argv[4] || null;
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync("src", { recursive: true });
fs.copyFileSync(page_, "src/replay.pg.tsx");
fs.writeFileSync("src/h.pg.tsx", fs.readFileSync("harness.tsx", "utf8").replace('"./replay"', '"./replay.pg"'));
await esbuild.build({ entryPoints: ["src/h.pg.tsx"], bundle: true, outfile: path.join(outDir, "b.js"), alias: { "grok/canvas": path.resolve("stub/grok-canvas.tsx") }, define: { "process.env.NODE_ENV": '"production"' }, jsx: "automatic", loader: { ".tsx": "tsx" } });
fs.writeFileSync(path.join(outDir, "i.html"), '<!doctype html><html><body style="margin:0;background:#0b0f19"><div id="root"></div><script src="b.js"></script></body></html>');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const p = await browser.newPage();
await p.setViewport({ width: 1200, height: 1100 });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => { if (["error", "warning"].includes(m.type())) errs.push(m.text()); });
await p.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
await p.goto("file://" + path.join(outDir, "i.html"));
await wait(800);
if (lang) await p.evaluate((l) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === (l === "zh" ? "中文" : "EN")); if (b) b.click(); }, lang);
const setRange = (v) => p.evaluate((v) => { const el = document.querySelector("input[type=range]"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, String(v)); el.dispatchEvent(new Event("input", { bubbles: true })); }, v);
for (const [name, pos] of [["start", 40], ["mid", 500], ["end", 1000]]) {
  await setRange(pos); await wait(1500);
  await p.screenshot({ path: path.join(outDir, name + ".png"), fullPage: true });
}
const text = await p.evaluate(() => document.body.innerText);
if (/NaN|undefined|\[object/.test(text)) { fails++; console.log("FAIL: bad text in page"); }
if (errs.length) { fails++; console.log("FAIL: errors", errs.slice(0, 3)); }
console.log(fails ? "PAGE CHECK FAILED" : "PAGE CHECK OK", text.split("\n").slice(0, 6).join(" | "));
await browser.close();
process.exit(fails ? 1 : 0);
