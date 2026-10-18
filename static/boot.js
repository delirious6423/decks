/* Slide Builder: boot.
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
  const DIRTY = '__sb_dirty_' + B.slug;
  const api = '/api/decks/' + B.slug + '/state';
  const putSync = (body) => { try { const x = new XMLHttpRequest(); x.open('PUT', api, false); x.setRequestHeader('Content-Type', 'application/json'); x.send(JSON.stringify(body)); return x.status === 200; } catch (e) { return false; } };

  const readonly = /[?&]readonly\b/.test(location.search);   // tools read the saved state without writing back

  // 2. unsynced local changes win over the server copy
  let pending = {};
  try { pending = JSON.parse(get.call(ls, DIRTY) || '{}'); } catch (e) { pending = {}; }
  const keys = Object.assign({}, (B.state && B.state.keys) || {});
  if (!readonly && Object.keys(pending).length) {
    const body = { set: {}, remove: [] };
    Object.entries(pending).forEach(([k, v]) => { if (v === null) { body.remove.push(k); delete keys[k]; } else { body.set[k] = v; keys[k] = v; } });
    if (putSync(body)) del.call(ls, DIRTY);
  }

  // 3. the server's copy becomes this browser's copy for the deck's keys
  for (let i = ls.length - 1; i >= 0; i--) { const k = ls.key(i); if (k && ours(k) && !(k in keys)) del.call(ls, k); }
  Object.entries(keys).forEach(([k, v]) => { try { set.call(ls, k, v); } catch (e) {} });

  // 4. mirror saves back, debounced; anything unsent is kept under DIRTY until it lands
  let queue = {}, timer = null, inflight = false;
  const keep = () => { try { const p = JSON.parse(get.call(ls, DIRTY) || '{}'); Object.assign(p, queue); set.call(ls, DIRTY, JSON.stringify(p)); } catch (e) {} };
  const flush = (keepalive) => {
    if (inflight && !keepalive) { timer = setTimeout(() => flush(), 300); return; }
    const batch = queue; queue = {}; if (!Object.keys(batch).length) return;
    const body = { set: {}, remove: [] };
    Object.entries(batch).forEach(([k, v]) => { if (v === null) body.remove.push(k); else body.set[k] = v; });
    inflight = true;
    fetch(api, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: !!keepalive })
      .then((r) => { if (!r.ok) throw new Error(r.status); try { del.call(ls, DIRTY); } catch (e) {} window.dispatchEvent(new CustomEvent('sb:saved')); })
      .catch(() => { queue = Object.assign(batch, queue); keep(); window.dispatchEvent(new CustomEvent('sb:offline')); })
      .finally(() => { inflight = false; });
  };
  const note = (k, v) => { queue[k] = v; keep(); clearTimeout(timer); timer = setTimeout(() => flush(), 350); };
  if (readonly) { window.__SB = { slug: B.slug, name: B.name, page: B.page, entry: B.entry, folder: B.folder, hideVersions: B.hideVersions || [], readonly: true, flush: () => {} }; return; }
  Storage.prototype.setItem = function (k, v) { set.call(this, k, v); if (this === ls && ours(String(k))) note(String(k), String(v)); };
  Storage.prototype.removeItem = function (k) { del.call(this, k); if (this === ls && ours(String(k))) note(String(k), null); };
  window.addEventListener('pagehide', () => flush(true));
  window.__SB = { slug: B.slug, name: B.name, page: B.page, entry: B.entry, folder: B.folder, hideVersions: B.hideVersions || [], flush: () => flush() };
})();
