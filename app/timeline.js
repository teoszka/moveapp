// Pure functions over timeline.json (SPEC §8.2, §8.4, §16 S-6). No DOM, no audio: unit-tested with node --test.

export const PROGRESS_MAX_AGE_S = 60 * 60;

// Index of the last item whose `start` is <= t (items sorted by start, contiguous). Clamped to the list.
function indexAt(items, t) {
  let lo = 0;
  let hi = items.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (items[mid].start <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function chapterIndexAt(timeline, t) {
  return indexAt(timeline.chapters, t);
}

export function stateAt(timeline, t) {
  const { chapters, closing, audio, breath } = timeline;
  const time = Math.max(0, t);
  if (time >= closing.start) {
    const last = chapters[chapters.length - 1];
    return {
      chapterIndex: chapters.length - 1,
      step: last.step,
      exercise: last.exercise,
      segmentKind: 'closing',
      side: null,
      of: null,
      segmentTimeLeft: Math.max(0, closing.end - time),
      workTimeLeft: 0,
      nextExercise: null,
      breathKind: null,
      finished: time >= audio.duration,
    };
  }
  const chapterIndex = indexAt(chapters, time);
  const chapter = chapters[chapterIndex];
  const seg = chapter.segments[indexAt(chapter.segments, time)];
  const segmentTimeLeft = seg.end - time;
  let breathKind = null;
  if (seg.kind === 'work' && breath.length) {
    const phase = breath[indexAt(breath, time)];
    if (phase && phase.start <= time && time < phase.end) breathKind = phase.kind;
  }
  const next = chapters[chapterIndex + 1];
  return {
    chapterIndex,
    step: chapter.step,
    exercise: chapter.exercise,
    segmentKind: seg.kind,
    side: seg.kind === 'work' ? seg.side : null,
    of: seg.kind === 'work' ? seg.of : null,
    segmentTimeLeft,
    workTimeLeft: seg.kind === 'work' ? segmentTimeLeft : 0,
    nextExercise: next ? next.exercise : null,
    breathKind,
    finished: false,
  };
}

// Start of the segment that contains t.
export function segmentStartAt(timeline, t) {
  const chapter = timeline.chapters[chapterIndexAt(timeline, t)];
  return chapter.segments[indexAt(chapter.segments, t)].start;
}

// SPEC §6.1: time left rounded to the nearest 5 s, clamped to [5, rMax].
export function clampRemaining(left, rMax) {
  return Math.min(rMax, Math.max(5, Math.round(left / 5) * 5));
}

// SPEC §8.4: what to do on resume at time t.
// { seekTo, nameClip: step index | null, remaining: key in timeline.resume.remaining | null }
export function resumePlan(timeline, t) {
  const state = stateAt(timeline, t);
  if (state.segmentKind === 'closing') return { seekTo: t, nameClip: null, remaining: null };
  if (state.segmentKind !== 'work') return { seekTo: segmentStartAt(timeline, t), nameClip: null, remaining: null };
  const rMax = Math.max(...Object.keys(timeline.resume.remaining).map(Number));
  const left = state.segmentTimeLeft;
  return { seekTo: t, nameClip: state.step, remaining: left >= 5 ? String(clampRemaining(left, rMax)) : null };
}

// Media Session previous/next (SPEC §8.3). Returns the target time, or null when there is nothing to do.
export function nextChapterStart(timeline, t) {
  const i = chapterIndexAt(timeline, t);
  if (t >= timeline.closing.start) return null;
  const next = timeline.chapters[i + 1];
  return next ? next.start : timeline.closing.start;
}

export function previousChapterStart(timeline, t) {
  if (t >= timeline.closing.start) return timeline.chapters[timeline.chapters.length - 1].start;
  const i = chapterIndexAt(timeline, t);
  const chapter = timeline.chapters[i];
  if (t - chapter.start > 3 || i === 0) return chapter.start;
  return timeline.chapters[i - 1].start;
}

// SPEC S-6: saved progress is used only if every check passes.
export function validProgress(saved, library, nowMs) {
  if (!saved || typeof saved !== 'object') return null;
  const entry = library.find((r) => r.id === saved.routine);
  if (!entry || entry.build !== saved.build) return null;
  if (typeof saved.t !== 'number' || !Number.isFinite(saved.t) || saved.t < 0 || saved.t >= entry.duration) return null;
  const age = (nowMs - saved.savedAt) / 1000;
  if (typeof saved.savedAt !== 'number' || !(age >= 0 && age <= PROGRESS_MAX_AGE_S)) return null;
  return { routine: saved.routine, build: saved.build, t: saved.t, savedAt: saved.savedAt };
}

export function formatClock(seconds) {
  const s = Math.max(0, Math.ceil(seconds - 1e-6));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatDuration(seconds) {
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}
