// Session playback: one <audio> for the session file, one for resume clips, Media Session (SPEC §8).
// All guidance state is derived from audio.currentTime and the timeline (D-3); no timers.

import { stateAt, resumePlan, nextChapterStart, previousChapterStart } from './timeline.js';
import { store } from './store.js';

const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;

async function fetchBlob(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !onProgress) return res.blob();
  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onProgress(got, total);
  }
  return new Blob(parts, { type: res.headers.get('content-type') || 'audio/mpeg' });
}

export class Player {
  constructor() {
    this.audio = new Audio();
    this.clip = new Audio();
    this.audio.preload = 'auto';
    this.listeners = new Set();
    this.data = null;
    this.blobs = null; // { id, build, session, names: [], remaining: {} } as blob URLs
    this.chain = null; // token of a running resume-clip chain
    this.metaKey = '';
    this.active = false;
    this.onEnded = null;

    this.audio.addEventListener('play', () => this.changed());
    this.audio.addEventListener('pause', () => this.changed());
    this.audio.addEventListener('seeked', () => this.sync(true));
    this.audio.addEventListener('timeupdate', () => this.sync(false));
    this.audio.addEventListener('ended', () => this.finish());
    addEventListener('pagehide', () => { if (this.active) this.saveProgress(); });
    this.registerHandlers();
  }

  // ----- loading -----

  // Fetches the session and resume clips into Blobs. Reuses them when the same routine build is opened again.
  async load(data, onProgress) {
    const { entry, urls } = data;
    this.data = data;
    if (this.blobs && this.blobs.id === entry.id && this.blobs.build === entry.build) return;
    this.unload();
    const urlOf = (blob) => URL.createObjectURL(blob);
    const session = await fetchBlob(urls.session, onProgress);
    const names = await Promise.all(urls.names.map((u) => fetchBlob(u)));
    const remainingKeys = Object.keys(urls.remaining);
    const remaining = await Promise.all(remainingKeys.map((k) => fetchBlob(urls.remaining[k])));
    this.blobs = {
      id: entry.id,
      build: entry.build,
      session: urlOf(session),
      names: names.map(urlOf),
      remaining: Object.fromEntries(remainingKeys.map((k, i) => [k, urlOf(remaining[i])])),
    };
    this.audio.src = this.blobs.session;
  }

  unload() {
    this.stopAll();
    if (!this.blobs) return;
    const { session, names, remaining } = this.blobs;
    for (const url of [session, ...names, ...Object.values(remaining)]) URL.revokeObjectURL(url);
    this.blobs = null;
    this.audio.removeAttribute('src');
    this.audio.load();
  }

  get ready() {
    return !!this.blobs && !!this.data && this.blobs.id === this.data.entry.id;
  }

  get timeline() { return this.data.timeline; }
  get time() { return this.audio.currentTime; }
  get playing() { return !this.audio.paused || !!this.chain; }

  // ----- transport -----

  start() {
    this.active = true;
    this.metaKey = '';
    this.audio.currentTime = 0;
    this.sync(true);
    this.audio.play().catch((e) => console.warn('play failed', e));
  }

  // Continue saved progress: seek, then the normal resume (clips included).
  continueAt(t) {
    this.active = true;
    this.metaKey = '';
    this.audio.currentTime = t;
    this.sync(true);
    this.resume();
  }

  pause() {
    this.chain = null;
    this.clip.onended = null;
    this.clip.pause();
    this.audio.pause();
    this.saveProgress();
    this.sync(true);
    this.changed();
  }

  resume() {
    if (this.chain || !this.audio.paused) return;
    const plan = resumePlan(this.timeline, this.audio.currentTime);
    if (plan.seekTo !== this.audio.currentTime) this.audio.currentTime = plan.seekTo;
    const clips = [];
    if (plan.nameClip != null) clips.push(this.blobs.names[plan.nameClip]);
    if (plan.remaining) clips.push(this.blobs.remaining[plan.remaining]);
    const token = {};
    this.chain = token;
    this.changed();
    const next = () => {
      if (this.chain !== token) return;
      const url = clips.shift();
      if (!url) {
        this.chain = null;
        this.clip.onended = null;
        this.audio.play().catch((e) => { console.warn('play failed', e); this.changed(); });
        return;
      }
      this.clip.onended = next;
      this.clip.src = url;
      this.clip.play().catch((e) => { console.warn('resume clip failed, resuming at once', e); clips.length = 0; next(); });
    };
    next();
  }

