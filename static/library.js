// SB_LIBRARY_LOADER: data-only libraries are split by the local server.
// Raw exports and portable HTML keep complete definitions and use this as a no-op.
const slideData = (() => {
  const pending = new Map(), waiting = [];
  let active = 0;
  const ready = (ids) => ids.every((id) => !LIBRARY[id]?.__sbChunk);
  function merge(data, key) {
    for (const [id, body] of Object.entries(data)) {
      const entry = LIBRARY[id]; if (entry?.__sbChunk !== key) continue;
      for (const [k, v] of Object.entries(body)) if (!Object.hasOwn(entry, k)) entry[k] = v;
      delete entry.__sbChunk;
    }
  }
  async function chunk(key) {
    if (!pending.has(key)) pending.set(key, (async () => {
      if (active >= 6) await new Promise((resolve) => waiting.push(resolve)); else active++;
      try {
        const url = new URL(location.href); url.search = ''; url.hash = '';
        url.searchParams.set('library', window.__SB_LIBRARY_CHUNKS[key]);
        const r = await fetch(url);
        if (!r.ok) throw new Error(r.status === 409 ? 'The deck changed. Reload to see the latest slides.' : 'Could not load slides. Try again.');
        merge(await r.json(), key);
      } finally { if (waiting.length) waiting.shift()(); else active--; }
    })().catch((e) => { pending.delete(key); throw e; }));
    return pending.get(key);
  }
  const load = (ids) => Promise.all([...new Set(ids.map((id) => LIBRARY[id]?.__sbChunk).filter(Boolean))].map(chunk));
  const all = () => load(Object.keys(LIBRARY));
  function printSync() {
    if (ready(Object.keys(LIBRARY))) return;
    // A browser-menu beforeprint event cannot await a Promise. Only this native
    // print fallback blocks; the app's Print button and Ctrl/Cmd-P await normally.
    const url = new URL(location.href); url.search = '?library=all'; url.hash = '';
    const r = new XMLHttpRequest(); r.open('GET', url, false); r.send();
    if (r.status !== 200) throw new Error('Could not prepare all slides for printing.');
    const chunks = JSON.parse(r.responseText);
    for (const [number, digest] of Object.entries(window.__SB_LIBRARY_CHUNKS || {})) if (chunks[digest]) merge(chunks[digest], Number(number));
  }

  const fail = (error) => { console.error(error); if (typeof toast === 'function') toast(error.message); };
  return {ready, load, all, printSync, fail};
})();
window.DeckData = slideData;
