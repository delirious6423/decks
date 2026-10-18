#!/usr/bin/env python3
"""New decks and templates for the Slide Builder.

    python3 newdeck.py templates         list the templates
    python3 newdeck.py build <template>  print a template's assembled deck file (for checking)

The engine (templates/_engine/engine.html) is one self-contained deck file without
content: the layouts, editing, versions, sorter, present mode, and "Save a copy" are
there; the slides, figures, and versions are placeholders. Each template in
templates/<id>/ fills them:

    template.json   name, description, kind, the sidebar line, and which files to copy
    content.js      CATS, CAT_LABELS, CAT_SHORT, FIGS, LIBRARY (the slides)
    pitches.js      PITCHES (the versions)
    anything else   copied next to the deck (img/, slide data scripts)

create_deck() copies a template into a new folder in the decks folder (sbconfig.py),
gives it its own storage prefix, adds it to decks.json, starts its git history, and
writes BRIEF.md with the brief from the New deck form. The server and `sb new` both
call it. Every new deck also carries the basic guided layouts in _engine/basics.js.
"""
import html
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import sbconfig

APP = Path(__file__).resolve().parent
TEMPLATES = APP / 'templates'
ENGINE = TEMPLATES / '_engine' / 'engine.html'   # the bundled engine every deck is built from
GITIGNORE = '*.pdf\n*.zip\n*.pptx\n_archive/\n.DS_Store\n.slidebuilder/thumb.png\n'

# ---------- themes ----------
# Each theme sets the engine's colors (CSS variables, written into the deck as one <style> block) and
# a color map for converted PowerPoint slides: their red source palette mapped onto the theme, text
# and fills separately, so Dark can turn dark text light and white panels dark.
def _pp(accent, deep, tint, light, dark, gray, mid, muted, panel, line, bg='#FFFFFF', card='#FFFFFF', on_dark='#FFFFFF', text_dark=None, text_gray=None, cover=None):
    fill = {'#A22731': accent, '#A12731': accent, '#842F2F': deep, '#F6E9EA': tint, '#F3D9DC': tint, '#E8DDDD': tint,
            '#D98A92': light, '#E07A84': light, '#272323': dark, '#272222': dark, '#C9C4C4': gray, '#F4F2F2': panel,
            '#E4E1E1': line, '#FFFFFF': card, '#5A5656': mid, '#8A8585': muted}
    text = dict(fill, **{'#FFFFFF': on_dark, '#272323': text_dark or dark, '#272222': text_dark or dark, '#C9C4C4': text_gray or gray})
    return {'fill': fill, 'text': text, 'bg': {'#FFFFFF': bg, '#272323': cover or dark, '#A12731': accent, '#A22731': accent}}

