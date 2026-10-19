/* Decks: Add a slide (key N, or + in the filmstrip and the sorter).
   "Help me choose" asks what you're trying to show and suggests a few layouts. If the deck carries
   one in its library (a template's layouts, the basic guided ones, or slides left out of this
   version), Add slide puts it right after the slide you're on. Either way, Copy prompt gives Claude
   (or Codex) everything it needs to build or fill the slide in the deck file. */
(async function () {
  if (window.__SB_ENGINE_READY) await window.__SB_ENGINE_READY;
  const SB = window.__SB, deck = document.getElementById('deck'), API = window.SlideBuilder;
  if (!SB || !deck || !API) return;
  const lib = () => { try { return LIBRARY; } catch (e) { return {}; } };   // eslint-disable-line no-undef
  const labels = () => { try { return CAT_LABELS; } catch (e) { return {}; } };   // eslint-disable-line no-undef
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const shown = () => window.DeckRenderer?.virtual?.() ? window.DeckRenderer.ids() : [...deck.children].filter((n) => n.dataset && n.dataset.id).map((n) => n.dataset.id);
  const box = (id) => window.DeckLibrary ? (window.DeckLibrary.has(id) ? { click: () => window.DeckLibrary.toggle(id) } : null) : document.querySelector(`#block-list input[data-id="${CSS.escape(id)}"]`);
  const addable = (id) => !!lib()[id] && !shown().includes(id) && !!box(id) && !(API.hidden && API.hidden(id));   // never a hidden client's slide
  // a basic layout can go in more than once: it comes with numbered copies (basic-x, basic-x-2 …)
  const copies = (base) => Object.keys(lib()).filter((k) => k === base || lib()[k].copyOf === base);
  const take = (id) => { const L = lib(); if (!L[id]) return null; return L[id].lib ? (copies(L[id].copyOf || id).find(addable) || null) : (addable(id) ? id : null); };
  const used = (base) => copies(base).filter((k) => shown().includes(k)).length;
  // a basic layout belongs to the section it sits in (for Presenter timing and section labels), not to the
  // deck's last section, where its library entry files it
  Object.entries(lib()).forEach(([id, e]) => { if (!e || !e.lib) return; const home = e.cat;
    try { Object.defineProperty(e, 'cat', { configurable: true, enumerable: true, set() {}, get() {
      const ids = shown(), k = ids.indexOf(id), L = lib(); if (k < 0) return home;
      for (let i = k - 1; i >= 0; i--) if (L[ids[i]] && !L[ids[i]].lib) return L[ids[i]].cat;
      for (let i = k + 1; i < ids.length; i++) if (L[ids[i]] && !L[ids[i]].lib) return L[ids[i]].cat;
      return home; } }); } catch (x) {} });

  // ---------- what people want to show, and the layouts that do it ----------
  const ASK = [
    ['number', 'One number that matters'], ['compare', 'A comparison'], ['trend', 'A change over time'], ['breakdown', 'How something breaks down'],
    ['process', 'A process or a plan'], ['choice', 'A choice between options'], ['voices', 'What people said'], ['answer', 'The answer, up front'],
    ['picture', 'A picture or screenshot'], ['section', 'The start of a new part'], ['group', 'Something for the group to do']];
  const FOLLOW = {
    number: ['How many numbers?', [['1', 'One'], ['many', 'Two or three']]],
    compare: ['How many things are you comparing?', [['2', 'Two'], ['3-5', 'Three to five'], ['6+', 'Six or more']]],
    trend: ['How many lines?', [['1', 'One'], ['many', 'Several']]],
    breakdown: ['What are you breaking down?', [['parts', 'A total into its parts'], ['change', 'A change into its causes'], ['question', 'A question into smaller ones']]],
    process: ['Which is it?', [['steps', 'Steps in order'], ['time', 'A plan over weeks or months']]],
    group: ['What should the group do?', [['discuss', 'Discuss a question'], ['exercise', 'Work on an exercise']]],
    picture: ['Which is it?', [['one', 'One picture, with the point beside it'], ['two', 'Two pictures to compare'], ['full', 'A full-screen photo']]],
  };
  const ASK_SK = { number: 'number', compare: 'columns', trend: 'line', breakdown: 'stack', process: 'steps', choice: 'quad', voices: 'quote',
    answer: 'exec', picture: 'picture', section: 'divider', group: 'exercise' };
  const FOLLOW_SK = { 'number/1': 'number', 'number/many': 'stats', 'compare/2': 'two', 'compare/3-5': 'bars', 'compare/6+': 'table', 'trend/1': 'line',
    'trend/many': 'lines', 'breakdown/parts': 'stack', 'breakdown/change': 'waterfall', 'breakdown/question': 'tree', 'process/steps': 'steps',
    'process/time': 'timeline', 'group/discuss': 'question', 'group/exercise': 'exercise', 'picture/one': 'picture', 'picture/two': 'pictures', 'picture/full': 'photo' };
  const KINDS = [
    { k: 'big-number', name: 'One big number', why: 'A single number, with what it means', sk: 'number', fit: ['number/1'], alt: ['number/many', 'voices'], ids: ['big-number-light', 'big-number-dark', 'big-number-area', 'basic-number'], ask: 'one big number with a line on what it means' },
    { k: 'three-numbers', name: 'Three numbers', why: 'A few numbers that belong together', sk: 'stats', fit: ['number/many'], alt: ['number/1'], ids: ['three-stats', 'kpi-dashboard', 'side-stacked-stats'], ask: 'two or three numbers side by side, each with a short label' },
    { k: 'two', name: 'Two side by side', why: 'Before and after, or this versus that', sk: 'two', fit: ['compare/2'], alt: ['compare/3-5'], ids: ['current-vs-future', 'mece-before-after', 'basic-two'], ask: 'two things side by side, so the difference is the point' },
    { k: 'ranked', name: 'Ranked bars', why: 'Biggest first, the one that matters highlighted', sk: 'bars', fit: ['compare/3-5', 'compare/6+'], alt: ['compare/2'], ids: ['ranked-bar', 'bar-highlight', 'side-ranked-bar', 'lollipop'], ask: 'a ranked bar chart, biggest first, with the bar that matters highlighted' },
    { k: 'columns', name: 'Columns side by side', why: 'Two measures for each thing', sk: 'columns', fit: ['compare/3-5', 'trend/1'], alt: ['compare/2', 'trend/many'], ids: ['clustered-column', 'column-highlight', 'dumbbell'], ask: 'columns side by side for each item, with the one that matters highlighted' },
    { k: 'table', name: 'Comparison table', why: 'When each row needs a few facts', sk: 'table', fit: ['compare/3-5', 'compare/6+', 'choice'], alt: ['compare/2'], ids: ['feature-comparison', 'side-comparison-table', 'data-table', 'heat-map-table', 'benchmark', 'basic-table'], ask: 'a comparison table with the column that matters highlighted' },
    { k: 'line', name: 'Line over time', why: 'One trend, with the turning point marked', sk: 'line', fit: ['trend/1'], alt: ['trend/many'], ids: ['line-chart', 'area-chart', 'side-line-end-labels'], ask: 'a line chart over time with the turning point called out' },
    { k: 'lines', name: 'Several lines', why: 'One line highlighted against the rest', sk: 'lines', fit: ['trend/many'], alt: ['trend/1'], ids: ['multi-line-highlight', 'slope-chart', 'small-multiples'], ask: 'a multi-line chart with one line highlighted and the rest in gray' },
    { k: 'stacked', name: 'Parts of a total', why: 'Shares that add up to 100 percent', sk: 'stack', fit: ['breakdown/parts'], alt: ['breakdown/change'], ids: ['stacked-bar-100', 'share-by-market', 'doughnut', 'pictograph', 'stacked-column'], ask: 'a 100 percent stacked bar showing how the total splits' },
    { k: 'waterfall', name: 'Waterfall', why: 'How you got from one total to another', sk: 'waterfall', fit: ['breakdown/change'], alt: ['breakdown/parts'], ids: ['waterfall', 'driver-tree', 'profit-tree'], ask: 'a waterfall from the starting total to the ending one, each step labeled' },
    { k: 'tree', name: 'Issue tree', why: 'A question broken into smaller ones', sk: 'tree', fit: ['breakdown/question'], alt: ['breakdown/change', 'breakdown/parts'], ids: ['hypothesis-tree', 'mece-breakdown', 'grouping', 'key-questions'], ask: 'an issue tree that breaks the question into a few parts that don’t overlap' },
    { k: 'steps', name: 'Process steps', why: 'A few steps in order, one highlighted', sk: 'steps', fit: ['process/steps'], alt: ['process/time'], ids: ['process-chevrons', 'sample-process', 'vertical-steps', 'cycle', 'basic-process'], ask: 'a process of three to five steps with the step that matters highlighted' },
    { k: 'timeline', name: 'Timeline or roadmap', why: 'What happens when, over weeks or months', sk: 'timeline', fit: ['process/time'], alt: ['process/steps'], ids: ['milestone-timeline', 'roadmap-swimlanes', 'gantt', 'workplan', 'plan-30-60-90'], ask: 'a timeline or roadmap with phases and milestones' },
    { k: 'quad', name: '2x2 matrix', why: 'Options placed on two axes that matter', sk: 'quad', fit: ['choice'], alt: [], ids: ['prioritization-2x2', 'options-2x2', 'sample-2x2', 'quadrant-scatter'], ask: 'a 2x2 matrix that places the options on two axes that matter' },
    { k: 'score', name: 'Options scored', why: 'Each option against the same criteria', sk: 'table', fit: ['choice'], alt: [], ids: ['weighted-scorecard', 'options-score-meters', 'pros-cons'], ask: 'the options scored against the same criteria, with the winner clear' },
    { k: 'quotes', name: 'Quotes', why: 'People’s own words, quoted exactly', sk: 'quote', fit: ['voices'], alt: [], ids: ['quote-wall', 'quote-and-data', 'interview-themes', 'basic-quotes', 'testimonials', 'testimonials-participants', 'testimonials-more'], ask: 'two or three quotes, quoted exactly from real sources and attributed' },
    { k: 'exec', name: 'Executive summary', why: 'The whole answer on one page', sk: 'exec', fit: ['answer'], alt: ['breakdown/question'], ids: ['exec-summary-numbered', 'exec-summary-scr', 'exec-summary-pyramid', 'three-key-things'], ask: 'an executive summary: the answer in the title and three reasons, each with one fact' },
    { k: 'recommend', name: 'Recommendation', why: 'What to do, and why', sk: 'text', fit: ['answer', 'choice'], alt: [], ids: ['recommendation', 'conditions', 'insight-evidence', 'basic-points'], ask: 'the recommendation, with the reasons and what has to be true' },
    { k: 'picture', name: 'Picture with the point', why: 'The picture proves what the title says', sk: 'picture', fit: ['picture/one'], alt: ['picture/full'], ids: ['basic-picture', 'image-text'], ask: 'a picture beside one or two lines on what to notice in it' },
    { k: 'pictures', name: 'Two pictures', why: 'Side by side, each with a caption', sk: 'pictures', fit: ['picture/two'], alt: ['picture/one'], ids: ['basic-pictures'], ask: 'two pictures side by side, each with a short caption' },
    { k: 'photo', name: 'Full-screen photo', why: 'One strong photo, the point said on it', sk: 'photo', fit: ['picture/full'], alt: ['picture/one'], ids: ['basic-photo'], ask: 'a full-screen photo with the point as a title on a dark band' },
    { k: 'divider', name: 'Section divider', why: 'Starts a new part of the deck', sk: 'divider', fit: ['section'], alt: [], ids: ['basic-section', 'section-divider'], ask: 'a section divider for the next part' },
    { k: 'question', name: 'A question for the group', why: 'Discussion, or a quick poll', sk: 'question', fit: ['group/discuss'], alt: ['group/exercise'], ids: ['basic-question'], ask: 'a question for the group to discuss, about their own work' },
    { k: 'exercise', name: 'An exercise', why: 'Instructions for pairs or teams', sk: 'exercise', fit: ['group/exercise'], alt: ['group/discuss'], ids: ['basic-exercise'], ask: 'an exercise slide: who works with whom, the steps, and how they share back' },
  ];

  // little drawings for layouts this deck doesn't carry
  const R = 'var(--sbx-accent)', G = '#C9C4C0', D = '#272322';
  const SK = {
    number: `<text x="80" y="54" text-anchor="middle" font-size="30" font-weight="900" fill="${R}">64%</text><rect x="45" y="64" width="70" height="4" fill="${G}"/>`,
    stats: [0, 1, 2].map((i) => `<text x="${28 + i * 52}" y="50" text-anchor="middle" font-size="17" font-weight="900" fill="${i === 1 ? R : D}">${['4×', '22%', '$3M'][i]}</text><rect x="${12 + i * 52}" y="58" width="32" height="3" fill="${G}"/>`).join(''),
    two: `<rect x="10" y="26" width="66" height="52" fill="${G}" opacity=".5"/><rect x="84" y="26" width="66" height="52" fill="${R}" opacity=".25"/><rect x="16" y="32" width="30" height="4" fill="${D}"/><rect x="90" y="32" width="30" height="4" fill="${R}"/>`,
    bars: [80, 64, 48, 34, 22].map((w, i) => `<rect x="14" y="${24 + i * 12}" width="${w}" height="8" fill="${i ? G : R}"/>`).join(''),
    columns: [0, 1, 2].map((i) => `<rect x="${22 + i * 40}" y="${50 - i * 6}" width="12" height="${30 + i * 6}" fill="${G}"/><rect x="${35 + i * 40}" y="${40 - i * 8}" width="12" height="${40 + i * 8}" fill="${R}"/>`).join(''),
    table: `<rect x="10" y="22" width="140" height="10" fill="${D}"/>` + [0, 1, 2, 3].map((i) => `<rect x="10" y="${34 + i * 12}" width="140" height="10" fill="#fff" stroke="#E4E1E1"/>`).join('') + `<rect x="112" y="34" width="38" height="46" fill="${R}" opacity=".18"/>`,
    line: `<polyline points="12,72 40,64 68,60 96,44 124,30 148,24" fill="none" stroke="${R}" stroke-width="3"/><circle cx="96" cy="44" r="4" fill="${R}"/>`,
    lines: `<polyline points="12,60 50,56 90,52 148,48" fill="none" stroke="${G}" stroke-width="2"/><polyline points="12,70 50,66 90,64 148,62" fill="none" stroke="${G}" stroke-width="2"/><polyline points="12,66 50,50 90,38 148,24" fill="none" stroke="${R}" stroke-width="3"/>`,
    stack: [0, 1, 2].map((i) => `<rect x="14" y="${26 + i * 18}" width="60" height="12" fill="${R}"/><rect x="74" y="${26 + i * 18}" width="${40 - i * 8}" height="12" fill="${G}"/><rect x="${114 - i * 8}" y="${26 + i * 18}" width="${32 + i * 8}" height="12" fill="#E4E1E1"/>`).join(''),
    waterfall: `<rect x="12" y="30" width="18" height="50" fill="${D}"/><rect x="36" y="22" width="18" height="8" fill="${R}"/><rect x="60" y="14" width="18" height="8" fill="${R}"/><rect x="84" y="14" width="18" height="16" fill="${G}"/><rect x="108" y="30" width="18" height="10" fill="${G}"/><rect x="132" y="40" width="18" height="40" fill="${D}"/>`,
    tree: `<rect x="10" y="40" width="34" height="14" fill="${D}"/>` + [0, 1, 2].map((i) => `<path d="M44 47 H56 V${26 + i * 22} H64" fill="none" stroke="${G}"/><rect x="64" y="${20 + i * 22}" width="40" height="12" fill="${R}"/><rect x="110" y="${20 + i * 22}" width="40" height="12" fill="#E4E1E1"/>`).join(''),
    steps: [0, 1, 2, 3].map((i) => `<path d="M${10 + i * 36} 36 h28 l8 10 l-8 10 h-28 l8 -10 z" fill="${i === 3 ? R : D}"/>`).join(''),
    timeline: `<rect x="10" y="48" width="140" height="2" fill="${G}"/>` + [20, 60, 100, 140].map((x, i) => `<circle cx="${x}" cy="49" r="5" fill="${i === 2 ? R : D}"/><rect x="${x - 14}" y="${i % 2 ? 58 : 30}" width="28" height="6" fill="${G}"/>`).join(''),
    quad: `<rect x="30" y="16" width="56" height="34" fill="${G}" opacity=".35"/><rect x="88" y="16" width="56" height="34" fill="${R}" opacity=".22"/><rect x="30" y="52" width="56" height="34" fill="${G}" opacity=".35"/><rect x="88" y="52" width="56" height="34" fill="${G}" opacity=".35"/><circle cx="108" cy="30" r="4" fill="${R}"/><circle cx="124" cy="38" r="4" fill="${R}"/><circle cx="56" cy="66" r="4" fill="#9C9896"/>`,
    quote: `<text x="18" y="46" font-size="34" font-weight="900" fill="${R}">“</text><rect x="40" y="30" width="100" height="5" fill="${D}" opacity=".45"/><rect x="40" y="40" width="88" height="5" fill="${D}" opacity=".45"/><rect x="40" y="54" width="40" height="4" fill="${D}"/>`,
    exec: [0, 1, 2].map((i) => `<circle cx="20" cy="${30 + i * 18}" r="6" fill="${R}"/><rect x="32" y="${27 + i * 18}" width="${90 - i * 10}" height="6" fill="${D}"/>`).join(''),
    text: `<rect x="14" y="30" width="120" height="6" fill="${D}"/><rect x="14" y="46" width="132" height="4" fill="${G}"/><rect x="14" y="56" width="110" height="4" fill="${G}"/><rect x="14" y="66" width="120" height="4" fill="${G}"/>`,
    divider: `<rect width="160" height="90" fill="${R}"/><rect x="14" y="30" width="84" height="8" fill="#fff"/><rect x="14" y="44" width="56" height="4" fill="#fff" opacity=".6"/>` + [0, 1, 2].map((i) => `<rect x="${14 + i * 46}" y="74" width="40" height="${i === 1 ? 3 : 1.5}" fill="#fff" opacity="${i === 1 ? 1 : .5}"/>`).join(''),
    picture: `<rect x="10" y="24" width="84" height="56" fill="${G}"/><path d="M24 72 l18 -18 l14 12 l12 -10 l20 16 z" fill="#fff" opacity=".7"/><rect x="102" y="38" width="48" height="5" fill="${D}"/><rect x="102" y="50" width="40" height="4" fill="${G}"/>`,
    pictures: `<rect x="10" y="24" width="66" height="44" fill="${G}"/><rect x="84" y="24" width="66" height="44" fill="${G}"/><rect x="10" y="73" width="40" height="4" fill="${D}"/><rect x="84" y="73" width="40" height="4" fill="${D}"/>`,
    photo: `<rect width="160" height="90" fill="#7A7470"/><path d="M30 70 l30 -30 l22 18 l18 -14 l34 26 z" fill="#9C9896"/><rect x="0" y="62" width="160" height="28" fill="#272322" opacity=".8"/><rect x="12" y="72" width="90" height="6" fill="#fff"/>`,
    question: `<rect width="160" height="90" fill="${R}"/><rect x="30" y="36" width="100" height="7" fill="#fff"/><rect x="48" y="50" width="64" height="4" fill="#fff" opacity=".6"/>`,
    exercise: `<rect width="160" height="90" fill="${R}"/><rect x="14" y="14" width="40" height="7" rx="3" fill="#fff" opacity=".8"/><rect x="14" y="30" width="132" height="48" fill="#fff"/>` + [0, 1, 2].map((i) => `<rect x="22" y="${38 + i * 12}" width="${90 - i * 14}" height="4" fill="${G}"/>`).join(''),
  };
  const sketch = (k) => `<svg viewBox="0 0 160 90" xmlns="http://www.w3.org/2000/svg" font-family="Lato, sans-serif"><rect width="160" height="90" fill="#F1EFEE"/>${!['divider', 'question', 'exercise', 'photo'].includes(k) ? `<rect x="10" y="8" width="96" height="6" fill="${R}" opacity=".85"/>` : ''}${SK[k] || ''}</svg>`;

  // ---------- styles (kept out of the page's HTML, so Save a copy stays clean) ----------
  const css = new CSSStyleSheet();
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--red-deep').trim() || '#A22731';
  css.replaceSync(`
    :root { --sbx-accent: ${accent}; }
    #sb-top .sbx-new { color: var(--sbx-accent); border-color: var(--sbx-accent); font-weight: 700; }
    #sb-top .sbx-new:hover { background: color-mix(in srgb, var(--sbx-accent) 8%, #fff); }
    #sb-top .sbx-new b, .sbx-filmnew b { display: inline-grid; place-items: center; width: 17px; height: 17px; border-radius: 50%; background: var(--sbx-accent); color: #fff; font: 700 14px/1 'DM Sans', sans-serif; vertical-align: -3px; }
    #sb-top .sbx-new b { margin-right: 1px; }
    #sb-top .sbx-new:disabled { opacity: .4; }
    .sbx-filmnew { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 2px 10px 8px; padding: 9px 10px; border: 1.5px dashed var(--sbx-accent); border-radius: 8px; background: color-mix(in srgb, var(--sbx-accent) 5%, #fff); color: var(--sbx-accent); font: 700 13px 'DM Sans', sans-serif; cursor: pointer; }
    .sbx-filmnew:hover { border-style: solid; background: color-mix(in srgb, var(--sbx-accent) 10%, #fff); }
    .sbx-filmnew kbd { font: 600 10.5px 'DM Sans', sans-serif; border: 1px solid currentColor; border-radius: 4px; padding: 0 4px; opacity: .6; }
    #sbx-back { display: none; position: fixed; inset: 0; z-index: 3000; background: rgba(39,35,34,.38); align-items: flex-start; justify-content: center; padding: 70px 16px; overflow-y: auto; font: 14px/1.45 'DM Sans', -apple-system, sans-serif; color: #272322; }
    #sbx-back.on { display: flex; }
    #sbx { width: 720px; max-width: 100%; background: #fff; border-radius: 12px; box-shadow: 0 18px 50px rgba(35,31,32,.25); padding: 20px 24px 22px; }
    #sbx .hd { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
    #sbx h3 { margin: 0; font-size: 19px; }
    #sbx .tabs { display: flex; gap: 16px; font-size: 13px; }
    #sbx .tabs button { border: 0; background: none; padding: 0; font: inherit; color: #635B58; cursor: pointer; }
    #sbx .tabs button.on { color: #272322; font-weight: 700; text-decoration: underline; text-underline-offset: 4px; }
    #sbx .x { border: 0; background: none; font-size: 22px; line-height: 1; color: #948C88; cursor: pointer; padding: 0 2px; }
    #sbx label { display: block; font-size: 13px; color: #635B58; margin: 16px 0 6px; }
    #sbx .opts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
    #sbx .opts.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    #sbx .opt { display: flex; align-items: center; gap: 10px; text-align: left; font: inherit; font-size: 13.5px; line-height: 1.3; color: #272322; border: 1px solid #D9D4D0; border-radius: 8px; padding: 5px 10px 5px 5px; background: #fff; cursor: pointer; }
    #sbx .opt .th { flex: none; width: 58px; line-height: 0; border-radius: 4px; overflow: hidden; box-shadow: 0 0 0 1px #E6E1DD; }
    #sbx .opt .th svg { display: block; width: 100%; height: auto; }
    #sbx .opt:hover { border-color: #BDB6B1; }
    #sbx .opt.on { border: 2px solid var(--sbx-accent); padding: 4px 9px 4px 4px; font-weight: 600; }
    #sbx .picks { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    #sbx .pick { text-align: left; font: inherit; border: 1px solid #D9D4D0; border-radius: 8px; padding: 7px; background: #fff; cursor: pointer; }
    #sbx .pick.on { border: 2px solid var(--sbx-accent); padding: 6px; }
    #sbx .pick b { display: block; font-size: 13px; margin-top: 6px; }
    #sbx .pick small { display: block; font-size: 12px; color: #635B58; line-height: 1.35; }
    #sbx .pick em { display: block; font-style: normal; font-size: 11.5px; color: #948C88; margin-top: 3px; }
    #sbx .tb { aspect-ratio: 16 / 9; overflow: hidden; position: relative; border-radius: 4px; background: #F1EFEE; }
    #sbx .tb svg { display: block; width: 100%; height: 100%; }
    #sbx .tb .slide { position: absolute; top: 0; left: 0; transform-origin: top left; pointer-events: none; }
    #sbx input[type=text] { width: 100%; box-sizing: border-box; font: inherit; font-size: 14px; border: 1px solid #D9D4D0; border-radius: 8px; padding: 9px 11px; }
    #sbx input[type=text]:focus { outline: none; border-color: var(--sbx-accent); box-shadow: 0 0 0 2px rgba(162,39,49,.14); }
    #sbx .ft { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 18px; }
    #sbx .ft .note { font-size: 12.5px; color: #948C88; }
    #sbx .b { font: inherit; font-size: 13.5px; border: 1px solid #D9D4D0; border-radius: 8px; padding: 7px 13px; background: #fff; color: #272322; cursor: pointer; }
    #sbx .b.red { background: var(--sbx-accent); border-color: var(--sbx-accent); color: #fff; }
    #sbx .b:disabled { opacity: .45; cursor: default; }
    #sbx .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; max-height: 52vh; overflow-y: auto; padding: 2px; }
    #sbx .grp { grid-column: 1 / -1; font-size: 11.5px; letter-spacing: .07em; text-transform: uppercase; color: #948C88; font-weight: 600; margin: 8px 0 0; }
    #sbx .empty { color: #948C88; font-size: 13px; padding: 10px 0; }
    .sbx-plus { border: 0; background: none; font: 600 12px 'DM Sans', sans-serif; color: inherit; cursor: pointer; padding: 2px 6px; border-radius: 6px; }
    .sbx-plus:hover { background: rgba(0,0,0,.06); }`);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, css];

  // ---------- the panel ----------
  const back = document.createElement('div'); back.id = 'sbx-back';
  back.innerHTML = '<div id="sbx" role="dialog" aria-modal="true" aria-labelledby="sbx-t"></div>';
  document.body.appendChild(back);
  const panel = back.firstElementChild;
  const st = { tab: 'choose', q1: '', q2: '', kind: null, id: null, what: '', after: undefined };   // after: the slide it goes after (null = first)

  function picksFor() {
    if (!st.q1 || (FOLLOW[st.q1] && !st.q2)) return [];
    const key = FOLLOW[st.q1] ? `${st.q1}/${st.q2}` : st.q1;
    // the best fits first, then close seconds; a layout this deck already carries wins a tie
    const score = (k) => (k.fit.includes(key) || k.fit.includes(st.q1) ? 3 : (k.alt || []).includes(key) || (k.alt || []).includes(st.q1) ? 1 : 0);
    return KINDS.map((k) => ({ k, s: score(k), id: k.ids.map(take).find(Boolean) || null })).filter((x) => x.s)
      .sort((a, b) => (b.s - a.s) || ((b.id ? 1 : 0) - (a.id ? 1 : 0))).slice(0, 3);
  }
  function thumb(el, id) {
    let s = null; try { const w = [...deck.children].find((n) => n.dataset && n.dataset.id === id); s = w ? w.querySelector('.slide') : null;
      if (!s) { const b = build(id); s = b && (b.querySelector ? b.querySelector('.slide') : null); } } catch (e) { s = null; }   // eslint-disable-line no-undef
    if (!s) return;
    const c = s.cloneNode(true); c.querySelectorAll('.ctrls, .slide-tag, .sb-badge, .sbg-ov').forEach((x) => x.remove()); c.querySelectorAll('[contenteditable]').forEach((x) => x.removeAttribute('contenteditable')); c.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
    el.innerHTML = ''; el.appendChild(c); requestAnimationFrame(() => { c.style.transform = `scale(${el.clientWidth / 1000})`; });
  }
  function render() {
    const tabs = `<div class="tabs">${[['choose', 'Help me choose'], ['basic', 'Basic layouts'], ['browse', 'All layouts']].map(([k, l]) => `<button data-tab="${k}" class="${st.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    let h = `<div class="hd"><h3 id="sbx-t">Add a slide</h3>${tabs}<button class="x" data-x aria-label="Close">×</button></div>`;
    if (st.tab === 'choose') {
      h += `<label>What are you trying to show?</label><div class="opts three">${ASK.map(([k, l]) => `<button class="opt${st.q1 === k ? ' on' : ''}" data-q1="${k}"><span class="th" aria-hidden="true">${sketch(ASK_SK[k])}</span><span>${l}</span></button>`).join('')}</div>`;
      const f = FOLLOW[st.q1];
      if (f) h += `<label>${f[0]}</label><div class="opts three">${f[1].map(([k, l]) => `<button class="opt${st.q2 === k ? ' on' : ''}" data-q2="${k}"><span class="th" aria-hidden="true">${sketch(FOLLOW_SK[st.q1 + '/' + k])}</span><span>${l}</span></button>`).join('')}</div>`;
      const picks = picksFor();
      if (picks.length) {
        if (!picks.some((p) => p.k.k === (st.kind && st.kind.k))) { st.kind = picks[0].k; st.id = picks[0].id; }
        h += `<label>Try one of these</label><div class="picks">${picks.map((p) => `<button class="pick${p.k.k === st.kind.k ? ' on' : ''}" data-kind="${p.k.k}"><div class="tb" data-tb="${esc(p.id || '')}">${p.id ? '' : sketch(p.k.sk)}</div><b>${esc(p.k.name)}</b><small>${esc(p.k.why)}</small><em>${p.id ? 'In this deck’s layouts' : 'Claude builds this one'}</em></button>`).join('')}</div>`;
      }
    } else if (st.tab === 'basic') {
      const L = lib(), bases = Object.keys(L).filter((k) => L[k].lib && !L[k].copyOf);
      if (!bases.length) h += '<div class="empty">This deck doesn’t carry the basic layouts yet. Ask Claude to “backfit the basic layouts” into it, or use Help me choose and Copy prompt.</div>';
      else h += '<div class="grid">' + bases.map((b) => { const free = take(b), n = used(b);
        return `<button class="pick${st.id && (st.id === b || L[st.id] && L[st.id].copyOf === b) ? ' on' : ''}" data-base="${esc(b)}"${free ? '' : ' disabled'}><div class="tb" data-tb="${esc(b)}"></div><small style="margin-top:5px">${esc(L[b].title || API.title(b)).slice(0, 70)}</small><em>${n ? `${n} in this deck` : 'Basic layout'}${free ? '' : ' · no copies left'}</em></button>`; }).join('') + '</div>';
    } else {
      const L = lib(), cl = labels(), cats = (() => { try { return CATS; } catch (e) { return []; } })();   // eslint-disable-line no-undef
      const out = Object.keys(L).filter((k) => addable(k) && !L[k].lib).sort((x, y) => (cats.indexOf(L[x].cat) - cats.indexOf(L[y].cat)));
      if (!out.length) h += '<div class="empty">This deck has no layouts waiting outside this version. Use Help me choose, and Copy prompt asks Claude to build the slide.</div>';
      else {
        let last = null; h += '<div class="grid">';
        out.forEach((id) => { const g = L[id].lib ? 'Basic layouts' : (cl[L[id].cat] || L[id].cat || ''); if (g !== last) { h += `<div class="grp">${esc(String(g).replace(/ · \d+:\d+.*$/, '').replace(/ — .*$/, ''))}</div>`; last = g; }
          h += `<button class="pick${st.id === id ? ' on' : ''}" data-id="${esc(id)}" title="${esc(API.title(id))}"><div class="tb" data-tb="${esc(id)}"></div><small style="margin-top:5px">${esc(API.title(id)).slice(0, 70)}</small></button>`; });
        h += '</div>';
      }
    }
    const ready = st.tab === 'choose' ? !!st.kind && picksFor().length : !!st.id;   // basic and all layouts: a layout picked
    const pos = (() => { const ids = API.slides(), a = st.after === undefined ? API.current() : st.after, k = ids.findIndex((x) => x.id === a); return a === null ? 'at the start of the deck' : k >= 0 ? `after slide ${k + 1}` : 'at the end'; })();
    h += `<label for="sbx-what">What should it say? <span style="color:#948C88">(optional)</span></label><input type="text" id="sbx-what" value="${esc(st.what)}" placeholder="Three vendors on price, speed, and support; ours wins on support">`;
    const canAdd = ready && st.id && addable(st.id);
    h += `<div class="ft"><span class="note">${!ready ? '' : canAdd ? `Goes in ${pos}.` : 'This deck doesn’t carry this layout yet: copy the prompt and Claude adds it.'}</span><span><button class="b" data-copy${ready ? '' : ' disabled'}>Copy prompt for Claude or Codex</button> <button class="b red" data-add${canAdd ? '' : ' disabled'}>Add slide</button></span></div>`;
    panel.innerHTML = h;
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); thumb(e.target, e.target.dataset.tb); } }), { root: panel.querySelector('.grid') || null, rootMargin: '200px' });
    panel.querySelectorAll('[data-tb]').forEach((el) => { if (el.dataset.tb) io.observe(el); });
    const w = panel.querySelector('#sbx-what'); w.addEventListener('input', () => { st.what = w.value; });
  }
  function prompt(added) {
    const L = lib(), ids = API.slides(), cur = st.after === undefined ? API.current() : st.after, k = ids.findIndex((s) => s.id === cur), here = ids[k];
    const file = `${SB.folder}/${SB.entry}`.replace(/^~\//, '~/');
    const where = here ? `after slide ${k + 1} (“${here.title}”)` : st.after === null && ids.length ? `before slide 1 (“${ids[0].title}”)` : 'at the end';
    const kind = st.tab === 'choose' && st.kind ? st.kind : null;
    const what = (st.what || '').trim();
    const lines = [`In my slide deck “${SB.name}” (file ${file}; open at ${location.origin}${location.pathname}${cur ? '#s=' + cur : ''}),`];
    if (st.id && L[st.id] && (added || shown().includes(st.id))) lines.push(`I just added a “${kind ? kind.name : API.title(st.id)}” slide (LIBRARY['${st.id}']) ${where}. Fill it in${what ? ': ' + what : ' for this deck'}.`);
    else if (st.id && L[st.id]) lines.push(`add the slide LIBRARY['${st.id}'] (“${kind ? kind.name : API.title(st.id)}”) ${where}${what ? ', and fill it in: ' + what : ', and fill it in for this deck'}.`);
    else lines.push(`add a new slide ${where}: ${kind ? kind.ask : 'the layout described below'}${what ? '. It should say: ' + what : ''}.`);
    lines.push('Keep the deck’s own layouts, colors, and fonts. The title is a plain sentence that says the point, two lines at most, and the slide passes Checks › Guides. Put any wording you drafted in the slide’s notes.');
    return lines.join(' ');
  }
  async function copy(t) { try { await navigator.clipboard.writeText(t); return true; } catch (e) { return false; } }
  function add() {
    const id = st.id, inp = id && box(id); if (!inp || !addable(id)) return;
    const after = st.after === undefined ? API.current() : st.after;
    inp.click();   // the deck adds it to this version and re-renders
    setTimeout(() => {
      const order = API.slides().map((s) => s.id).filter((x) => x !== id), k = order.indexOf(after);
      order.splice(after === null ? 0 : k < 0 ? order.length : k + 1, 0, id);
      try { API.order(order); } catch (e) {}
      setTimeout(() => { API.go(id, true); }, 300);
    }, 350);
  }
  panel.addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.matches('[data-x]')) return close();
    if (t.dataset.tab) { st.tab = t.dataset.tab; st.id = null; return render(); }
    if (t.dataset.q1) { st.q1 = t.dataset.q1; st.q2 = ''; st.kind = null; st.id = null; return render(); }
    if (t.dataset.q2) { st.q2 = t.dataset.q2; st.kind = null; st.id = null; return render(); }
    if (t.dataset.kind) { const p = picksFor().find((x) => x.k.k === t.dataset.kind); st.kind = p.k; st.id = p.id; return render(); }
    if (t.dataset.id) { st.id = t.dataset.id; return render(); }
    if (t.dataset.base) { st.id = take(t.dataset.base); st.kind = null; return render(); }
    if (t.matches('[data-copy]')) { const ok = await copy(prompt()); t.textContent = ok ? 'Copied: paste it to Claude or Codex' : 'Copy failed'; setTimeout(() => { if (t.isConnected) t.textContent = 'Copy prompt for Claude or Codex'; }, 2400); return; }
    if (t.matches('[data-add]')) { const p = prompt(true); add(); close(); await copy(p); return; }
  });
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  function open(after) { st.what = ''; st.after = after; st.id = null; st.kind = null; render(); back.classList.add('on'); }
  function close() { back.classList.remove('on'); }
  window.SlideBuilder.addSlide = (after) => open(after);

  // ---------- ways in: + between slides (filmstrip and Scroll), + Slide in the top bar and the sorter, and N ----------
  const head = document.querySelector('#sb-film .sb-colhead');
  if (head) { const b = document.createElement('button'); b.className = 'sbx-filmnew'; b.innerHTML = '<b>+</b> New slide <kbd>N</kbd>'; b.title = 'Add a slide after the one you’re on'; b.addEventListener('click', () => open()); head.after(b); }
  const topBar = document.getElementById('sb-top'), hideBtn = document.getElementById('sb-hide');
  if (topBar) { const b = document.createElement('button'); b.className = 'sb-btn sbx-new'; b.id = 'sbx-top'; b.innerHTML = '<b>+</b><span class="sb-long"> New slide</span>'; b.title = 'Add a slide after the one you’re on (N)'; b.addEventListener('click', () => open()); if (hideBtn) hideBtn.before(b); else topBar.appendChild(b); }
  const ins = (id, label) => { const g = document.createElement('span'); g.className = 'sbx-ins'; g.setAttribute('role', 'button'); g.dataset.after = id; g.title = label; g.innerHTML = '<i></i><b>+</b><i></i>'; return g; };
  const list = document.getElementById('sb-film-list');
  const decorateFilm = () => { if (!list) return; list.querySelectorAll('.sb-fi').forEach((fi) => { if (!fi.querySelector(':scope > .sbx-ins')) fi.appendChild(ins(fi.dataset.id, 'Add a slide here')); }); };
  if (list) {
    new MutationObserver(decorateFilm).observe(list, { childList: true, subtree: true }); decorateFilm();
    list.addEventListener('click', (e) => { const g = e.target.closest('.sbx-ins'); if (!g) return; e.stopPropagation(); e.preventDefault(); open(g.dataset.after); }, true);
  }
  const decorated = new Set();
  const decorateDeck = () => {
    const lazy = window.DeckRenderer?.enabled();
    for (const w of decorated) if (!w.isConnected || (lazy && w.classList.contains('is-unrendered'))) { w.querySelector(':scope > .sbx-ins')?.remove(); decorated.delete(w); }
    const rows = lazy ? deck.querySelectorAll(':scope > [data-id]:not(.is-unrendered)') : deck.children;
    for (const w of rows) if (w.dataset?.id && !decorated.has(w)) { w.appendChild(ins(w.dataset.id, 'Add a slide after this one')); decorated.add(w); }
  };
  new MutationObserver(decorateDeck).observe(deck, { childList: true });
  window.addEventListener('sb:slide', decorateDeck); window.addEventListener('sb:window', decorateDeck); decorateDeck();
  deck.addEventListener('click', (e) => { const g = e.target.closest('.sbx-ins'); if (!g) return; e.stopPropagation(); open(g.dataset.after); }, true);
  const sorter = document.getElementById('sb-sorter');
  if (sorter) new MutationObserver(() => { const h = sorter.querySelector('.sb-sorter-head'); if (h && !h.querySelector('.sbx-plus')) { const b = document.createElement('button'); b.className = 'sbx-plus'; b.textContent = '+ Add slide'; b.addEventListener('click', () => open()); h.appendChild(b); } }).observe(sorter, { childList: true });
  css.insertRule('#sb-film-list .sb-fi { position: relative; overflow: visible; }');
  css.insertRule('.sbx-ins { position: absolute; left: 6px; right: 6px; bottom: -11px; height: 18px; z-index: 6; display: flex; align-items: center; gap: 6px; opacity: 0; cursor: pointer; transition: opacity .12s; }');
  css.insertRule('.sbx-ins i { flex: 1; height: 2px; border-radius: 1px; background: var(--sbx-accent, #A22731); }');
  css.insertRule('.sbx-ins b { width: 18px; height: 18px; border-radius: 50%; background: var(--sbx-accent, #A22731); color: #fff; font: 700 14px/18px "DM Sans", sans-serif; text-align: center; }');
  css.insertRule('.sbx-ins:hover, #sb-film-list .sb-fi:hover > .sbx-ins { opacity: 1; }');
  css.insertRule('#deck > [data-id] > .sbx-ins { display: none; }');
  css.insertRule('body.sb-scroll #deck > [data-id] { position: relative; }');
  css.insertRule('body.sb-scroll #deck > [data-id] > .sbx-ins { display: flex; position: absolute; left: 0; right: 0; bottom: -22px; height: 22px; }');
  css.insertRule('body.sb-scroll #deck > [data-id]:hover > .sbx-ins { opacity: .9; }');
  css.insertRule('@media print { .sbx-ins, #sbx-top { display: none !important; } }');
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && back.classList.contains('on')) { close(); return; }
    if ((e.key !== 'n' && e.key !== 'N') || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    try { if (showing) return; } catch (x) {}   // eslint-disable-line no-undef
    e.preventDefault(); open();
  });
  // the + in the top bar is only for views with a slide in focus
  const syncTop = () => { const b = document.getElementById('sbx-top'); if (b) b.disabled = document.body.classList.contains('sb-checks'); };
  new MutationObserver(syncTop).observe(document.body, { attributes: true, attributeFilter: ['class'] }); syncTop();
})();
