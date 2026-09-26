#!/usr/bin/env bash
# 원본 mp3(유튜브 다운로드)를 앱용 m4a로 가공한다. 원본은 읽기만 한다.
#
#   noise.m4a          쉬~+빗소리, 10분짜리 이음새 없는 반복 구간
#   brahms.m4a         브람스 오르골 전체
#   bebefinn.m4a       베베핀 자장가 전체
#   brahms-mix.m4a     오르골 + 백색소음(-10dB). 끝나면 60초 동안 백색소음이 원래 크기로 올라감
#   bebefinn-mix.m4a   베베핀 + 백색소음, 같은 방식
#
# 모든 트랙은 -24 LUFS로 맞춘다. *-mix 파일의 마지막 소리 크기는 noise.m4a와 같아서
# 앱이 mix → noise로 넘어갈 때 음량이 튀지 않는다.
set -euo pipefail

SRC_DIR="${SRC_DIR:-/Users/hj/Music/소리담/다운로드}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/audio"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

LOOP_START=1800   # 백색소음에서 잘라낼 시작 지점(초)
LOOP_LEN=600      # 반복 구간 길이(초)
XFADE=10          # 이음새 크로스페이드(초)
NOISE_UNDER_DB=-10
RAMP=60           # 자장가 끝난 뒤 백색소음이 원래 크기로 올라가는 시간(초)
TARGET_I=-24
TARGET_TP=-3
TARGET_LRA=11

if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q aac_at; then AAC=aac_at; else AAC=aac; fi

find_src() {
  local matches=("$SRC_DIR"/*"$1"*.mp3)
  [[ -f "${matches[0]}" ]] || { echo "원본을 찾을 수 없음: *$1*.mp3 in $SRC_DIR" >&2; exit 1; }
  printf '%s' "${matches[0]}"
}

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

# loudnorm 2-pass: 측정 → 측정값으로 선형 보정. 결과는 44.1kHz 16bit wav.
normalize() {
  local in="$1" out="$2" json
  json="$(ffmpeg -hide_banner -nostats -i "$in" \
    -af "loudnorm=I=$TARGET_I:TP=$TARGET_TP:LRA=$TARGET_LRA:print_format=json" \
    -f null - 2>&1 | sed -n '/^{/,/^}/p')"
  local args
  args="$(python3 -c '
import json, sys
m = json.loads(sys.stdin.read())
print("measured_I={input_i}:measured_TP={input_tp}:measured_LRA={input_lra}:measured_thresh={input_thresh}:offset={target_offset}".format(**m))
' <<<"$json")"
  ffmpeg -hide_banner -nostats -loglevel error -y -i "$in" \
    -af "loudnorm=I=$TARGET_I:TP=$TARGET_TP:LRA=$TARGET_LRA:$args:linear=true,aresample=44100" \
    -c:a pcm_s16le "$out"
}

encode() {
  local in="$1" out="$2" bitrate="$3"
  ffmpeg -hide_banner -nostats -loglevel error -y -i "$in" -vn -map_metadata -1 \
    -c:a "$AAC" -b:a "$bitrate" -ar 44100 -ac 2 -movflags +faststart "$out"
}

duration() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }

mkdir -p "$OUT"
NOISE_SRC="$(find_src -X_rCJFIx38)"
BEBEFINN_SRC="$(find_src 0Zh1RUzfw4o)"
BRAHMS_SRC="$(find_src OzhsoSo-4dU)"

# 1) 백색소음 반복 구간.
# A = 원본[LOOP_START, LOOP_START+LOOP_LEN+XFADE]
# 결과 = (A[LEN:LEN+X] 페이드아웃 + A[0:X] 페이드인) + A[X:LEN]
# 결과의 끝(A[LEN-])은 다시 처음(A[LEN]으로 시작)으로 자연스럽게 이어진다.
log "백색소음 반복 구간 만드는 중"
ffmpeg -hide_banner -nostats -loglevel error -y -ss "$LOOP_START" -t $((LOOP_LEN + XFADE)) \
  -i "$NOISE_SRC" -c:a pcm_s16le "$WORK/noise-seg.wav"
ffmpeg -hide_banner -nostats -loglevel error -y -i "$WORK/noise-seg.wav" -filter_complex "
  [0]asplit=3[a][b][c];
  [a]atrim=0:$XFADE,asetpts=PTS-STARTPTS,afade=t=in:d=$XFADE:curve=qsin[head];
  [b]atrim=$LOOP_LEN:$((LOOP_LEN + XFADE)),asetpts=PTS-STARTPTS,afade=t=out:d=$XFADE:curve=qsin[tail];
  [head][tail]amix=inputs=2:normalize=0[x];
  [c]atrim=$XFADE:$LOOP_LEN,asetpts=PTS-STARTPTS[body];
  [x][body]concat=n=2:v=0:a=1[out]" -map "[out]" -c:a pcm_s16le "$WORK/noise-loop-raw.wav"
normalize "$WORK/noise-loop-raw.wav" "$WORK/noise.wav"
encode "$WORK/noise.wav" "$OUT/noise.m4a" 128k

# 2) 자장가 단독
for name in brahms bebefinn; do
  if [[ $name == brahms ]]; then src="$BRAHMS_SRC"; else src="$BEBEFINN_SRC"; fi
  log "$name 음량 맞추는 중"
  normalize "$src" "$WORK/$name.wav"
  encode "$WORK/$name.wav" "$OUT/$name.m4a" 96k
done

# 3) 자장가 + 백색소음 믹스. 자장가 길이 동안 백색소음은 -10dB,
#    자장가가 끝나면 RAMP초 동안 0dB까지 올린다.
under="$(python3 -c "print(10 ** ($NOISE_UNDER_DB / 20))")"
for name in brahms bebefinn; do
  log "$name + 백색소음 믹스 만드는 중"
  music_len="$(duration "$WORK/$name.wav")"
  total="$(python3 -c "print($music_len + $RAMP)")"
  ffmpeg -hide_banner -nostats -loglevel error -y \
    -i "$WORK/$name.wav" -stream_loop -1 -i "$WORK/noise.wav" -filter_complex "
    [1]atrim=0:$total,asetpts=PTS-STARTPTS,
       volume='if(lt(t,$music_len),$under,$under+(1-$under)*min((t-$music_len)/$RAMP,1))':eval=frame[bed];
    [0]apad=whole_dur=$total[music];
    [music][bed]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.89:level=false[out]" \
    -map "[out]" -c:a pcm_s16le "$WORK/$name-mix.wav"
  encode "$WORK/$name-mix.wav" "$OUT/$name-mix.m4a" 112k
done

log "완료"
ls -lh "$OUT"
