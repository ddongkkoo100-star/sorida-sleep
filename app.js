import {
  TRACKS,
  TRACK_IDS,
  TIMER_CHOICES,
  planPlayback,
  requiredTracks,
  nextAfterFirst,
  LOCK_TEST,
  trackIdFromFilename,
  timerState,
  fadeDurationMs,
  formatRemaining,
  parseSettings,
} from './src/logic.js';
import { saveTrack, loadTrack, clearTracks, requestPersistence } from './src/store.js';

const $ = (sel) => document.querySelector(sel);
const audio = $('#player');
const IS_IOS =
  /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

// iOS 17+: 음악 앱과 같은 재생 세션으로 표시한다.
if ('audioSession' in navigator) {
  try {
    navigator.audioSession.type = 'playback';
  } catch {}
}

let settings = parseSettings(safeGet('settings'));
const urls = new Map(); // trackId → 재생 URL(blob: 또는 개발용 audio/ 경로)
const sizes = new Map();
// 재생 중인 상태. null이면 멈춤.
// { plan, stage: 'first'|'then', trackId, endsAt, fadeMs, userPaused, seekToEnd, repeats }
let session = null;

// ---------- 저장소 헬퍼 ----------
function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}
function saveSettings() {
  safeSet('settings', JSON.stringify(settings));
}

// ---------- 재생 기록 (잠금 중에 무슨 일이 있었는지 나중에 확인용) ----------
const LOG_KEY = 'eventlog';
function readLog() {
  try {
    return JSON.parse(safeGet(LOG_KEY) ?? '[]');
  } catch {
    return [];
  }
}
function log(ev, detail = '') {
  const list = readLog();
  list.push({ t: new Date().toISOString(), ev, hidden: document.hidden, detail: String(detail) });
  safeSet(LOG_KEY, JSON.stringify(list.slice(-300)));
}
let lastHiddenTickLog = 0;

// ---------- 음원 ----------
async function refreshTracks() {
  for (const url of urls.values()) {
    if (url.startsWith('blob:') && url !== audio.src) URL.revokeObjectURL(url);
  }
  urls.clear();
  sizes.clear();
  for (const id of TRACK_IDS) {
    const rec = await loadTrack(id).catch(() => null);
    if (rec?.blob) {
      urls.set(id, URL.createObjectURL(rec.blob));
      sizes.set(id, rec.size);
      continue;
    }
    // 맥에서 개발할 때는 audio/ 폴더를 그대로 쓴다. 배포본에는 audio/가 없다.
    if (IS_LOCAL) {
      const path = `audio/${TRACKS[id].file}`;
      const res = await fetch(path, { method: 'HEAD' }).catch(() => null);
      if (res?.ok) {
        urls.set(id, path);
        sizes.set(id, Number(res.headers.get('content-length')) || 0);
      }
    }
  }
  render();
}

// ---------- 재생 ----------
// 화면이 꺼져도 끊기지 않도록 <audio> 하나만 쓰고, 곡이 바뀔 때도 같은 요소에 src만 바꾼다.
function start({ plan = planPlayback(settings), seekToEnd = 0, timerMin = settings.timerMin } = {}) {
  const missing = requiredTracks(plan).filter((id) => !urls.has(id));
  if (missing.length) {
    openSetup(`먼저 가져와야 할 음원: ${missing.map((id) => TRACKS[id].title).join(', ')}`);
    return;
  }
  session = {
    plan,
    stage: 'first',
    trackId: plan.first,
    endsAt: timerMin ? Date.now() + timerMin * 60_000 : null,
    fadeMs: fadeDurationMs(timerMin),
    userPaused: false,
    seekToEnd,
    repeats: 0,
  };
  audio.volume = 1;
  setSource(plan.first, plan.loopFirst);
  play('start');
  render();
}

function setSource(id, loop) {
  audio.loop = loop;
  audio.src = urls.get(id);
  session.trackId = id;
  updateMediaSession();
}

function play(reason, onRejected) {
  log('play', `${reason} ${session?.trackId ?? ''}`);
  const p = audio.play();
  p?.catch((err) => {
    log('play-rejected', `${reason} ${err.name}`);
    onRejected?.(err);
    render();
  });
}

function stop(reason) {
  if (!session) return;
  log('stop', reason);
  session = null;
  audio.pause();
  audio.volume = 1;
  updateMediaSession();
  render();
}

function resumeIfInterrupted(why) {
  if (session && !session.userPaused && audio.paused) play(`resume:${why}`);
}

