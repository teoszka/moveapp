// DOM helpers. Content is never parsed as markup (SPEC S-3): text via textContent, elements via createElement.

const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

const ICONS = {
  sun: { attrs: { 'stroke-linecap': 'round' }, parts: [['circle', { cx: 12, cy: 12, r: 4.2 }], ['path', { d: 'M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6' }]] },
  moon: { attrs: { 'stroke-linejoin': 'round' }, parts: [['path', { d: 'M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1Z' }]] },
  back: { attrs: { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': 2 }, parts: [['path', { d: 'M15 5l-7 7 7 7' }]] },
};

export function icon(name) {
  const def = ICONS[name];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'ico');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('aria-hidden', 'true');
  for (const [k, v] of Object.entries(def.attrs)) svg.setAttribute(k, v);
  for (const [tag, attrs] of def.parts) {
    const part = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) part.setAttribute(k, v);
    svg.append(part);
  }
  return svg;
}

export const moodIcon = (mood) => icon(mood === 'energize' ? 'sun' : 'moon');
export const themeClass = (moods, mood) => (moods[mood]?.theme === 'night' ? 't-night' : 't-day');
