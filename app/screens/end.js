import { h, moodIcon, themeClass } from '../dom.js';
import { formatClock } from '../timeline.js';

export function endScreen({ data, onBack }) {
  const { entry, routine, moods } = data;
  const night = routine.mood === 'wind-down';
  return h('section', { class: `scr ${themeClass(moods, routine.mood)}` },
    h('div', { class: 'wrap end' },
      !night && moodIcon(routine.mood),
      h('h1', { text: 'Done' }),
      !night && h('p', { text: `${routine.title} · ${formatClock(entry.duration)}` }),
      h('button', { class: 'primary', type: 'button', text: 'Back to library', onClick: onBack })));
}