THEMES = {
    'navy': {'name': 'Navy', 'accent': '#2E6DA4',
             'vars': {'--char': '#1B2A3E', '--char-2': '#24364F', '--maroon': '#1F3A5F', '--maroon-deep': '#142740', '--red': '#3B82C4', '--red-deep': '#2E6DA4',
                      '--paper': '#F4F6F9', '--light': '#EEF1F5', '--title-red': '#1F3A5F', '--accent': '#2E6DA4', '--lime': '#3B82C4', '--line': '#D3DAE3', '--text-light': '#5B6675'},
             'div': {'--div-accent': '#8DB5DD'},
             'pp': _pp('#2E6DA4', '#1F3A5F', '#E3ECF6', '#8DB5DD', '#1B2A3E', '#C6CFDA', '#4F5B6B', '#7D8896', '#F1F4F8', '#DDE3EA')},
    'dark': {'name': 'Dark', 'accent': '#E0505A', 'dark': True,
             'vars': {'--char': '#141211', '--char-2': '#2B2726', '--maroon': '#2B2726', '--maroon-deep': '#141211', '--red': '#EC6670', '--red-deep': '#E0505A',
                      '--paper': '#262322', '--light': '#1E1C1B', '--white': '#262322', '--ink': '#F3F0EE', '--text': '#E6E1DE', '--text-light': '#B5ADA9', '--text-mute': '#8E8783',
                      '--line': '#3A3634', '--title-red': '#FFFFFF', '--accent': '#E0505A', '--lime': '#EC6670'},
             'div': {'--div-bg': '#141211', '--div-accent': '#E0505A'},
             'pp': _pp('#E0505A', '#B23A43', '#3D2427', '#A8474F', '#3A3533', '#57514F', '#C9C2BE', '#9A938F', '#2B2826', '#3A3634',
                       bg='#1E1C1B', card='#262322', on_dark='#FFFFFF', text_dark='#F3F0EE', text_gray='#B5ADA9', cover='#141211')},
    'minimal': {'name': 'Minimal', 'accent': '#C8102E',
                'vars': {'--char': '#111111', '--char-2': '#222222', '--maroon': '#111111', '--maroon-deep': '#000000', '--red': '#E0293F', '--red-deep': '#C8102E',
                         '--paper': '#F5F5F5', '--light': '#FFFFFF', '--title-red': '#111111', '--accent': '#C8102E', '--lime': '#E0293F', '--line': '#E6E6E6', '--text-light': '#555555'},
                'div': {'--div-bg': '#FFFFFF', '--div-fg': '#111111', '--div-accent': '#C8102E'},
                'pp': _pp('#C8102E', '#8E0B21', '#FBE7EA', '#E8808F', '#111111', '#D6D6D6', '#555555', '#888888', '#F5F5F5', '#E6E6E6')},
    'forest': {'name': 'Forest', 'accent': '#2F7A55',
               'vars': {'--char': '#16211C', '--char-2': '#1E2C25', '--maroon': '#1E4D3A', '--maroon-deep': '#133326', '--red': '#3C9A6B', '--red-deep': '#2F7A55',
                        '--paper': '#F5F8F6', '--light': '#EEF2EF', '--title-red': '#1E4D3A', '--accent': '#2F7A55', '--lime': '#3C9A6B', '--line': '#D2DCD5', '--text-light': '#56645C'},
               'div': {'--div-accent': '#9FD4B8'},
               'pp': _pp('#2F7A55', '#1E4D3A', '#E2F0E8', '#8CC3A6', '#1C2B24', '#C5CEC8', '#4F5C55', '#7E8A83', '#F1F5F2', '#DCE4DF')},
    'teal': {'name': 'Teal', 'accent': '#13838F',
             'vars': {'--char': '#102227', '--char-2': '#173038', '--maroon': '#0F4C5C', '--maroon-deep': '#0A3540', '--red': '#1FA2AE', '--red-deep': '#13838F',
                      '--paper': '#F4F8F9', '--light': '#EDF3F4', '--title-red': '#0F4C5C', '--accent': '#13838F', '--lime': '#1FA2AE', '--line': '#CFDDE0', '--text-light': '#4C5E62'},
             'div': {'--div-accent': '#8FD6DC'},
             'pp': _pp('#13838F', '#0F4C5C', '#DDF0F2', '#7CC3CA', '#12262B', '#C3D0D2', '#4C5E62', '#7B8B8E', '#EFF5F6', '#D8E3E5')},
    'plum': {'name': 'Plum', 'accent': '#7B3F72',
             'vars': {'--char': '#221520', '--char-2': '#2E1D2B', '--maroon': '#4A2545', '--maroon-deep': '#32182F', '--red': '#9C5292', '--red-deep': '#7B3F72',
                      '--paper': '#F8F5F7', '--light': '#F3EFF2', '--title-red': '#4A2545', '--accent': '#7B3F72', '--lime': '#9C5292', '--line': '#DDD2DA', '--text-light': '#5E5260'},
             'div': {'--div-accent': '#E2B8DA'},
             'pp': _pp('#7B3F72', '#4A2545', '#F1E6EF', '#C08DB8', '#2A1C28', '#CFC6CD', '#5E5260', '#8C808A', '#F6F2F5', '#E4DCE2')},
}
SERIF = "Georgia, 'Times New Roman', serif"


