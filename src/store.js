// 음원은 IndexedDB에 Blob으로 저장한다. 앱 코드만 인터넷에 올리고 음원은 기기 안에만 둔다.
// 레코드: { id: 'noise', blob: Blob(audio/mp4), size: 9600000, savedAt: '2026-09-26T12:00:00.000Z' }

const DB_NAME = 'sorida';
const STORE = 'tracks';

let dbPromise = null;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const result = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(result.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export async function saveTrack(id, file) {
  // iOS Safari는 MIME 타입이 있어야 Blob URL을 오디오로 재생한다.
  const bytes = await file.arrayBuffer();
  const blob = new Blob([bytes], { type: 'audio/mp4' });
  await run('readwrite', (s) => s.put({ id, blob, size: blob.size, savedAt: new Date().toISOString() }));
}

export function loadTrack(id) {
  return run('readonly', (s) => s.get(id));
}

export async function listTracks() {
  const all = await run('readonly', (s) => s.getAll());
  return (all ?? []).map(({ id, size, savedAt }) => ({ id, size, savedAt }));
}

export function clearTracks() {
  return run('readwrite', (s) => s.clear());
}

// 저장 공간이 부족할 때 iOS가 데이터를 지우지 않도록 요청한다.
export async function requestPersistence() {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