  toggle() { if (this.playing) this.pause(); else this.resume(); }

  seek(t) {
    const end = this.timeline.audio.duration - 0.05;
    this.audio.currentTime = Math.max(0, Math.min(end, t));
  }

  next() {
    const t = nextChapterStart(this.timeline, this.audio.currentTime);
    if (t != null) this.seek(t);
  }

  previous() { this.seek(previousChapterStart(this.timeline, this.audio.currentTime)); }

  stopAll() {
    this.chain = null;
    this.clip.onended = null;
    this.clip.pause();
    this.audio.pause();
    this.active = false;
  }

  // End of session: clear progress, release the media card.
  finish() {
    this.active = false;
    store.clearProgress();
    if (ms) ms.playbackState = 'none';
    this.changed();
    if (this.onEnded) this.onEnded();
  }

  // Leave without finishing (End session): clear progress too.
  end() {
    this.stopAll();
    store.clearProgress();
    if (ms) { ms.playbackState = 'none'; ms.metadata = null; }
    this.changed();
  }

  saveProgress() {
    if (!this.active || !this.data) return;
    const t = this.audio.currentTime;
    if (t >= this.timeline.audio.duration - 0.05) return;
    store.saveProgress(this.data.entry.id, this.data.entry.build, t);
  }

  // ----- state out -----

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  changed() {
    if (ms && this.active) ms.playbackState = this.playing ? 'playing' : 'paused';
    this.updatePosition();
    for (const fn of this.listeners) fn();
  }

  // ----- Media Session (SPEC §8.3) -----

  exerciseName(id) { return this.data.exercises[id]?.name ?? id; }

  sync(force) {
    if (!this.active || !this.data) return;
    const t = this.audio.currentTime;
    const s = stateAt(this.timeline, t);
    const side = s.segmentKind === 'switch' ? 2 : s.side;
    const key = `${s.chapterIndex}:${side === 2 ? 2 : 1}`;
    const changed = key !== this.metaKey;
    this.metaKey = key;
    if (changed) {
      this.setMetadata(s, side);
      this.saveProgress();
    }
    if (changed || force) this.updatePosition();
  }

  setMetadata(s, side) {
    if (!ms) return;
    const { routine, entry } = this.data;
    const mood = routine.mood;
    const icon = (n) => ({ src: `icons/mood-${mood}-${n}.png`, sizes: `${n}x${n}`, type: 'image/png' });
    ms.metadata = new MediaMetadata({
      title: this.exerciseName(s.exercise) + (side === 2 && s.of !== 1 ? ' · side 2' : ''),
      artist: `${entry.title} · ${s.step + 1} of ${entry.steps}`,
      album: 'MoveApp',
      artwork: [icon(512), icon(192)],
    });
  }

  updatePosition() {
    if (!ms || !ms.setPositionState || !this.active || !this.data) return;
    const tl = this.timeline;
    const t = this.audio.currentTime;
    const ch = tl.chapters[stateAt(tl, t).chapterIndex];
    const end = t >= tl.closing.start ? tl.closing.end : ch.end;
    const duration = end - ch.start;
    try {
      ms.setPositionState({ duration, position: Math.min(duration, Math.max(0, t - ch.start)), playbackRate: 1 });
    } catch (e) { console.warn('setPositionState failed', e); }
  }

  registerHandlers() {
    if (!ms) return;
    const handlers = {
      play: () => this.resume(),
      pause: () => this.pause(),
      nexttrack: () => this.next(),
      previoustrack: () => this.previous(),
      seekto: (d) => {
        const ch = this.timeline.chapters[stateAt(this.timeline, this.audio.currentTime).chapterIndex];
        this.seek(ch.start + (d.seekTime ?? 0));
      },
      stop: () => this.pause(),
    };
    for (const [action, fn] of Object.entries(handlers)) {
      try { ms.setActionHandler(action, (details) => { if (this.active && this.data) fn(details ?? {}); }); } catch { /* unsupported action */ }
    }
  }
}