def theme_key(style):
    s = (style or '').strip().lower()
    return next((k for k, t in THEMES.items() if s in (k, t['name'].lower())), None)


def theme_css(key, serif=False):
    t = THEMES.get(key)
    css = ['.ctrls .cbtn.orig { display: none; }   /* the PowerPoint picture behind a converted slide: not useful in a new deck */']
    if not t and not serif:
        return '<style id="deck-theme">\n' + css[0] + '\n</style>'
    css += [f'/* Deck theme: {t["name"] if t else "engine colors"}{", serif titles" if serif else ""}. Change these to restyle the whole deck. */']
    if t:
        css.append(':root { ' + ' '.join(f'{k}: {v};' for k, v in t['vars'].items()) + ' }')
        css.append('.slide.l-section { ' + ' '.join(f'{k}: {v};' for k, v in t.get('div', {}).items()) + ' }')
        # a few layouts use fixed colors; bring them onto the theme
        css.append(f'.slide .step.accent, .slide .flow-body .step.accent {{ background: var(--maroon) !important; border-color: var(--maroon) !important; }}')
        css.append('.slide table th { background: var(--maroon) !important; }')
        css.append('.slide.maroon, .slide.l-reflect:not(.dark), .slide.l-breakout { background: var(--maroon) !important; }')
        if t.get('dark'):
            css.append('.slide { background: var(--light); color: var(--text); }')
            css.append('.slide .person, .slide .card, .slide .step:not(.accent), .slide table td, .slide table tr { background: #262322 !important; color: var(--text) !important; }')
            css.append('.slide .logo { filter: brightness(0) invert(1); opacity: .8; }')
    if serif:
        css.append(f'.slide .h-title, .slide h1, .slide h2 {{ font-family: {SERIF}; font-weight: 700; letter-spacing: 0; }}')
    return '<style id="deck-theme">\n' + '\n'.join(css) + '\n</style>'


def theme_js(key, serif=False):
    t = THEMES.get(key)
    return 'const DECK_THEME = ' + json.dumps({'pp': t['pp'] if t else None, 'serif': SERIF if serif else None}) + ';'


def recolor_images(folder, key):
    """Converted chart pictures (img/ct-*): the source reds move to the theme's accent (Dark keeps its light panels)."""
    t = THEMES.get(key)
    if not t:
        return 0
    try:
        import numpy as np
        from PIL import Image
    except ImportError:
        return 0
    acc = np.array([int(t['accent'][i:i + 2], 16) for i in (1, 3, 5)], dtype=float)
    n = 0
    for f in sorted((folder / 'img').glob('ct-*')):
        if f.suffix.lower() not in ('.jpg', '.jpeg', '.png'):
            continue
        im = Image.open(f); mode = im.mode
        a = np.asarray(im.convert('RGBA'), dtype=float)
        rgb = a[..., :3] / 255
        mx, mn = rgb.max(-1), rgb.min(-1)
        sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
        r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        red = (r >= g) & (r >= b) & (r - np.maximum(g, b) > .03) & (np.abs(g - b) < .12)   # the source reds and their pink tints
        if not red.any():
            continue
        amt = np.clip(sat / .76, 0, 1)[..., None]          # how much accent is in the pixel (#A22731 is full)
        shade = np.clip(mx / .64, 0, 1.3)[..., None]       # darker reds stay darker
        target = (1 - amt) * 255 + amt * np.clip(acc * shade, 0, 255)
        a[..., :3] = np.where(red[..., None], target, a[..., :3])
        out = Image.fromarray(a.astype('uint8'), 'RGBA')
        out = out.convert('RGB') if mode != 'RGBA' else out
        out.save(f, quality=88) if f.suffix.lower() in ('.jpg', '.jpeg') else out.save(f)
        n += 1
    return n


# ---------- templates ----------

def list_templates():
    out = []
    for d in sorted(TEMPLATES.iterdir()) if TEMPLATES.exists() else []:
        m = d / 'template.json'
        if d.name.startswith('_') or not m.exists():
            continue
        t = json.loads(m.read_text(encoding='utf-8'))
        t['id'] = d.name
        out.append(t)
    return sorted(out, key=lambda t: t.get('order', 99))


