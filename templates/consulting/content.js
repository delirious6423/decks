/* Consulting starter: a guided storyline in eight slides (cover, executive summary,
   storyline, ghost chart, hypothesis tree, 2x2, plan, next steps). Every line on a slide
   says what goes there. The slides were converted from PowerPoint by tools/pptx2native.py:
   ct-slides.js holds their shapes (CT), drawn by the engine's pptx layout, so every word
   is editable. README.md has more. */
const CATS = ['story', 'issues', 'frameworks', 'plans', 'people'];
const CAT_LABELS = {
  story: 'Storyline and executive summary',
  issues: 'Issue tree',
  frameworks: 'Frameworks',
  plans: 'Plan',
  people: 'Next steps',
};
const CAT_SHORT = { story: 'Story', issues: 'Issues', frameworks: 'Frameworks', plans: 'Plan', people: 'Close' };
const FIGS = {};

// A converted slide. n is its key in CT (ct-slides.js), drawn by the 'pptx' layout. The PowerPoint
// titles are 26pt: the title placeholder flag is dropped so the engine keeps that size rather than
// raising it to its 36pt floor. The deck's theme (DECK_THEME, written by the New deck form) maps the
// converted palette onto its own: text colors and fills separately, so Dark can turn dark text light.
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
const ct = (n, cat, title, extra) => {
  const pp0 = (typeof CT !== 'undefined') ? CT[n] : null;
  const pp = pp0 && !pp0.error && !pp0.bgpic && (pp0.shapes || []).length ? themed(pp0) : null;
  return Object.assign(pp ? { layout: 'pptx', pp } : { layout: 'plain', body: ['This slide needs ct-slides.js next to the deck.'] }, { cat, title, titleMax: 100 }, extra || {});
};

const LIBRARY = {
  'sample-cover': ct('sp1', 'story', 'The question this deck answers, or the answer itself', { nologo:true, notes:'TITLE SLIDE. Replace the title with the question the deck answers, or with the answer itself. Keep the subtitle to one line: who it\'s for, the date, or the status (draft, final).' }),
  'exec-summary-numbered': ct(5, 'story', 'Write the whole answer as one sentence: what to do, and why', { notes:'EXECUTIVE SUMMARY (NUMBERED). The three bold lines should make the whole argument. Each becomes a section title later in the deck.' }),
  'storyline-flow': ct(8, 'story', 'Read the titles alone, in order, and they should tell the whole story', { notes:'STORYLINE (HORIZONTAL FLOW). Paste every action title in order. If the list doesn\'t read like a short memo, fix the structure before the slides.' }),
  'ghost-chart': ct(9, 'story', 'Sketch each page before the data arrives: write the title you expect, with [X] for the number', { notes:'GHOST CHART. Write the title as the answer you expect, with brackets for numbers you don\'t have yet. Sketch the chart, list the data you need, and change the title when the data comes in.' }),
  'hypothesis-tree': ct(15, 'issues', 'Break the question into the few things that must be true for the answer to hold', { notes:'HYPOTHESIS TREE. The decision on the left, hypotheses in the middle written as claims, and the test for each on the right.' }),
  'sample-2x2': ct('sp6', 'frameworks', 'Place the options on two axes that matter, so the choice is obvious', { nologo:true, notes:'2x2 MATRIX. Name both axes so a reader knows which corner is good. Label the quadrant that carries the recommendation and gray the rest. To place the options, give Claude the raw data: in the comment under this slide, paste each option\'s name and its score on both axes, or the path to a spreadsheet that has them. Claude renames the dots and moves each one to where its numbers put it.' }),
  'sample-process': ct('sp7', 'plans', 'Lay out the plan as phases, each ending in something you can show or decide', { nologo:true, notes:'PROCESS. One box per phase, with the timing above and the output below. Write each output as the decision or fact the phase produces, not the activity.' }),
  'sample-next-steps': ct('sp8', 'people', 'End with the decision you need, and who does what by when', { nologo:true, notes:'NEXT STEPS. Every row is an action with one owner and a date. The title asks for the decision the meeting needs to make.' }),
};
