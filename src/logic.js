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

// 화면이 꺼진 동안에도 끊기지 않도록 항상 <audio> 하나로만 재생한다.
// 자장가+백색소음은 미리 섞어 둔 *-mix 파일을 한 번 재생하고,
// 끝나면 같은 요소에서 noise로 넘어가 계속 반복한다.
export function planPlayback({ sound, withNoise }) {
  if (!SOUNDS.includes(sound)) throw new Error(`unknown sound: ${sound}`);
  if (sound === 'noise') return { first: 'noise', loopFirst: true, then: null };
  if (withNoise) return { first: `${sound}-mix`, loopFirst: false, then: 'noise' };
  return { first: sound, loopFirst: true, then: null };
}

export function requiredTracks(plan) {
  return plan.then ? [plan.first, plan.then] : [plan.first];
}

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
