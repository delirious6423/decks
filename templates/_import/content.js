/* An imported deck. The file it came from is in source/. tools/importdeck.py writes the slides
   between the IMPORTED SLIDES lines below: each is ct(key, ...), and its shapes are CT[key] in
   ct-slides.js, drawn by the engine's pptx layout so every word is editable. A slide the converter
   couldn't rebuild comes in as a picture of the original (src), and its notes come along. For a
   rebuild in Decks' own layouts, the agent replaces these slides with native ones. */
const FIGS = {};

// A converted slide keeps PowerPoint's own text sizes: the title placeholder flag is dropped so the
// engine doesn't raise titles to its 36pt floor. With a color set picked in New deck (DECK_THEME),
// the StrategyU palette maps onto it; other colors stay as they were.
const themed = (pp) => {
  const T = (typeof DECK_THEME !== 'undefined' && DECK_THEME) || {}, M = T.pp;
  const up = (c) => (typeof c === 'string' ? c.toUpperCase() : c);
  const walk = (o) => {
    if (Array.isArray(o)) return o.map(walk);
    if (!o || typeof o !== 'object') return o;
    const run = 't' in o, out = {};
    Object.entries(o).forEach(([k, v]) => {
      if (M && k === 'c' && typeof v === 'string') out[k] = (run ? M.text : M.fill)[up(v)] || v;
      else if (M && (k === 'fill' || k === 'fillc') && typeof v === 'string') out[k] = M.fill[up(v)] || v;
      else out[k] = walk(v);
    });
    return out;
  };
  const shapes = pp.shapes.map(({ ph, ...sh }) => (ph === 'title' && T.serif ? Object.assign({}, sh, { text: (sh.text || []).map((para) => Object.assign({}, para, { runs: (para.runs || []).map((r) => Object.assign({}, r, { font: T.serif })) })) }) : sh));
  return Object.assign({}, pp, { bg: M && typeof pp.bg === 'string' ? (M.bg[up(pp.bg)] || M.fill[up(pp.bg)] || pp.bg) : pp.bg, shapes: M ? walk(shapes) : shapes });
};
// ct(key, part, title, { src: the original slide's picture, notes, ... }): the converted slide, or the
// picture when it has no shapes to draw (the "original" button switches between the two).
const ct = (n, cat, title, extra) => {
  const pp0 = (typeof CT !== 'undefined') ? CT[n] : null;
  const pp = pp0 && !pp0.error && !pp0.bgpic && (pp0.shapes || []).length ? themed(pp0) : null;
  const pic = extra && extra.src;
  return Object.assign(pp ? { layout: 'pptx', pp } : pic ? { layout: 'image' } : { layout: 'plain', body: ['This slide needs ct-slides.js next to the deck.'] }, { cat, title, titleMax: 100 }, extra || {});
};

// ---- IMPORTED SLIDES: tools/importdeck.py replaces everything from this line to the END line ----
const CATS = ['deck'];
const CAT_LABELS = { deck: 'The deck' };
const CAT_SHORT = { deck: 'Deck' };
const LIBRARY = {
  'import-start': { cat:'deck', layout:'plain', title:'{{NAME_JS}}: waiting to be brought in',
    body:['The file you imported is in this deck’s source folder.', 'Paste the prompt from New deck into Claude Code or Codex, and it brings every slide in here, with its notes.'],
    notes:'Placeholder: the import replaces this slide.' },
};
// ---- END OF IMPORTED SLIDES ----
