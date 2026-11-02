// X Pulse minifier: removes comments and indentation, joins lines where that is provably safe, and keeps EVERY identifier, type and string
// exactly as written. The DATA markers survive. Self-check: the token stream of the output must equal the token stream of the input
// (JSX text compared after JSX whitespace normalisation), and the output must parse without syntax errors.
// Usage: node minify.mjs <in.tsx> <out.tsx>
import ts from "typescript";
import fs from "node:fs";

const BEGIN = "// ===== BEGIN DATA =====";
const END = "// ===== END DATA =====";
const K = ts.SyntaxKind;

function parse(text) {
  return ts.createSourceFile("x.tsx", text, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);
}

function leaves(sf) {
  const out = [];
  const walk = (n) => {
    if (n.kind >= K.FirstJSDocNode && n.kind <= K.LastJSDocNode) return;
    const ch = n.getChildren(sf);
    if (ch.length === 0) {
      if (n.kind !== K.EndOfFileToken) out.push(n);
      return;
    }
    ch.forEach(walk);
  };
  walk(sf);
  return out;
}

function jsxNorm(text) {
  const lines = text.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  lines.forEach((l, i) => {
    if (/[^ \t]/.test(l)) lastNonEmpty = i;
  });
  let str = "";
  lines.forEach((line, i) => {
    let t = line.replace(/\t/g, " ");
    if (i !== 0) t = t.replace(/^ +/, "");
    if (i !== lines.length - 1) t = t.replace(/ +$/, "");
    if (t !== "") {
      if (i !== lastNonEmpty) t += " ";
      str += t;
    }
  });
  return str;
}

const idc = (c) => /[A-Za-z0-9_$\\\u0080-\uffff]/.test(c);
const opc = (c) => "+-*/%<>=!&|^~?:.".includes(c);
const DROP_AFTER = new Set([";", "{", ",", "(", "[", "=>", "?", ":", "=", "&&", "||", "??", "+=", "-=", "*=", "/=", "%=", "|=", "&=", "^=", "||=", "&&=", "??="]);
const DROP_BEFORE = new Set([")", "]", "}", ",", ";"]);

function tokText(sf, n) {
  const start = n.kind === K.JsxText ? n.pos : n.getStart(sf, false);
  const txt = sf.text.slice(start, n.end);
  return { start, txt };
}

function minSegment(text) {
  const sf = parse(text);
  const ls = leaves(sf);
  let out = "";
  let prev = null;
  let prevEnd = 0;
  for (const n of ls) {
    const { start, txt } = tokText(sf, n);
    let piece = txt;
    if (n.kind === K.JsxText) {
      piece = /[^ \t\r\n]/.test(txt) ? jsxNorm(txt) : /[\r\n]/.test(txt) ? "" : txt;
    }
    const trivia = text.slice(prevEnd, start);
    if (prev !== null && trivia !== "" && piece !== "") {
      const a = prev.piece;
      const lc = a[a.length - 1];
      const fc = piece[0];
      let space =
        (idc(lc) && idc(fc)) ||
        (opc(lc) && opc(fc)) ||
        (prev.kind === K.StringLiteral && idc(fc)) ||
        (prev.kind === K.NumericLiteral && /^[0-9]+$/.test(a) && fc === ".") ||
        (n.parent && (n.parent.kind === K.JsxAttribute || n.parent.kind === K.JsxSpreadAttribute) && n.parent.getFirstToken(sf) === n);
      const nl = /[\r\n]/.test(trivia);
      if (nl && !space && !(DROP_AFTER.has(a) || DROP_BEFORE.has(piece)) ) out += "\n";
      else if (space) out += nl && !(DROP_AFTER.has(a) || DROP_BEFORE.has(piece)) ? "\n" : " ";
    }
    out += piece;
    prev = { piece: piece === "" ? (prev ? prev.piece : "") : piece, kind: piece === "" && prev ? prev.kind : n.kind };
    prevEnd = n.end;
  }
  return out;
}

function sig(text) {
  const sf = parse(text);
  return leaves(sf).map((n) => (n.kind === K.JsxText ? "JSX:" + jsxNorm(tokText(sf, n).txt) : tokText(sf, n).txt)).filter((s) => s !== "JSX:");
}

function check(a, b, label) {
  const sf = parse(b);
  const diags = sf.parseDiagnostics || [];
  if (diags.length) throw new Error(label + ": syntax errors in output: " + diags.slice(0, 3).map((d) => d.messageText).join("; "));
  const sa = sig(a);
  const sb = sig(b);
  if (sa.length !== sb.length) throw new Error(label + ": token count " + sa.length + " != " + sb.length);
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) throw new Error(label + ": token " + i + " differs: " + JSON.stringify(sa[i]) + " vs " + JSON.stringify(sb[i]));
}

const [inp, outp] = process.argv.slice(2);
const src = fs.readFileSync(inp, "utf8");
const bi = src.indexOf(BEGIN);
const ei = src.indexOf(END);
if (bi < 0 || ei < bi) throw new Error("DATA markers not found");
const head = src.slice(0, bi);
const data = src.slice(bi + BEGIN.length, ei);
const tail = src.slice(ei + END.length);
// keep the leading comment lines of the DATA block (the "example data" warning) verbatim
const dm = data.match(/^(\s*\/\/[^\n]*\n)*/);
const dataComments = dm ? dm[0] : "";
const dataCode = data.slice(dataComments.length);
const parts = [
  [head, "head"],
  [dataCode, "data"],
  [tail, "tail"],
].map(([t, l]) => {
  const m = minSegment(t);
  check(t, m, l);
  return m;
});
const ver = (src.match(/Renderer version (\d+\.\d+\.\d+)/) || [])[1] || "unknown";
const outText = "// X Pulse renderer " + ver + " (minified: comments and indentation removed, nothing renamed; readable source: github.com/topmindspace/x-pulse-bot, renderer/x-pulse-replay.tsx)\n" + parts[0] + "\n" + BEGIN + "\n" + dataComments.replace(/^\s+/gm, "") + parts[1] + "\n" + END + "\n" + parts[2] + "\n";
fs.writeFileSync(outp, outText);
console.log(JSON.stringify({ in: src.length, out: outText.length, ratio: +(outText.length / src.length).toFixed(3) }));
