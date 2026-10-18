/* Slide Builder shell.
   Wraps a deck page served by the Slide Builder server with:
   - a top bar (logo, version, filters, Claude's live status, view switch, present),
   - focus view: filmstrip | one slide | comment thread, both side bars collapsible,
   - scroll view: the deck as before, with Claude's replies under each slide,
   - live updates: replies appear as Claude posts them, and the page reloads itself
     when Claude finishes a round (or shows a banner if you are typing).
   It only talks to the deck through its existing DOM: comments still live in each
   slide's .fb box and are saved by the deck itself. */
(function () {
  const SB = window.__SB;
  const deck = document.getElementById('deck');
  if (!SB || !deck) return;

  // ---------- small helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const h = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const api = (p) => '/api/decks/' + SB.slug + (p ? '/' + p : '');
  const post = (op) => fetch(api('review'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(op) }).then((r) => r.json());
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const UIKEY = '__sb_ui';
  const ui = (() => { try { return Object.assign({ view: 'focus', noleft: false, noright: false }, JSON.parse(localStorage.getItem(UIKEY) || '{}')); } catch (e) { return { view: 'focus', noleft: false, noright: false }; } })();
  const saveUi = () => { try { localStorage.setItem(UIKEY, JSON.stringify(ui)); } catch (e) {} };

  // ---------- the deck, as the builders expose it ----------
  const wraps = () => [...deck.children].filter((n) => n.dataset && n.dataset.id);
  let wmap = null;   // id -> slide wrapper, rebuilt when the deck re-renders
  const wrapOf = (id) => { if (!id) return null; const w = wmap && wmap.get(id); if (w && w.parentNode === deck) return w; wmap = new Map(wraps().map((x) => [x.dataset.id, x])); return wmap.get(id) || null; };
  const lib = () => { try { return LIBRARY; } catch (e) { return {}; } };            // eslint-disable-line no-undef
  const title = (id) => { let t = ''; try { if (typeof titleOf === 'function') t = titleOf(id); } catch (e) {} if (!t) { const b = lib()[id] || {}; t = String(b.title || b.q || id); } return t.replace(/<[^>]+>/g, '').replace(/\*\*/g, ''); }; // eslint-disable-line no-undef
  const notesOf = (id) => String((lib()[id] || {}).notes || '').replace(/<[^>]+>/g, '');
  const fbOf = (id) => { const w = wrapOf(id); return w && w.querySelector('textarea.fb'); };
  const commentOf = (id) => { const f = fbOf(id); return f ? f.value.trim() : ''; };
  const setComment = (id, v) => { const f = fbOf(id); if (!f) return; f.value = v; f.dispatchEvent(new Event('input', { bubbles: true })); };
  // the box a slide is scaled into: .slide-frame in the workshop engine, .slide-box in the pitch builder
  const frameOf = (w) => { const sl = w.querySelector('.slide'); return (sl && sl.parentElement !== w && sl.parentElement) || w; };
  // scale slides to their frames: every width first, then every transform, so the browser lays out once
  // (the deck's own fitSlides alternates the two, one layout per slide). One slide in focus and checks.
  const fitIn = (list) => { const fs = list.map((w) => w.querySelector('.slide') && frameOf(w)).filter((f) => f && f.matches('.slide-frame, .slide-box')), k = fs.map((f) => f.clientWidth / 1000);
    fs.forEach((f, i) => { const s = f.querySelector('.slide'); if (s) s.style.transform = k[i] && isFinite(k[i]) ? `scale(${k[i]})` : 'none'; }); return fs.length; };
  const refit = () => {
    const one = (ui.view === 'focus' || ui.view === 'checks') && cur && wrapOf(cur);
    try { if (fitIn(one ? [one] : wraps())) return; } catch (e) {}
    try { if (typeof fitSlides === 'function') fitSlides(); else window.dispatchEvent(new Event('resize')); } catch (e) { window.dispatchEvent(new Event('resize')); } }; // eslint-disable-line no-undef
  const presenting = () => { try { return !!showing; } catch (e) { return false; } };   // eslint-disable-line no-undef
  const sideSelect = $('.sidebar select');

  // ---------- review state from the server ----------
  let review = { comments: {}, replies: {}, changed: {}, rounds: [], claude: null };
  let filter = 'all', cur = null;
  const info = (id) => {
    const text = commentOf(id), rep = review.replies[id], ch = review.changed[id];
    const fresh = !!rep && (!text || rep.forText === text || !rep.forText);
    const st = fresh ? rep.status : null, meta = review.comments[id] || {};
    return { text, rep, fresh, st, ch, hold: meta.state === 'draft' && meta.text === text,
      open: !!text && st !== 'done' && st !== 'skipped', question: st === 'question', replied: fresh && st !== 'working', changed: !!ch };
  };
  const FILTERS = [['all', 'All'], ['open', 'Open'], ['replied', 'Replied'], ['questions', 'Questions'], ['changed', 'Changed']];
  const pass = (id, f = filter) => { if (f === 'all') return true; const i = info(id); return (f === 'open' && i.open) || (f === 'replied' && i.replied) || (f === 'questions' && i.question) || (f === 'changed' && i.changed); };
  const visible = () => wraps().map((w) => w.dataset.id).filter((id) => pass(id));

  // ---------- top bar ----------
  const top = h('div'); top.id = 'sb-top';
  top.innerHTML = `<a href="/" title="All decks"><img class="sb-logo" src="/_sb/logo.svg" alt="Slide Builder"></a>
    <a href="/" class="sb-btn sb-back" title="Back to the dashboard of all decks">← <span class="sb-lbl">All decks</span></a><span class="sb-sep"></span>
    <span class="sb-deck" title="${esc(SB.name)}">${esc(SB.name)}</span>
    ${sideSelect ? '<select id="sb-version" title="Version"></select>' : ''}
    <div class="sb-chips" id="sb-chips" role="group" aria-label="Filter slides"></div>
    <span class="sb-grow"></span>
    <span class="sb-claude" id="sb-claude" role="status"><i></i><span></span></span>
    <span class="sb-saved" id="sb-saved" title="Every edit and comment saves to disk, next to the deck">Saved</span>
    <button class="sb-btn" id="sb-resolve" hidden></button>
    <div class="sb-seg" role="group" aria-label="View"><button data-v="focus" title="Focus (F)">Focus</button><button data-v="scroll" title="Scroll (S)">Scroll</button><button data-v="sorter" title="Sorter (G)">Sorter</button><button data-v="checks" title="Checks (C)">Checks</button></div>
    <button class="sb-btn" id="sb-hide" title="Titles only: hide everything but the titles, to test that each one says the point (H). Space reveals one slide.">Titles<span class="sb-long"> only</span></button>
    <button class="sb-btn icon" id="sb-left" title="Show or hide the left side bar ( [ )">◧</button>
    <button class="sb-btn icon" id="sb-right" title="Show or hide notes ( ] )">◨</button>
    <button class="sb-btn" id="sb-ask" title="Copy a prompt that asks Claude (or Codex) to work through your comments">Ask Claude<span class="sb-n" id="sb-ask-n"></span></button>
    ${$('#present-btn') ? '<button class="sb-btn red" id="sb-present" title="Present from this slide">▶<span class="sb-long"> Present</span></button>' : ''}
    <div class="sb-menu" id="sb-more"><button class="sb-btn icon" aria-label="More">⋯</button><div></div></div>`;
  document.body.prepend(top);
  document.body.classList.add('sb-on');

  if (sideSelect) {
    const vs = $('#sb-version');
    const hidden = new Set(SB.hideVersions || []);
    const syncVersions = () => { vs.innerHTML = [...sideSelect.options].filter((o) => !hidden.has(o.value)).map((o) => `<option value="${esc(o.value)}">${esc(o.textContent)}</option>`).join(''); vs.value = sideSelect.value; };
    syncVersions();
    if (hidden.has(sideSelect.value)) { const first = [...sideSelect.options].find((o) => !hidden.has(o.value)); if (first) { sideSelect.value = first.value; sideSelect.dispatchEvent(new Event('change', { bubbles: true })); vs.value = first.value; } }
    vs.addEventListener('change', () => { sideSelect.value = vs.value; sideSelect.dispatchEvent(new Event('change', { bubbles: true })); });
    sideSelect.addEventListener('change', () => { vs.value = sideSelect.value; });
  }

  const more = $('#sb-more'), moreBox = more.querySelector('div');
  const proxy = (sel, label) => { const t = $(sel); if (!t) return; const b = h('button', null, esc(label)); b.addEventListener('click', () => { more.classList.remove('open'); t.click(); }); moreBox.appendChild(b); };
  proxy('#presenter-btn', 'Presenter view');
  proxy('#export-btn', 'Export PDF (print)');
  proxy('#save-copy', 'Save a copy with my edits');
  proxy('#copy-edits', 'Copy edits');
  proxy('#notes-toggle', 'Show facilitator notes (scroll view)');
  const help = h('div'); help.id = 'sb-help';
  help.innerHTML = `<h4>How this works</h4><ul>
    <li>Click any text on a slide to edit it. It saves to disk as you type.</li>
    <li>Write a comment for a slide, then say <b>process changes</b> to Claude. Tick “Still drafting” to hold one back.</li>
    <li>Claude replies under your comment. <b>Looks good</b> clears it; <b>Reopen</b> sends it back.</li>
    <li>In the left bar, × leaves a slide out of this version; add slides back from “Not in this version”.</li>
    <li>Present, PDF export, and “Save a copy” (the file to send a client) are in this ⋯ menu and the top bar.</li></ul>
    <h4 style="margin-top:14px">Keyboard shortcuts</h4>
    <table class="sb-keys">
      <tr><td><kbd>F</kbd> <kbd>S</kbd> <kbd>G</kbd> <kbd>C</kbd></td><td>Focus, Scroll, Sorter, Checks</td></tr>
      <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>Previous and next slide (<kbd>Home</kbd> <kbd>End</kbd>: first and last)</td></tr>
      <tr><td><kbd>H</kbd></td><td>Titles only (hide the content)</td></tr>
      <tr><td><kbd>[</kbd> <kbd>]</kbd></td><td>Hide the slides bar or the notes bar</td></tr>
      <tr><td><kbd>1</kbd>–<kbd>5</kbd></td><td>Checks: 5-second test, 10-second test, horizontal flow, vertical flow, guides. From Focus or Scroll they run that check on the slide you’re on</td></tr>
      <tr><td><kbd>Space</kbd></td><td>Start a timed test, or reveal the slide</td></tr>
      <tr><td><kbd>A</kbd> <kbd>M</kbd></td><td>After a timed test: show again, missed it</td></tr>
      <tr><td><kbd>P</kbd> <kbd>L</kbd></td><td>Horizontal flow: paragraphs, one per line</td></tr>
      <tr><td><kbd>?</kbd></td><td>Show this card</td></tr>
    </table>`;
  document.body.appendChild(help);
  { const b = h('button', null, 'How this works and shortcuts (?)'); b.addEventListener('click', (e) => { e.stopPropagation(); more.classList.remove('open'); help.classList.toggle('on'); }); moreBox.prepend(b); }
  document.addEventListener('click', (e) => { if (!help.contains(e.target)) help.classList.remove('on'); });
  { const b = h('button', null, 'Open the plain deck file'); b.addEventListener('click', () => { window.open(location.pathname + '?raw=1', '_blank'); }); moreBox.appendChild(b); }
  more.firstElementChild.addEventListener('click', (e) => { e.stopPropagation(); more.classList.toggle('open'); });
  document.addEventListener('click', () => more.classList.remove('open'));
  const pres = $('#sb-present');
  if (pres) pres.addEventListener('click', (e) => { if (cur && ui.view === 'focus') { const w = wrapOf(cur); if (w) w.scrollIntoView({ block: 'center' }); } $('#present-btn').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: e.shiftKey })); });

  // ---------- getting help from the agent ----------
  const toast = h('div'); toast.id = 'sb-toast'; document.body.appendChild(toast);
  let toastT = null; const say = (msg) => { toast.innerHTML = msg; toast.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toast.classList.remove('on'), 5200); };
  const copyText = async (t) => { try { await navigator.clipboard.writeText(t); return true; } catch (e) { return false; } };
  const deckFile = () => `${SB.folder}/${SB.entry}`;
  const askPrompt = () => [
    `Work through the comments on my slide deck “${SB.name}” in the Slide Builder.`,
    `Deck file: ${deckFile()} (open at ${location.origin}${location.pathname}).`,
    `If you have the slide-builder skill, this is “process changes”. Otherwise, from ${SB.app || 'the Slide Builder folder'}:`,
    `1. ./sb comments ${SB.slug} lists my comments; ./sb edits ${SB.slug} shows text I edited on the slides.`,
    `2. For each comment, change the deck file, then reply on that slide: ./sb reply ${SB.slug} <slide-id> done "what changed" (question to ask me something, skipped to say why not).`,
    `3. Check your work: ./sb shot ${SB.slug} <slide-ids> and ./sb audit ${SB.slug}.`,
    `4. Finish: ./sb export ${SB.slug}, then ./sb round ${SB.slug} --summary "what changed", then ./sb commit ${SB.slug} "Round N".`,
    'Titles are plain sentences, two lines at most, and every slide passes Checks › Guides.'].join('\n');
  $('#sb-ask').addEventListener('click', async () => {
    const ok = await copyText(askPrompt());
    say(ok ? '<b>Prompt copied.</b> Paste it into Claude Code or Codex. In Claude Code you can also just say “process changes”.' : 'Couldn’t copy. In Claude Code, say “process changes”.');
  });
  fetch(api('')).then((r) => r.json()).then((d) => {   // a deck just made from the New deck form: say what's next
    const key = '__sb_next_' + SB.slug; let gone = false; try { gone = localStorage.getItem(key) === '1'; } catch (e) {}
    if (!d || !d.prompt || (d.rounds || []).length || gone) return;
    const nb = h('div'); nb.id = 'sb-next';
    nb.innerHTML = '<span><b>Next:</b> paste your prompt into Claude Code or Codex, and it builds the first draft from your brief. You’ll see its progress up here.</span><span><button class="sb-btn" data-c>Copy prompt</button> <button class="sb-btn icon" data-x aria-label="Dismiss">×</button></span>';
    nb.querySelector('[data-c]').addEventListener('click', async () => { say((await copyText(d.prompt)) ? '<b>Prompt copied.</b> Paste it into Claude Code or Codex.' : 'Couldn’t copy the prompt.'); });
    nb.querySelector('[data-x]').addEventListener('click', () => { nb.remove(); document.body.classList.remove('sb-has-next'); size(); try { localStorage.setItem(key, '1'); } catch (e) {} });
    document.body.appendChild(nb); document.body.classList.add('sb-has-next'); size();
  }).catch(() => {});
  { let seen = false; try { seen = localStorage.getItem('__sb_welcome') === '1'; } catch (e) {}
    if (!seen && !SB.readonly) {
      const wc = h('div'); wc.id = 'sb-welcome';
      wc.innerHTML = `<h4>Three things to know</h4><ol>
        <li><b>Click any text on a slide to edit it.</b> It saves as you type.</li>
        <li><b>Leave a comment under a slide</b> for anything you want changed.</li>
        <li><b>Click Ask Claude</b> (or say “process changes” in Claude Code). Claude edits the deck, replies under each comment, and exports a PDF.</li></ol>
        <p><kbd>N</kbd> adds a slide · <kbd>1</kbd>–<kbd>5</kbd> run the checks · <kbd>?</kbd> shows every shortcut</p><button class="sb-btn red">Got it</button>`;
      wc.querySelector('button').addEventListener('click', () => { wc.remove(); try { localStorage.setItem('__sb_welcome', '1'); } catch (e) {} });
      document.body.appendChild(wc);
    } }

  const banner = h('div'); banner.id = 'sb-banner';
  banner.innerHTML = '<span>Claude updated this deck.</span><button class="sb-btn">Reload</button>';
  banner.querySelector('button').addEventListener('click', () => reload());
  document.body.appendChild(banner);

  const saved = $('#sb-saved');
  window.addEventListener('sb:saved', () => { saved.textContent = 'Saved'; saved.classList.remove('off'); });
  window.addEventListener('sb:offline', () => { saved.textContent = 'Server offline: saving in this browser'; saved.classList.add('off'); });

  let dragId = null;   // the slide being dragged, in the filmstrip or the sorter
  // ---------- focus view: filmstrip and thread panel ----------
  const film = h('aside'); film.id = 'sb-film';
  film.innerHTML = '<div class="sb-colhead"><span id="sb-film-h">Slides</span><button data-hide="left" title="Hide ( [ )">«</button></div><div class="sb-scroll" id="sb-film-list"></div>';
  const panel = h('aside'); panel.id = 'sb-panel';
  panel.innerHTML = '<div class="sb-colhead"><span>Notes</span><button data-hide="right" title="Hide ( ] )">»</button></div><div class="sb-scroll" id="sb-panel-body"></div>';
  document.body.append(film, panel);
  const sorter = h('div'); sorter.id = 'sb-sorter';
  deck.before(sorter);
  const checks = h('div'); checks.id = 'sb-checks';
  deck.before(checks);
  const under = h('div', 'sb-under');
  under.innerHTML = '<span id="sb-pos"></span><span><button class="sb-btn" id="sb-prev">← Previous</button> <button class="sb-btn red" id="sb-reveal" title="Show or hide this slide\'s content (space)">Reveal</button> <button class="sb-btn" id="sb-next">Next →</button></span>';
  deck.after(under);
  film.querySelector('[data-hide]').addEventListener('click', () => toggleSide('left'));
  panel.querySelector('[data-hide]').addEventListener('click', () => toggleSide('right'));
  $('#sb-left').addEventListener('click', () => toggleSide('left'));
  $('#sb-right').addEventListener('click', () => toggleSide('right'));
  $('#sb-prev').addEventListener('click', () => step(-1));
  $('#sb-next').addEventListener('click', () => step(1));
  $('#sb-reveal').addEventListener('click', () => reveal());
  under.addEventListener('click', (e) => { if (e.target.closest('[data-keys]')) { e.stopPropagation(); more.classList.remove('open'); help.classList.toggle('on'); } });

  const thumbs = new IntersectionObserver((es) => es.forEach((e) => { if (!e.isIntersecting) return; const box = e.target; thumbs.unobserve(box); fillThumb(box); }), { root: $('#sb-film-list'), rootMargin: '300px' });
  function fillThumb(box) {
    const w = wrapOf(box.dataset.id); const s = w && w.querySelector('.slide'); if (!s) return;
    const c = s.cloneNode(true);
    c.querySelectorAll('.ctrls, .slide-tag, .sb-badge').forEach((x) => x.remove());
    c.querySelectorAll('[contenteditable]').forEach((x) => x.removeAttribute('contenteditable'));
    c.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
    c.style.transform = ''; box.innerHTML = ''; box.appendChild(c);
  }

  const dotsFor = (id) => { const i = info(id); let d = '';
    if (i.st === 'working') d += '<span class="sb-dot w">Claude working</span>';
    else if (i.question) d += '<span class="sb-dot q">Question</span>';
    else if (i.st === 'done' && i.text) d += '<span class="sb-dot d">Done</span>';
    else if (i.st === 'skipped' && i.text) d += '<span class="sb-dot">Skipped</span>';
    else if (i.open) d += `<span class="sb-dot c">${i.hold ? 'Drafting' : 'Comment'}</span>`;
    if (i.changed) d += '<span class="sb-dot x">Changed</span>';
    return d; };

  let filmKey = '';
  function renderFilm() {
    const list = $('#sb-film-list'), all = wraps().map((w) => w.dataset.id), ids = visible();
    $('#sb-film-h').textContent = filter === 'all' ? `Slides · ${all.length}` : `${ids.length} of ${all.length}`;
    const outIds = [...document.querySelectorAll('#block-list input[data-id]')].filter((i) => !i.checked).map((i) => i.dataset.id);
    const key = [filter, all.join(','), ids.join(','), outIds.join(',')].join('|');
    if (key === filmKey && list.firstChild) {   // same slides in the same order: refresh labels, keep the thumbnails
      list.querySelectorAll('.sb-fi').forEach((b) => { const id = b.dataset.id, t = title(id), d = b.querySelector('.sb-dots'), fl = b.querySelector('.sb-fl'), html = dotsFor(id);
        b.classList.toggle('on', id === cur); if (d.innerHTML !== html) d.innerHTML = html; if (fl.textContent !== t) { fl.textContent = t; b.title = t; } });
      return;
    }
    filmKey = key;
    list.innerHTML = '';
    if (!ids.length) { list.appendChild(h('div', 'sb-empty', 'Nothing here. Pick another filter.')); return; }
    ids.forEach((id) => {
      const n = all.indexOf(id) + 1;
      const b = h('button', 'sb-fi' + (id === cur ? ' on' : ''));
      b.dataset.id = id; b.title = title(id);
      b.innerHTML = `<span class="sb-fn">${n}</span><span class="sb-thumb" data-id="${esc(id)}"></span><span class="sb-fn"></span><span class="sb-fl">${esc(title(id))}</span><span class="sb-fn"></span><span class="sb-dots">${dotsFor(id)}</span><span class="sb-x" role="button" title="Leave this slide out of this version" aria-label="Leave out">×</span>`;
      if (filter === 'all') {   // drag up and down to reorder
        b.draggable = true;
        b.addEventListener('dragstart', (e) => { dragId = id; b.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); });
        b.addEventListener('dragend', () => { dragId = null; list.querySelectorAll('.sb-fi').forEach((x) => x.classList.remove('dragging', 'drop-before', 'drop-after')); });
        b.addEventListener('dragover', (e) => { if (!dragId || dragId === id) return; e.preventDefault(); const r = b.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
          list.querySelectorAll('.sb-fi').forEach((x) => x.classList.remove('drop-before', 'drop-after')); b.classList.add(after ? 'drop-after' : 'drop-before'); });
        b.addEventListener('drop', (e) => { e.preventDefault(); if (!dragId || dragId === id) return; const after = b.classList.contains('drop-after');
          const order = all.filter((x) => x !== dragId); order.splice(order.indexOf(id) + (after ? 1 : 0), 0, dragId); const moved = dragId; saveOrder(order); setTimeout(() => go(moved, true), 200); });
      }
      b.addEventListener('click', (e) => {
        if (e.target.closest('.sb-x')) { e.stopPropagation(); const w = wrapOf(id), rm = w && w.querySelector('.ctrls [data-a="rm"]'); if (rm) { const k = ids.indexOf(id); if (id === cur) cur = ids[k + 1] || ids[k - 1] || null; rm.click(); } return; }
        go(id);
      });
      list.appendChild(b);
      thumbs.observe(b.querySelector('.sb-thumb'));
    });
    const out = [...document.querySelectorAll('#block-list input[data-id]')].filter((i) => !i.checked && lib()[i.dataset.id]);
    if (out.length && filter === 'all') {
      const ex = h('details', 'sb-extras'); ex.open = !!ui.extrasOpen;
      ex.innerHTML = `<summary>Not in this version · ${out.length}</summary>`;
      ex.addEventListener('toggle', () => { ui.extrasOpen = ex.open; saveUi(); });
      out.forEach((inp) => {
        const id = inp.dataset.id, b = lib()[id] || {};
        const tag = b.fac ? 'Facilitator' : b.prop ? 'Proposed' : b.alt ? 'Extra' : '';
        const r = h('div', 'sb-ex', `<span>${tag ? `<span class="sb-tag">${tag}</span>` : ''}${esc(title(id))}</span><button class="sb-btn">Add</button>`);
        r.querySelector('button').addEventListener('click', () => { inp.click(); setTimeout(() => go(id), 250); });
        ex.appendChild(r);
      });
      list.appendChild(ex);
    }
  }


  // the right bar: the slide's notes and what changed. Comments live under the slide itself.
  function renderPanel() {
    const body = $('#sb-panel-body'); if (!cur) { body.innerHTML = '<div class="sb-empty">No slide selected.</div>'; return; }
    const id = cur, i = info(id), all = wraps().map((w) => w.dataset.id), n = all.indexOf(id) + 1;
    const notes = notesOf(id);
    body.innerHTML = `<div class="sb-sec"><p class="sb-title">${esc(title(id))}</p><div class="sb-meta">Slide ${n} of ${all.length} · ${esc(id)}</div></div>
      <div class="sb-sec" id="sb-change-slot">${changeBlock(id, i)}</div>
      <div class="sb-sec"><h4>Notes and sources</h4>${notes ? `<div class="sb-notes">${esc(notes)}</div>` : '<div class="sb-hint">No notes on this slide.</div>'}</div>
      <div class="sb-sec"><div class="sb-hint">Comment under the slide, then click Ask Claude (or say “process changes” in Claude Code). Tick “Still drafting” to hold one back.</div></div>`;
  }
  const changeBlock = (id, i) => i.ch ? `<h4>Changed in round ${esc(i.ch.round || '')}<button class="sb-btn" data-act="seen" style="padding:2px 8px;font-size:11.5px;text-transform:none;letter-spacing:0">Mark as seen</button></h4><div class="sb-change">${esc(i.ch.note || 'Updated this round.')}</div>` : '<div class="sb-hint">No changes on this slide in the last round.</div>';

  // buttons inside the panel and under slides
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const id = b.closest('[data-sbid]') ? b.closest('[data-sbid]').dataset.sbid : cur; if (!id) return;
    const act = b.dataset.act; b.disabled = true;
    if (act === 'resolve') post({ op: 'resolve', slide: id }).then((r) => { setComment(id, ''); setReview(r); });
    else if (act === 'reopen') post({ op: 'reopen', slide: id, text: commentOf(id) }).then(setReview);
    else if (act === 'seen') post({ op: 'seen', slides: [id] }).then(setReview);
  });

  // ---------- sorter ----------
  const fitThumb = (box, k) => { let w = wrapOf(box.dataset.id) || null; if (!w) { try { w = build(box.dataset.id); } catch (e) { w = null; } } const s0 = w && w.querySelector('.slide'); if (!s0) return;
    const c = s0.cloneNode(true);
    c.querySelectorAll('.ctrls, .slide-tag, .sb-badge').forEach((x) => x.remove()); c.querySelectorAll('[contenteditable]').forEach((x) => x.removeAttribute('contenteditable')); c.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
    c.style.transform = `scale(${k})`; box.innerHTML = ''; box.appendChild(c); };
  const lazy = new IntersectionObserver((es) => {   // every thumbnail is the same width: measure once, not once per slide
    const boxes = es.filter((e) => e.isIntersecting).map((e) => e.target); if (!boxes.length) return;
    const k = boxes[0].clientWidth / 1000; boxes.forEach((b) => { lazy.unobserve(b); fitThumb(b, k); });
  }, { rootMargin: '400px' });
  const refitThumbs = debounce(() => { const boxes = [...sorter.querySelectorAll('.sb-tb')]; if (!boxes.length) return; const k = boxes[0].clientWidth / 1000; boxes.forEach((box) => { const sl = box.querySelector('.slide'); if (sl) sl.style.transform = `scale(${k})`; }); }, 30);
  function saveOrder(ids) {
    try { if (typeof applyOrder === 'function') { applyOrder(ids); return; } } catch (e) {}   // eslint-disable-line no-undef
    ids.forEach((id) => { const w = wrapOf(id); if (w) deck.appendChild(w); });
    try { if (typeof numberSlides === 'function') numberSlides(); } catch (e) {}              // eslint-disable-line no-undef
    deck.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function renderSorter() {
    const ids = wraps().map((w) => w.dataset.id), y = window.scrollY;
    const zw = ui.zoom || 210;
    sorter.innerHTML = `<div class="sb-sorter-head"><span><b>${ids.length} slides</b> in this version · drag to reorder · click a slide to open it</span><label class="sb-zoom">Smaller <input type="range" min="120" max="520" step="10" value="${zw}" aria-label="Thumbnail size"> Bigger</label></div><div class="sb-grid" id="sb-grid"></div>`;
    sorter.style.setProperty('--sb-thumbw', zw + 'px');
    const zoom = sorter.querySelector('.sb-zoom input');
    zoom.addEventListener('input', () => { sorter.style.setProperty('--sb-thumbw', zoom.value + 'px'); refitThumbs(); });
    zoom.addEventListener('change', () => { ui.zoom = +zoom.value; saveUi(); });
    const grid = $('#sb-grid', sorter);
    ids.forEach((id, k) => {
      const c = h('div', 'sb-card' + (id === cur ? ' on' : '')); c.draggable = true; c.dataset.id = id; c.title = title(id);
      c.innerHTML = `<div class="sb-tb" data-id="${esc(id)}"></div><span class="sb-x" title="Leave this slide out of this version">×</span><div class="sb-cap"><b>${k + 1}</b><span class="sb-t">${esc(title(id))}</span><span class="sb-dots">${dotsFor(id)}</span></div>`;
      c.addEventListener('click', (e) => {
        if (e.target.closest('.sb-x')) { const rm = wrapOf(id) && wrapOf(id).querySelector('.ctrls [data-a="rm"]'); if (rm) rm.click(); return; }
        cur = id; setView('focus');
      });
      c.addEventListener('dragstart', (e) => { dragId = id; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); });
      c.addEventListener('dragend', () => { dragId = null; grid.querySelectorAll('.sb-card').forEach((x) => x.classList.remove('dragging', 'drop-before', 'drop-after')); });
      c.addEventListener('dragover', (e) => { if (!dragId || dragId === id) return; e.preventDefault(); const r = c.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2;
        grid.querySelectorAll('.sb-card').forEach((x) => x.classList.remove('drop-before', 'drop-after')); c.classList.add(after ? 'drop-after' : 'drop-before'); });
      c.addEventListener('drop', (e) => { e.preventDefault(); if (!dragId || dragId === id) return; const after = c.classList.contains('drop-after');
        const order = ids.filter((x) => x !== dragId); order.splice(order.indexOf(id) + (after ? 1 : 0), 0, dragId); cur = dragId; saveOrder(order); });
      grid.appendChild(c); lazy.observe(c.querySelector('.sb-tb'));
    });
    const out = [...document.querySelectorAll('#block-list input[data-id]')].filter((i) => !i.checked && lib()[i.dataset.id]);
    if (out.length) {
      const shelf = h('div', 'sb-shelf', `<h4>Not in this version · ${out.length}</h4><div class="sb-grid"></div>`);
      const g2 = shelf.querySelector('.sb-grid');
      out.forEach((inp) => { const id = inp.dataset.id, b = lib()[id] || {}, tag = b.fac ? 'Facilitator' : b.prop ? 'Proposed' : b.alt ? 'Extra' : '';
        const c = h('div', 'sb-card', `<div class="sb-tb" data-id="${esc(id)}"></div><div class="sb-cap"><span></span><span class="sb-t">${tag ? `<span class="sb-tag" style="font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#8A4B00;background:#FFF1DC;border-radius:4px;padding:0 4px;margin-right:4px">${tag}</span>` : ''}${esc(title(id))}</span></div><button class="sb-btn sb-add">Add to this version</button>`);
        c.querySelector('.sb-add').addEventListener('click', () => { inp.click(); });
        g2.appendChild(c);
        const box = c.querySelector('.sb-tb'); box.dataset.id = id;
        lazy.observe(box); });
      sorter.appendChild(shelf);
    }
    window.scrollTo(0, y);
  }

  // ---------- checks: read the story (horizontal flow), or the title test ----------
  const EXEMPT = new Set(['title', 'closing', 'reflect', 'lines', 'statement', 'image', 'photo', 'agenda', 'pptx', 'team']);
  const titleEl = (id) => { const w = wrapOf(id); return w && w.querySelector('.slide > .h-title'); };
  const catOf = (id) => (lib()[id] || {}).cat || '';
  function flags(id, text) {
    const b = lib()[id] || {}, f = [];
    if (!text || EXEMPT.has(b.layout) || /-section$/.test(id)) return f;
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words <= 4 && !text.includes(':')) f.push(['Topic label', 'Reads like a label. Say the point.']);
    if (words > 22 || text.length > 130) f.push(['Long', 'Hard to take in at a glance.']);
    const halves = text.split(', ');   // "The same shape, blank": a short fragment, a comma, a short twist
    if (halves.length === 2 && !text.includes(':') && halves.every((x) => x.split(/\s+/).length <= 4)) f.push(['Comma pivot', 'A fragment with a twist. Write the plain sentence.']);
    return f;
  }
  const sentence = (id, k) => {
    const t = titleEl(id), text = t ? t.innerText.replace(/\s+/g, ' ').trim() : title(id), f = t ? flags(id, text) : [];
    const dot = !/[.?!:”"…]$/.test(text);
    return `<span class="s${t ? '' : ' none'}${f.length ? ' flag' : ''}" data-id="${esc(id)}" data-n="${k + 1}"${f.length ? ` data-flags="${esc(JSON.stringify(f))}"` : ''}${t ? ' contenteditable="plaintext-only" spellcheck="true"' : ''}${dot ? ' data-dot' : ''}>${esc(text)}</span>`;
  };
  function renderChecks() {
    if (checks.querySelector('[contenteditable]:focus')) return;   // don't rebuild under the cursor
    const ids = wraps().map((w) => w.dataset.id), fmt = ui.fmt || 'para';
    let mode = ui.checks || 'horizontal'; if (!['five', 'ten', 'horizontal', 'vertical', 'guides'].includes(mode)) mode = 'horizontal';
    const timed = mode === 'five' || mode === 'ten';
    const nflag = ids.filter((id) => { const t = titleEl(id); return t && flags(id, t.innerText.trim()).length; }).length;
    let body = '';
    // the deck's own section divider slides become headings
    const isDivider = (id) => /-section$|^div-/.test(id) || ['section', 'divider'].includes((lib()[id] || {}).layout);
    if (fmt === 'para') {   // one paragraph per part of the deck, the titles as its sentences
      let para = [], last = null;
      const flush = () => { if (para.length) body += `<p>${para.join(' ')}</p>`; para = []; };
      ids.forEach((id, k) => {
        if (isDivider(id)) { flush(); body += `<h4 class="sb-divh">${sentence(id, k)}</h4>`; last = catOf(id); return; }
        if (last !== null && catOf(id) !== last) flush();
        last = catOf(id); para.push(sentence(id, k));
      });
      flush();
    } else {
      let last = null;
      ids.forEach((id, k) => { const dv = isDivider(id); body += `<div class="ln${dv ? ' divl' : ''}${!dv && last !== null && catOf(id) !== last ? ' gap' : ''}"><button class="no" data-open="${esc(id)}" title="Open slide ${k + 1}">${k + 1}</button><span>${sentence(id, k)}</span></div>`; last = catOf(id); });
    }
    const tally = timed ? Object.values(tenLog(mode)) : [], fails = tally.filter((x) => x === 'fail').length;
    const concept = {
      five: ['Check whether you can quickly grasp the slide in 5 seconds.', 'Even better: show it to someone who hasn’t seen the slide. See if they can grok it.'],
      ten: ['A slightly longer check.', 'The ten-second test is best practice for a deck people will read: they may have a little more time, and the goal is still to capture their attention in 10 seconds.'],
      horizontal: ['The principle of “horizontal flow” is the idea that your slides should tell a coherent story.', 'A good way to test this is to read the titles in order to see if they make sense.'],
      vertical: ['The title is the takeaway. The body proves it.', 'Read the title, say what the slide must show, then reveal it and check.'],
      guides: ['Here are some basic principles for spacing, margins, titles, and text.', 'These are guidelines, not rules. They’re meant to help you make a more professional presentation.'] };
    const status = {
      five: tally.length ? `${tally.length} checked${fails ? `, ${fails} missed (left as comments for Claude)` : ''}.` : '',
      ten: tally.length ? `${tally.length} checked${fails ? `, ${fails} too much to take in (left as comments for Claude)` : ''}.` : '',
      horizontal: `${nflag ? `${nflag} note${nflag === 1 ? '' : 's'} in the margin. ` : ''}Click any sentence to edit it. Grey sentences are slides without a title, like quotes and discussion questions.`,
      vertical: '',
      guides: '' };
    const notes = Object.fromEntries(Object.keys(concept).map((k) => [k, `<b class="sb-idea">${concept[k][0]}</b><span class="sb-how">${concept[k][1]}</span>${status[k] ? `<span class="sb-stat">${status[k]}</span>` : ''}`]));
    const G = window.SBGuides || { MIN_TEXT: 12, MAX_SIZES: 4 };
    notes.guides += `<ul class="sb-principles">
      <li><b>Margins.</b> Keep text and figures inside the hatched border. The edge is kept for the logo, the source line, and the page number.</li>
      <li><b>Titles.</b> Two lines at most. The dashed box shows how much room that is.</li>
      <li><b>Text size.</b> Nothing smaller than ${G.MIN_TEXT} px on the slide (about 11 pt in PowerPoint), so it reads when projected.</li>
      <li><b>Text sizes.</b> Three or four sizes on a slide is usually enough. More starts to look unplanned.</li></ul>
      <div class="sb-glist" id="sb-glist"><span class="sb-stat">Checking every slide…</span></div>`;
    checks.innerHTML = `<div class="sb-modebar">
        <div class="sb-seg" role="group" aria-label="Check"><button data-mode="five" class="${mode === 'five' ? 'on' : ''}">5-second test <kbd>1</kbd></button><button data-mode="ten" class="${mode === 'ten' ? 'on' : ''}">10-second test <kbd>2</kbd></button><button data-mode="horizontal" class="${mode === 'horizontal' ? 'on' : ''}">Horizontal flow <kbd>3</kbd></button><button data-mode="vertical" class="${mode === 'vertical' ? 'on' : ''}">Vertical flow <kbd>4</kbd></button><button data-mode="guides" class="${mode === 'guides' ? 'on' : ''}">Guides <kbd>5</kbd></button></div>
        </div>
      <div class="sb-note" style="${mode === 'horizontal' ? '' : 'display:block!important'}">${notes[mode]}</div>
      ${mode !== 'horizontal' ? '<div class="sb-timed" id="sb-timed"></div>' : ''}
      ${mode === 'horizontal' ? `<div class="sb-readwrap"><div class="sb-seg sb-fmt" role="group" aria-label="Format"><button data-fmt="para" class="${fmt === 'para' ? 'on' : ''}">Paragraphs <kbd>P</kbd></button><button data-fmt="lines" class="${fmt === 'lines' ? 'on' : ''}">One per line <kbd>L</kbd></button></div><div></div><div class="sb-read${fmt === 'lines' ? ' lines' : ''}">${body}</div><div class="sb-margin"></div></div>` : ''}`;
    if (mode === 'horizontal') requestAnimationFrame(placeNotes);
    document.body.classList.toggle('sb-story', mode === 'horizontal');
    document.body.classList.toggle('sb-test', mode !== 'horizontal');
    document.body.classList.toggle('sb-vflow', mode === 'vertical');
    document.body.classList.toggle('sb-gcheck', mode === 'guides');
    if (mode === 'guides') requestAnimationFrame(() => setTimeout(guideList, 30));
    document.body.classList.toggle('sb-ten', timed);
    renderUnder();
  }
  function guideList() {
    const box = checks.querySelector('#sb-glist'); if (!box || !window.SBGuides) return;
    const res = window.SBGuides.scan(wraps()).filter((r) => r.issues.length);
    box.innerHTML = res.length
      ? `<span class="sb-stat">${res.length} slide${res.length === 1 ? '' : 's'} to look at:</span>` + res.map((r) => `<button class="sb-gitem" data-gjump="${esc(r.id)}" title="${esc(r.issues.map((g) => g.msg).join(' '))}"><b>${r.n}</b> ${esc(r.issues.map((g) => g.short || g.msg).join(' · '))}</button>`).join('')
      : '<span class="sb-stat">Every slide follows these guidelines.</span>';
  }
  checks.addEventListener('click', (e) => { const b = e.target.closest('[data-gjump]'); if (b) go(b.dataset.gjump, true); });
  function placeNotes() {
    const read = checks.querySelector('.sb-read'), margin = checks.querySelector('.sb-margin'); if (!read || !margin) return;
    margin.innerHTML = ''; const top0 = read.getBoundingClientRect().top; let floor = 0;
    read.querySelectorAll('.s.flag').forEach((sp) => {
      const f = JSON.parse(sp.dataset.flags || '[]'), n = h('div', 'sb-mnote'); n.dataset.id = sp.dataset.id;
      n.innerHTML = f.map(([l, w]) => `<b>${esc(l)}</b> ${esc(w)}`).join('<br>') + ` <button class="sb-open" data-open="${esc(sp.dataset.id)}">Slide ${esc(sp.dataset.n)} ↗</button>`;
      const y = Math.max(sp.getBoundingClientRect().top - top0, floor); n.style.top = y + 'px'; margin.appendChild(n); floor = y + n.offsetHeight + 8;
      n.addEventListener('mouseenter', () => sp.classList.add('hl')); n.addEventListener('mouseleave', () => sp.classList.remove('hl'));
      sp.addEventListener('mouseenter', () => n.classList.add('hl')); sp.addEventListener('mouseleave', () => n.classList.remove('hl'));
    });
    margin.style.minHeight = floor + 'px';
  }
  window.addEventListener('resize', debounce(() => { if (ui.view === 'checks') placeNotes(); }, 150));
  checks.addEventListener('click', (e) => {
    const m = e.target.closest('[data-mode]'), f = e.target.closest('[data-fmt]'), o = e.target.closest('[data-open]');
    if (m) { openCheck(m.dataset.mode); return; }
    if (f) { ui.fmt = f.dataset.fmt; saveUi(); renderChecks(); return; }
    if (o) { cur = o.dataset.open; setView('focus'); }
  });
  checks.addEventListener('input', (e) => {
    const sp = e.target.closest('.s[data-id]'), t = sp && titleEl(sp.dataset.id); if (!t) return;
    t.textContent = sp.innerText.replace(/\n/g, ' ');
    t.dispatchEvent(new Event('input', { bubbles: true }));
  });
  checks.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.closest('.s')) { e.preventDefault(); e.target.blur(); } });
  checks.addEventListener('focusout', debounce(() => { if (ui.view === 'checks') renderChecks(); }, 300));
  function openCheck(mode) {
    ui.checks = mode; saveUi();
    if (ui.view !== 'checks') { setView('checks'); return; }
    tenReady(); renderChecks(); if (mode !== 'horizontal') go(cur || visible()[0], true);
  }
  // 10-second test: ready (covered) -> showing for 10 s -> covered, then the verdict
  let tenState = 'ready', tenTimer = null;
  const isTimed = () => ui.view === 'checks' && (ui.checks === 'five' || ui.checks === 'ten');
  const tenLog = (m = ui.checks) => { ui.timed = ui.timed || {}; const k = m + ':' + SB.slug; ui.timed[k] = ui.timed[k] || {}; return ui.timed[k]; };
  const slideOf = (id) => { const w = id && wrapOf(id); return w && w.querySelector('.slide'); };
  function cover(msg) { const sl = slideOf(cur); if (!sl) return; sl.classList.add('sb-cover'); sl.dataset.msg = msg; const c = sl.querySelector('.sb-count'); if (c) c.remove(); }
  function tenReady() { clearTimeout(tenTimer); document.querySelectorAll('.slide.sb-cover').forEach((x) => x.classList.remove('sb-cover')); document.querySelectorAll('.sb-count').forEach((x) => x.remove()); tenState = 'ready'; if (isTimed()) cover(`You get ${ui.checks === 'five' ? 5 : 10} seconds with this slide. Press Start.`); renderUnder(); }
  function tenStart() { const sl = slideOf(cur); if (!sl) return; clearTimeout(tenTimer); const ms = ui.checks === 'five' ? 5000 : 10000;
    sl.classList.remove('sb-cover'); const c = h('div', 'sb-count'); c.style.animationDuration = ms + 'ms'; sl.appendChild(c); tenState = 'showing'; renderUnder();
    tenTimer = setTimeout(() => { cover('What was the one point?'); tenState = 'asked'; renderUnder(); }, ms); }
  function tenVerdict(ok) {
    tenLog()[cur] = ok ? 'pass' : 'fail'; saveUi();
    if (!ok) { const now = commentOf(cur), add = ui.checks === 'five' ? 'Five-second test: the one point didn’t come through at a glance.' : 'Ten-second test: too much to take in at a glance.'; if (!now.includes(add)) setComment(cur, now ? now + '\n' + add : add); }
    const ids = visible(), k = ids.indexOf(cur); if (k < ids.length - 1) go(ids[k + 1]); tenReady(); renderChecks();
  }
  function renderUnder() {
    let box = under.querySelector('span:last-child'); if (!box) return;
    const vflow = ui.view === 'checks' && ui.checks === 'vertical', gch = ui.view === 'checks' && ui.checks === 'guides';
    under.classList.toggle('sb-timed-on', isTimed() || vflow || gch);
    const K = (k) => `<kbd>${k}</kbd>`;
    if (gch) {
      box = checks.querySelector('#sb-timed'); if (!box) return;
      box.innerHTML = `<button class="sb-btn" data-u="prev">${K('←')} Previous</button> <button class="sb-btn" data-u="next">Next ${K('→')}</button>`;
    } else if (vflow) {
      box = checks.querySelector('#sb-timed'); if (!box) return;
      box.innerHTML = `<button class="sb-btn" data-u="prev">${K('←')} Previous</button> <button class="sb-btn red" data-u="reveal">Reveal ${K('Space')}</button> <button class="sb-btn" data-u="next">Next ${K('→')}</button>`;
    } else if (isTimed()) {
      box = checks.querySelector('#sb-timed'); if (!box) return;
      const five = ui.checks === 'five';
      box.innerHTML = tenState === 'ready' ? `<button class="sb-btn" data-u="prev">${K('←')} Previous</button> <button class="sb-btn red" data-u="start">Start ${five ? 5 : 10} seconds ${K('Space')}</button> <button class="sb-btn" data-u="next">Skip ${K('→')}</button>`
        : tenState === 'showing' ? '<button class="sb-btn" data-u="stop">Stop</button>'
        : `<button class="sb-btn" data-u="again">Show again ${K('A')}</button> <button class="sb-btn" data-u="fail">${five ? 'Missed the point' : 'Too much to take in'} ${K('M')}</button> <button class="sb-btn red" data-u="pass">${five ? 'Got the one point' : 'Got it at a glance'} ${K('Space')}</button>`;
    } else if (!box.querySelector('#sb-prev')) {
      box.innerHTML = '<button class="sb-btn" id="sb-prev">← Previous</button> <button class="sb-btn red" id="sb-reveal" title="Show or hide this slide\'s content (space)">Reveal</button> <button class="sb-btn" id="sb-next">Next →</button>';
      $('#sb-prev').addEventListener('click', () => step(-1)); $('#sb-next').addEventListener('click', () => step(1)); $('#sb-reveal').addEventListener('click', () => reveal());
    }
  }
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-u]'); if (!b) return; const u = b.dataset.u;
    if (u === 'start' || u === 'again') tenStart(); else if (u === 'stop') { clearTimeout(tenTimer); tenReady(); } else if (u === 'pass') tenVerdict(true); else if (u === 'fail') tenVerdict(false);
    else if (u === 'reveal') reveal();
    else if (u === 'prev') { step(-1); if (isTimed()) tenReady(); } else if (u === 'next') { step(1); if (isTimed()) tenReady(); } });

  const hideBtn = () => $('#sb-hide');
  function setHide(on) { ui.hide = on; saveUi(); document.body.classList.toggle('sb-titles-only', !!on); hideBtn().classList.toggle('on', !!on); document.querySelectorAll('.slide.sb-reveal').forEach((x) => x.classList.remove('sb-reveal')); }
  function reveal() { const w = cur && wrapOf(cur), sl = w && w.querySelector('.slide'); if (sl) sl.classList.toggle('sb-reveal'); }

  // ---------- views, navigation, and sizing ----------
  function setView(v) {
    ui.view = v; saveUi();
    top.querySelectorAll('.sb-seg button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    document.body.classList.toggle('sb-focus', v === 'focus');
    document.body.classList.toggle('sb-scroll', v === 'scroll');
    document.body.classList.toggle('sb-sorter', v === 'sorter');
    document.body.classList.toggle('sb-checks', v === 'checks');
    if (v !== 'checks') { under.classList.remove('sb-timed-on'); document.body.classList.remove('sb-story', 'sb-test', 'sb-vflow', 'sb-ten', 'sb-gcheck'); clearTimeout(tenTimer); document.querySelectorAll('.slide.sb-cover').forEach((x) => x.classList.remove('sb-cover')); const hl = under.parentNode && under.parentNode.querySelector('.sb-hint-line'); if (hl) hl.style.display = 'none'; }
    if (v === 'checks') { if (!cur || !wrapOf(cur)) cur = (wraps()[0] || {}).dataset?.id; renderChecks(); go(cur, true); if (isTimed()) tenReady(); window.scrollTo(0, 0); sideState(); return; }
    if (document.body.classList.contains('view-sorter') && $('[data-view="slides"]')) $('[data-view="slides"]').click();
    if (v === 'sorter') { wraps().forEach((w) => w.classList.remove('sb-active')); renderSorter(); window.scrollTo(0, 0); sideState(); return; }
    top.querySelectorAll('.sb-seg button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    if (v === 'focus') { if (document.body.classList.contains('view-sorter') && $('[data-view="slides"]')) $('[data-view="slides"]').click(); if (!cur || !wrapOf(cur)) cur = (visible()[0] || (wraps()[0] || {}).dataset?.id); go(cur, true); }
    else { wraps().forEach((w) => w.classList.remove('sb-active')); deck.style.maxWidth = ''; renderFilm(); renderPanel(); requestAnimationFrame(() => { refit(); if (cur) { const w = wrapOf(cur); if (w) w.scrollIntoView({ block: 'start' }); } }); }
    sideState();
  }
  top.querySelectorAll('.sb-seg button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.v)));
  function sideState() {
    document.body.classList.toggle('sb-noleft', !!ui.noleft);
    document.body.classList.toggle('sb-noright', !!ui.noright);
    const noL = ui.view === 'sorter' || ui.view === 'checks', noR = noL;   // Focus and Scroll share both side bars
    $('#sb-left').classList.toggle('on', !ui.noleft && !noL); $('#sb-right').classList.toggle('on', !ui.noright && !noR);
    $('#sb-left').disabled = noL; $('#sb-right').disabled = noR;
    $('#sb-left').title = noL ? 'No side bar in this view' : 'Show or hide the slides bar ( [ )';
    $('#sb-right').title = noR ? 'Notes are in Focus and Scroll' : 'Show or hide notes ( ] )';
    size();
  }
  function toggleSide(which) { if ($(which === 'left' ? '#sb-left' : '#sb-right').disabled) return; if (which === 'left') ui.noleft = !ui.noleft; else ui.noright = !ui.noright; saveUi(); sideState(); }

  function size() {
    const test = ui.view === 'checks';
    if (ui.view !== 'focus' && !test) { deck.style.maxWidth = ''; under.style.maxWidth = ''; refit(); return; }
    const css = getComputedStyle(document.documentElement), px = (v) => parseFloat(css.getPropertyValue(v)) || 0;
    const left = test || ui.noleft ? 0 : px('--sb-left'), right = test || ui.noright ? 0 : px('--sb-right');
    // the comment box and Claude's reply under the slide take room too, and they wrap differently at
    // different widths; always measure from the widest layout so the size never depends on the last one
    const aw = ui.view === 'focus' && cur && wrapOf(cur);
    const below = () => { let n = 0; if (aw) [...aw.children].forEach((c) => { if (c.querySelector('.slide') || c.classList.contains('slide') || c.classList.contains('sb-reply') || !c.offsetHeight) return; const cs = getComputedStyle(c); if (cs.position === 'absolute' || cs.position === 'fixed') return; n += c.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0); }); return n; };
    const W = window.innerWidth - left - right - 68, H0 = window.innerHeight - 52 - 22 - 70 - (document.body.classList.contains('sb-has-next') ? 42 : 0) - (test ? (checks.offsetHeight || 150) + 34 : 0);
    const fit = (b) => Math.max(320, Math.min(W, (H0 - b - 30) * 16 / 9));   // 30: one line for Claude's reply, kept on every slide so moving never resizes
    deck.style.maxWidth = Math.round(W) + 'px';
    let w = fit(below());
    deck.style.maxWidth = Math.round(w) + 'px';
    const w2 = fit(below()); if (w2 < w) { w = w2; deck.style.maxWidth = Math.round(w) + 'px'; }
    under.style.maxWidth = Math.round(w) + 'px';
    refit();
  }
  window.addEventListener('resize', debounce(() => { size(); if (ui.view === 'sorter') refitThumbs(); }, 120));
  new ResizeObserver(debounce(refit, 60)).observe(deck);

  function go(id, force, fromScroll) {
    if (!id || !wrapOf(id)) return;
    const changedSlide = id !== cur; cur = id;
    if (ui.view === 'focus') { wraps().forEach((w) => w.classList.toggle('sb-active', w.dataset.id === id)); size(); window.scrollTo(0, 0); }
    else if (ui.view === 'checks') { wraps().forEach((w) => w.classList.toggle('sb-active', w.dataset.id === id)); size(); window.scrollTo(0, 0);
      let hl = under.querySelector('.sb-hint-line'); if (!hl) { hl = h('div', 'sb-hint-line'); under.after(hl); }
      const t = titleEl(id), f = ui.checks === 'vertical' && t ? flags(id, t.innerText.trim()) : []; hl.textContent = f.map((x) => x[0] + ': ' + x[1]).join(' '); hl.style.display = f.length ? '' : 'none';
      if (isTimed() && changedSlide) tenReady(); }
    else if (ui.view === 'scroll' && !fromScroll) { tracking = false; wrapOf(id).scrollIntoView({ block: 'start' }); setTimeout(() => { tracking = true; }, 400); }
    history.replaceState(null, '', '#' + (sideSelect ? 'v=' + encodeURIComponent(sideSelect.value) + '&' : '') + 's=' + encodeURIComponent(id));
    const all = wraps().map((w) => w.dataset.id), ids = visible(), k = ids.indexOf(id);
    $('#sb-pos').innerHTML = `Slide ${all.indexOf(id) + 1} of ${all.length}${filter !== 'all' ? ` · ${k + 1} of ${ids.length} ${esc(FILTERS.find((f) => f[0] === filter)[1].toLowerCase())}` : ''} · <kbd>←</kbd> <kbd>→</kbd> to move · <button class="sb-keyhint" data-keys>? shortcuts</button>`;
    $('#sb-film-list').querySelectorAll('.sb-fi').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
    const on = $('#sb-film-list .sb-fi.on'); if (on) on.scrollIntoView({ block: 'nearest' });
    if ((changedSlide || force) && (ui.view === 'focus' || ui.view === 'scroll')) renderPanel();
  }
  // scroll view: the left bar follows the slide you are looking at
  let tracking = true;
  const seen = new IntersectionObserver((es) => {
    if (ui.view !== 'scroll' || !tracking) return;
    const vis = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (vis) go(vis.target.dataset.id, false, true);
  }, { rootMargin: '-60px 0px -55% 0px' });
  const watch = () => { seen.disconnect(); wraps().forEach((w) => seen.observe(w)); };
  function step(d) {
    const ids = visible(); if (!ids.length) return;
    const k = ids.indexOf(cur), next = ids[k < 0 ? 0 : Math.max(0, Math.min(ids.length - 1, k + d))];
    if (next === cur) { edge(d); return; }   // nothing further this way: say so instead of redrawing the same slide
    go(next);
  }
  let edgeTimer = null;
  function edge(d) {
    const pos = $('#sb-pos'); if (!pos) return;
    let e = $('#sb-edge'); if (!e) { e = h('span'); e.id = 'sb-edge'; pos.after(e); }
    const f = FILTERS.find((x) => x[0] === filter);
    e.innerHTML = filter !== 'all' ? `That’s the ${d > 0 ? 'last' : 'first'} ${esc(f[1].toLowerCase())} slide · <button class="sb-link" data-allf>Show all slides</button>` : `That’s the ${d > 0 ? 'last' : 'first'} slide`;
    e.classList.add('on'); clearTimeout(edgeTimer); edgeTimer = setTimeout(() => e.classList.remove('on'), 4000);
  }
  document.addEventListener('click', (e) => { if (!e.target.closest('[data-allf]')) return; filter = 'all'; refresh(); const x = $('#sb-edge'); if (x) x.classList.remove('on'); });

  // ---------- badges, replies under slides, counts ----------
  function decorate() {
    wraps().forEach((w) => {
      const id = w.dataset.id, i = info(id), fr = frameOf(w);
      w.dataset.sbid = id;
      let bd = fr.querySelector(':scope > .sb-badge');
      if (i.changed) { if (!bd) { bd = h('span', 'sb-badge'); if (getComputedStyle(fr).position === 'static') fr.style.position = 'relative'; fr.appendChild(bd); } bd.textContent = `Changed · round ${i.ch.round || ''}`; }
      else if (bd) bd.remove();
      const fb = w.querySelector('textarea.fb'); if (!fb) return;
      const hold = holdRow(w); hold.querySelector('input').checked = i.hold;
      let rp = w.querySelector('.sb-reply');
      if (i.rep) {
        if (!rp) { rp = h('div', 'sb-reply'); hold.after(rp); }
        const label = { done: 'Claude · Done', question: 'Claude · Question', skipped: 'Claude · Skipped', working: 'Claude · Working…' }[i.rep.status] || 'Claude';
        rp.className = 'sb-reply ' + i.rep.status;
        rp.innerHTML = `<span class="sb-who">${label}</span><span class="sb-txt">${esc(i.rep.text)}</span>${i.rep.status === 'working' ? '' : '<button class="sb-btn" data-act="resolve">Looks good</button><button class="sb-btn" data-act="reopen">Reopen</button>'}`;
      } else if (rp) rp.remove();
    });
  }
  // "Still drafting" sits under each comment and shows once there is text
  function holdRow(w) {
    const fb = w.querySelector('textarea.fb'); let r = w.querySelector('.sb-hold');
    if (!r) { r = h('label', 'sb-check sb-hold', '<input type="checkbox"> Still drafting: Claude skips it'); fb.after(r); }
    r.classList.toggle('empty', !fb.value.trim()); return r;
  }
  deck.addEventListener('change', (e) => {
    const box = e.target.closest('.sb-hold input'), w = box && box.closest('#deck > [data-id]'); if (!w) return;
    const id = w.dataset.id;
    post({ op: 'comment-state', slide: id, state: box.checked ? 'draft' : 'ready', text: commentOf(id) }).then(setReview);
  });
  function counts() {
    const ids = wraps().map((w) => w.dataset.id);
    const n = { all: ids.length };
    FILTERS.slice(1).forEach(([f]) => { n[f] = ids.filter((id) => pass(id, f)).length; });
    $('#sb-chips').innerHTML = FILTERS.map(([f, l]) => (f === 'all' || n[f] || f === filter) ? `<button class="sb-chip${f === filter ? ' on' : ''}" data-f="${f}">${l} <b>${n[f]}</b></button>` : '').join('');
    const askN = $('#sb-ask-n'); if (askN) { askN.textContent = n.open ? String(n.open) : ''; askN.classList.toggle('on', n.open > 0); }
    const done = ids.filter((id) => { const i = info(id); return i.st === 'done' && i.text; });
    const rb = $('#sb-resolve'); rb.hidden = done.length < 2; rb.textContent = `Looks good: all ${done.length} done`;
    rb.onclick = async () => { rb.disabled = true; for (const id of done) { const r = await post({ op: 'resolve', slide: id }); setComment(id, ''); review = r; } rb.disabled = false; refresh(); };
  }
  $('#sb-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (!b) return; filter = b.dataset.f; refresh(); if (!pass(cur)) { const v = visible(); if (v.length) go(v[0]); } });

  function claudeLine() {
    const c = review.claude, el = $('#sb-claude');
    const fresh = c && (Date.now() / 1000 - (c.at || 0) < 1800);
    el.classList.toggle('on', !!fresh);
    if (fresh) el.querySelector('span').textContent = 'Claude' + (c.total ? `: ${c.done || 0} of ${c.total}` : '') + (c.text ? ' · ' + c.text : '');
  }
  function refresh() { counts(); decorate(); claudeLine(); renderFilm(); if (ui.view === 'scroll') renderPanel(); if (ui.view === 'focus') { renderPanel(); size(); } if (ui.view === 'sorter') renderSorter(); if (ui.view === 'checks') renderChecks(); }
  function setReview(r) { if (r && r.replies) review = r; refresh(); }
  async function loadReview() { try { setReview(await (await fetch(api('review'))).json()); } catch (e) {} }

  // comments typed under a slide; edits on a slide refresh its thumbnail
  const staleThumbs = new Set();
  const refillThumbs = debounce(() => { staleThumbs.forEach((id) => { const box = $(`#sb-film-list .sb-thumb[data-id="${CSS.escape(id)}"]`); if (box && box.firstChild) fillThumb(box); }); staleThumbs.clear(); }, 700);
  const afterComment = debounce(() => { counts(); renderFilm(); if (ui.view === 'focus') size(); }, 300);
  deck.addEventListener('input', (e) => {
    const t = e.target, w = t.closest && t.closest('#deck > [data-id]'); if (!w) return;
    if (t.matches('textarea.fb')) { holdRow(w); afterComment(); }
    else if (t.isContentEditable) { staleThumbs.add(w.dataset.id); refillThumbs(); }
  });

  // the deck re-renders on version switches and reorders: follow it
  new MutationObserver(debounce(() => { if (cur && !wrapOf(cur)) cur = null; refresh(); watch(); if (ui.view === 'focus') go(cur || visible()[0] || (wraps()[0] || {}).dataset?.id, true); }, 150)).observe(deck, { childList: true });

  // keyboard
  let lastKey = 0;
  document.addEventListener('keydown', (e) => {
    lastKey = Date.now();
    const t = e.target, typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if (typing) { if (e.key === 'Escape') t.blur(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey || presenting()) return;
    const nav = ui.view === 'focus' || (ui.view === 'checks' && ['vertical', 'ten', 'five', 'guides'].includes(ui.checks));
    if (isTimed() && e.key === ' ') { e.preventDefault(); if (tenState === 'ready') tenStart(); else if (tenState === 'asked') tenVerdict(true); return; }
    if (isTimed() && tenState === 'asked' && (e.key === 'm' || e.key === 'M')) { tenVerdict(false); return; }
    if (isTimed() && tenState === 'asked' && (e.key === 'a' || e.key === 'A')) { tenStart(); return; }
    const k = e.key.toLowerCase();
    if (e.key === '?') { help.classList.toggle('on'); return; }
    if (e.key === 'Escape') { help.classList.remove('on'); more.classList.remove('open'); return; }
    const views = { f: 'focus', s: 'scroll', g: 'sorter', c: 'checks' }, tests = { 1: 'five', 2: 'ten', 3: 'horizontal', 4: 'vertical', 5: 'guides' };
    if (views[k]) { setView(views[k]); return; }
    if (tests[k]) { openCheck(tests[k]); return; }
    if (nav && (e.key === 'Home' || e.key === 'End')) { e.preventDefault(); const ids = visible(); go(e.key === 'Home' ? ids[0] : ids[ids.length - 1]); if (isTimed()) tenReady(); return; }
    if (ui.view === 'checks' && (ui.checks || 'horizontal') === 'horizontal' && (k === 'p' || k === 'l')) { ui.fmt = k === 'p' ? 'para' : 'lines'; saveUi(); renderChecks(); return; }
    if (nav && (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'j')) { e.preventDefault(); step(1); }
    else if (nav && (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'k')) { e.preventDefault(); step(-1); }
    else if (e.key === '?' || k === '/') help.classList.toggle('on');
    else if (e.key === 'h' || e.key === 'H') setHide(!ui.hide);
    else if (e.key === ' ' && nav && (ui.hide || ui.view === 'checks')) { e.preventDefault(); reveal(); }
    else if (e.key === '[') toggleSide('left');
    else if (e.key === ']') toggleSide('right');
  });

  // ---------- live updates ----------
  let base = null, pending = false;
  const idle = () => { const a = document.activeElement; const typing = a && (a.isContentEditable || /^(INPUT|TEXTAREA)$/.test(a.tagName)); return !typing && Date.now() - lastKey > 8000; };
  function reload() { try { SB.flush(); } catch (e) {} setTimeout(() => location.reload(), 450); }
  async function pulse() {
    let p; try { p = await (await fetch(api('pulse'), { cache: 'no-store' })).json(); } catch (e) { return; }
    if (!base) { base = p; return; }
    if (p.review !== base.review) { base.review = p.review; loadReview(); }
    if (p.file !== base.file || p.shell !== base.shell) { pending = true; }
    if (pending) { if (idle()) reload(); else banner.classList.add('on'); }
  }
  setInterval(pulse, 2500);

  // ---------- agent-friendly handle (Claude can drive the page with this) ----------
  window.SlideBuilder = {
    go, step, setView, current: () => cur, filter: (f) => { filter = f; refresh(); }, order: (ids) => saveOrder(ids), title,
    slides: () => wraps().map((w, k) => Object.assign({ n: k + 1, id: w.dataset.id, title: title(w.dataset.id) }, (({ text, st, changed, hold }) => ({ comment: text, reply: st, changed, draft: hold }))(info(w.dataset.id)))),
  };

  // ---------- start ----------
  const wantV = decodeURIComponent((location.hash.match(/[#&]v=([^&]+)/) || [])[1] || '');
  if (wantV && sideSelect && [...sideSelect.options].some((o) => o.value === wantV) && sideSelect.value !== wantV) { sideSelect.value = wantV; sideSelect.dispatchEvent(new Event('change', { bubbles: true })); }
  const want = decodeURIComponent((location.hash.match(/[#&]s=([^&]+)/) || [])[1] || '');
  cur = want && wrapOf(want) ? want : null;
  hideBtn().addEventListener('click', () => setHide(!ui.hide));
  setHide(!!ui.hide);
  watch();
  loadReview().then(() => { setView(['scroll', 'sorter', 'checks'].includes(ui.view) ? ui.view : 'focus'); requestAnimationFrame(() => document.body.classList.add('sb-ready')); });
})();