def template(tid):
    for t in list_templates():
        if t['id'] == tid:
            return t
    raise ValueError(f'no template {tid!r}')


def pieces_js(pieces, template_pitches):
    """Versions for the pieces picked in the New deck form (the first is the main deck), then the template's own extra versions.
    A piece other than the main one starts as one placeholder slide (only:true, in:[piece]) until Claude builds it;
    a facilitator pack is the engine's facilitator version (the agenda plus fac:true slides)."""
    main, rest = pieces[0], pieces[1:]
    js = ['const TEMPLATE_PITCHES = (() => {', template_pitches, '  return PITCHES;', '})();',
          "const pieceOnly = (k) => Object.keys(LIBRARY).filter((id) => (LIBRARY[id].in || []).includes(k));"]
    for pc in rest:
        if pc['id'] == 'facilitator':
            continue
        title = f"{pc['name']}: {pc.get('desc', '').rstrip('.')}" if pc.get('desc') else pc['name']
        js.append(f"LIBRARY[{json.dumps(pc['id'] + '-start')}] = {{ cat: CATS[CATS.length - 1], layout: 'plain', only: true, in: [{json.dumps(pc['id'])}], "
                  f"title: {json.dumps(title)}, body: ['Claude builds this version from the main deck and the brief.', 'Pick it from the version menu at the top to see it.'], "
                  f"notes: 'Placeholder: Claude replaces this slide when it builds this version.' }};")
    v = [f"  {json.dumps(main['id'])}: {{ name: {json.dumps(main['name'])}, default: true, blocks: (Object.values(TEMPLATE_PITCHES).find((x) => x.default) || {{}}).blocks || CATS.flatMap(byCat) }},"]
    for pc in rest:
        blocks = 'facPack()' if pc['id'] == 'facilitator' else f"pieceOnly({json.dumps(pc['id'])})"
        v.append(f"  {json.dumps(pc['id'])}: {{ name: {json.dumps(pc['name'])}, blocks: {blocks} }},")
    ids = json.dumps([pc['id'] for pc in pieces])
    js += ['const PITCHES = Object.assign({', *v, '}, Object.fromEntries(Object.entries(TEMPLATE_PITCHES).filter(([k, x]) => !x.default && k !== \'facilitator\' && !' + ids + '.includes(k))));']
    return '\n'.join(js)


def assemble(tid, name, prefix, pieces=None, theme=None, serif=False, logo=None):
    """A template's deck file, ready to open."""
    t = template(tid)
    d = TEMPLATES / tid
    engine = ENGINE.read_text(encoding='utf-8')
    content = (d / 'content.js').read_text(encoding='utf-8').replace('{{NAME_JS}}', json.dumps(name)[1:-1])
    pitches = (d / 'pitches.js').read_text(encoding='utf-8')
    if pieces:
        pitches = pieces_js(pieces, pitches)
    scripts = '\n'.join(f'<script src="{html.escape(s)}"></script>' for s in t.get('scripts', []))
    basics = TEMPLATES / '_engine' / 'basics.js'
    if t.get('basics', True) and basics.exists():   # the basic guided layouts behind Add a slide
        content += '\n' + basics.read_text(encoding='utf-8')
    head = [theme_js(theme, serif)]
    if logo:
        head.append(f'const LOGO = {json.dumps(logo)}, LOGO_ALT = {json.dumps(name)};')
    content = '\n'.join(head) + '\n' + content
    out = (engine.replace('/*{{CONTENT}}*/', content).replace('/*{{PITCHES}}*/', pitches).replace('<!--{{THEME}}-->', theme_css(theme, serif))
           .replace('<!--{{SCRIPTS}}-->', scripts)
           .replace('{{TITLE}}', html.escape(name)).replace('{{BRAND}}', html.escape(name))
           .replace('{{SUB}}', html.escape(t.get('sub', t['name']))).replace('{{PREFIX}}', prefix))
    assert '{{' not in out.replace('{{ ', ''), 'unfilled placeholder'
    return out


