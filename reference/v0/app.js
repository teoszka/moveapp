// Screens, timer engine, voice cues, beeps, vibration and wake lock.
// Time comes from performance.now() deltas, not counted ticks, so a throttled tab catches up instead of drifting.
(function () {
  const $ = sel => document.querySelector(sel);
  const SPEED = Math.max(1, Number(new URLSearchParams(location.search).get('speed')) || 1); // ?speed=10 for testing
  const DEFAULT_PREP = 6;
  const RING = 2 * Math.PI * 54;

  const store = {
    get(k, d) { try { const v = localStorage.getItem('moveapp.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('moveapp.' + k, JSON.stringify(v)); } catch {} },
  };

  // ---- Formatting

  const prepOf = it => it.prep ?? DEFAULT_PREP;
  const total = r => r.items.reduce((s, it) => s + prepOf(it) + it.dur, 0);
  const clock = s => { s = Math.max(0, Math.ceil(s)); return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : String(s); };
  const durLabel = s => (s < 60 ? `${s} s` : `${s / 60} min`);
  const spokenDur = s => { if (s < 60) return `${s} sekund`; const m = s / 60; return m === 1 ? '1 minuta' : m < 5 ? `${m} minuty` : `${m} minut`; };
  const exercisesWord = n => (n === 1 ? 'ćwiczenie' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'ćwiczenia' : 'ćwiczeń');
  const meta = r => `ok. ${Math.round(total(r) / 60)} min · ${r.items.length} ${exercisesWord(r.items.length)}`;

  // ---- Sound, vibration, voice, wake lock

  let ac = null;
  function unlockAudio() {
    try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); } catch {}
  }
  function beep(freq = 880, ms = 120) {
    if (!ac) return;
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + ms / 1000 + 0.02);
  }
  const buzz = pattern => navigator.vibrate && navigator.vibrate(pattern);

  const synth = window.speechSynthesis;
  let voiceOn = store.get('voice', true), plVoice = null, voicesKnown = false;
  function pickVoice() {
    const voices = synth.getVoices();
    voicesKnown = voices.length > 0;
    plVoice = voices.find(v => /^pl/i.test(v.lang)) || null;
    renderVoice();
  }
  // Some Android builds list no voices but still speak when lang is set, so only an explicit "no Polish voice" mutes.
  const canSpeak = () => synth && voiceOn && (plVoice || !voicesKnown);
  function speak(text) {
    if (!canSpeak()) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'pl-PL';
    if (plVoice) u.voice = plVoice;
    u.rate = run ? run.routine.rate : 1;
    synth.speak(u);
  }

  let lock = null;
  async function keepAwake(on) {
    try {
      if (on && !lock && 'wakeLock' in navigator) {
        lock = await navigator.wakeLock.request('screen');
        lock.addEventListener('release', () => (lock = null));
      } else if (!on && lock) {
        await lock.release();
        lock = null;
      }
    } catch {}
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && run) keepAwake(true); });

  // ---- Screens (each one is a history entry, so Android's back button walks back through them)

  let routine = null, run = null, figure = null;

  function show(id) {
    document.querySelectorAll('.screen').forEach(s => (s.hidden = s.id !== id));
    if (id === 'home') document.body.style.removeProperty('--accent');
    window.scrollTo(0, 0);
  }
  function go(id) { show(id); history.pushState({ id }, ''); }
  window.addEventListener('popstate', e => {
    if (run) stop();
    show((e.state && e.state.id) || 'home');
  });

  function renderHome() {
    $('#routines').innerHTML = Object.values(ROUTINES).map(r => `
      <button class="card" data-routine="${r.id}" style="--accent:${r.accent}">
        <span class="card-icon"><svg width="28" height="28"><use href="#i-${r.icon}"/></svg></span>
        <span class="card-body"><strong>${r.title}</strong><span>${r.tagline}</span><small>${meta(r)}</small></span>
      </button>`).join('');
    $('#voice-toggle').checked = voiceOn;
  }

  function renderVoice() {
    $('#voice-toggle').checked = voiceOn;
    $('#btn-voice').classList.toggle('muted', !voiceOn);
    const note = $('#voice-note');
    note.hidden = !(voicesKnown && !plVoice);
    note.textContent = 'Ta przeglądarka nie ma polskiego głosu, więc zostaną sygnały dźwiękowe i wibracje.';
  }
  function setVoice(on) {
    voiceOn = on;
    store.set('voice', on);
    if (!on && synth) synth.cancel();
    renderVoice();
  }

  function openRoutine(id) {
    routine = ROUTINES[id];
    document.body.style.setProperty('--accent', routine.accent);
    $('#ov-title').textContent = routine.title;
    $('#ov-meta').textContent = meta(routine);
    $('#ov-intro').textContent = routine.intro;
    let group = null;
    $('#ov-list').innerHTML = routine.items.map((it, i) => {
      let head = '';
      if (it.group && it.group !== group) head = `<li class="group">${(group = it.group)}</li>`;
      const extra = it.sides ? ' · obie strony' : '';
      return `${head}<li class="item"><span class="num">${i + 1}</span><span><strong>${it.name}</strong><small>${it.en} · ${durLabel(it.dur)}${extra}</small></span></li>`;
    }).join('');
    go('overview');
  }

  // ---- Player

  const item = () => run.routine.items[run.i];
  const phaseLen = () => (run.phase === 'prep' ? prepOf(item()) : item().dur);

  function start() {
    unlockAudio();
    keepAwake(true);
    run = { routine, i: 0, phase: 'prep', elapsed: 0, last: performance.now(), paused: false, marks: new Set() };
    go('player');
    figure.pause(false);
    renderPlay();
    enter(0, 'prep');
  }

  function enter(i, phase) {
    Object.assign(run, { i, phase, elapsed: 0, marks: new Set() });
    const it = item();
    if (phase === 'prep') {
      renderExercise(it);
      speak(`${i === 0 ? 'Przygotuj się.' : 'Teraz:'} ${it.name}. ${spokenDur(it.dur)}.${it.sides ? ' Najpierw jedna strona.' : ''}`);
    } else {
      beep(1320, 350);
      buzz(250);
    }
    renderTick();
  }

  function next() {
    if (run.i + 1 >= run.routine.items.length) finish();
    else enter(run.i + 1, 'prep');
  }

  function tick() {
    if (!run) return;
    const now = performance.now();
    if (!run.paused) run.elapsed += ((now - run.last) / 1000) * SPEED;
    run.last = now;
    for (let guard = 0; run && run.elapsed >= phaseLen() && guard < 100; guard++) {
      const extra = run.elapsed - phaseLen();
      if (run.phase === 'prep') enter(run.i, 'work');
      else next();
      if (run) run.elapsed = extra;
    }
    if (!run) return;
    cues();
    renderTick();
  }
  setInterval(tick, 100);

  function cues() {
    const it = item(), left = phaseLen() - run.elapsed;
    const once = k => !run.marks.has(k) && !!run.marks.add(k);
    if (run.phase === 'work' && it.sides && run.elapsed >= it.dur / 2 && once('half')) {
      speak('Zmień stronę');
      beep(660);
      setTimeout(() => beep(660), 180);
      buzz([120, 80, 120]);
      figure.mirror(true);
    }
    for (const s of [3, 2, 1]) if (left <= s && left > s - 1 && once('c' + s)) beep(880, 110);
  }

  function stop() {
    run = null;
    if (synth) synth.cancel();
    keepAwake(false);
  }

  function finish() {
    const r = run.routine;
    stop();
    beep(1320, 500);
    buzz([200, 100, 200]);
    speak(`Koniec. ${r.doneText}`);
    $('#done-title').textContent = `${r.title} ukończony`;
    $('#done-text').textContent = r.doneText;
    show('done');
    history.replaceState({ id: 'done' }, '');
  }

  function renderExercise(it) {
    const items = run.routine.items, nxt = items[run.i + 1];
    figure.show(it);
    figure.mirror(false);
    $('#pl-soon').hidden = !!it.poses;
    $('#pl-count').textContent = `${run.i + 1}/${items.length}`;
    $('#pl-name').textContent = it.name;
    $('#pl-en').textContent = `${it.en} · ${durLabel(it.dur)}${it.sides ? ' · obie strony' : ''}`;
    $('#pl-cues').innerHTML = it.cues.map(c => `<li>${c}</li>`).join('');
    $('#pl-avoid').innerHTML = it.avoid ? `<b>Unikaj:</b> ${it.avoid}` : '';
    $('#pl-next').textContent = nxt ? `Następne: ${nxt.name}` : 'To ostatnie ćwiczenie';
    $('#pl-video').href = `https://youtu.be/${run.routine.video}?t=${it.t}`;
  }

  function renderTick() {
    const it = item(), len = phaseLen();
    $('#pl-time').textContent = clock(len - run.elapsed);
    $('#pl-ring').style.strokeDashoffset = String((RING * run.elapsed) / len);
    $('#pl-phase').textContent = run.phase === 'prep' ? 'Przygotuj się'
      : it.sides ? (run.marks.has('half') ? 'Strona 2 z 2' : 'Strona 1 z 2') : run.routine.workLabel;
    $('#player').classList.toggle('is-prep', run.phase === 'prep');
    const before = run.routine.items.slice(0, run.i).reduce((s, x) => s + prepOf(x) + x.dur, 0);
    const done = before + (run.phase === 'work' ? prepOf(it) : 0) + run.elapsed;
    $('#pl-bar').style.width = `${(100 * done) / total(run.routine)}%`;
  }

  function renderPlay() {
    $('#btn-play').classList.toggle('paused', run.paused);
    $('#btn-play').setAttribute('aria-label', run.paused ? 'Wznów' : 'Pauza');
  }

  function togglePause() {
    run.paused = !run.paused;
    figure.pause(run.paused);
    if (run.paused && synth) synth.cancel();
    renderPlay();
  }

  function back() {
    if (run.i === 0 || (run.phase === 'work' && run.elapsed > 3)) enter(run.i, 'prep');
    else enter(run.i - 1, 'prep');
  }

  // ---- Wiring

  figure = Figure.create($('#pl-stage'));
  history.replaceState({ id: 'home' }, '');
  renderHome();
  if (synth) {
    pickVoice();
    synth.onvoiceschanged = pickVoice;
  }
  renderVoice();

  $('#routines').addEventListener('click', e => {
    const card = e.target.closest('[data-routine]');
    if (card) openRoutine(card.dataset.routine);
  });
  document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => history.back()));
  $('#voice-toggle').addEventListener('change', e => setVoice(e.target.checked));
  $('#btn-voice').addEventListener('click', () => setVoice(!voiceOn));
  $('#btn-start').addEventListener('click', start);
  $('#btn-play').addEventListener('click', togglePause);
  $('#btn-skip').addEventListener('click', next);
  $('#btn-prev').addEventListener('click', back);
})();
