const CATS = ['open', 'main', 'close'];
const CAT_LABELS = { open: 'Opening', main: 'The argument', close: 'Close' };
const CAT_SHORT = { open: 'Open', main: 'Main', close: 'Close' };
const FIGS = {};

const LIBRARY = {
  'title': { cat:'open', layout:'title', title:'{{NAME_JS}}', date:'Who it is for · the date',
    notes:'Replace the title with the question the deck answers, or with the answer itself.' },

  'part-1': { cat:'main', layout:'section', dark:true, n:'1', mod:'Part 1', title:'The first part of the argument', able:'One line on what this part shows.' },
  'point-1': { cat:'main', layout:'plain', title:'Each title says the point of its slide as one plain sentence',
    body:['The body proves the title. Keep only what the audience needs to believe the sentence above.',
          'A title takes two lines at most. Checks › Guides (key 5) shows that limit and the protected border.'],
    notes:'Draft placeholder text for your agent to replace.' },
  'point-2': { cat:'main', layout:'twocol', title:'Put two things side by side when the difference is the point',
    cols:[{ h:'Today', body:['What happens now.'] }, { h:'Proposed', body:['What changes, and why it is better.'] }],
    notes:'Draft placeholder text for your agent to replace.' },

  'closing': { cat:'close', layout:'closing', dark:true, title:'Thank you', contacts:['Your name', 'your-site.com'], site:'', notes:'Replace with your name and where people can reach you.' },
};
