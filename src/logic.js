// 재생 계획·타이머·파일 매칭. DOM에 의존하지 않아 node --test로 검증한다.

export const TRACKS = {
  noise: { title: '쉬~ 빗소리', file: 'noise.m4a' },
  brahms: { title: '브람스 오르골', file: 'brahms.m4a' },
  bebefinn: { title: '베베핀 자장가', file: 'bebefinn.m4a' },
  'brahms-mix': { title: '브람스 오르골 + 빗소리', file: 'brahms-mix.m4a' },
  'bebefinn-mix': { title: '베베핀 자장가 + 빗소리', file: 'bebefinn-mix.m4a' },
};

export const TRACK_IDS = Object.keys(TRACKS);

export const SOUNDS = ['noise', 'brahms', 'bebefinn'];

export const TIMER_CHOICES = [0, 15, 30, 60, 90]; // 0 = 계속

// 타이머가 있을 때, 믹스가 끝난 시점에 이만큼 이상 남았으면 자장가를 다시 튼다.
export const REPEAT_MIN_LEFT_MS = 10 * 60_000;

// 화면이 꺼진 동안에도 끊기지 않도록 항상 <audio> 하나로만 재생한다.
// 자장가+백색소음은 미리 섞어 둔 *-mix 파일을 재생하고,
// 끝나면 같은 요소에서 noise로 넘어가 계속 반복한다. (타이머가 넉넉하면 믹스를 먼저 다시 튼다: nextAfterFirst)
export function planPlayback({ sound, withNoise }) {
  if (!SOUNDS.includes(sound)) throw new Error(`unknown sound: ${sound}`);
  if (sound === 'noise') return { first: 'noise', loopFirst: true, then: null };
  if (withNoise) return { first: `${sound}-mix`, loopFirst: false, then: 'noise' };
  return { first: sound, loopFirst: true, then: null };
}

export function requiredTracks(plan) {
  return plan.then ? [plan.first, plan.then] : [plan.first];
}

// 첫 트랙(자장가+빗소리 믹스)이 끝났을 때 다음 동작.
// 'repeat': 같은 믹스를 다시 튼다 — 타이머가 REPEAT_MIN_LEFT_MS 이상 남았을 때.
// 'then': plan.then(noise)로 넘어간다 — 타이머가 없거나 조금 남았을 때. 빗소리가 이어져 음량이 튀지 않는다.
// 'stop': 이어질 곡이 없다.
export function nextAfterFirst(plan, { now, endsAt }) {
  if (!plan.then) return 'stop';
  if (endsAt && endsAt - now >= REPEAT_MIN_LEFT_MS) return 'repeat';
  return 'then';
}

// 잠금 테스트: 첫 곡을 끝 20초 전부터 튼다. 타이머를 REPEAT_MIN_LEFT_MS + 30초로 잡아
// 20초 뒤 첫 끝에서는 다시 틀고('repeat'), 40초 뒤 두 번째 끝에서는 다음 곡으로 넘어간다('then').
export const LOCK_TEST = { seekToEnd: 20, timerMin: (REPEAT_MIN_LEFT_MS + 30_000) / 60_000 };

// 사용자가 고른 파일 이름으로 트랙을 찾는다. "brahms-mix (1).m4a" 같은 이름도 허용.
export function trackIdFromFilename(name) {
  const base = name.toLowerCase().replace(/\.[a-z0-9]+$/, '');
  const byLength = [...TRACK_IDS].sort((a, b) => b.length - a.length);
  return byLength.find((id) => base === id || base.startsWith(`${id} `) || base.startsWith(`${id}(`)) ?? null;
}

// 타이머 종료 전 fadeMs 동안 선형으로 줄어드는 볼륨 배율.
export function timerState(now, endsAt, fadeMs) {
  if (!endsAt) return { done: false, gain: 1 };
  const left = endsAt - now;
  if (left <= 0) return { done: true, gain: 0 };
  if (left >= fadeMs) return { done: false, gain: 1 };
  return { done: false, gain: left / fadeMs };
}

// 타이머가 짧으면 페이드도 짧게: 최대 2분, 타이머 길이의 1/5까지.
export function fadeDurationMs(timerMinutes) {
  return Math.min(120_000, (timerMinutes * 60_000) / 5);
}

export function formatRemaining(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

const DEFAULT_SETTINGS = { sound: 'noise', withNoise: true, timerMin: 0 };

export function parseSettings(raw) {
  let parsed = {};
  try {
    parsed = JSON.parse(raw ?? '{}') ?? {};
  } catch {
    parsed = {};
  }
  return {
    sound: SOUNDS.includes(parsed.sound) ? parsed.sound : DEFAULT_SETTINGS.sound,
    withNoise: typeof parsed.withNoise === 'boolean' ? parsed.withNoise : DEFAULT_SETTINGS.withNoise,
    timerMin: TIMER_CHOICES.includes(parsed.timerMin) ? parsed.timerMin : DEFAULT_SETTINGS.timerMin,
  };
}
