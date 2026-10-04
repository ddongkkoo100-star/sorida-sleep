import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planPlayback,
  requiredTracks,
  nextAfterFirst,
  REPEAT_MIN_LEFT_MS,
  trackIdFromFilename,
  timerState,
  fadeDurationMs,
  formatRemaining,
  parseSettings,
} from '../src/logic.js';

test('백색소음만: noise를 반복', () => {
  assert.deepEqual(planPlayback({ sound: 'noise', withNoise: true }), { first: 'noise', loopFirst: true, then: null });
  assert.deepEqual(planPlayback({ sound: 'noise', withNoise: false }), { first: 'noise', loopFirst: true, then: null });
});

test('자장가만: 자장가를 반복', () => {
  assert.deepEqual(planPlayback({ sound: 'brahms', withNoise: false }), { first: 'brahms', loopFirst: true, then: null });
});

test('자장가 + 백색소음: 믹스를 한 번 재생하고 noise로 넘어감', () => {
  const plan = planPlayback({ sound: 'bebefinn', withNoise: true });
  assert.deepEqual(plan, { first: 'bebefinn-mix', loopFirst: false, then: 'noise' });
  assert.deepEqual(requiredTracks(plan), ['bebefinn-mix', 'noise']);
});

const MIN = 60_000;
const mixPlan = planPlayback({ sound: 'brahms', withNoise: true });

test('믹스가 끝났을 때: 타이머가 없으면 noise로 넘어감(기존 동작)', () => {
  assert.equal(nextAfterFirst(mixPlan, { now: 0, endsAt: null }), 'then');
});

test('믹스가 끝났을 때: 타이머가 10분 이상 남았으면 믹스를 다시 틂', () => {
  assert.equal(REPEAT_MIN_LEFT_MS, 10 * MIN);
  assert.equal(nextAfterFirst(mixPlan, { now: 0, endsAt: 27 * MIN }), 'repeat');
  assert.equal(nextAfterFirst(mixPlan, { now: 0, endsAt: 10 * MIN }), 'repeat');
});

test('믹스가 끝났을 때: 타이머가 10분 미만 남았으면 noise로 넘어감', () => {
  assert.equal(nextAfterFirst(mixPlan, { now: 0, endsAt: 10 * MIN - 1 }), 'then');
  assert.equal(nextAfterFirst(mixPlan, { now: 5 * MIN, endsAt: 7 * MIN }), 'then');
});

test('이어질 곡이 없으면 stop (자장가만 반복 재생하는 계획)', () => {
  const loopPlan = planPlayback({ sound: 'brahms', withNoise: false });
  assert.equal(nextAfterFirst(loopPlan, { now: 0, endsAt: 60 * MIN }), 'stop');
});

// 믹스 길이 = 자장가 31분 21초 + 빗소리 램프 60초. 타이머 시간 동안 믹스를 몇 번 트는지 흉내 낸다.
function simulate(mixMin, timerMin) {
  const endsAt = timerMin * MIN;
  let t = 0;
  let passes = 0;
  for (;;) {
    passes += 1;
    t += mixMin * MIN;
    if (t >= endsAt) return { passes, finishedBy: 'timer' }; // 믹스 도중에 타이머가 끝남
    const next = nextAfterFirst(mixPlan, { now: t, endsAt });
    if (next !== 'repeat') return { passes, finishedBy: 'noise' };
  }
}

test('브람스(32.4분 믹스) + 60분 타이머: 두 번 틀고 타이머로 끝남 — 빗소리만 남지 않음', () => {
  assert.deepEqual(simulate(32.4, 60), { passes: 2, finishedBy: 'timer' });
});

test('브람스 + 90분 타이머: 세 번 틀고 타이머로 끝남', () => {
  assert.deepEqual(simulate(32.4, 90), { passes: 3, finishedBy: 'timer' });
});

test('브람스 + 30분/15분 타이머: 믹스 하나로 충분함', () => {
  assert.deepEqual(simulate(32.4, 30), { passes: 1, finishedBy: 'timer' });
  assert.deepEqual(simulate(32.4, 15), { passes: 1, finishedBy: 'timer' });
});

test('베베핀(53분 믹스) + 60분 타이머: 7분만 남으므로 다시 틀지 않고 빗소리로 마무리', () => {
  assert.deepEqual(simulate(53, 60), { passes: 1, finishedBy: 'noise' });
});

test('알 수 없는 소리는 거부', () => {
  assert.throws(() => planPlayback({ sound: 'rock', withNoise: false }));
});

test('파일 이름 매칭: mix를 단독 트랙보다 먼저 확인', () => {
  assert.equal(trackIdFromFilename('brahms-mix.m4a'), 'brahms-mix');
  assert.equal(trackIdFromFilename('brahms.m4a'), 'brahms');
  assert.equal(trackIdFromFilename('Brahms-Mix (1).m4a'), 'brahms-mix');
  assert.equal(trackIdFromFilename('noise(2).m4a'), 'noise');
  assert.equal(trackIdFromFilename('bebefinn.M4A'), 'bebefinn');
  assert.equal(trackIdFromFilename('brahmsXYZ.m4a'), null);
  assert.equal(trackIdFromFilename('song.mp3'), null);
});

test('타이머: 없으면 계속, 페이드 구간에서 선형 감소, 끝나면 done', () => {
  assert.deepEqual(timerState(1000, null, 60_000), { done: false, gain: 1 });
  assert.deepEqual(timerState(0, 120_000, 60_000), { done: false, gain: 1 });
  assert.deepEqual(timerState(90_000, 120_000, 60_000), { done: false, gain: 0.5 });
  assert.deepEqual(timerState(120_000, 120_000, 60_000), { done: true, gain: 0 });
  assert.deepEqual(timerState(500_000, 120_000, 60_000), { done: true, gain: 0 });
});

test('페이드 길이: 최대 2분, 짧은 타이머는 1/5', () => {
  assert.equal(fadeDurationMs(60), 120_000);
  assert.equal(fadeDurationMs(15), 120_000);
  assert.equal(fadeDurationMs(5), 60_000);
});

test('남은 시간 표시', () => {
  assert.equal(formatRemaining(0), '0:00');
  assert.equal(formatRemaining(61_000), '1:01');
  assert.equal(formatRemaining(59_001), '1:00');
  assert.equal(formatRemaining(3_725_000), '1:02:05');
});

test('설정 복원: 잘못된 값은 기본값으로', () => {
  assert.deepEqual(parseSettings(null), { sound: 'noise', withNoise: true, timerMin: 0 });
  assert.deepEqual(parseSettings('not json'), { sound: 'noise', withNoise: true, timerMin: 0 });
  assert.deepEqual(parseSettings('{"sound":"brahms","withNoise":false,"timerMin":30}'), {
    sound: 'brahms',
    withNoise: false,
    timerMin: 30,
  });
  assert.deepEqual(parseSettings('{"sound":"x","withNoise":"yes","timerMin":7}'), {
    sound: 'noise',
    withNoise: true,
    timerMin: 0,
  });
});
