/* Decks: Client copy (Share menu).
   The file to send a client: the slides of the version on screen, as they look now (your edits and
   order included), and nothing else. No facilitator slides or notes, no comments, no other versions,
   no editing. It is a snapshot of the slides themselves, so none of that is even in its source.
   One file: the server embeds the pictures. It scrolls, prints one slide per page, and presents
   full screen (Present, or P). */
(async function () {
  if (window.__SB_ENGINE_READY) await window.__SB_ENGINE_READY;
  const SB = window.__SB, deck = document.getElementById('deck');
  const API = window.SlideBuilder;
  if (!SB || !deck || !API || !API.shareItem) return;
  const lib = () => { try { return LIBRARY; } catch (e) { return {}; } };   // eslint-disable-line no-undef
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const api = (p) => '/api/decks/' + SB.slug + '/' + p;

  // what the snapshot leaves out of each slide: the editor's own parts, and the app's
  const STRIP = '.ctrls, .slide-tag, .slide-no, .fnote, .fb, textarea, input, button, [class^="sb-"], [class*=" sb-"], [class^="sbg"], [class^="sbx"]';

  function slides() {
    const L = lib();
    return [...deck.children].filter((w) => w.dataset && w.dataset.id && !(L[w.dataset.id] && L[w.dataset.id].fac))
      .map((w) => { const s = w.querySelector('.slide'); return s && (s.parentElement.matches('.slide-frame, .slide-box') ? s.parentElement : s); }).filter(Boolean);
  }
  function clean(frame) {
    const c = frame.cloneNode(true);
    c.querySelectorAll(STRIP).forEach((n) => { if (!n.matches('.slide')) n.remove(); });
    [c, ...c.querySelectorAll('*')].forEach((n) => {
      n.removeAttribute('contenteditable'); n.removeAttribute('spellcheck'); n.removeAttribute('draggable');
      if (n.matches('.slide')) { n.style.removeProperty('transform'); n.style.removeProperty('transform-origin'); }
    });
    c.style.removeProperty('width'); c.style.removeProperty('height');
    return c;
  }
  const versionLabel = () => { const s = document.getElementById('sb-version') || document.querySelector('.sidebar select');
    return s && s.options.length > 1 && s.selectedIndex >= 0 ? s.options[s.selectedIndex].text.trim() : ''; };
  const fileName = () => [SB.name, versionLabel()].filter(Boolean).join(' · ').replace(/[\\/:*?"<>|]+/g, '-').trim() + '.html';

  const VIEWER_CSS = `
html, body.cc { margin: 0 !important; padding: 0 !important; background: #E9E6E2 !important; display: block !important; height: auto !important; overflow: auto !important; }
.cc-bar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 16px; padding: 12px 24px; background: rgba(233,230,226,.92); backdrop-filter: blur(6px); font: 600 14px/1.3 -apple-system, 'Segoe UI', sans-serif; color: #231F20; }
.cc-bar .cc-t { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cc-bar .cc-n { color: #6E6A66; font-weight: 500; }
.cc-bar button { font: 600 13px/1 -apple-system, 'Segoe UI', sans-serif; padding: 9px 14px; border-radius: 6px; border: 1px solid #231F20; background: #231F20; color: #fff; cursor: pointer; }
.cc-deck { max-width: 1100px; margin: 8px auto 64px; padding: 0 24px; display: flex; flex-direction: column; gap: 28px; }
.cc-slide > * { width: 100% !important; height: auto !important; aspect-ratio: 16 / 9; position: relative; overflow: hidden; margin: 0 !important; box-shadow: 0 1px 2px rgba(0,0,0,.05), 0 14px 34px rgba(35,31,32,.14); }
.cc-slide .slide { transform-origin: top left; }
body.cc-show { background: #000 !important; overflow: hidden !important; }
body.cc-show .cc-bar { display: none; }
body.cc-show .cc-deck { max-width: none; margin: 0; padding: 0; }
body.cc-show .cc-slide { display: none; }
body.cc-show .cc-slide.cc-on { display: flex; position: fixed; inset: 0; align-items: center; justify-content: center; background: #000; cursor: pointer; }
body.cc-show .cc-slide.cc-on > * { width: min(100vw, calc(100vh * 16 / 9)) !important; box-shadow: none; }
@media print {
  @page { size: 13.333in 7.5in; margin: 0; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  html, body.cc { background: #fff !important; }
  .cc-bar { display: none !important; }
  .cc-deck { display: block; max-width: none; margin: 0; padding: 0; }
  .cc-slide { break-after: page; break-inside: avoid; }
  .cc-slide:last-child { break-after: auto; }
  .cc-slide > * { width: 1280px !important; height: 720px !important; aspect-ratio: auto; box-shadow: none !important; }
  .cc-slide .slide { transform: scale(1.28) !important; }
}`;
  // fits each slide to its frame, and runs Present: arrows, space, click; Esc leaves
  const VIEWER_JS = `(function(){
var S=[].slice.call(document.querySelectorAll('.cc-slide')),i=0;
function fit(){S.forEach(function(s){var f=s.firstElementChild,sl=s.querySelector('.slide');if(f&&sl&&f.clientWidth)sl.style.transform='scale('+(f.clientWidth/1000)+')';});}
function show(k){i=Math.max(0,Math.min(S.length-1,k));S.forEach(function(s,j){s.classList.toggle('cc-on',j===i);});fit();}
function start(){var y=window.innerHeight/3;i=0;S.forEach(function(s,j){if(s.getBoundingClientRect().top<y)i=j;});document.body.classList.add('cc-show');show(i);var d=document.documentElement;if(d.requestFullscreen)d.requestFullscreen().catch(function(){});}
function stop(){if(!document.body.classList.contains('cc-show'))return;document.body.classList.remove('cc-show');S.forEach(function(s){s.classList.remove('cc-on');});fit();S[i].scrollIntoView({block:'center'});if(document.fullscreenElement&&document.exitFullscreen)document.exitFullscreen().catch(function(){});}
document.getElementById('cc-present').addEventListener('click',start);
document.addEventListener('fullscreenchange',function(){if(!document.fullscreenElement)stop();});
document.addEventListener('click',function(e){if(document.body.classList.contains('cc-show')&&e.target.closest('.cc-slide'))show(i+1);});
document.addEventListener('keydown',function(e){var on=document.body.classList.contains('cc-show'),k=e.key;
if(!on){if(k==='p'||k==='P')start();return;}
if(k==='ArrowRight'||k==='ArrowDown'||k===' '||k==='PageDown'||k==='Enter'){e.preventDefault();show(i+1);}
else if(k==='ArrowLeft'||k==='ArrowUp'||k==='PageUp'||k==='Backspace'){e.preventDefault();show(i-1);}
else if(k==='Home')show(0);else if(k==='End')show(S.length-1);else if(k==='Escape')stop();});
window.addEventListener('resize',fit);window.addEventListener('beforeprint',function(){S.forEach(function(s){var sl=s.querySelector('.slide');if(sl)sl.style.transform='';});});window.addEventListener('afterprint',fit);
fit();if(document.fonts&&document.fonts.ready)document.fonts.ready.then(fit);})();`;

  function snapshot() {
    const ids = window.DeckRenderer?.ids() || [];
    if (window.DeckData && !DeckData.ready(ids)) return DeckData.load(ids).then(snapshot);
    if (window.DeckRenderer) window.DeckRenderer.all();
    const frames = slides();
    const css = [...document.querySelectorAll('style')].filter((s) => !/^sb/.test(s.id || '')).map((s) => s.textContent).join('\n');
    const links = [...document.querySelectorAll('link[rel="stylesheet"], link[rel="preconnect"]')].filter((l) => /^https?:/.test(l.href)).map((l) => l.outerHTML).join('\n');
    const first = frames[0] && frames[0].querySelector('.h-title, h1, h2');
    const title = (first ? first.textContent : document.title).replace(/\s+/g, ' ').trim() || SB.name;
    const body = frames.map((f, k) => `<section class="cc-slide" id="slide-${k + 1}">${clean(f).outerHTML}</section>`).join('\n');
    const result = { n: frames.length, html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<!-- Made with Decks Performance (https://github.com/delirious6423/decks), an independent fork of Decks (https://github.com/paulmil11/decks). Deck engine: Copyright (c) 2026 Paul Millerd, MIT License, https://github.com/paulmil11/decks/blob/main/LICENSE. The slides are yours. -->
<title>${esc(title)}</title>
${links}
<style>${css.replace(/<\/style/gi, '<\\/style')}</style>
<style>${VIEWER_CSS}</style>
</head><body class="cc">
<header class="cc-bar"><span class="cc-t">${esc(title)}</span><span class="cc-n">${frames.length} slides</span><button id="cc-present" title="Full screen. Arrow keys or click to move, Esc to stop. Shortcut: P">Present</button></header>
<main class="cc-deck">
${body}
</main>
<script>${VIEWER_JS}</script>
</body></html>` };
    if (window.DeckRenderer) window.DeckRenderer.resume();
    return result;
  }

  async function save() {
    const say = (t) => { try { window.SlideBuilder.say(t); } catch (e) {} };
    const snap = await snapshot();
    let out = new Blob([snap.html], { type: 'text/html' }), pics = null;
    try {
      const r = await fetch(api('bundle'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html: snap.html }) });
      if (r.ok) { out = new Blob([await r.text()], { type: 'text/html' }); pics = +r.headers.get('X-SB-Pictures'); }
    } catch (e) {}
    const u = URL.createObjectURL(out), a = document.createElement('a'); a.href = u; a.download = fileName();
    document.body.appendChild(a); HTMLAnchorElement.prototype.click.call(a); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
    say(`<b>Saved ${esc(fileName())}.</b> ${snap.n} slides${pics ? `, pictures inside` : ''}. Slides only: no notes, comments, or editing. It opens in any browser and has a Present button.`);
  }

  API.shareItem({ t: 'Client copy', sub: 'To read or present. Slides only, one file', id: 'sb-client-copy',
    title: 'The file to send a client: this version’s slides as they look now. No notes, comments, other versions, or editing.', act: () => save() });
  if (window.SlideBuilder) window.SlideBuilder.clientCopy = () => { const result = snapshot(); return result?.then ? result.then((s) => s.html) : result.html; };   // for the tools
})();
