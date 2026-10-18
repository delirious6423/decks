/* Basic layouts every new deck carries, ready to add from Add a slide. Each one is guided:
   its text says what goes there. They start outside every version (alt + lib). */
(() => {
  const C = CATS[CATS.length - 1], D = 'Basic layout from Add a slide: placeholder text, replace it.';
  Object.assign(LIBRARY, {
    'basic-number': { cat: C, alt: true, lib: true, layout: 'lines', lines: [{ t: '[X]%', size: '6.5rem' }, { t: 'What the number means, in one plain line', size: '1.7rem' }], title: 'One big number', notes: D },
    'basic-points': { cat: C, alt: true, lib: true, layout: 'plain', title: 'Say the point of this slide as one plain sentence',
      body: ['The body proves the title. Keep only what the audience needs to believe it.', 'Two or three short paragraphs at most.'], notes: D },
    'basic-two': { cat: C, alt: true, lib: true, layout: 'twocol', title: 'Put two things side by side when the difference is the point',
      cols: [{ h: 'Today', body: ['What happens now.'] }, { h: 'Proposed', body: ['What changes, and why it is better.'] }], notes: D },
    'basic-process': { cat: C, alt: true, lib: true, layout: 'flow', title: 'Show a process as a few steps, with the one that matters highlighted',
      steps: [{ wk: 'Step 1', lbl: 'What happens first', sub: 'One line of detail' }, { wk: 'Step 2', lbl: 'What happens next', sub: 'One line of detail' },
              { wk: 'Step 3', lbl: 'The step that matters', sub: 'Why it is the one to watch', accent: true }], notes: D },
    'basic-table': { cat: C, alt: true, lib: true, layout: 'data', numeric: false, title: 'A small table carries the facts, with the column that matters highlighted',
      cols: ['', 'First option', 'Second option', 'Third option'], rows: [['What it costs', '$', '$$', '$$$'], ['How long it takes', 'Weeks', 'Months', 'A quarter'], ['What you get', 'The basics', 'More', 'Everything']], em: 2, notes: D },
    'basic-quotes': { cat: C, alt: true, lib: true, layout: 'twocol', title: 'People’s own words, quoted exactly, carry more than a summary of them',
      cols: [{ h: 'Name, role', body: ['“Their words, quoted exactly from a source you can cite.”'] }, { h: 'Name, role', body: ['“A second voice, ideally one that disagrees.”'] }],
      notes: 'Basic layout from Add a slide. Only real quotes from a source you have open, attributed to who actually said them.' },
    'basic-section': { cat: C, alt: true, lib: true, layout: 'section', dark: true, n: '', mod: 'New part', short: 'New part', title: 'The next part of the argument', able: 'One line on what this part shows.', notes: D },
    'basic-question': { cat: C, alt: true, lib: true, layout: 'reflect', title: 'A question for the group', q: 'A plain question about the group’s own work', subq: 'Give them a minute to think before anyone answers.', notes: D },
    'basic-picture': { cat: C, alt: true, lib: true, layout: 'picture', title: 'Put the point in the title, and let the picture prove it',
      body: ['One or two lines on what to notice in the picture.', 'Click the picture to put your own in, or drop an image on it.'], notes: D },
    'basic-pictures': { cat: C, alt: true, lib: true, layout: 'pictures', title: 'Two pictures side by side make a difference easy to see',
      pics: [{ cap: 'Before: what it looked like' }, { cap: 'After: what changed' }], notes: D },
    'basic-photo': { cat: C, alt: true, lib: true, layout: 'photofull', title: 'A full-screen photo, with the point said plainly on it',
      sub: 'Click the photo to put your own in.', notes: D },
    'basic-exercise': { cat: C, alt: true, lib: true, layout: 'breakout', lab: 'Practice', time: '15', setup: '<b>Pairs</b>Who works with whom.',
      title: 'What each pair or team does, in one sentence', steps: ['The first instruction, one plain sentence.', 'The second instruction.', 'How they share back.'], notes: D },
  });
  // up to six of each, so a deck can have several picture or point slides without editing the file
  Object.keys(LIBRARY).filter((k) => LIBRARY[k].lib && !LIBRARY[k].copyOf).forEach((k) => {
    for (let n = 2; n <= 6; n++) LIBRARY[`${k}-${n}`] = Object.assign({}, LIBRARY[k], { copyOf: k });
  });
})();