# ---------- new decks ----------

def slugify(name):
    s = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    return s[:48].strip('-') or 'deck'


def new_prefix(name, taken):
    words = [w for w in re.findall(r'[a-z0-9]+', name.lower()) if w not in ('the', 'a', 'an', 'of', 'for', 'and', 'to', 'in')] or ['deck']
    base = ''.join(w[0] for w in words)[:3]
    base = (base + ''.join(words))[:3] if len(base) < 3 else base
    cand, n = base, 2
    while any(p.startswith(cand + '_') or (cand + '_').startswith(p) for p in taken):
        cand, n = f'{base}{n}', n + 1
    return cand + '_'


BRIEF_FIELDS = (('audience', 'Who it is for'), ('audienceType', 'Kind of audience'), ('knows', 'What they know and care about'),
                ('use', 'How it will be used'), ('length', 'Length'), ('point', 'The one point'), ('structure', 'Structure'),
                ('density', 'Density'), ('style', 'Style'), ('titles', 'Title font'), ('notes', 'Notes and source material'))


def prompt_for(deck, brief, tmpl, pieces=None):
    bits = [f'New slide builder deck “{deck["name"]}” from the {tmpl["name"]} template']
    if brief.get('length'):
        bits[0] += f', {brief["length"]}'
    if brief.get('audience'):
        bits[0] += f', for {brief["audience"]}'
    lines = [bits[0] + '.', f'It is set up at {deck["url"]} ({deck["folder"]}, slug {deck["slug"]}).']
    if brief.get('point'):
        lines.append(f'The one point: {brief["point"]}')
    shape = [brief.get('use'), brief.get('audienceType') and 'for ' + brief['audienceType'].lower(),
             brief.get('structure') and 'structure: ' + brief['structure'].lower(), brief.get('density') and brief['density'].lower() + ' density',
             brief.get('style') and 'style: ' + brief['style']]
    shape = '; '.join(s for s in shape if s)
    if shape:
        lines.append(f'Brief: {shape}.')
    if pieces and len(pieces) > 1:
        lines.append('Build these together, each as a version in the deck: ' + ', '.join(pc['name'] + (' (the main one, first)' if i == 0 else '') for i, pc in enumerate(pieces)) + '.')
    lines.append('Read BRIEF.md and shape the template to it (structure, density, style, and the slides themselves), then build a first draft. '
                 'Titles are plain sentences, two lines max, everything passes Checks › Guides, and mark any wording you drafted for me in the notes.')
    return ' '.join(lines)