// 잠금 테스트용: 첫 곡은 (다시 틀 때도) 끝 부분부터 재생해 짧게 확인한다.
audio.addEventListener('loadedmetadata', () => {
  if (session?.seekToEnd && session.stage === 'first') {
    audio.currentTime = Math.max(0, audio.duration - session.seekToEnd);
  }
});

function switchToThen(reason) {
  session.stage = 'then';
  setSource(session.plan.then, true);
  play(reason);
  log('switch', session.plan.then);
}

// 다시 틀기가 거부되면 소리가 끊기지 않도록 기존처럼 빗소리로 넘어간다.
// 사용자가 멈췄거나, 이미 다른 곡으로 넘어갔거나, 다른 재생 요청으로 이미 소리가 나는 경우는 건드리지 않는다.
function repeatRejected() {
  if (!session || session.userPaused || session.stage !== 'first' || !audio.paused) return;
  log('repeat-failed', session.trackId);
  switchToThen('repeat-fallback');
}

audio.addEventListener('ended', () => {
  log('ended', session?.trackId ?? '');
  if (!session) return;
  const next = session.stage === 'first' ? nextAfterFirst(session.plan, { now: Date.now(), endsAt: session.endsAt }) : 'stop';
  if (next === 'repeat') {
    // 타이머가 넉넉하면 자장가를 다시 튼다. 곡이 바뀔 때와 같이 같은 요소에 src만 다시 지정한다.
    session.repeats += 1;
    setSource(session.plan.first, false);
    play('repeat', repeatRejected);
    log('repeat', `${session.plan.first} #${session.repeats + 1}`);
  } else if (next === 'then') {
    switchToThen('next');
  } else {
    stop('ended');
  }
});

audio.addEventListener('pause', () => {
  // 전화·알람 등으로 시스템이 멈춘 경우. 사용자가 멈춘 건 userPaused로 구분한다.
  if (session && !session.userPaused && !audio.ended) log('interrupted', session.trackId);
  updateMediaSession();
  render();
});
audio.addEventListener('playing', () => {
  updateMediaSession();
  render();
});
audio.addEventListener('error', () => log('audio-error', audio.error?.code ?? ''));

document.addEventListener('visibilitychange', () => {
  log('visibility', document.visibilityState);
  if (!document.hidden) {
    resumeIfInterrupted('visible');
    showLockTestResult();
  }
});
window.addEventListener('pageshow', () => resumeIfInterrupted('pageshow'));

// ---------- 타이머 ----------
function tick() {
  if (session?.endsAt) {
    const { done, gain } = timerState(Date.now(), session.endsAt, session.fadeMs);
    // iOS는 audio.volume을 무시하므로 서서히 줄이기는 다른 기기에서만 동작한다.
    if (!IS_IOS) audio.volume = gain;
    if (done) stop('timer');
  }
  if (session && document.hidden && Date.now() - lastHiddenTickLog > 10_000) {
    lastHiddenTickLog = Date.now();
    log('tick-hidden', session.trackId);
  }
  renderStatus();
}
setInterval(tick, 1000);
audio.addEventListener('timeupdate', tick);

// ---------- 잠금화면 / 제어센터 ----------
function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  if (!session) {
    ms.playbackState = 'none';
    return;
  }
  ms.metadata = new MediaMetadata({
    title: TRACKS[session.trackId].title,
    artist: '소리담',
    artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
  });
  ms.playbackState = audio.paused ? 'paused' : 'playing';
}

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const handlers = {
    play: () => {
      if (!session) return start();
      session.userPaused = false;
      play('remote');
    },
    pause: () => {
      if (!session) return;
      session.userPaused = true;
      log('pause', 'remote');
      audio.pause();
    },
    stop: () => stop('remote'),
  };
  for (const [action, fn] of Object.entries(handlers)) {
    try {
      ms.setActionHandler(action, fn);
    } catch {}
  }
}

// ---------- 화면 ----------
function render() {
  document.querySelectorAll('.sound').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.sound === settings.sound));
  });
  $('#with-noise-row').hidden = settings.sound === 'noise';
  $('#with-noise').checked = settings.withNoise;
  document.querySelectorAll('#timer-choices button').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(Number(btn.dataset.min) === settings.timerMin));
  });

  const playBtn = $('#play');
  if (!session) {
    playBtn.textContent = '▶︎ 재생';
    playBtn.classList.remove('on');
  } else if (audio.paused) {
    playBtn.textContent = '▶︎ 이어서 재생';
    playBtn.classList.remove('on');
  } else {
    playBtn.textContent = '■ 정지';
    playBtn.classList.add('on');
  }

  const missingAny = TRACK_IDS.some((id) => !urls.has(id));
  $('#missing-banner').hidden = !missingAny;
  renderStatus();
}

