#!/bin/bash
# assemble.sh <workdir> <out_dir> <file prefix> <mode...(wide square)>
# <workdir>/<mode>/*.jpg + <workdir>/au.pcm -> <out_dir>/<prefix>_{16x9,1x1}.mp4 (h264 + aac 192k, loudness -16 LUFS)
set -e
W="$1"; OUTD="$2"; PFX="$3"; shift 3; mkdir -p "$OUTD"
LN="loudnorm=I=-16:TP=-1.5:LRA=11"
ffmpeg -v error -y -f s16le -ar 44100 -ac 2 -i "$W/au.pcm" "$W/au_raw.wav"
M=$(ffmpeg -v info -i "$W/au_raw.wav" -af "$LN:print_format=json" -f null - 2>&1 | awk '/^{/,/^}/')
g() { echo "$M" | grep "\"$1\"" | sed 's/.*: "\(.*\)".*/\1/'; }
ffmpeg -v error -y -i "$W/au_raw.wav" -af "$LN:measured_I=$(g input_i):measured_TP=$(g input_tp):measured_LRA=$(g input_lra):measured_thresh=$(g input_thresh):offset=$(g target_offset):linear=true,alimiter=limit=0.89:level=false" -ar 44100 "$W/au_norm.wav"
for m in "$@"; do
  n=$([ "$m" = wide ] && echo 16x9 || echo 1x1); F=$(ls "$W/$m"/*.jpg | wc -l); D=$(awk "BEGIN{print $F/30}")
  ffmpeg -v error -y -framerate 30 -i "$W/$m/%05d.jpg" -i "$W/au_norm.wav" \
    -vf "fade=t=in:st=0:d=0.3,fade=t=out:st=$(awk "BEGIN{print $D-0.6}"):d=0.6,format=yuv420p" \
    -af "afade=t=in:st=0:d=0.4,afade=t=out:st=$(awk "BEGIN{print $D-1.5}"):d=1.5" \
    -c:v libx264 -preset slow -crf 17 -r 30 -colorspace bt709 -color_primaries bt709 -color_trc bt709 -c:a aac -b:a 192k -t "$D" -movflags +faststart "$OUTD/${PFX}_${n}.mp4"
  echo "== ${PFX}_${n}.mp4"; ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,r_frame_rate,duration -of csv=p=0 "$OUTD/${PFX}_${n}.mp4"
done
