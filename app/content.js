// Loads content files. Routine files are requested with the routine's build hash (SPEC §12).

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export const loadLibrary = () => getJson('content/library.json');

let shared;
export function loadShared() {
  shared ??= Promise.all([getJson('content/exercises.json'), getJson('content/moods.json')])
    .then(([exercises, moods]) => ({ exercises, moods }))
    .catch((e) => { shared = undefined; throw e; });
  return shared;
}

export const withBuild = (url, build) => `${url}?b=${encodeURIComponent(build)}`;

// Every URL a routine needs, as absolute paths from the page, with the build query.
export function routineUrls(entry, timeline) {
  const base = new URL(`audio/${entry.id}/`, document.baseURI);
  const abs = (rel) => withBuild(new URL(rel, base).pathname, entry.build);
  return {
    session: abs(timeline.audio.src),
    names: timeline.resume.names.map(abs),
    remaining: Object.fromEntries(Object.entries(timeline.resume.remaining).map(([k, rel]) => [k, abs(rel)])),
  };
}

export async function loadRoutine(entry) {
  const [routine, timeline, shared] = await Promise.all([
    getJson(withBuild(`content/routines/${entry.id}.json`, entry.build)),
    getJson(withBuild(`audio/${entry.id}/timeline.json`, entry.build)),
    loadShared(),
  ]);
  return { entry, routine, timeline, ...shared, urls: routineUrls(entry, timeline) };
}

// SPEC §12: after an online launch, fetch everything for the current builds (the service worker stores it),
// then drop content-cache entries of builds that no longer exist.
export async function warmCache(library) {
  if (!navigator.onLine || !('caches' in globalThis)) return;
  const builds = new Set(library.map((r) => r.build));
  for (const entry of library) {
    try {
      const { urls } = await loadRoutine(entry);
      const all = [urls.session, ...urls.names, ...Object.values(urls.remaining)];
      for (const url of all) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
        await res.arrayBuffer();
      }
    } catch (e) {
      console.warn('warm cache failed for', entry.id, e);
      return;
    }
  }
  try {
    const cache = await caches.open('moveapp-content');
    for (const req of await cache.keys()) {
      const url = new URL(req.url);
      const versioned = url.pathname.includes('/audio/') || url.pathname.includes('/content/routines/');
      if (versioned && !builds.has(url.searchParams.get('b'))) await cache.delete(req);
    }
  } catch (e) {
    console.warn('cache prune failed', e);
  }
}
