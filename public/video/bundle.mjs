// node bundle.mjs <page.tsx> <workdir>
// Bundles the finished page file (public/out/page_<TAG>.tsx) with the grok/canvas stub into <workdir>/index.html + bundle.js.
import esbuild from "esbuild";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const here = path.dirname(fileURLToPath(import.meta.url));
const [page, work] = [path.resolve(process.argv[2] || ""), path.resolve(process.argv[3] || "")];
if (!fs.existsSync(page)) { console.error("page file not found: " + page); process.exit(2); }
fs.mkdirSync(path.join(work, "src"), { recursive: true });
fs.copyFileSync(page, path.join(work, "src/replay.tsx"));
fs.writeFileSync(path.join(work, "src/h.tsx"), 'import * as React from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./replay";\ncreateRoot(document.getElementById("root") as HTMLElement).render(React.createElement(App));\n');
await esbuild.build({ entryPoints: [path.join(work, "src/h.tsx")], bundle: true, outfile: path.join(work, "bundle.js"), alias: { "grok/canvas": path.join(here, "stub/grok-canvas.tsx") }, nodePaths: [path.join(here, "node_modules")], define: { "process.env.NODE_ENV": '"production"' }, logLevel: "error", jsx: "automatic", target: "es2020" });
fs.writeFileSync(path.join(work, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><style>*{transition:none!important;animation:none!important}html,body{margin:0;background:#0b0f19;font-family:"Noto Sans SC",sans-serif;overflow:hidden}</style></head><body><div id="root"></div><script src="bundle.js"></script></body></html>');
console.log("bundled", path.join(work, "index.html"));
