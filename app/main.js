// Boot and routing between screens (SPEC §3). Screens: library, preview, session, end.

import { loadLibrary, loadShared, loadRoutine, warmCache } from './content.js';
import { Player } from './player.js';
import { store } from './store.js';
import { stateAt, validProgress } from './timeline.js';
import { libraryScreen } from './screens/library.js';
import { previewScreen } from './screens/preview.js';
import { sessionScreen } from './screens/session.js';
import { endScreen } from './screens/end.js';

const app = document.getElementById('app');
const player = new Player();
const dark = matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => { document.documentElement.dataset.theme = dark.matches ? 'dark' : 'light'; };
applyTheme();
dark.addEventListener('change', applyTheme);

let library = [];
let moods = {};
let current = null; // { name, destroy? }
let navToken = 0; // invalidates async work when the user moves on

function mount(name, el, destroy) {
  if (current?.destroy) current.destroy();
  current = { name, destroy };
  app.replaceChildren(el);
  scrollTo(0, 0);
}

async function showLibrary() {
  const token = ++navToken;
  let resumeInfo = null;
  let error = null;
  if (!library.length) {
    try { library = await loadLibrary(); } catch (e) { console.warn(e); error = 'Could not load the routines. Check your connection and reload.'; }
  }
  if (library.length) {
    try { moods = (await loadShared()).moods; } catch (e) { console.warn(e); error = 'Could not load the app data. Check your connection and reload.'; }
    const saved = store.getProgress();
    const valid = validProgress(saved, library, Date.now());
    if (saved && !valid) store.clearProgress();
    if (valid) {
      const entry = library.find((r) => r.id === valid.routine);
      try {
        const data = await loadRoutine(entry);
        resumeInfo = { entry, exerciseName: data.exercises[stateAt(data.timeline, valid.t).exercise].name };
      } catch (e) { console.warn('continue banner skipped', e); }
    }
  }
  if (token !== navToken) return;
  mount('library', libraryScreen({ library, moods, resumeInfo, error, onOpen: openPreview, onContinue: continueSession }));
}

async function openPreview(entry) {
  const token = ++navToken;
  let data;
  try { data = await loadRoutine(entry); } catch (e) { console.warn(e); return; }
  if (token !== navToken) return;
  history.pushState({ screen: 'preview' }, '');
  const view = previewScreen({ data, onBack: () => history.back(), onStart: () => beginSession(data, null) });
  mount('preview', view.el);
  try {
    await player.load(data, (got, total) => { if (token === navToken) view.setProgress(got, total); });
    if (token === navToken) view.setReady();
  } catch (e) {
    console.warn(e);
    if (token === navToken) view.setFailed('Could not load the audio. Go back and try again.');
  }
}

async function continueSession(entry) {
  const token = ++navToken;
  const valid = validProgress(store.getProgress(), library, Date.now());
  if (!valid) { showLibrary(); return; }
  try {
    const data = await loadRoutine(entry);
    await player.load(data);
    if (token !== navToken) return;
    history.pushState({ screen: 'preview' }, '');
    beginSession(data, valid.t);
  } catch (e) { console.warn(e); }
}

function beginSession(data, resumeAt) {
  navToken++;
  history.pushState({ screen: 'session' }, '');
  player.onEnded = () => showEnd(data);
  if (resumeAt == null) player.start(); else player.continueAt(resumeAt);
  const view = sessionScreen({ data, player, onEnd: () => { player.end(); showLibrary(); } });
  mount('session', view.el, view.destroy);
}

function showEnd(data) {
  navToken++;
  mount('end', endScreen({ data, onBack: showLibrary }));
}

// Android back: in a session it pauses instead of leaving; elsewhere it goes up to the library.
addEventListener('popstate', () => {
  if (current?.name === 'session') {
    player.pause();
    history.pushState({ screen: 'session' }, '');
  } else if (current?.name !== 'library') {
    showLibrary();
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('service worker failed', e));
}

showLibrary().then(() => { if (library.length) setTimeout(() => warmCache(library), 1500); });
