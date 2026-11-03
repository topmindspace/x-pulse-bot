#!/bin/bash
# X Pulse (Public): one command from the cache to the page file and the 16:9 + 1:1 videos.
#   bash make_public.sh --tag 2026-11-03T04 [--ver v1] [--lang zh|en] [--modes wide,square] [--outdir DIR] [--no-video]
# Prerequisite: the cache is filled (fetch_plan.py -> X calls -> ingest.py, see README.md). Exit codes: 2 cache/config, 3 self-check (e.g. estimate wording
# in a visual area), 4 gloss missing (translate cache/gloss.json, re-run), 5 environment (node / ffmpeg / chrome missing).
set -e
cd "$(dirname "$0")"
TAG=""; VER="v1"; LANG_="zh"; MODES="wide,square"; OUTDIR_=""; VIDEO=1
while [ $# -gt 0 ]; do case "$1" in
  --tag) TAG="$2"; shift 2;; --ver) VER="$2"; shift 2;; --lang) LANG_="$2"; shift 2;;
  --modes) MODES="$2"; shift 2;; --outdir) OUTDIR_="$2"; shift 2;; --no-video) VIDEO=0; shift;;
  *) echo "unknown option $1"; exit 1;; esac; done
[ -n "$TAG" ] || { echo "--tag required"; exit 1; }
python3 fill_public.py --tag "$TAG" | tail -n 5 || exit $?
python3 gloss.py --tag "$TAG" || { rc=$?; [ $rc -eq 4 ] && echo "translate the MISSING items into cache/gloss.json, then re-run" ; exit $rc; }
python3 fill_public.py --tag "$TAG" > out/fill_$TAG.log || exit $?
[ "$VIDEO" = 1 ] || { echo "page: out/page_$TAG.tsx"; exit 0; }
for c in node ffmpeg ffprobe /usr/bin/google-chrome; do command -v "$c" >/dev/null 2>&1 || [ -x "$c" ] || { echo "missing $c"; exit 5; }; done
if [ ! -d video/node_modules ]; then
  if [ -d ../tests/node_modules ]; then ln -sfn ../../tests/node_modules video/node_modules; else (cd video && npm install --no-audit --no-fund); fi
fi
W="$PWD/out/video_$TAG"; rm -rf "$W"; mkdir -p "$W"
node video/bundle.mjs "out/page_$TAG.tsx" "$W"
DATE=$(python3 - "$TAG" <<'PY'
import json, sys, datetime as d
t = sys.argv[1]; s = json.load(open('out/data_%s.json' % t)); z = s.get('tz', {}).get('iana', 'UTC')
try:
    from zoneinfo import ZoneInfo
    tz = ZoneInfo(z)
except Exception:
    tz = d.timezone.utc
e = d.datetime.strptime(s['window']['endISO'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=d.timezone.utc).astimezone(tz)
print(e.strftime('%Y-%m-%d'))
PY
)
TOPIC=$(python3 -c "import json,sys;print(json.load(open('out/data_$TAG.json'))['topic']['name'].replace('/','-').replace(' ','_'))")
OUTD="${OUTDIR_:-out/$DATE}"; PFX="X-Pulse-Public_${TOPIC}_${DATE}_${VER}"; IFS=, read -ra ML <<< "$MODES"
pids=(); for m in "${ML[@]}"; do node video/rec.mjs "$m" "$W" --lang "$LANG_" & pids+=($!); done
for p in "${pids[@]}"; do wait "$p" || { echo "recording failed (exit 3 = estimate wording or page error)"; exit 3; }; done
node video/audio.mjs "$W" "${ML[0]}_log.json" au.pcm
bash video/assemble.sh "$W" "$OUTD" "$PFX" "${ML[@]}"
cp "out/data_$TAG.json" "$OUTD/${PFX}_data.json"; cp "out/summary_$TAG.json" "$OUTD/${PFX}_summary.json"
ls -la "$OUTD/${PFX}"*
