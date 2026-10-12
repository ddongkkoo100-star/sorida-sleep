import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './helpers/app-harness.mjs';

const MIN = 60_000;

for (const minutes of [60, 90]) {
  test(`${minutes}분: 같은 믹스를 반복하고 종료 시각에 멈춤`, async () => {
    const app = await createApp({ timerMin: minutes });
    app.click('#play');
    const source = app.audio.src;
    for (let passed = 30; passed < minutes; passed += 30) {
      app.advance(30 * MIN);
      app.audio.finish();
      assert.equal(app.audio.src, source);
      assert.equal(app.audio.paused, false);
    }
    app.advance(30 * MIN);
    const calls = app.audio.playCalls;
    app.audio.finish(); // tick이 없어도 종료 이벤트에서 바로 정지해야 한다.
    assert.equal(app.audio.playCalls, calls);
    assert.equal(app.audio.paused, true);
    assert.equal(app.logs().at(-1).detail, 'timer');
  });
}

test('남은 7분도 반복하고, 꼬리 되감기는 새 play 요청 없이 실행', async () => {
  const app = await createApp();
  app.click('#play');
  app.advance(53 * MIN);
  app.audio.finish();
  assert.equal(app.audio.sources[0], app.audio.src);
  const calls = app.audio.playCalls;
  app.audio.currentTime = app.audio.duration - 60;
  app.audio.emit('timeupdate');
  assert.equal(app.audio.currentTime, 0);
  assert.equal(app.audio.playCalls, calls);
  app.advance(7 * MIN);
  app.tick();
  assert.equal(app.audio.paused, true);
});

test('자장가 단독은 native loop를 사용하고 타이머로 정지', async () => {
  const app = await createApp({ withNoise: false });
  app.click('#play');
  assert.equal(app.audio.loop, true);
  app.advance(60 * MIN);
  app.tick();
  assert.equal(app.audio.paused, true);
});

for (const paused of [false, true]) {
  test(`계속 → 빗소리 → 90분: 믹스 복귀, 일시정지=${paused} 유지`, async () => {
    const app = await createApp({ timerMin: 0 });
    app.click('#play');
    const mix = app.audio.src;
    app.audio.finish();
    assert.notEqual(app.audio.src, mix);
    assert.equal(app.audio.loop, true);
    if (paused) app.remote('pause');
    app.timer(90);
    assert.equal(app.audio.src, mix);
    assert.equal(app.audio.paused, paused);
    assert.equal(app.audio.loop, false);
    if (paused) app.remote('play');
    assert.equal(app.audio.paused, false);
  });
}

test('재생 중 시간 연장은 현재 믹스의 재생 위치를 유지', async () => {
  const app = await createApp();
  app.click('#play');
  app.advance(50 * MIN);
  app.audio.currentTime = 100;
  app.timer(90);
  assert.equal(app.audio.currentTime, 100);
  app.advance(10 * MIN);
  app.tick();
  assert.equal(app.audio.paused, false);
  app.advance(80 * MIN);
  app.tick();
  assert.equal(app.audio.paused, true);
});

for (const trigger of ['visible', 'pageshow', 'remote', 'button', 'playing']) {
  test(`만료된 세션은 ${trigger}에서도 재개하지 않음`, async () => {
    const app = await createApp();
    app.click('#play');
    app.audio.pause();
    app.advance(60 * MIN + 1);
    const calls = app.audio.playCalls;
    if (trigger === 'visible') app.document.emit('visibilitychange');
    if (trigger === 'pageshow') app.window.emit('pageshow');
    if (trigger === 'remote') app.remote('play');
    if (trigger === 'button') app.click('#play');
    if (trigger === 'playing') { app.audio.paused = false; app.audio.emit('playing'); }
    assert.equal(app.audio.playCalls, calls);
    assert.equal(app.audio.paused, true);
    assert.equal(app.logs().at(-1).detail, 'timer');
  });
}

test('반복 요청 실패 시 빗소리로 전환하고 타이머 연장 시 믹스로 복귀', async () => {
  const app = await createApp();
  app.click('#play');
  const mix = app.audio.src;
  app.advance(30 * MIN);
  app.audio.nextPlay = Promise.reject(new Error('play blocked'));
  app.audio.finish();
  await app.flush();
  assert.notEqual(app.audio.src, mix);
  assert.equal(app.audio.loop, true);
  assert.ok(app.logs().some((entry) => entry.ev === 'repeat-failed'));
  app.timer(90);
  assert.equal(app.audio.src, mix);
});

for (const change of ['new-session', 'deadline', 'paused', 'new-request']) {
  test(`늦은 반복 실패는 ${change} 상태를 훼손하지 않음`, async () => {
    const app = await createApp();
    app.click('#play');
    let reject;
    app.audio.nextPlay = new Promise((_, fail) => { reject = fail; });
    app.audio.finish();
    if (change === 'new-session') {
      app.remote('stop');
      app.click('#play');
      app.remote('pause');
    }
    if (change === 'deadline') app.advance(60 * MIN);
    if (change === 'paused') app.remote('pause');
    if (change === 'new-request') { app.remote('play'); app.audio.pause(); }
    const source = app.audio.src;
    const calls = app.audio.playCalls;
    reject(new Error('late rejection'));
    await app.flush();
    assert.equal(app.audio.src, source);
    assert.equal(app.audio.playCalls, calls);
    assert.equal(app.audio.paused, true);
    assert.ok(!app.logs().some((entry) => entry.ev === 'repeat-failed'));
  });
}

test('잠금 테스트는 한 번 반복 후 다음 곡으로 전환', async () => {
  const app = await createApp();
  app.click('#lock-test');
  const first = app.audio.src;
  app.audio.emit('loadedmetadata');
  assert.equal(app.audio.currentTime, app.audio.duration - 20);
  app.advance(20_000);
  app.audio.finish();
  assert.equal(app.audio.src, first);
  app.audio.emit('loadedmetadata');
  assert.equal(app.audio.currentTime, app.audio.duration - 20);
  app.advance(20_000);
  app.audio.finish();
  assert.notEqual(app.audio.src, first);
  assert.equal(app.audio.loop, true);
  assert.equal(app.audio.paused, false);
});
