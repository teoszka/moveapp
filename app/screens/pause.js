import { h } from '../dom.js';

// Pause sheet. A tap outside the buttons resumes (SPEC §8.4, §10). Returns { el, update(exerciseName, timeLeft) }.
export function pauseSheet({ onResume, onRestart, onSkip, onEnd }) {
  const sub = h('div', { class: 'sheet-sub' });
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Paused', onClick: (e) => e.stopPropagation() },
    h('div', { class: 'sheet-title', text: 'Paused' }),
    sub,
    h('button', { class: 'primary', type: 'button', text: 'Resume', onClick: onResume }),
    h('div', { class: 'sheet-row' },
      h('button', { class: 'ghost', type: 'button', text: 'Restart exercise', onClick: onRestart }),
      h('button', { class: 'ghost', type: 'button', text: 'Skip', onClick: onSkip })),
    h('button', { class: 'linkish', type: 'button', text: 'End session', onClick: onEnd }));
  const el = h('div', { class: 'sheet-wrap', onClick: (e) => { e.stopPropagation(); onResume(); } }, sheet);
  return { el, update(name, left) { const text = left ? `${name} · ${left}` : name; if (sub.textContent !== text) sub.textContent = text; } };
}
