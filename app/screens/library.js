import { h, moodIcon, themeClass } from '../dom.js';

// props: { library, moods, resumeInfo: { entry, exerciseName } | null, onOpen(entry), onContinue(entry) }
export function libraryScreen({ library, moods, resumeInfo, onOpen, onContinue, error }) {
  const cards = library.map((entry) => h(
    'button',
    { class: `card ${themeClass(moods, entry.mood)}`, type: 'button', onClick: () => onOpen(entry) },
    moodIcon(entry.mood),
    h('span', {},
      h('span', { class: 'card-title', text: entry.title }),
      h('span', { class: 'card-sum', text: entry.summary }),
      h('span', { class: 'card-meta', text: `${Math.round(entry.duration / 60)} min · ${entry.steps} ${entry.steps === 1 ? "exercise" : "exercises"}` })),
  ));
  const banner = resumeInfo && h(
    'button',
    { class: 'banner', type: 'button', onClick: () => onContinue(resumeInfo.entry) },
    h('span', { text: `Continue ${resumeInfo.entry.title}: ${resumeInfo.exerciseName}` }),
    h('small', { text: 'Resume' }),
  );
  return h('section', { class: 'scr t-lib' },
    h('div', { class: 'wrap lib' },
      h('span', { class: 'wordmark', text: 'MoveApp' }),
      h('h1', { text: 'Move by sound' }),
      banner,
      error && h('p', { class: 'lib-error', text: error }),
      cards));
}