function renderStatus() {
  let text = '';
  if (session) {
    text = `${TRACKS[session.trackId].title}${audio.paused ? ' · 멈춤' : ' 재생 중'}`;
    if (session.stage === 'first' && session.repeats) text += ` · ${session.repeats + 1}번째`;
    if (session.endsAt) text += ` · ${formatRemaining(session.endsAt - Date.now())} 뒤 꺼짐`;
  }
  $('#status').textContent = text;
  $('#lock-now').textContent = text || '멈춤';
}

function buildTimerChoices() {
  const wrap = $('#timer-choices');
  for (const min of TIMER_CHOICES) {
    const btn = document.createElement('button');
    btn.dataset.min = String(min);
    btn.textContent = min ? `${min}분` : '계속';
    wrap.append(btn);
  }
}

function formatSize(bytes) {
  return bytes ? `${(bytes / 1_000_000).toFixed(1)}MB` : '';
}

function renderTrackList() {
  const list = $('#track-list');
  list.replaceChildren(
    ...TRACK_IDS.map((id) => {
      const li = document.createElement('li');
      const ok = urls.has(id);
      li.className = ok ? 'ok' : 'missing';
      li.textContent = `${ok ? '✓' : '✗'} ${TRACKS[id].file} — ${TRACKS[id].title} ${ok ? formatSize(sizes.get(id)) : '(없음)'}`;
      return li;
    }),
  );
  $('#event-log').textContent = readLog()
    .slice(-80)
    .reverse()
    .map((e) => `${e.t.slice(11, 19)} ${e.hidden ? '[꺼짐]' : '      '} ${e.ev} ${e.detail}`)
    .join('\n');
}

function openSetup(message = '') {
  renderTrackList();
  $('#import-status').textContent = message;
  const dialog = $('#setup');
  if (!dialog.open) dialog.showModal();
}

// ---------- 잠금 테스트 ----------
function startLockTest() {
  if (!urls.has('noise') || !urls.has('brahms')) {
    $('#import-status').textContent = '잠금 테스트에는 noise.m4a와 brahms.m4a가 필요해요.';
    return;
  }
  safeSet('locktest', JSON.stringify({ startedAt: Date.now() }));
  $('#lock-test-result').hidden = true;
  $('#setup').close();
  if (session) stop('lock-test');
  // 빗소리 끝 20초 → 같은 곡 다시 틀기(끝 20초) → 오르골. 타이머 길이로 두 갈래를 모두 지나간다(LOCK_TEST).
  start({ plan: { first: 'noise', loopFirst: false, then: 'brahms' }, ...LOCK_TEST });
}

function showLockTestResult() {
  let test;
  try {
    test = JSON.parse(safeGet('locktest') ?? 'null');
  } catch {
    test = null;
  }
  if (!test || Date.now() - test.startedAt < 45_000) return;
  safeSet('locktest', 'null');

  const entries = readLog().filter((e) => Date.parse(e.t) >= test.startedAt);
  const wentHidden = entries.some((e) => e.ev === 'visibility' && e.detail === 'hidden');
  const lines = [];
  if (!wentHidden) {
    lines.push('⚠️ 테스트 중에 화면이 꺼지지 않았어요. 시작 후 바로 옆 버튼으로 화면을 꺼 주세요.');
  } else {
    const stoppedWhileHidden = entries.some((e) => e.ev === 'interrupted' && e.hidden);
    const switchedWhileHidden = entries.some((e) => e.ev === 'switch' && e.hidden);
    const repeatedWhileHidden =
      entries.some((e) => e.ev === 'repeat' && e.hidden) && !entries.some((e) => e.ev === 'repeat-failed');
    const ticked = entries.some((e) => e.ev === 'tick-hidden');
    lines.push(
      stoppedWhileHidden
        ? '❌ 화면이 꺼진 뒤 소리가 멈췄어요. 홈 화면 앱 대신 Safari에서 열어 다시 테스트해 보세요.'
        : '✅ 화면이 꺼져도 소리가 계속 나왔어요.',
    );
    lines.push(
      repeatedWhileHidden
        ? '✅ 화면이 꺼진 상태에서 같은 곡을 다시 틀었어요. 타이머를 켜면 자장가가 반복돼요.'
        : '❌ 화면이 꺼진 동안 같은 곡을 다시 틀지 못했어요. 타이머를 켜도 자장가는 한 번만 나오고 빗소리로 넘어가요.',
    );
    lines.push(
      switchedWhileHidden
        ? '✅ 화면이 꺼진 상태에서 다음 곡으로 넘어갔어요. ‘빗소리 같이 틀기’를 써도 돼요.'
        : '❌ 화면이 꺼진 동안 다음 곡으로 넘어가지 못했어요. 빗소리만 틀거나 ‘빗소리 같이 틀기’를 끄세요.',
    );
    lines.push(
      ticked
        ? '✅ 화면이 꺼져도 앱 타이머가 동작해요.'
        : '⚠️ 화면이 꺼지면 앱 타이머가 멈출 수 있어요. 시계 앱 타이머(재생 중단)를 쓰세요.',
    );
  }
  const box = $('#lock-test-result');
  box.replaceChildren(
    ...lines.map((line) => {
      const p = document.createElement('p');
      p.textContent = line;
      return p;
    }),
  );
  box.hidden = false;
  openSetup();
}

