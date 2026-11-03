// node rec.mjs <wide|square> <workdir> [--lang zh|en] [--speed 1|2|4] [--max N]
// Records JPEG frames at 30 fps from the finished page with the renderer's own panels (no overlay): <workdir>/<mode>/%05d.jpg + <workdir>/<mode>_log.json.
// Exit 3 when the visual areas contain 估 / "est" wording or the page reported an error.
import fs from "fs";
import path from "path";
import { open, step } from "./lib.mjs";
const argv = process.argv.slice(2);
const MODE = argv[0] === "square" ? "square" : "wide";
const WORK = path.resolve(argv[1] || "out");
const opt = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const LANG = opt("lang", "zh") === "en" ? "en" : "zh";
const SPEED = +opt("speed", "1");
const MAXF = +opt("max", 1e9);
const [W, H] = MODE === "wide" ? [1920, 1080] : [1080, 1080];
const OUT = path.join(WORK, MODE);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const { browser, page, errs } = await open(WORK, W, H, { layout: MODE, fw: W });
await page.waitForFunction(() => !!window.__XPULSE_API, { timeout: 15000 });
const api = (o) => page.evaluate((o) => window.__XPULSE_API.set(o), o);
await api({ play: false, music: 1, speed: SPEED, lang: LANG, p: 0 });
await step(page); await step(page);
const LOG = [];
let frame = 0;
const shot = async () => {
  await step(page);
  LOG.push(await page.evaluate(() => window.__XPULSE_API.state()));
  await page.screenshot({ path: `${OUT}/${String(frame++).padStart(5, "0")}.jpg`, type: "jpeg", quality: 92 });
};
for (let i = 0; i < 15 && frame < MAXF; i++) await shot();
await api({ play: true });
const N = Math.ceil((30 * 30) / SPEED) + 5 + 80 + 40;
for (let i = 0; i < N && frame < MAXF; i++) await shot();
// the end state must be the finished board: ask the page for the text it drew and the visible DOM text outside the caveat spans
const chk = await page.evaluate(() => {
  const stage = document.querySelector("[data-xp-stage]");
  let dom = "";
  if (stage) { const c = stage.cloneNode(true); c.querySelectorAll("[data-xp-caveat]").forEach((n) => n.remove()); dom = c.textContent || ""; }
  return { canvas: [...window.__XP_TEXTS], dom, hasStage: !!stage };
});
const bad = (t) => /估|estimat|\best\b|\best\./i.test(t);
const badTexts = chk.canvas.filter(bad).concat(bad(chk.dom) ? ["DOM: " + chk.dom.slice(0, 200)] : []);
fs.writeFileSync(path.join(WORK, `${MODE}_log.json`), JSON.stringify(LOG));
console.log("frames", frame, "sec", (frame / 30).toFixed(1), "canvasStrings", chk.canvas.length, "errs", JSON.stringify(errs));
await browser.close();
if (!chk.hasStage || badTexts.length || errs.length) { console.error("FAIL", JSON.stringify({ hasStage: chk.hasStage, badTexts, errs })); process.exit(3); }
