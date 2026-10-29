import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  stateAt, resumePlan, clampRemaining, validProgress, nextChapterStart, previousChapterStart, formatClock, formatDuration,
} from '../app/timeline.js';

const load = (id) => JSON.parse(readFileSync(new URL(`../audio/${id}/timeline.json`, import.meta.url), 'utf8'));
const library = JSON.parse(readFileSync(new URL('../content/library.json', import.meta.url), 'utf8'));
const morning = load('morning');
const evening = load('evening');
const work = (tl, step, side = 1) => tl.chapters[step].segments.filter((s) => s.kind === 'work')[side - 1];

test('chapters are contiguous and end where the closing starts', () => {
  for (const tl of [morning, evening]) {
    for (let i = 1; i < tl.chapters.length; i++) assert.equal(tl.chapters[i].start, tl.chapters[i - 1].end);
    assert.equal(tl.chapters.at(-1).end, tl.closing.start);
    assert.equal(tl.closing.end, tl.audio.duration);
  }
});

test('stateAt: boundaries belong to the next segment', () => {
  const w = work(morning, 0);
  assert.equal(stateAt(morning, w.start - 0.001).segmentKind, 'transition');
  assert.equal(stateAt(morning, w.start).segmentKind, 'work');
  assert.equal(stateAt(morning, w.end - 0.001).segmentKind, 'work');
  assert.equal(stateAt(morning, w.end).chapterIndex, 1);
  assert.equal(stateAt(morning, 0).segmentKind, 'transition');
  assert.equal(stateAt(morning, -5).chapterIndex, 0);
});

test('stateAt: work state of a one-sided step', () => {
  const w = work(morning, 1);
  const s = stateAt(morning, w.start + 10);
  assert.equal(s.exercise, 'cat-cow');
  assert.equal(s.side, 1);
  assert.equal(s.of, 1);
  assert.ok(Math.abs(s.segmentTimeLeft - 20) < 1e-9);
  assert.equal(s.workTimeLeft, s.segmentTimeLeft);
  assert.equal(s.nextExercise, 'neck-circles');
  assert.equal(s.breathKind, null);
});

test('stateAt: two-sided step has work, switch, work with side numbers', () => {
  const ch = morning.chapters[4]; // hip circles
  assert.deepEqual(ch.segments.map((s) => s.kind), ['transition', 'work', 'switch', 'work']);
  const a = stateAt(morning, ch.segments[1].start + 1);
  const gap = stateAt(morning, ch.segments[2].start + 1);
  const b = stateAt(morning, ch.segments[3].start + 1);
  assert.deepEqual([a.side, a.of], [1, 2]);
  assert.equal(gap.segmentKind, 'switch');
  assert.equal(gap.side, null);
  assert.equal(gap.workTimeLeft, 0);
  assert.ok(Math.abs(gap.segmentTimeLeft - 2) < 1e-9);
  assert.deepEqual([b.side, b.of], [2, 2]);
});

test('stateAt: the final step has no next exercise; closing keeps the last step', () => {
  const lastWork = work(morning, 10);
  assert.equal(stateAt(morning, lastWork.start + 1).nextExercise, null);
  const c = stateAt(morning, morning.closing.start + 0.5);
  assert.equal(c.segmentKind, 'closing');
  assert.equal(c.chapterIndex, 10);
  assert.equal(c.exercise, 'hinge-to-reach');
  assert.equal(c.workTimeLeft, 0);
  assert.equal(c.nextExercise, null);
  assert.equal(c.finished, false);
  assert.ok(Math.abs(c.segmentTimeLeft - (morning.closing.end - morning.closing.start - 0.5)) < 1e-9);
  assert.equal(stateAt(morning, morning.audio.duration).finished, true);
});

test('stateAt: breath kind follows the pattern within 20 ms (AC-6.1)', () => {
  const w = work(evening, 0);
  const kinds = [['in', 0.01], ['in', 3.99], ['hold', 4.01], ['hold', 7.99], ['out', 8.01], ['out', 11.99], ['hold', 12.01], ['in', 16.01], ['out', 120.01]];
  for (const [kind, dt] of kinds) assert.equal(stateAt(evening, w.start + dt).breathKind, kind, `at +${dt}`);
  assert.equal(stateAt(evening, w.start - 1).breathKind, null); // transition
  assert.equal(stateAt(evening, w.end + 0.5).breathKind, null);
  const fold = work(evening, 1);
  assert.equal(stateAt(evening, fold.start + 2).breathKind, 'in');
  assert.equal(stateAt(evening, fold.start + 5).breathKind, 'out');
  assert.equal(stateAt(evening, fold.start + 10.01).breathKind, 'in');
});

test('breath steps end on the end of an exhale (AC-6.2)', () => {
  for (const ch of evening.chapters) {
    const w = ch.segments.find((s) => s.kind === 'work');
    const last = evening.breath.filter((m) => m.start >= w.start && m.end <= w.end).at(-1);
    assert.equal(last.kind, 'out');
    assert.equal(last.end, w.end);
    assert.ok(Math.abs(w.end - w.start - (ch.exercise === 'butterfly-pulses' ? 120 : 124)) < 1e-6);
  }
  assert.equal(morning.breath.length, 0);
});