// ---------- 화면 잠금 (터치 방지) ----------
const UNLOCK_MS = 1200;
let unlockTimer = null;
function showLock() {
  renderStatus();
  $('#lock').hidden = false;
}
function beginUnlock(e) {
  e.preventDefault();
  $('#unlock').classList.add('holding');
  unlockTimer = setTimeout(() => {
    $('#lock').hidden = true;
    cancelUnlock();
  }, UNLOCK_MS);
}
function cancelUnlock() {
  clearTimeout(unlockTimer);
  $('#unlock').classList.remove('holding');
}

// ---------- 이벤트 연결 ----------
function wire() {
  $('#sounds').addEventListener('click', (e) => {
    const btn = e.target.closest('.sound');
    if (!btn) return;
    settings = { ...settings, sound: btn.dataset.sound };
    saveSettings();
    if (session) start(); // 재생 중에 바꾸면 바로 새 소리로
    render();
  });
  $('#with-noise').addEventListener('change', (e) => {
    settings = { ...settings, withNoise: e.target.checked };
    saveSettings();
    if (session) start();
    render();
  });
  $('#timer-choices').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    settings = { ...settings, timerMin: Number(btn.dataset.min) };
    saveSettings();
    if (session) {
      session.endsAt = settings.timerMin ? Date.now() + settings.timerMin * 60_000 : null;
      session.fadeMs = fadeDurationMs(settings.timerMin);
      audio.volume = 1;
    }
    render();
  });
  $('#play').addEventListener('click', () => {
    if (!session) return start();
    if (audio.paused) {
      session.userPaused = false;
      play('button');
      return;
    }
    stop('button');
  });

  $('#open-setup').addEventListener('click', () => openSetup());
  document.querySelectorAll('[data-open-setup]').forEach((b) => b.addEventListener('click', () => openSetup()));

  $('#file-input').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    if (session) stop('import');
    const status = $('#import-status');
    const saved = [];
    const unknown = [];
    try {
      for (const file of files) {
        const id = trackIdFromFilename(file.name);
        if (!id) {
          unknown.push(file.name);
          continue;
        }
        status.textContent = `${TRACKS[id].title} 저장 중… (${saved.length + 1}/${files.length})`;
        await saveTrack(id, file);
        saved.push(id);
      }
      await requestPersistence().catch(() => false);
      await refreshTracks();
      status.textContent =
        `${saved.length}개 저장 완료` + (unknown.length ? ` · 알 수 없는 파일: ${unknown.join(', ')}` : '');
    } catch (err) {
      status.textContent = `저장 실패: ${err?.name === 'QuotaExceededError' ? '저장 공간이 부족해요' : err?.message ?? err}`;
      log('import-error', err?.name ?? err);
    }
    renderTrackList();
  });

  $('#lock-test').addEventListener('click', startLockTest);

  $('#clear-tracks').addEventListener('click', async () => {
    if (!confirm('저장한 음원을 모두 지울까요?')) return;
    if (session) stop('clear');
    await clearTracks();
    await refreshTracks();
    renderTrackList();
  });

  $('#lock-screen').addEventListener('click', showLock);
  const unlock = $('#unlock');
  unlock.addEventListener('pointerdown', beginUnlock);
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) unlock.addEventListener(ev, cancelUnlock);
  $('#lock').addEventListener('contextmenu', (e) => e.preventDefault());
}

// ---------- 시작 ----------
buildTimerChoices();
wire();
render();
refreshTracks().then(showLockTestResult);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((err) => log('sw-error', err?.message ?? err));
}
