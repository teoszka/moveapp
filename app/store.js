// localStorage wrapper. Every call is wrapped: storage can be blocked or throw (SPEC §3).

const PROGRESS = 'moveapp.progress';
const SAFETY = 'moveapp.safetyAck';

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: the app works without it */ }
}
function remove(key) {
  try { localStorage.removeItem(key); } catch { /* see above */ }
}

export const store = {
  getProgress: () => read(PROGRESS),
  saveProgress: (routine, build, t) => write(PROGRESS, { routine, build, t, savedAt: Date.now() }),
  clearProgress: () => remove(PROGRESS),
  safetyAcked: () => read(SAFETY) === true,
  ackSafety: () => write(SAFETY, true),
};
