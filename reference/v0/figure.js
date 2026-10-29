// Side-view stick figure facing right. Pose angles are absolute, in degrees: 0 = up, 90 = forward, 180 = down, 270 = back.
// Pose fields: t torso, h head, c spine curve (> 0 rounds the back, < 0 arches it), aN/aF near/far arm [upper, fore],
// lN/lF near/far leg [thigh, shin, foot]. Missing far limbs copy the near ones with a small offset.
// Each exercise loops through its poses; the figure stands on its lowest point and stays pinned at `anchor` horizontally.
window.Figure = (function () {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 300, H = 200, GROUND = 186, STROKE = 5;
  const L = { torso: 50, neck: 8, head: 11, up: 28, fore: 26, thigh: 42, shin: 42, foot: 13 };
  const STAND = [{ t: 0 }, { t: 2, h: 5 }];
  const ANCHORS = {
    hip: j => j.hip,
    kneeN: j => j.legN[1],
    ankleN: j => j.legN[2],
    handN: j => j.armN[2],
  };

  const rad = a => (a * Math.PI) / 180;
  const step = (p, a, len) => [p[0] + Math.sin(rad(a)) * len, p[1] - Math.cos(rad(a)) * len];
  const chain = (start, angles, lens) => angles.reduce((pts, a, i) => (pts.push(step(pts[i], a, lens[i])), pts), [start]);

  // Flat number vector, so poses interpolate component by component.
  function vec(p) {
    const t = p.t || 0;
    const aN = p.aN || [180, 180], lN = p.lN || [180, 180, 90];
    const aF = p.aF || aN.map(a => a + 6);
    const lF = p.lF || lN.map((a, i) => (i < 2 ? a - 5 : a));
    return [t, p.h ?? t, p.c || 0, ...aN, ...aF, ...lN, ...lF];
  }

  function joints(v) {
    const [t, h, c] = v;
    const hip = [0, 0], neck = step(hip, t, L.torso);
    const back = [-Math.cos(rad(t)), -Math.sin(rad(t))]; // perpendicular to the spine, towards the back
    return {
      hip,
      neck,
      ctrl: [(hip[0] + neck[0]) / 2 + back[0] * 2 * c, (hip[1] + neck[1]) / 2 + back[1] * 2 * c],
      head: step(neck, h, L.neck + L.head),
      armN: chain(neck, v.slice(3, 5), [L.up, L.fore]),
      armF: chain(neck, v.slice(5, 7), [L.up, L.fore]),
      legN: chain(hip, v.slice(7, 10), [L.thigh, L.shin, L.foot]),
      legF: chain(hip, v.slice(10, 13), [L.thigh, L.shin, L.foot]),
    };
  }

  function points(j) {
    const [x, y] = j.head, r = L.head;
    return [j.hip, j.neck, [x, y - r], [x, y + r], [x - r, y], [x + r, y], ...j.armN, ...j.armF, ...j.legN, ...j.legF];
  }

  function create(svg) {
    const el = (tag, attrs, parent) => {
      const e = document.createElementNS(NS, tag);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      return (parent || svg).appendChild(e);
    };
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    el('line', { x1: 12, y1: GROUND + 2, x2: W - 12, y2: GROUND + 2, class: 'fig-ground' });
    const flip = el('g', {}), body = el('g', {}, flip);
    const armF = el('polyline', { class: 'fig-far' }, body);
    const legF = el('polyline', { class: 'fig-far' }, body);
    const torso = el('path', { class: 'fig-torso' }, body);
    const legN = el('polyline', { class: 'fig-near' }, body);
    const head = el('circle', { r: L.head, class: 'fig-head' }, body);
    const armN = el('polyline', { class: 'fig-near' }, body);

    let keys = STAND.map(vec), cycle = 4, open = false, linear = false, anchor = ANCHORS.ankleN, ax = 0, scale = 1;
    let time = 0, last = 0, paused = false;

    function current() {
      const n = keys.length;
      if (n === 1) return keys[0];
      const segs = open ? n - 1 : n;
      const pos = ((time % cycle) / cycle) * segs, i = Math.floor(pos);
      const u = linear ? pos - i : (1 - Math.cos(Math.PI * (pos - i))) / 2;
      const a = keys[i], b = keys[(i + 1) % n];
      return a.map((x, k) => x + (b[k] - x) * u);
    }

    function draw() {
      const j = joints(current());
      const lowest = Math.max(...points(j).map(p => p[1]));
      const dx = ax - anchor(j)[0], dy = -STROKE - lowest;
      body.setAttribute('transform', `translate(${W / 2} ${GROUND}) scale(${scale.toFixed(3)}) translate(${dx.toFixed(1)} ${dy.toFixed(1)})`);
      const line = pts => pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
      armF.setAttribute('points', line(j.armF));
      legF.setAttribute('points', line(j.legF));
      legN.setAttribute('points', line(j.legN));
      armN.setAttribute('points', line(j.armN));
      torso.setAttribute('d', `M${line([j.hip])} Q${line([j.ctrl])} ${line([j.neck])}`);
      head.setAttribute('cx', j.head[0].toFixed(1));
      head.setAttribute('cy', j.head[1].toFixed(1));
    }

    function frame(now) {
      if (!paused && last) time += (now - last) / 1000;
      last = now;
      if (svg.getClientRects().length) draw();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    return {
      show(ex) {
        keys = (ex.poses || STAND).map(vec);
        cycle = ex.cycle || 4;
        open = !!ex.open;
        linear = ex.ease === 'linear';
        anchor = ANCHORS[ex.anchor] || ANCHORS.ankleN;
        // Fit the whole motion: pin the anchor at x = 0, stand on the lowest point, and take the extent over all poses.
        let minX = Infinity, maxX = -Infinity, height = 0;
        for (const k of keys) {
          const j = joints(k), a = anchor(j)[0], pts = points(j), low = Math.max(...pts.map(p => p[1]));
          for (const p of pts) {
            minX = Math.min(minX, p[0] - a);
            maxX = Math.max(maxX, p[0] - a);
            height = Math.max(height, low - p[1]);
          }
        }
        ax = -(minX + maxX) / 2;
        scale = Math.min(1.6, (W - 40) / (maxX - minX + 2 * STROKE), (GROUND - 16) / (height + 2 * STROKE));
        time = 0;
        draw();
      },
      mirror(on) { flip.setAttribute('transform', on ? `translate(${W} 0) scale(-1 1)` : ''); },
      pause(on) { paused = on; },
    };
  }

  return { create };
})();
