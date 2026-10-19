/* Decks: boot.
   Runs in <head>, before the deck's own script. It
   1. removes its own tags, so the deck's "Save a copy" captures a clean file,
   2. pushes any local saves that never reached the server (tab closed mid-save),
   3. loads the deck's saved state from the server into localStorage, where the
      builder expects it, and
   4. mirrors every later save of the deck's keys back to the server.
   The deck keeps working exactly as before; the server just becomes where its
   state lives, so it no longer depends on which address the page was opened at. */
(function () {
  const B = window.__SB_BOOT;
  ['sb-boot-data', 'sb-boot'].forEach((id) => { const n = document.getElementById(id); if (n) n.remove(); });
  if (!B) return;

  // 0. the shell's styles, before the first paint, as an adopted sheet: it is not part of the
  //    page's HTML, so it never ends up in "Save a copy". The deck stays hidden until the shell is ready.
  if (!/[?&]readonly\b/.test(location.search) || true) {
    try {
      const x = new XMLHttpRequest(); x.open('GET', '/_sb/shell.css?v=' + (B.v || ''), false); x.send();
      const sheet = new CSSStyleSheet(); sheet.replaceSync(x.responseText + '\nbody:not(.sb-ready) #deck, body:not(.sb-ready) .stage-head, body:not(.sb-ready) #sb-sorter, body:not(.sb-ready) #sb-checks { visibility: hidden; }');
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      setTimeout(() => { if (document.body) document.body.classList.add('sb-ready'); }, 4000);   // never leave the deck hidden
    } catch (e) {}
  }
  let ls; try { ls = window.localStorage; ls.getItem('__sb'); } catch (e) { return; }

  const set = Storage.prototype.setItem, get = Storage.prototype.getItem, del = Storage.prototype.removeItem;
  const ours = (k) => (B.prefixes || []).some((p) => k.startsWith(p));
  const DIRTY = '__sb_dirty_' + B.slug, DBASE = '__sb_dbase_' + B.slug;   // unsent saves, and what each one started from
  const api = '/api/decks/' + B.slug + '/state';
  const TAB = Math.random().toString(36).slice(2, 10);   // so other tabs can tell this tab's saves from theirs
  const putSync = (body) => { try { const x = new XMLHttpRequest(); x.open('PUT', api, false); x.setRequestHeader('Content-Type', 'application/json'); x.send(JSON.stringify(body)); return x.status === 200 ? (JSON.parse(x.responseText || '{}') || {}) : null; } catch (e) { return null; } };
  const readMap = (k) => { try { return JSON.parse(get.call(ls, k) || '{}') || {}; } catch (e) { return {}; } };

  const readonly = /[?&]readonly\b/.test(location.search);   // tools read the saved state without writing back

  // 2. unsynced local changes win over the server copy
  //    Each save carries the value it started from, so the server merges it with what another tab saved meanwhile.
  const pending = readMap(DIRTY), pbase = readMap(DBASE);
  const keys = Object.assign({}, (B.state && B.state.keys) || {});
  if (!readonly && Object.keys(pending).length) {
    const body = { set: {}, remove: [], base: {}, tab: TAB };
    Object.entries(pending).forEach(([k, v]) => { if (v === null) { body.remove.push(k); delete keys[k]; } else { body.set[k] = v; keys[k] = v; if (k in pbase) body.base[k] = pbase[k]; } });
    const r = putSync(body);
    if (r) { Object.assign(keys, r.merged || {}); del.call(ls, DIRTY); del.call(ls, DBASE); }
  }
  const synced = Object.assign({}, keys);   // what the server holds for each key, as far as this tab knows

  // 3. the server's copy becomes this browser's copy for the deck's keys
  for (let i = ls.length - 1; i >= 0; i--) { const k = ls.key(i); if (k && ours(k) && !(k in keys)) del.call(ls, k); }
  Object.entries(keys).forEach(([k, v]) => { try { set.call(ls, k, v); } catch (e) {} });

  // 4. mirror saves back, debounced; anything unsent is kept under DIRTY until it lands
  let queue = {}, timer = null, inflight = false, retry = 0;
  // Object leaves (a slide's text array, one comment, an order) are the units of a save.
  // Keep full snapshots in localStorage for offline copies and recovery, but only send
  // changed leaves. Old deck engines benefit too; the server still accepts legacy sets.
  const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const changes = (before, after, path = [], out = []) => {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
      const had = Object.hasOwn(before, key), has = Object.hasOwn(after, key), b = before[key], a = after[key];
      if (had && has && object(b) && object(a)) changes(b, a, [...path, key], out);
      else if (!had || !has || JSON.stringify(b) !== JSON.stringify(a)) {
        const op = { path: [...path, key], hadBase: had };
        if (had) op.base = b;
        if (has) op.value = a; else op.remove = true;
        out.push(op);
      }
    }
    return out;
  };
  const requestFor = (batch) => {
    const body = { set: {}, remove: [], base: {}, patch: {}, tab: TAB };
    Object.entries(batch).forEach(([k, v]) => {
      if (v === null) { body.remove.push(k); return; }
      try {
        const b = JSON.parse(synced[k]), a = JSON.parse(v);
        if (object(b) && object(a)) { body.patch[k] = changes(b, a); return; }
      } catch (e) {}
      body.set[k] = v; body.base[k] = k in synced ? synced[k] : null;
    });
    return body;
  };
  const keep = () => { try {
    const p = readMap(DIRTY), b = readMap(DBASE);
    Object.keys(queue).forEach((k) => { if (!(k in b)) b[k] = k in synced ? synced[k] : null; });
    set.call(ls, DIRTY, JSON.stringify(Object.assign(p, queue))); set.call(ls, DBASE, JSON.stringify(b)); } catch (e) {} };
  const flush = (keepalive) => {
    // A later keepalive must not race an earlier PUT and overwrite newer changes.
    // Unsent work is already durable under DIRTY and replays on the next open.
    if (inflight) { if (!keepalive) { clearTimeout(timer); timer = setTimeout(() => flush(), 300); } return; }
    const batch = queue; queue = {}; if (!Object.keys(batch).length) return;
    const body = requestFor(batch);
    inflight = true;
    fetch(api, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: !!keepalive })
      .then((r) => { if (!r.ok) throw new Error(r.status);
        Object.entries(batch).forEach(([k, v]) => { if (v === null) delete synced[k]; else synced[k] = v; });
        retry = 0; try { del.call(ls, DIRTY); del.call(ls, DBASE); } catch (e) {} if (Object.keys(queue).length) keep();
        window.dispatchEvent(new CustomEvent('sb:saved')); })
      .catch(() => { queue = Object.assign(batch, queue); keep(); window.dispatchEvent(new CustomEvent('sb:offline'));
        retry = Math.min((retry || 1) * 2, 16); clearTimeout(timer); timer = setTimeout(() => flush(), retry * 1000); })   // keep trying: 2, 4, 8, 16 s
      .finally(() => { inflight = false; });
  };
  const note = (k, v) => { queue[k] = v; keep(); clearTimeout(timer); timer = setTimeout(() => flush(), 350); };
  window.addEventListener('online', () => { if (Object.keys(queue).length) { clearTimeout(timer); flush(); } });
  if (readonly) { window.__SB = { slug: B.slug, name: B.name, page: B.page, entry: B.entry, folder: B.folder, hideVersions: B.hideVersions || [], pulse: B.pulse, readonly: true, flush: () => {} }; return; }
  Storage.prototype.setItem = function (k, v) { set.call(this, k, v); if (this === ls && ours(String(k))) note(String(k), String(v)); };
  Storage.prototype.removeItem = function (k) { del.call(this, k); if (this === ls && ours(String(k))) note(String(k), null); };
  window.addEventListener('pagehide', () => { if (window.__DECK_FLUSH) window.__DECK_FLUSH(); flush(true); });
  window.__SB = { slug: B.slug, name: B.name, page: B.page, entry: B.entry, folder: B.folder, hideVersions: B.hideVersions || [], pulse: B.pulse, tab: TAB, flush: () => flush() };
})();