def create_deck(name, tid, brief=None, pieces=None, logo=None, registry_path=None):
    name = (name or '').strip()
    if not name:
        raise ValueError('Enter a name for the deck.')
    brief = {k: str(v).strip() for k, v in (brief or {}).items() if v and str(v).strip()}
    pieces = [{'id': re.sub(r'[^a-z0-9-]', '', str(pc.get('id', '')).lower()) or f'piece{i}', 'name': str(pc.get('name', '')).strip() or 'Version',
               'desc': str(pc.get('desc', '')).strip()} for i, pc in enumerate(pieces or []) if isinstance(pc, dict)]
    tmpl = template(tid)
    registry_path = Path(registry_path or sbconfig.REGISTRY)
    reg = json.loads(registry_path.read_text(encoding='utf-8')) if registry_path.exists() else {'decks': []}
    slug = slugify(name)
    if any(d['slug'] == slug or d['name'].strip().lower() == name.lower() for d in reg['decks']):
        raise ValueError(f'There is already a deck called “{name}”. Try another name.')
    folder = registry_path.parent / slug
    if folder.exists():
        raise ValueError(f'{folder} already exists. Try another name.')
    prefix = new_prefix(name, [p for d in reg['decks'] for p in d.get('prefixes', [])])
    entry = tmpl.get('entry', 'deck.html')

    src = TEMPLATES / tid
    folder.mkdir(parents=True)
    for p in src.iterdir():
        if p.name in ('template.json', 'content.js', 'pitches.js', 'README.md') or p.name.startswith('.'):
            continue
        (shutil.copytree if p.is_dir() else shutil.copy2)(p, folder / p.name)
    theme = theme_key(brief.get('style'))
    serif = 'serif' in brief.get('titles', '').lower() and 'sans' not in brief.get('titles', '').lower()
    logo_path = None
    if logo and logo.get('data'):   # the deck's own logo, from the form (a data URL)
        import base64
        m = re.match(r'data:image/(png|jpeg|jpg|svg\+xml|webp);base64,(.*)$', logo['data'], re.S)
        if not m:
            raise ValueError('The logo has to be a PNG, JPG, SVG, or WebP file.')
        raw = base64.b64decode(m.group(2))
        if len(raw) > 3_000_000:
            raise ValueError('That logo file is over 3 MB. Try a smaller one.')
        ext = {'jpeg': 'jpg', 'svg+xml': 'svg'}.get(m.group(1), m.group(1))
        (folder / 'img').mkdir(exist_ok=True)
        (folder / 'img' / f'logo.{ext}').write_bytes(raw)
        logo_path = f'img/logo.{ext}'
    if theme:
        recolor_images(folder, theme)
    (folder / entry).write_text(assemble(tid, name, prefix, pieces, theme, serif, logo_path), encoding='utf-8')
    (folder / '.gitignore').write_text(GITIGNORE, encoding='utf-8')

    deck = {'slug': slug, 'name': name, 'group': 'active', 'kind': tmpl.get('kind', 'workshop'),
            'folder': sbconfig.tilde(folder), 'entry': entry,
            'prefixes': [prefix], 'exportName': name, 'template': tid}
    if pieces:
        deck['pieces'] = [{'id': pc['id'], 'name': pc['name']} for pc in pieces]
    deck['url'] = f'http://localhost:{sbconfig.PORT}/d/{slug}/{entry}'
    md = [f'# {name}', '', f'Started {__import__("time").strftime("%B %-d, %Y")} from the {tmpl["name"]} template.', '']
    if pieces:
        md += ['## What to build', '', *[f'- **{pc["name"]}**' + (f': {pc["desc"]}' if pc.get('desc') else '') + (' (the main deck)' if i == 0 else '') for i, pc in enumerate(pieces)], '']
    for k, label in BRIEF_FIELDS:
        if brief.get(k):
            md += [f'## {label}', '', brief[k], '']
    (folder / 'BRIEF.md').write_text('\n'.join(md), encoding='utf-8')

    deck['prompt'] = prompt_for(deck, brief, tmpl, pieces)
    reg['decks'].insert(0, {k: v for k, v in deck.items() if k != 'url'})
    tmp = registry_path.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(reg, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    os.replace(tmp, registry_path)

    try:   # version history for the deck; skipped without git
        git = lambda *a: subprocess.run(['git', *a], cwd=folder, capture_output=True, text=True)
        git('init', '-q')
        git('add', '-A')
        git('commit', '-q', '-m', f'New deck from the {tmpl["name"]} template')
    except OSError:
        pass
    return deck


def create_demo(registry_path=None):
    """The deck a fresh install starts with: the talk template, with a brief about trying the Slide Builder."""
    return create_deck('Demo talk', 'talk', {
        'audience': 'people trying the Slide Builder for the first time',
        'point': 'Comment on a slide, ask your agent, and read its reply under the slide.',
        'length': '20 min',
        'style': 'Navy',
        'notes': 'A practice deck. Leave a comment under any slide, then click Ask Claude and paste the prompt into Claude Code or Codex.',
    }, registry_path=registry_path)


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'templates':
        for t in list_templates():
            print(f'{t["id"]:14} {t["name"]}: {t.get("description", "")}')
    elif cmd == 'build':
        sys.stdout.write(assemble(sys.argv[2], 'Test deck', 'tst_'))
    else:
        print(__doc__)
