/* StrategyU Slide Builder: pictures. Click a picture on a slide (or drop an image file on it) to put
   your own in. The picture sits in an editable box, so the new one saves like any text edit, and
   `sb edits` shows it to Claude to bake into the deck file. Uploads go to the deck's img/uploads/. */
(function () {
  const SB = window.__SB, deck = document.getElementById('deck');
  if (!SB || !deck || SB.readonly) return;
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml'; input.hidden = true;
  document.body.appendChild(input);
  let target = null;
  const PIC = '.slide:is(.l-picture, .l-pictures, .l-photofull) .pic';   // only the Slide Builder picture layouts
  const picOf = (e) => { const p = e.target.closest && e.target.closest(PIC); return p && deck.contains(p) ? p : null; };
  const read = (f) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); });
  async function put(pic, file) {
    if (!file || !/^image\//.test(file.type)) return;
    pic.classList.add('sbp-busy');
    try {
      const r = await fetch(`/api/decks/${SB.slug}/upload`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: file.name, data: await read(file) }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'upload failed');
      let img = pic.querySelector('img'); if (!img) { img = document.createElement('img'); img.alt = ''; pic.appendChild(img); }
      img.src = d.path;
      pic.dispatchEvent(new Event('input', { bubbles: true }));   // the deck saves it with the slide's other edits
    } catch (e) { alert('Couldn’t add that picture: ' + e.message); }
    pic.classList.remove('sbp-busy');
  }
  deck.addEventListener('click', (e) => { const p = picOf(e); if (!p) return; e.preventDefault(); target = p; input.value = ''; input.click(); });
  input.addEventListener('change', () => { if (target && input.files[0]) put(target, input.files[0]); });
  deck.addEventListener('dragover', (e) => { const p = picOf(e); if (!p) return; e.preventDefault(); p.classList.add('sbp-over'); });
  deck.addEventListener('dragleave', (e) => { const p = picOf(e); if (p) p.classList.remove('sbp-over'); });
  deck.addEventListener('drop', (e) => { const p = picOf(e); if (!p) return; e.preventDefault(); p.classList.remove('sbp-over'); put(p, e.dataTransfer.files[0]); });
  // the box is editable only so the picture saves: no typing into it
  deck.addEventListener('keydown', (e) => { if (picOf(e) && e.key !== 'Tab' && e.key !== 'Escape') e.preventDefault(); }, true);
  deck.addEventListener('paste', (e) => { if (picOf(e)) e.preventDefault(); }, true);
  const css = new CSSStyleSheet();
  css.replaceSync(`
    #deck .slide:is(.l-picture, .l-pictures, .l-photofull) .pic:hover::after { content: 'Click to replace, or drop an image'; position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); padding: 4px 10px; border-radius: 6px; background: rgba(20,18,17,.78); color: #fff; font: 600 12px/1.3 'DM Sans', sans-serif; white-space: nowrap; pointer-events: none; }
    #deck .slide:is(.l-picture, .l-pictures, .l-photofull) .pic.sbp-over { box-shadow: inset 0 0 0 4px var(--red-deep, #A22731); }
    #deck .slide:is(.l-picture, .l-pictures, .l-photofull) .pic.sbp-busy { opacity: .55; }`);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, css];
})();
