// Shared helpers: a virtual clock (the page only advances when we call __step, so frames are deterministic) and a page opener.
import puppeteer from "puppeteer-core";
import path from "path";
export const VCLOCK = `(()=>{let t=1000;const q=[];let id=0;
performance.now=()=>t;
window.requestAnimationFrame=cb=>{q.push([++id,cb]);return id};
window.cancelAnimationFrame=i=>{const k=q.findIndex(x=>x[0]===i);if(k>=0)q.splice(k,1)};
window.__step=ms=>{t+=ms;const cur=q.splice(0);for(const [,cb] of cur)cb(t)};
})();`;
// Canvas text spy: records every string drawn with fillText / strokeText so the recorder can prove the visual areas carry no estimate wording.
export const SPY = `(()=>{window.__XP_TEXTS=new Set();for(const k of ["fillText","strokeText"]){const o=CanvasRenderingContext2D.prototype[k];CanvasRenderingContext2D.prototype[k]=function(t,...a){try{window.__XP_TEXTS.add(String(t))}catch(e){}return o.call(this,t,...a)}}})();`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// workdir: folder with index.html + bundle.js (bundle.mjs). rec: the window.__XPULSE_REC object that switches the renderer into recorder mode.
export async function open(workdir, vw, vh, rec, dsf = 1) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: "new", args: ["--no-sandbox", "--disable-gpu", "--font-render-hinting=none"] });
  const page = await browser.newPage();
  await page.setViewport({ width: vw, height: vh, deviceScaleFactor: dsf });
  await page.evaluateOnNewDocument(VCLOCK);
  await page.evaluateOnNewDocument(SPY);
  await page.evaluateOnNewDocument((rec) => { window.__XPULSE_REC = rec; try { localStorage.clear(); } catch (e) { /* ignore */ } }, rec);
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("request", (r) => { if (!r.url().startsWith("file://") && !r.url().startsWith("data:")) errs.push("NET " + r.url()); });
  await page.goto("file://" + path.resolve(workdir, "index.html"));
  await sleep(500);
  return { browser, page, errs };
}
export async function step(page, ms = 1000 / 30) {
  await page.evaluate((ms) => window.__step(ms), ms);
  await sleep(12);
}
