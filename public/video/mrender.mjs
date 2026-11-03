// Offline deterministic render of the generative music for a recorded timeline.
import fs from "fs";
import { open } from "./lib.mjs";
export async function renderAudio(work, tl, outPcm, sr = 44100, extraSec = 2.5) {
  const { browser, page } = await open(work, 800, 600, { layout: "wide", fw: 800 });
  await page.waitForFunction(() => !!window.__XPULSE_ME, { timeout: 15000 });
  const total = tl.length / 30 + extraSec;
  const res = await page.evaluate(async (tl, sr, total) => {
    const { MusicEngine } = window.__XPULSE_ME;
    const ctx = new OfflineAudioContext(2, Math.ceil(total * sr), sr);
    const eng = new MusicEngine(ctx);
    let prev = tl[0].cur;
    for (let k = 0; k < tl.length; k++) { const f = tl[k]; eng.setStyle(f.music); eng.frame(k / 30, prev, f.cur, f.play, f.speed, 1000 / 30, f.follow); prev = f.cur; }
    const buf = await ctx.startRendering();
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    const out = new Int16Array(L.length * 2); let peak = 0; let ss = 0;
    for (let i = 0; i < L.length; i++) { const a = Math.max(-1, Math.min(1, L[i])), b = Math.max(-1, Math.min(1, R[i])); peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); ss += L[i] * L[i]; out[2 * i] = a * 32767; out[2 * i + 1] = b * 32767; }
    const u8 = new Uint8Array(out.buffer); let s = ""; const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return { b64: btoa(s), peak, rms: Math.sqrt(ss / L.length), n: L.length };
  }, tl, sr, total);
  fs.writeFileSync(outPcm, Buffer.from(res.b64, "base64"));
  await browser.close();
  return { peak: res.peak, rms: res.rms, sec: res.n / sr };
}
