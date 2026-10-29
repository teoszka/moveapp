import { h, themeClass } from '../dom.js';
import { stateAt, formatClock, nextChapterStart } from '../timeline.js';
import { pauseSheet } from './pause.js';

const BREATH_WORD = { in: 'Breathe in', hold: 'Hold', out: 'Breathe out' };
const HINT_MS = 5000;

// props: { data, player, onEnd() }; returns { el, destroy() }.
// Everything shown is derived from player.time and the timeline on each animation frame.
export function sessionScreen({ data, player, onEnd }) {
  const { routine, timeline, exercises, moods, entry } = data;
  const mood = moods[routine.mood];
  const nameOf = (id) => exercises[id].name;

  const top = h('div', { class: 'ss-top' }, h('span', { text: routine.title }), h('span'));
  const fills = timeline.chapters.map(() => h('b'));
  const label = h('div', { class: 'ss-label' });
  const name = h('div', { class: 'ss-name' });
  const timer = h('div', { class: 'ss-timer' });
  const next = h('div', { class: 'ss-next' });
  const desc = h('div', { class: 'ss-desc' });
  const hint = h('div', { class: 'ss-hint', text: 'Tap anywhere to pause' });
  const dim = h('div', { class: 'ss-dim' });

  const sheet = pauseSheet({
    onResume: () => player.resume(),
    onRestart: () => player.seek(timeline.chapters[stateAt(timeline, player.time).chapterIndex].start),
    onSkip: () => player.seek(nextChapterStart(timeline, player.time) ?? player.time),
    onEnd,
  });

  const el = h('section', { class: `scr ss ${themeClass(moods, routine.mood)}`, onClick: () => { if (player.playing) player.pause(); } },
    h('div', { class: 'wrap' },
      top,
      h('div', { class: 'ss-progress' }, fills.map((b) => h('i', {}, b))),
      h('div', { class: 'ss-main' }, label, name, timer, next),
      desc),
    hint, dim);

  const shown = {};
  const set = (key, node, text) => { if (shown[key] !== text) { shown[key] = text; node.textContent = text; } };
  let sheetUp = false;
  let playingSince = performance.now();
  let wasPlaying = true;
  const mountedAt = performance.now();
  let frame = 0;
  let stopped = false;
  let lastStep = -1;

  function render(now) {
    const t = player.time;
    const s = stateAt(timeline, t);
    const closing = s.segmentKind === 'closing';

    if (s.chapterIndex !== lastStep) {
      lastStep = s.chapterIndex;
      const ex = exercises[s.exercise];
      desc.replaceChildren(...(ex.drawing ? [h('img', { class: 'drawing', src: ex.drawing, alt: '' })] : []), document.createTextNode(ex.description));
      set('top', top.lastChild, `${s.step + 1} of ${entry.steps}`);
    }
    set('name', name, nameOf(s.exercise));
    set('next', next, s.nextExercise ? `Next: ${nameOf(s.nextExercise)}` : '');
    let text = '';
    if (closing) text = routine.mood === 'energize' ? 'Done' : 'Rest';
    else if (s.segmentKind === 'transition') text = 'Get ready';
    else if (s.segmentKind === 'switch') text = 'Switch sides';
    else if (s.breathKind) text = BREATH_WORD[s.breathKind];
    else if (s.of === 2) text = `Side ${s.side} of 2`;
    set('label', label, text);
    set('timer', timer, closing ? '' : formatClock(s.segmentTimeLeft));

    timeline.chapters.forEach((ch, i) => {
      const frac = i < s.chapterIndex || closing ? 1 : i === s.chapterIndex ? (t - ch.start) / (ch.end - ch.start) : 0;
      const w = `${(Math.min(1, Math.max(0, frac)) * 100).toFixed(1)}%`;
      if (shown[`p${i}`] !== w) { shown[`p${i}`] = w; fills[i].style.width = w; }
    });

    const playing = player.playing;
    if (playing && !wasPlaying) playingSince = now;
    wasPlaying = playing;
    const paused = !playing;
    if (paused !== sheetUp) {
      sheetUp = paused;
      if (paused) el.append(sheet.el); else sheet.el.remove();
    }
    if (paused) sheet.update(nameOf(s.exercise), closing ? '' : formatClock(s.segmentTimeLeft) + ' left');
    el.classList.toggle('dimmed', mood.dimAfter != null && playing && now - playingSince > mood.dimAfter * 1000);
    hint.classList.toggle('off', now - mountedAt > HINT_MS);
  }

  function loop(now) {
    if (stopped) return;
    render(now);
    frame = requestAnimationFrame(loop);
  }
  const onVisible = () => { if (!document.hidden && !stopped) { cancelAnimationFrame(frame); frame = requestAnimationFrame(loop); } };
  document.addEventListener('visibilitychange', onVisible);
  const unsubscribe = player.subscribe(() => render(performance.now()));
  frame = requestAnimationFrame(loop);
  render(performance.now());

  return {
    el,
    destroy() {
      stopped = true;
      unsubscribe();
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', onVisible);
    },
  };
}
