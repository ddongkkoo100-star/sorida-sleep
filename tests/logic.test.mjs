import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planPlayback,
  requiredTracks,
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