test('transitions meet the settle minimums and leave room for the announcement (AC-5.1)', () => {
  const settles = [10, 5, 10, 5, 5, 5, 5, 10, 5, 10, 5];
  morning.chapters.forEach((ch, i) => {
    const len = ch.segments[0].end - ch.segments[0].start;
    assert.ok(len >= settles[i] - 1e-9, `step ${i}: ${len}`);
    assert.ok(len >= 0.6 + 0.5 + 3 - 1e-9);
  });
  for (const ch of evening.chapters) assert.ok(ch.segments[0].end - ch.segments[0].start >= 5);
});

test('resumePlan: during work plays name + remaining time, resumes at the same position (AC-9.1)', () => {
  const w = work(morning, 1);
  const p = resumePlan(morning, w.start + 12.2);
  assert.equal(p.seekTo, w.start + 12.2);
  assert.equal(p.nameClip, 1);
  assert.equal(p.remaining, '20'); // 17.8 s left -> 20
});

test('resumePlan: skips the remaining-time clip under 5 s', () => {
  const w = work(morning, 1);
  const p = resumePlan(morning, w.end - 4.9);
  assert.equal(p.nameClip, 1);
  assert.equal(p.remaining, null);
  assert.equal(resumePlan(morning, w.end - 5).remaining, '5');
});

test('resumePlan: a box position paused right after its start says two minutes (clamp)', () => {
  const w = work(evening, 0);
  assert.equal(resumePlan(evening, w.start + 0.5).remaining, '120');
  assert.equal(clampRemaining(123.5, 120), 120);
  assert.equal(clampRemaining(100, 30), 30);
  assert.equal(clampRemaining(5.5, 120), 5);
  assert.equal(clampRemaining(62.4, 120), 60);
});

test('resumePlan: transition and switch restart the segment, with no clips (AC-9.2)', () => {
  const ch = morning.chapters[4];
  const trans = resumePlan(morning, ch.segments[0].start + 4);
  assert.deepEqual(trans, { seekTo: ch.segments[0].start, nameClip: null, remaining: null });
  const sw = resumePlan(morning, ch.segments[2].start + 1);
  assert.deepEqual(sw, { seekTo: ch.segments[2].start, nameClip: null, remaining: null });
  const closing = resumePlan(morning, morning.closing.start + 1);
  assert.deepEqual(closing, { seekTo: morning.closing.start + 1, nameClip: null, remaining: null });
});

test('every resume path in the timelines points at a clip for the chosen key', () => {
  for (const tl of [morning, evening]) {
    assert.equal(tl.resume.names.length, tl.chapters.length);
    const keys = Object.keys(tl.resume.remaining).map(Number);
    assert.equal(Math.min(...keys), 5);
    for (const k of keys) assert.equal(k % 5, 0);
  }
  assert.equal(Math.max(...Object.keys(morning.resume.remaining).map(Number)), 30);
  assert.equal(Math.max(...Object.keys(evening.resume.remaining).map(Number)), 120);
});

test('next and previous chapter targets (SPEC §8.3)', () => {
  const c = morning.chapters;
  assert.equal(nextChapterStart(morning, c[2].start + 1), c[3].start);
  assert.equal(nextChapterStart(morning, c[10].start + 1), morning.closing.start);
  assert.equal(nextChapterStart(morning, morning.closing.start + 1), null);
  assert.equal(previousChapterStart(morning, c[3].start + 5), c[3].start);
  assert.equal(previousChapterStart(morning, c[3].start + 2), c[2].start);
  assert.equal(previousChapterStart(morning, 1), 0);
});

test('validProgress enforces S-6', () => {
  const now = 1_000_000_000_000;
  const entry = library.find((r) => r.id === 'morning');
  const good = { routine: 'morning', build: entry.build, t: 100, savedAt: now - 5 * 60_000 };
  assert.deepEqual(validProgress(good, library, now), good);
  assert.equal(validProgress({ ...good, routine: 'nope' }, library, now), null);
  assert.equal(validProgress({ ...good, build: 'old' }, library, now), null);
  assert.equal(validProgress({ ...good, t: NaN }, library, now), null);
  assert.equal(validProgress({ ...good, t: -1 }, library, now), null);
  assert.equal(validProgress({ ...good, t: entry.duration }, library, now), null);
  assert.equal(validProgress({ ...good, t: '5' }, library, now), null);
  assert.equal(validProgress({ ...good, savedAt: now - 61 * 60_000 }, library, now), null);
  assert.equal(validProgress({ ...good, savedAt: now + 1000 }, library, now), null);
  assert.equal(validProgress(null, library, now), null);
  assert.equal(validProgress('x', library, now), null);
});

test('formatting', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(29.2), '0:30');
  assert.equal(formatClock(124), '2:04');
  assert.equal(formatDuration(30), '30 s');
  assert.equal(formatDuration(120), '2 min');
  assert.equal(formatDuration(90), '1 min 30 s');
});
