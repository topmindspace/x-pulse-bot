// node audio.mjs <workdir> <recorder log, e.g. wide_log.json> <output pcm>
import fs from "fs";
import path from "path";
import { renderAudio } from "./mrender.mjs";
const DAY = 86400;
const work = path.resolve(process.argv[2]);
const L = JSON.parse(fs.readFileSync(path.resolve(work, process.argv[3])));
// the frame that was drawn with play=true starts one frame after the state reads play=true
const tl = L.map((m, k) => ({ cur: m.p * DAY, play: k > 0 ? L[k - 1].play : m.play, speed: m.speed, music: m.music, follow: m.follow }));
const r = await renderAudio(work, tl, path.resolve(work, process.argv[4]), 44100, 2.5);
console.log("audio", JSON.stringify({ frames: tl.length, ...r }));
