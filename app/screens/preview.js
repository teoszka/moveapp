import { h, icon, moodIcon, themeClass } from '../dom.js';
import { formatClock, formatDuration } from '../timeline.js';
import { store } from '../store.js';

// Link built from validated values with new URL() (SPEC S-3).
function youtubeUrl(id, at) {
  const url = new URL('https://www.youtube.com/watch');
  url.searchParams.set('v', id);
  if (at != null) url.searchParams.set('t', `${Math.max(0, Math.floor(at))}s`);
  return url.href;
}

const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', text });

// props: { data, onBack(), onStart() }; returns { el, setProgress(got, total), setReady(), setFailed(message) }
export function previewScreen({ data, onBack, onStart }) {
  const { entry, routine, exercises, moods } = data;
  const source = routine.source;

  const start = h('button', { class: 'primary', type: 'button', disabled: true, onClick: onStart, text: 'Preparing audio…' });

  const rows = routine.steps.map((step, i) => {
    const ex = exercises[step.exercise];
    const more = h('div', { class: 'step-more', hidden: true },
      ex.drawing && h('img', { class: 'drawing', src: ex.drawing, alt: '' }),
      h('p', { text: ex.description }),
      step.videoAt != null && h('p', {}, link(youtubeUrl(source.youtubeId, step.videoAt), `Watch in video (${formatClock(step.videoAt)})`)));
    const button = h('button', { class: 'step', type: 'button', 'aria-expanded': 'false', onClick: () => {
      more.hidden = !more.hidden;
      button.setAttribute('aria-expanded', String(!more.hidden));
    } },
    h('span', { class: 'step-n', text: i + 1 }),
    h('span', { class: 'step-name' }, ex.name, step.breath && h('span', { class: 'breath-tag', text: 'breath' })),
    h('span', { class: 'step-dur', text: formatDuration(step.work) + (step.sides === 2 ? ' per side' : '') }));
    return h('li', {}, button, more);
  });

  const safety = !store.safetyAcked() && h('div', { class: 'safety' },
    h('span', { text: 'Stop if anything hurts.' }),
    h('button', { type: 'button', text: 'OK', onClick: (e) => { store.ackSafety(); e.currentTarget.parentElement.remove(); } }));

  const el = h('section', { class: `scr ${themeClass(moods, routine.mood)}` },
    h('div', { class: 'wrap pv' },
      h('div', { class: 'topbar' }, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Back to routines', onClick: onBack }, icon('back'))),
      h('div', { class: 'pv-hero' },
        moodIcon(routine.mood),
        h('h1', { text: routine.title }),
        h('p', { class: 'pv-meta', text: `${Math.round(entry.duration / 60)} min · ${entry.steps} ${entry.steps === 1 ? "exercise" : "exercises"} · ${routine.mood === 'energize' ? 'Energize' : 'Wind down'}` })),
      h('p', { class: 'credit' },
        `Based on “${source.title}” by ${source.creator}. `,
        link(youtubeUrl(source.youtubeId), 'Watch on YouTube')),
      safety,
      h('ol', { class: 'steps' }, rows),
      h('div', { class: 'pv-cta' }, start)));

  return {
    el,
    setProgress(got, total) {
      const mb = (n) => (n / 1e6).toFixed(1);
      start.textContent = total ? `Preparing audio… ${mb(got)} / ${mb(total)} MB` : `Preparing audio… ${mb(got)} MB`;
    },
    setReady() { start.disabled = false; start.textContent = 'Start'; },
    setFailed(message) { start.textContent = message; },
  };
}
