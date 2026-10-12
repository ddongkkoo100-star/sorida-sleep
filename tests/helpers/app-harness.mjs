import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import * as logic from '../../src/logic.js';

// 실제 app.js의 시작 코드와 이벤트 핸들러를 실행한다.
// DOM·오디오·시계·저장소 경계만 대체하므로 iOS의 실제 미디어 정책은 검증하지 않는다.
export async function createApp({ timerMin = 60, withNoise = true, sound = 'brahms' } = {}) {
  let now = 1_000_000;
  const events = () => ({
    listeners: new Map(),
    addEventListener(name, fn) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(fn);
    },
    emit(name, event = {}) {
      for (const fn of this.listeners.get(name) ?? []) fn(event);
    },
  });
  const element = () => ({
    ...events(), dataset: {}, hidden: false, textContent: '', checked: false,
    classList: { add() {}, remove() {} }, setAttribute() {}, append() {}, replaceChildren() {},
    showModal() { this.open = true; }, close() { this.open = false; },
  });
  const nodes = new Map();
  const get = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, element());
    return nodes.get(selector);
  };
  const audio = Object.assign(get('#player'), {
    paused: true, ended: false, duration: 1941.434, currentTime: 0, volume: 1,
    playCalls: 0, sources: [], nextPlay: null,
    play() {
      this.playCalls += 1;
      if (this.nextPlay) {
        const result = this.nextPlay;
        this.nextPlay = null;
        return result;
      }
      this.paused = false;
      this.ended = false;
      this.emit('playing');
      return Promise.resolve();
    },
    pause() {
      if (!this.paused) { this.paused = true; this.emit('pause'); }
    },
    finish() {
      this.currentTime = this.duration;
      this.paused = true;
      this.ended = true;
      this.emit('ended');
    },
  });
  let source = '';
  Object.defineProperty(audio, 'src', {
    get: () => source,
    set(value) {
      source = value;
      audio.sources.push(value);
      audio.currentTime = 0;
      audio.paused = true;
      audio.ended = false;
    },
  });
  const document = { ...events(), hidden: false, visibilityState: 'visible',
    querySelector: get, querySelectorAll: () => [], createElement: element };
  const window = events();
  const media = new Map();
  const storage = new Map([['settings', JSON.stringify({ sound, withNoise, timerMin })]]);
  const intervals = [];
  const context = vm.createContext({
    ...logic, document, window, console, URL,
    navigator: { userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 1,
      mediaSession: { setActionHandler: (name, fn) => media.set(name, fn) } },
    MediaMetadata: class { constructor(value) { Object.assign(this, value); } },
    location: { hostname: 'example.test' },
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    setInterval: (fn) => intervals.push(fn), setTimeout, clearTimeout,
    loadTrack: async (id) => ({ blob: new Blob([id]), size: id.length }),
    saveTrack: async () => {}, clearTracks: async () => {}, requestPersistence: async () => true,
  });
  // vm.Script에서 ES-module import만 주입한 의존성으로 대체한다. 앱 본문은 그대로 실행한다.
  const sourceCode = (await readFile(new URL('../../app.js', import.meta.url), 'utf8'))
    .replace(/^import\s+[\s\S]*?from '\.\/src\/(?:logic|store)\.js';\n/gm, '');
  vm.runInContext(sourceCode, context, { filename: 'app.js' });
  await setImmediate(); // refreshTracks의 모든 비동기 저장소 조회를 완료한다.
  return {
    audio, get, document, window, storage,
    click: (selector) => get(selector).emit('click'),
    timer: (min) => get('#timer-choices').emit('click', { target: { closest: () => ({ dataset: { min: String(min) } }) } }),
    remote: (action) => media.get(action)(),
    advance: (ms) => { now += ms; },
    tick: () => intervals.forEach((fn) => fn()),
    flush: setImmediate,
    logs: () => JSON.parse(storage.get('eventlog') ?? '[]'),
  };
}
