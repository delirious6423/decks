#!/usr/bin/env python3
"""Convert a PPTX into editable native slides for a Decks deck.

    python3 tools/pptx2native.py "<deck.pptx>" "<render-dir>" "<prefix>" --pdf deck.pdf --var CT > ct-slides.js

Needs python-pptx, lxml, Pillow, and (for --pdf) PyMuPDF:
    pip install python-pptx lxml Pillow PyMuPDF

For every slide it emits a JSON description of the shapes -- text boxes with
their runs (size, bold, italic, colour), filled rectangles, pictures, tables --
positioned on the 1000 x 562.5 canvas the builder uses, drawn by the engine's
`pptx` layout. Anything it cannot rebuild (charts, SmartArt, icons) is cropped
out of the rendered JPEG of that slide and placed as a picture, so the slide
still looks right and every word on it is editable.

Colours are resolved through the theme (scheme colours, lumMod/lumOff), and
text properties through the usual PowerPoint inheritance chain: run -> shape
list style -> layout placeholder -> master placeholder -> master text styles.

Options:

    --pdf deck.pdf        render the slides from PowerPoint's PDF export itself
                          (PyMuPDF): <prefix>-NNN.jpg pictures into render_dir
                          (--picture-width, --quality) and sharper renders in a
                          temporary folder to crop from (--crop-width)
    --slides 4-13,15      only these slides (rendering too)
    --var CT              the JS constant's name (default CT)
    --key sp --append     keys sp1, sp2, ... added to an existing constant with
                          Object.assign, so two decks can share one file
    --jpeg-crops          a crop on a solid background with nothing native beneath
                          it is laid onto the background and saved as a JPEG
    --keep-text           text inside a chart stays native instead of baked in
    --inpaint             baked words are painted over with the colour beneath them
                          (not cut out as see-through holes)
    --dashed-outlines     a dashed box or circle outline is drawn as a dashed path
    --fonts               text keeps its typeface (Georgia, Calibri, the theme's fonts),
                          with the deck's own font where the machine lacks it

Always on: lines drawn as shapes (prst="line", as pptxgenjs writes them) become
native lines; chevrons, pentagons (homePlate) and diamonds are drawn as polygons;
vertical text (vert270) and side-turned text boxes keep their turn; a table's
height comes from its rows, not the frame (pptxgenjs writes a nominal one-inch
frame); a box's outline colour is keyed out of a crop only near the outline; a
box's word colours only where its words are. What the slide layout and master draw
on every slide (a logo, a band of colour) comes in under the slide's own shapes, and
a gradient fill is drawn as a gradient, transparency and all. A deck of any size (Google Slides
exports 10in slides) is scaled onto the canvas, and one of another shape (4:3) is
centred on it. A picture or gradient slide background becomes one picture under
the native shapes, with the picture's crop and brightness and contrast corrections.

tools/importdeck.py drives this for Import a deck: it also renders the PDF when
hidden slides are left out of it, and writes each slide's title and notes.

templates/consulting was made with it: each slide is ct(key, ...) in content.js,
and its shapes are CT[key] in ct-slides.js.
"""

import colorsys
import hashlib
import io
import json
import os
import re
import sys
import zipfile

from lxml import etree
from PIL import Image
from pptx import Presentation
from pptx.util import Emu

NS = {
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
}
A = '{%s}' % NS['a']
P = '{%s}' % NS['p']

SLIDE_W_PX = 1000.0
EMU_PER_PX = 12192000 / SLIDE_W_PX          # 13.333in deck -> 1000px canvas
PT_TO_PX = SLIDE_W_PX / 960.0                # 960pt wide -> 1000px
# A deck of another size (Google Slides' 10in, Keynote's, an old 4:3 one) is scaled onto the
# 13.333 x 7.5in canvas; a deck of another shape is centred on it. Converter() sets these.
SCALE = 1.0                                  # deck EMU -> canvas EMU, for positions, text, and lines
OFFSET = (0.0, 0.0)                          # canvas EMU left of and above a deck of another shape


def fit_slide(width, height):
    """(scale, (dx, dy)) that fits a width x height EMU slide onto the 16:9 canvas."""
    width, height = width or 12192000, height or 6858000
    s = min(12192000 / width, 6858000 / height)
    return s, ((12192000 - width * s) / 2, (6858000 - height * s) / 2)


def emu_px(v):
    return round(v / EMU_PER_PX, 2)


# --------------------------------------------------------------------------
# theme colours
# --------------------------------------------------------------------------
def load_theme(master):
    """Scheme name -> hex from this master's theme, plus its clrMap and fill styles."""
    theme_part = None
    for rel in master.part.rels.values():
        if 'theme' in rel.reltype:
            theme_part = rel.target_part
            break
    scheme = {}
    if theme_part is not None:
        root = etree.fromstring(theme_part.blob)
        cs = root.find('.//a:clrScheme', NS)
        if cs is not None:
            for child in cs:
                name = etree.QName(child).localname
                srgb = child.find('a:srgbClr', NS)
                sysc = child.find('a:sysClr', NS)
                if srgb is not None:
                    scheme[name] = srgb.get('val')
                elif sysc is not None:
                    scheme[name] = sysc.get('lastClr', '000000')
    cmap = {}
    cm = master._element.find('p:clrMap', NS)
    if cm is not None:
        cmap = dict(cm.attrib)
    fills = []
    if theme_part is not None:
        fl = root.find('.//a:fmtScheme/a:fillStyleLst', NS)
        if fl is not None:
            fills = list(fl)
    return scheme, cmap, fills


def apply_lum(hexv, mod=None, off=None):
    r, g, b = (int(hexv[i:i + 2], 16) / 255 for i in (0, 2, 4))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    if mod is not None:
        l = l * mod
    if off is not None:
        l = l + off
    l = max(0.0, min(1.0, l))
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    return '%02X%02X%02X' % (round(r * 255), round(g * 255), round(b * 255))


class Colors:
    def __init__(self, scheme, cmap):
        self.scheme, self.cmap = scheme, cmap

    def resolve(self, clr_el):
        """clr_el is a:srgbClr / a:schemeClr / a:prstClr ... -> hex or None."""
        if clr_el is None:
            return None
        tag = etree.QName(clr_el).localname
        hexv = None
        if tag == 'srgbClr':
            hexv = clr_el.get('val')
        elif tag == 'schemeClr':
            name = clr_el.get('val')
            name = self.cmap.get(name, name)      # bg1 -> lt1 etc.
            hexv = self.scheme.get(name)
        elif tag == 'sysClr':
            hexv = clr_el.get('lastClr', '000000')
        elif tag == 'prstClr':
            hexv = {'black': '000000', 'white': 'FFFFFF'}.get(clr_el.get('val'))
        if not hexv:
            return None
        mod = clr_el.find('a:lumMod', NS)
        off = clr_el.find('a:lumOff', NS)
        if mod is not None or off is not None:
            hexv = apply_lum(hexv,
                             int(mod.get('val')) / 100000 if mod is not None else None,
                             int(off.get('val')) / 100000 if off is not None else None)
        tint = clr_el.find('a:tint', NS)
        shade = clr_el.find('a:shade', NS)
        if tint is not None or shade is not None:
            r, g, b = (int(hexv[i:i + 2], 16) for i in (0, 2, 4))
            if tint is not None:
                t = int(tint.get('val')) / 100000
                r, g, b = (round(255 - (255 - v) * t) for v in (r, g, b))
            if shade is not None:
                t = int(shade.get('val')) / 100000
                r, g, b = (round(v * t) for v in (r, g, b))
            hexv = '%02X%02X%02X' % (r, g, b)
        return '#' + hexv

    def resolve_ph(self, clr_el, ph_hex):
        """Like resolve(), but a:schemeClr val="phClr" takes the given colour."""
        if clr_el is None:
            return None
        if etree.QName(clr_el).localname == 'schemeClr' and clr_el.get('val') == 'phClr':
            import copy
            tmp = copy.deepcopy(clr_el)
            tmp.tag = A + 'srgbClr'
            tmp.set('val', ph_hex.lstrip('#'))
            return self.resolve(tmp)
        return self.resolve(clr_el)

    def solid_fill(self, parent):
        """First direct a:solidFill child of parent -> hex or None; 'none' for noFill."""
        if parent is None:
            return None
        if parent.find('a:noFill', NS) is not None:
            return 'none'
        sf = parent.find('a:solidFill', NS)
        if sf is None:
            return None
        for child in sf:
            c = self.resolve(child)
            if c:
                return c
        return None


# --------------------------------------------------------------------------
# text style inheritance
# --------------------------------------------------------------------------
def lvl_props(lst_style, level):
    """a:lvlNpPr element for level (0-based) inside an a:lstStyle-like element."""
    if lst_style is None:
        return None
    return lst_style.find('a:lvl%dpPr' % (level + 1), NS)


def ph_info(sp):
    ph = sp.find('.//p:nvPr/p:ph', NS)
    if ph is None:
        return None
    return {'type': ph.get('type', 'body'), 'idx': ph.get('idx')}


def find_layout_ph(layout_or_master_el, ph):
    """Match a placeholder on a layout/master by idx, then by type."""
    if ph is None or layout_or_master_el is None:
        return None
    cands = layout_or_master_el.findall('.//p:sp', NS)
    if ph.get('idx') is not None:
        for sp in cands:
            p = sp.find('.//p:nvPr/p:ph', NS)
            if p is not None and p.get('idx') == ph['idx']:
                return sp
    for sp in cands:
        p = sp.find('.//p:nvPr/p:ph', NS)
        if p is not None and p.get('type', 'body') == ph['type']:
            return sp
    return None


class TextResolver:
    def __init__(self, colors, master_el, layout_el):
        self.colors = colors
        self.master_el, self.layout_el = master_el, layout_el
        tx = master_el.find('p:txStyles', NS)
        self.title_style = tx.find('p:titleStyle', NS) if tx is not None else None
        self.body_style = tx.find('p:bodyStyle', NS) if tx is not None else None
        self.other_style = tx.find('p:otherStyle', NS) if tx is not None else None

    def chain(self, sp, level):
        """Ordered list of lvlNpPr elements to consult for this shape/level."""
        out = []
        ls = sp.find('.//p:txBody/a:lstStyle', NS)
        if ls is not None:
            out.append(lvl_props(ls, level))
        ph = ph_info(sp)
        if ph is not None:
            for host in (self.layout_el, self.master_el):
                hsp = find_layout_ph(host, ph)
                if hsp is not None:
                    hls = hsp.find('.//p:txBody/a:lstStyle', NS)
                    out.append(lvl_props(hls, level))
            t = ph['type']
            if t in ('title', 'ctrTitle'):
                out.append(lvl_props(self.title_style, level))
            elif t in ('body', 'subTitle', 'obj', 'dt', 'ftr', 'sldNum', 'pic', 'tbl', 'chart'):
                out.append(lvl_props(self.body_style, level))
            else:
                out.append(lvl_props(self.other_style, level))
        else:
            out.append(lvl_props(self.other_style, level))
        return [x for x in out if x is not None]

    def run_props(self, sp, p_el, r_el, level, is_ph):
        """size(pt), bold, italic, underline, colour for a run."""
        props = {'size': None, 'b': None, 'i': None, 'u': None, 'color': None, 'font': None}

        def take(rpr):
            if rpr is None:
                return
            if props['size'] is None and rpr.get('sz'):
                props['size'] = int(rpr.get('sz')) / 100
            if props['b'] is None and rpr.get('b') is not None:
                props['b'] = rpr.get('b') == '1'
            if props['i'] is None and rpr.get('i') is not None:
                props['i'] = rpr.get('i') == '1'
            if props['u'] is None and rpr.get('u') is not None:
                props['u'] = rpr.get('u') != 'none'
            if props['color'] is None:
                c = self.colors.solid_fill(rpr)
                if c and c != 'none':
                    props['color'] = c
            if props['font'] is None:
                lt = rpr.find('a:latin', NS)
                if lt is not None and lt.get('typeface'):
                    props['font'] = lt.get('typeface')

        take(r_el.find('a:rPr', NS) if r_el is not None else None)
        # paragraph-level default
        ppr = p_el.find('a:pPr', NS) if p_el is not None else None
        if ppr is not None:
            take(ppr.find('a:defRPr', NS))
        for lvl in self.chain(sp, level):
            take(lvl.find('a:defRPr', NS))
        if props['size'] is None:
            props['size'] = 18.0
        props['size'] *= SCALE
        if props['b'] is None:
            props['b'] = False
        if props['i'] is None:
            props['i'] = False
        return props

    def para_props(self, sp, p_el, level):
        """alignment, bullet, spacing for a paragraph."""
        out = {'align': None, 'bullet': None, 'lnSpc': None, 'spcBef': None, 'spcAft': None, 'indent': None, 'marL': None, 'buFont': None, 'buColor': None}

        def take(ppr):
            if ppr is None:
                return
            if out['align'] is None and ppr.get('algn'):
                out['align'] = ppr.get('algn')
            if out['bullet'] is None:
                if ppr.find('a:buNone', NS) is not None:
                    out['bullet'] = ''
                else:
                    bc = ppr.find('a:buChar', NS)
                    ba = ppr.find('a:buAutoNum', NS)
                    if bc is not None:
                        out['bullet'] = bc.get('char', '•')
                        bf = ppr.find('a:buFont', NS)
                        if bf is not None and bf.get('typeface'):
                            out['buFont'] = bf.get('typeface')
                        bcl = ppr.find('a:buClr', NS)
                        if bcl is not None and len(bcl):
                            out['buColor'] = self.colors.resolve(bcl[0])
                    elif ba is not None:
                        out['bullet'] = 'num'
            if out['lnSpc'] is None:
                ls = ppr.find('a:lnSpc/a:spcPct', NS)
                if ls is not None:
                    out['lnSpc'] = int(ls.get('val')) / 100000
            if out['spcBef'] is None:
                sb = ppr.find('a:spcBef/a:spcPts', NS)
                if sb is not None:
                    out['spcBef'] = int(sb.get('val')) / 100 * SCALE
            if out['spcAft'] is None:
                sa = ppr.find('a:spcAft/a:spcPts', NS)
                if sa is not None:
                    out['spcAft'] = int(sa.get('val')) / 100 * SCALE
            if out['marL'] is None and ppr.get('marL'):
                out['marL'] = round(int(ppr.get('marL')) * SCALE)
            if out['indent'] is None and ppr.get('indent'):
                out['indent'] = round(int(ppr.get('indent')) * SCALE)

        take(p_el.find('a:pPr', NS) if p_el is not None else None)
        for lvl in self.chain(sp, level):
            take(lvl)
        return out


# --------------------------------------------------------------------------
# geometry
# --------------------------------------------------------------------------
def xfrm_of(el):
    """(x, y, w, h, rot) in EMU from the element's a:xfrm (spPr or grpSpPr)."""
    xf = el.find('.//a:xfrm', NS)
    if xf is None:
        return None
    off = xf.find('a:off', NS)
    ext = xf.find('a:ext', NS)
    if off is None or ext is None:
        return None
    rot = int(xf.get('rot', '0')) / 60000
    return [int(off.get('x')), int(off.get('y')), int(ext.get('cx')), int(ext.get('cy')), rot,
            xf.get('flipH') == '1', xf.get('flipV') == '1']


def ph_xfrm(sp, layout_el, master_el):
    """Placeholders inherit position from the layout/master when they have none."""
    ph = ph_info(sp)
    for host in (layout_el, master_el):
        hsp = find_layout_ph(host, ph)
        if hsp is not None:
            xf = xfrm_of(hsp.find('p:spPr', NS))
            if xf:
                return xf
    return None


class Transform:
    """Maps child coordinates through nested group transforms."""

    def __init__(self, sx=1.0, sy=1.0, dx=0.0, dy=0.0):
        self.sx, self.sy, self.dx, self.dy = sx, sy, dx, dy

    def apply(self, x, y, w, h):
        return (self.dx + x * self.sx, self.dy + y * self.sy, w * self.sx, h * self.sy)

    def child(self, grp_el):
        xf = grp_el.find('p:grpSpPr/a:xfrm', NS)
        if xf is None:
            return self
        off, ext = xf.find('a:off', NS), xf.find('a:ext', NS)
        choff, chext = xf.find('a:chOff', NS), xf.find('a:chExt', NS)
        if None in (off, ext, choff, chext):
            return self
        gx, gy = self.apply(int(off.get('x')), int(off.get('y')), 0, 0)[:2]
        gw, gh = int(ext.get('cx')) * self.sx, int(ext.get('cy')) * self.sy
        cx, cy = int(choff.get('x')), int(choff.get('y'))
        cw, ch = int(chext.get('cx')) or 1, int(chext.get('cy')) or 1
        sx, sy = gw / cw, gh / ch
        return Transform(sx, sy, gx - cx * sx, gy - cy * sy)


import math


def place(pts, w, h, rot, flip_h, flip_v):
    """Local shape coordinates -> unrotated-bbox coordinates: flips first, then the
    clockwise rotation about the centre, the way DrawingML draws them."""
    out = []
    a = math.radians(rot or 0)
    ca, sa = math.cos(a), math.sin(a)
    for (x, y) in pts:
        if flip_h:
            x = w - x
        if flip_v:
            y = h - y
        dx, dy = x - w / 2, y - h / 2
        out.append((w / 2 + dx * ca - dy * sa, h / 2 + dx * sa + dy * ca))
    return out


def connector_path(prst, w, h, adj):
    """Path points for a connector preset, as a list of (cmd, [(x, y), ...]) in local px."""
    a1 = adj.get('adj1', 50000) / 100000
    if prst in ('straightConnector1', 'line'):
        return [('M', [(0, 0)]), ('L', [(w, h)])]
    if prst == 'bentConnector2':
        return [('M', [(0, 0)]), ('L', [(w, 0)]), ('L', [(w, h)])]
    if prst == 'bentConnector3':
        x1 = w * a1
        return [('M', [(0, 0)]), ('L', [(x1, 0)]), ('L', [(x1, h)]), ('L', [(w, h)])]
    if prst == 'curvedConnector2':
        return [('M', [(0, 0)]), ('C', [(w, 0), (w, 0), (w, h)])]
    if prst == 'curvedConnector3':
        x2 = w * a1
        x1, x3 = x2 / 2, (w + x2) / 2
        return [('M', [(0, 0)]), ('C', [(x1, 0), (x2, h / 4), (x2, h / 2)]), ('C', [(x2, h * 3 / 4), (x3, h), (w, h)])]
    return None


def arrow_polygon(prst, w, h, adj):
    """Block-arrow presets as a polygon in local px."""
    ss = min(w, h)
    a1 = min(adj.get('adj1', 50000), 100000) / 100000
    a2 = adj.get('adj2', 50000) / 100000
    if prst == 'rightArrow':
        dx1 = min(ss * a2, w); x1 = w - dx1; dy1 = h * a1 / 2
        return [(0, h / 2 - dy1), (x1, h / 2 - dy1), (x1, 0), (w, h / 2), (x1, h), (x1, h / 2 + dy1), (0, h / 2 + dy1)]
    if prst == 'leftArrow':
        dx1 = min(ss * a2, w); x1 = dx1; dy1 = h * a1 / 2
        return [(w, h / 2 - dy1), (x1, h / 2 - dy1), (x1, 0), (0, h / 2), (x1, h), (x1, h / 2 + dy1), (w, h / 2 + dy1)]
    if prst == 'downArrow':
        dy1 = min(ss * a2, h); y1 = h - dy1; dx1 = w * a1 / 2
        return [(w / 2 - dx1, 0), (w / 2 + dx1, 0), (w / 2 + dx1, y1), (w, y1), (w / 2, h), (0, y1), (w / 2 - dx1, y1)]
    if prst == 'upArrow':
        dy1 = min(ss * a2, h); y1 = dy1; dx1 = w * a1 / 2
        return [(w / 2 - dx1, h), (w / 2 + dx1, h), (w / 2 + dx1, y1), (w, y1), (w / 2, 0), (0, y1), (w / 2 - dx1, y1)]
    if prst == 'upDownArrow':
        dy = min(ss * a2, h / 2); dx1 = w * a1 / 2
        return [(w / 2, 0), (w, dy), (w / 2 + dx1, dy), (w / 2 + dx1, h - dy), (w, h - dy), (w / 2, h), (0, h - dy), (w / 2 - dx1, h - dy), (w / 2 - dx1, dy), (0, dy)]
    a0 = adj.get('adj', adj.get('adj1', 50000)) / 100000
    if prst == 'homePlate':
        dx1 = min(ss * a0, w); x1 = w - dx1
        return [(0, 0), (x1, 0), (w, h / 2), (x1, h), (0, h)]
    if prst == 'chevron':
        x1 = min(ss * a0, w); x2 = w - x1
        return [(0, 0), (x2, 0), (w, h / 2), (x2, h), (0, h), (x1, h / 2)]
    if prst == 'diamond':
        return [(w / 2, 0), (w, h / 2), (w / 2, h), (0, h / 2)]
    if prst == 'leftRightArrow':
        dx = min(ss * a2, w / 2); dy1 = h * a1 / 2
        return [(0, h / 2), (dx, 0), (dx, h / 2 - dy1), (w - dx, h / 2 - dy1), (w - dx, 0), (w, h / 2), (w - dx, h), (w - dx, h / 2 + dy1), (dx, h / 2 + dy1), (dx, h)]
    return None


ARROW_PRSTS = ('rightArrow', 'leftArrow', 'downArrow', 'upArrow', 'upDownArrow', 'leftRightArrow', 'homePlate', 'chevron', 'diamond')
CONNECTOR_PRSTS = ('straightConnector1', 'line', 'bentConnector2', 'bentConnector3', 'curvedConnector2', 'curvedConnector3')


def head_shape(kind, tip, prev, lw):
    """An arrowhead at `tip`, pointing away from `prev`: ('fill'|'open', points)."""
    if not kind or kind == 'none':
        return None
    dx, dy = tip[0] - prev[0], tip[1] - prev[1]
    d = math.hypot(dx, dy) or 1
    ux, uy = dx / d, dy / d
    L = max(lw * 4.0, 11.0)
    W = max(lw * 3.6, 10.0)
    bx, by = tip[0] - ux * L, tip[1] - uy * L
    nx, ny = -uy * W / 2, ux * W / 2
    p1, p2 = (bx + nx, by + ny), (bx - nx, by - ny)
    if kind == 'arrow':
        return ('open', [p1, tip, p2])
    if kind == 'stealth':
        return ('fill', [p1, tip, p2, (tip[0] - ux * L * 0.6, tip[1] - uy * L * 0.6)])
    if kind == 'oval':
        return ('fill', [(tip[0] + math.cos(t) * W / 2, tip[1] + math.sin(t) * W / 2) for t in [i * math.pi / 6 for i in range(12)]])
    if kind == 'diamond':
        return ('fill', [(tip[0] - ux * L / 2 + nx, tip[1] - uy * L / 2 + ny), tip, (tip[0] - ux * L / 2 - nx, tip[1] - uy * L / 2 - ny), (tip[0] - ux * L, tip[1] - uy * L)])
    return ('fill', [p1, tip, p2])


# --------------------------------------------------------------------------
# the converter
# --------------------------------------------------------------------------
class Converter:
    def __init__(self, pptx_path, render_dir, prefix, img_dir, png_dir=None):
        self.png_dir = png_dir or render_dir
        self.prs = Presentation(pptx_path)
        self.zip = zipfile.ZipFile(pptx_path)
        global SCALE, OFFSET
        SCALE, OFFSET = fit_slide(self.prs.slide_width, self.prs.slide_height)
        d = self.prs.part._element.find('p:defaultTextStyle/a:lvl1pPr/a:defRPr', NS)
        self.default_size = int(d.get('sz')) / 100 if d is not None and d.get('sz') else 18.0   # text with no size set anywhere
        self.render_dir, self.prefix, self.img_dir = render_dir, prefix, img_dir
        self.themes = {}      # one theme per slide master: this deck has seven
        self.use_master(self.prs.slide_masters[0])
        self.blob_cache = {}
        self.stats = {'slides': 0, 'text': 0, 'pics': 0, 'crops': 0, 'tables': 0, 'skipped': 0}

    def use_master(self, master):
        key = str(master.part.partname)
        if key not in self.themes:
            self.themes[key] = load_theme(master)
        scheme, cmap, fills = self.themes[key]
        self.theme_fonts = {}
        for rel in master.part.rels.values():   # the theme's heading (+mj-lt) and body (+mn-lt) fonts
            if 'theme' in rel.reltype:
                fs = etree.fromstring(rel.target_part.blob).find('.//a:fontScheme', NS)
                for code, tag in (('+mj-lt', 'majorFont'), ('+mn-lt', 'minorFont')):
                    lt = fs.find(f'a:{tag}/a:latin', NS) if fs is not None else None
                    if lt is not None and lt.get('typeface'):
                        self.theme_fonts[code] = lt.get('typeface')
                break
        self.base_cmap = cmap
        self.colors = Colors(scheme, dict(cmap))
        self.theme_fills = fills

    # ---- images ----
    def save_blob(self, blob, ext):
        h = hashlib.sha1(blob).hexdigest()[:12]
        name = f'{self.prefix}-pic-{h}.{ext}'
        path = os.path.join(self.img_dir, name)
        if not os.path.exists(path):
            try:
                im = Image.open(io.BytesIO(blob))
                # keep files sane: cap at 1600px wide, convert exotic modes
                if im.width > 1600:
                    im = im.resize((1600, round(im.height * 1600 / im.width)), Image.LANCZOS)
                if ext.lower() in ('jpg', 'jpeg'):
                    im.convert('RGB').save(path, quality=88)
                else:
                    im.save(path, optimize=True)
            except Exception:
                open(path, 'wb').write(blob)
        return 'img/' + name

    def word_colours(self, node):
        """The colours a text box's words are drawn in (unset runs take the theme's text colour)."""
        dflt = self.colors.scheme.get(self.colors.cmap.get('tx1', 'dk1')) or '000000'
        out = []
        for para in node.get('text') or []:
            for r in para.get('runs') or []:
                if r['t'].strip():
                    c = r.get('c') or ('#' + dflt.lstrip('#'))
                    if c not in out:
                        out.append(c)
        return out

    def crop_from_render(self, n, x, y, w, h, mask=None, bg=None, key=None, strong=False, regions=None, keep=None, flatten=None, inpaint=None):
        """Cut a region (canvas px) out of the rendered slide JPEG. With `flatten` (a hex colour),
        a crop that came out transparent is laid back onto that colour and saved as a JPEG."""
        src = os.path.join(self.png_dir, f'{self.prefix}-{n:03d}.png')
        if not os.path.exists(src):
            src = os.path.join(self.render_dir, f'{self.prefix}-{n:03d}.jpg')
        if not os.path.exists(src):
            return None
        im = Image.open(src).convert('RGB')
        k = im.width / SLIDE_W_PX
        pad = 3
        box = (max(0, int((x - pad) * k)), max(0, int((y - pad) * k)),
               min(im.width, int((x + w + pad) * k)), min(im.height, int((y + h + pad) * k)))
        if box[2] - box[0] < 2 or box[3] - box[1] < 2:
            return None
        crop = im.crop(box)
        if inpaint:
            crop = crop.convert('RGB')
            px = crop.load()
            from collections import Counter

            def segd(pt, a, b):
                vx, vy, vz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
                L2 = vx * vx + vy * vy + vz * vz or 1
                tt = max(0.0, min(1.0, ((pt[0] - a[0]) * vx + (pt[1] - a[1]) * vy + (pt[2] - a[2]) * vz) / L2))
                return max(abs(pt[0] - a[0] - vx * tt), abs(pt[1] - a[1] - vy * tt), abs(pt[2] - a[2] - vz * tt))
            for (tx, ty, tw, th), cols in inpaint:
                x0, y0 = max(0, int((tx - 2) * k) - box[0]), max(0, int((ty - 2) * k) - box[1])
                x1, y1 = min(crop.width, int((tx + tw + 2) * k) - box[0]), min(crop.height, int((ty + th + 2) * k) - box[1])
                if x1 <= x0 or y1 <= y0 or not cols:
                    continue
                T = [tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) for c in cols]
                # what the words sit on: the commonest colour in the box that isn't theirs
                hist, sums = Counter(), {}
                for yy in range(y0, y1):
                    for xx in range(x0, x1):
                        r, g, b_ = px[xx, yy]
                        if min(max(abs(r - q[0]), abs(g - q[1]), abs(b_ - q[2])) for q in T) <= 60:
                            continue
                        qk = (r // 8, g // 8, b_ // 8)
                        hist[qk] += 1
                        s = sums.setdefault(qk, [0, 0, 0])
                        s[0] += r; s[1] += g; s[2] += b_
                if not hist:
                    continue
                qk, cnt = hist.most_common(1)[0]
                under = tuple(round(v / cnt) for v in sums[qk])
                for yy in range(y0, y1):
                    for xx in range(x0, x1):
                        r, g, b_ = px[xx, yy]
                        if min(segd((r, g, b_), q, under) for q in T) <= 30:
                            px[xx, yy] = under
        # cut out any native text boxes that fall inside the crop (transparent, so
        # the crop neither bakes the words in nor paints over them when it sits on top)
        masked = False
        if keep:
            # keep only pixels near one colour (a mark drawn over other shapes)
            crop = crop.convert('RGBA')
            kr, kg, kb = (int(keep[i:i + 2], 16) for i in (1, 3, 5))
            chroma_k = max(kr, kg, kb) - min(kr, kg, kb)
            px = crop.load()
            for yy in range(crop.height):
                for xx in range(crop.width):
                    r, g, b_, a_ = px[xx, yy]
                    dist = max(abs(r - kr), abs(g - kg), abs(b_ - kb))
                    if chroma_k > 40 and (max(r, g, b_) - min(r, g, b_)) < chroma_k * 0.45:
                        dist = 999
                    if dist <= 36:
                        px[xx, yy] = (kr, kg, kb, 255)
                    elif dist < 72:
                        px[xx, yy] = (kr, kg, kb, int(255 * (72 - dist) / 36))
                    else:
                        px[xx, yy] = (r, g, b_, 0)
            masked = True
            key = None
            regions = None
        if key:
            # everything within a whisker of the slide background becomes transparent
            crop = crop.convert('RGBA')
            kr, kg, kb = (int(key[i:i + 2], 16) for i in (1, 3, 5))
            px = crop.load()
            T1, T2 = (22, 70) if strong else (10, 34)   # small crops shed their drop shadows
            for yy in range(crop.height):
                for xx in range(crop.width):
                    r, g, b_, a_ = px[xx, yy]
                    dist = max(abs(r - kr), abs(g - kg), abs(b_ - kb))
                    if dist <= T1:
                        px[xx, yy] = (r, g, b_, 0)
                    elif dist < T2:
                        px[xx, yy] = (r, g, b_, int(255 * (dist - T1) / (T2 - T1)))
            masked = True
        if regions:
            # where the crop lies over a filled native box: key that box's colour out
            # (a box beneath the crop) or cut the box out (a box drawn above it), so
            # the crop neither paints over the box's words nor carries its ghost
            crop = crop.convert('RGBA')
            px = crop.load()
            for reg in regions:
                (rx, ry, rw, rh), rkey = reg[0], reg[1]
                edge = reg[2] if len(reg) > 2 else None
                x0, y0 = max(0, int(rx * k) - box[0]), max(0, int(ry * k) - box[1])
                x1, y1 = min(crop.width, int((rx + rw) * k) - box[0]), min(crop.height, int((ry + rh) * k) - box[1])
                if x1 <= x0 or y1 <= y0:
                    continue
                masked = True
                if rkey is None:
                    for yy in range(y0, y1):
                        for xx in range(x0, x1):
                            r, g, b_, a_ = px[xx, yy]
                            px[xx, yy] = (r, g, b_, 0)
                    continue
                keys = [tuple(int(kh[i:i + 2], 16) for i in (1, 3, 5)) for kh in rkey]
                # a pixel that lies between two of the box's colours is an anti-aliased
                # edge of its words or its outline, so it goes too
                pairs = [(keys[i], keys[j]) for i in range(len(keys)) for j in range(i + 1, len(keys))]
                if edge:
                    # the box's outline colour only goes near its outline: a mark inside the
                    # box drawn in that same colour (a red line in a red-edged card) stays
                    (ex, ey, ew, eh), ec, band = edge
                    ek = tuple(int(ec[i:i + 2], 16) for i in (1, 3, 5))
                    keys_e = keys + ([ek] if ek not in keys else [])
                    pairs_e = [(keys_e[i], keys_e[j]) for i in range(len(keys_e)) for j in range(i + 1, len(keys_e))]

                def seg_dist(pt, a, b):
                    ax, ay, az = a
                    vx, vy, vz = b[0] - ax, b[1] - ay, b[2] - az
                    L2 = vx * vx + vy * vy + vz * vz or 1
                    tt = max(0.0, min(1.0, ((pt[0] - ax) * vx + (pt[1] - ay) * vy + (pt[2] - az) * vz) / L2))
                    qx, qy, qz = ax + vx * tt, ay + vy * tt, az + vz * tt
                    return max(abs(pt[0] - qx), abs(pt[1] - qy), abs(pt[2] - qz))
                for yy in range(y0, y1):
                    for xx in range(x0, x1):
                        r, g, b_, a_ = px[xx, yy]
                        ks, ps = keys, pairs
                        if edge:
                            cx, cy = (xx + box[0]) / k, (yy + box[1]) / k
                            if min(abs(cx - ex), abs(cx - ex - ew), abs(cy - ey), abs(cy - ey - eh)) <= band:
                                ks, ps = keys_e, pairs_e
                        dist = min(max(abs(r - kr), abs(g - kg), abs(b_ - kb)) for kr, kg, kb in ks)
                        if dist > 12 and ps:
                            dist = min(dist, min(seg_dist((r, g, b_), a, b) for a, b in ps))
                        if dist <= 12:
                            px[xx, yy] = (r, g, b_, 0)
                        elif dist < 40:
                            px[xx, yy] = (r, g, b_, min(a_, int(255 * (dist - 12) / 28)))
        if mask:
            from PIL import ImageDraw
            crop = crop.convert('RGBA')
            dr = ImageDraw.Draw(crop)
            for (tx, ty, tw, th) in mask:
                bx = (int(tx * k) - box[0], int(ty * k) - box[1], int((tx + tw) * k) - box[0], int((ty + th) * k) - box[1])
                if bx[2] > 0 and bx[3] > 0 and bx[0] < crop.width and bx[1] < crop.height:
                    dr.rectangle(bx, fill=(0, 0, 0, 0))
                    masked = True
        if masked and flatten:
            # nothing native lies beneath this crop, so its see-through parts would only
            # ever show the slide background: paint that in and keep the file small
            fr, fg, fb = (int(flatten[i:i + 2], 16) for i in (1, 3, 5))
            flat = Image.new('RGB', crop.size, (fr, fg, fb))
            flat.paste(crop, mask=crop.convert('RGBA').split()[3])
            crop, masked = flat, False
        h12 = hashlib.sha1(crop.tobytes()).hexdigest()[:12]
        if masked:
            name = f'{self.prefix}-s{n:03d}-crop-{h12}.png'
            crop.save(os.path.join(self.img_dir, name), optimize=True)
        else:
            name = f'{self.prefix}-s{n:03d}-crop-{h12}.jpg'
            crop.convert('RGB').save(os.path.join(self.img_dir, name), quality=88)
        self.stats['crops'] += 1
        return {'src': 'img/' + name, 'x': round(box[0] / k, 2), 'y': round(box[1] / k, 2),
                'w': round((box[2] - box[0]) / k, 2), 'h': round((box[3] - box[1]) / k, 2)}

    def sample_bg(self, n):
        src = os.path.join(self.png_dir, f'{self.prefix}-{n:03d}.png')
        if not os.path.exists(src):
            src = os.path.join(self.render_dir, f'{self.prefix}-{n:03d}.jpg')
        if not os.path.exists(src):
            return None
        im = Image.open(src).convert('RGB')
        pts = [(6, 6), (im.width - 7, 6), (6, im.height - 7), (im.width - 7, im.height - 7)]
        cols = [im.getpixel(p) for p in pts]
        # only trust it when the corners agree (a solid background)
        if max(max(abs(a - b) for a, b in zip(c, cols[0])) for c in cols) > 12:
            return None
        r, g, b = [sum(c[i] for c in cols) // 4 for i in range(3)]
        return '#%02X%02X%02X' % (r, g, b)

    # ---- background ----
    def background(self, slide):
        """(colour, is a picture or gradient, a picture shape that draws it or None)."""
        for host in (slide, slide.slide_layout, slide.slide_layout.slide_master):
            bg = host._element.find('.//p:bg', NS)
            if bg is None:
                continue
            bgpr = bg.find('p:bgPr', NS)
            if bgpr is not None:
                c = self.colors.solid_fill(bgpr)
                if c and c != 'none':
                    return c, False, None
                if bgpr.find('a:blipFill', NS) is not None or bgpr.find('a:gradFill', NS) is not None:
                    node = self.bg_picture(host.part, bgpr)   # picture/gradient background: drawn as a picture
                    return (node or {}).get('avg'), True, node
            bgref = bg.find('p:bgRef', NS)
            if bgref is not None:
                for child in bgref:
                    c = self.colors.resolve(child)
                    if c:
                        return c, False, None
        return '#E3E2E0', False, None

    def keep_font(self, run, face):
        """With --fonts, a run keeps its typeface (the theme's heading or body font when it names one), with the
        deck's own font after it for a machine that doesn't have it."""
        if getattr(self, 'keep_fonts', False) and not run.get('f'):
            face = self.theme_fonts.get(face, face) if face else self.theme_fonts.get('+mn-lt')
            used = getattr(self, 'pdf_fonts', None)   # the fonts the PDF was drawn with: a typeface it doesn't use was swapped for another
            key = re.sub(r'[^a-z0-9]', '', (face or '').lower())
            if face and not face.startswith('+') and re.fullmatch(r"[\w .&-]{1,60}", face) and (used is None or any(u.startswith(key) for u in used)):
                run['font'] = f"'{face}', var(--slide)"
        return run

    def grad_css(self, gf):
        """A gradient fill as CSS (each stop's transparency kept), or None."""
        stops = []
        for gs in sorted(gf.findall('a:gsLst/a:gs', NS), key=lambda g: int(g.get('pos', 0))):
            el = next(iter(gs), None)
            c = self.colors.resolve(el) if el is not None else None
            if not c:
                continue
            a = el.find('a:alpha', NS)
            alpha = int(a.get('val')) / 100000 if a is not None else 1
            r, g, b = (int(c[i:i + 2], 16) for i in (1, 3, 5))
            stops.append(f'rgba({r},{g},{b},{alpha:.3g}) {int(gs.get("pos", 0)) / 1000:.4g}%')
        if not stops:
            return None
        if gf.find('a:path', NS) is not None:
            return f'radial-gradient(circle, {", ".join(stops)})'
        lin = gf.find('a:lin', NS)
        deg = (int(lin.get('ang', 0)) / 60000 if lin is not None else 0) + 90   # PowerPoint's 0 runs left to right; CSS's 90deg does
        return f'linear-gradient({deg % 360:.4g}deg, {", ".join(stops)})'

    def bg_picture(self, part, bgpr):
        """A picture or gradient slide background as one picture shape under everything else, so the
        words on it stay native. The picture is stretched to the slide, as PowerPoint does, with its
        crop and its brightness and contrast corrections. None when it can't be made: the slide then
        comes in as its rendered picture."""
        from PIL import ImageEnhance, ImageOps
        W = 1600
        H = round(W * self.prs.slide_height / self.prs.slide_width)
        try:
            bf = bgpr.find('a:blipFill', NS)
            if bf is not None:
                blip = bf.find('a:blip', NS)
                rid = blip.get('{%s}embed' % NS['r']) if blip is not None else None
                if not rid:
                    return None
                im = Image.open(io.BytesIO(part.related_part(rid).blob)).convert('RGB')
                sr = bf.find('a:srcRect', NS)
                if sr is not None and any(sr.get(k) for k in 'ltrb'):
                    l, t_, r, b = (int(sr.get(k, 0)) / 100000 for k in 'ltrb')
                    box = (round(im.width * l), round(im.height * t_), round(im.width * (1 - r)), round(im.height * (1 - b)))
                    if box[2] - box[0] > 4 and box[3] - box[1] > 4:
                        im = im.crop(box)
                im = im.resize((W, H), Image.LANCZOS)
                # corrections written as a:lum, a:grayscl are applied when the slide is drawn. Office 2010's
                # (in a:extLst) are already in the picture: that keeps the original only to undo them.
                bright = contrast = 0.0
                for e in blip:
                    tag = etree.QName(e).localname
                    if tag == 'lum':
                        bright += int(e.get('bright', 0)) / 100000
                        contrast += int(e.get('contrast', 0)) / 100000
                    elif tag == 'grayscl':
                        im = ImageOps.grayscale(im).convert('RGB')
                if bright > 0:
                    im = Image.blend(im, Image.new('RGB', im.size, (255, 255, 255)), min(bright, 1))
                elif bright < 0:
                    im = ImageEnhance.Brightness(im).enhance(max(0.0, 1 + bright))
                if contrast:
                    im = ImageEnhance.Contrast(im).enhance(max(0.0, 1 + contrast))
                amt = blip.find('a:alphaModFix', NS)
                if amt is not None and int(amt.get('amt', 100000)) < 100000:   # see-through: over white
                    im = Image.blend(Image.new('RGB', im.size, (255, 255, 255)), im, int(amt.get('amt')) / 100000)
            else:
                gf = bgpr.find('a:gradFill', NS)
                stops = []
                for gs in gf.findall('a:gsLst/a:gs', NS):
                    c = next((self.colors.resolve(ch) for ch in gs), None)
                    if c:
                        stops.append((int(gs.get('pos', 0)) / 100000, tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))))
                if not stops:
                    return None
                stops.sort()
                import numpy as np
                yy, xx = np.mgrid[0:H, 0:W].astype(float)
                lin = gf.find('a:lin', NS)
                if gf.find('a:path', NS) is not None:     # radial (circle, rect, shape): from the middle out
                    tpos = np.hypot((xx - W / 2) / (W / 2), (yy - H / 2) / (H / 2)) / np.sqrt(2)
                else:
                    ang = math.radians(int(lin.get('ang', 0)) / 60000 if lin is not None else 0)
                    dx, dy = math.cos(ang), math.sin(ang)
                    proj = xx * dx + yy * dy
                    tpos = (proj - proj.min()) / max(proj.max() - proj.min(), 1)
                pos = [s[0] for s in stops]
                rgb = np.stack([np.interp(tpos, pos, [s[1][k] for s in stops]) for k in range(3)], -1)
                im = Image.fromarray(rgb.clip(0, 255).astype('uint8'), 'RGB')
        except Exception:
            return None
        buf = io.BytesIO()
        im.save(buf, 'JPEG', quality=85, optimize=True, progressive=True)
        src = self.save_blob(buf.getvalue(), 'jpg')
        avg = im.resize((1, 1), Image.BILINEAR).getpixel((0, 0))
        x, y = emu_px(OFFSET[0]), emu_px(OFFSET[1])
        return {'k': 'pic', 'src': src, 'x': x, 'y': y, 'w': round(SLIDE_W_PX - 2 * x, 2), 'h': round(562.5 - 2 * y, 2),
                'crop': [0, 0, 0, 0], 'radius': None, 'rot': 0, 'avg': '#%02X%02X%02X' % avg}

    # ---- text ----
    def text_body(self, sp, txBody, is_ph, autofit_scale):
        paras = []
        for p_el in txBody.findall('a:p', NS):
            level = int(p_el.find('a:pPr', NS).get('lvl', '0')) if p_el.find('a:pPr', NS) is not None else 0
            pp = self.tr.para_props(sp, p_el, level)
            runs = []
            for child in p_el:
                tag = etree.QName(child).localname
                if tag == 'r':
                    t = child.find('a:t', NS)
                    text = t.text if t is not None and t.text else ''
                    if text == '':
                        continue
                    rp = self.tr.run_props(sp, p_el, child, level, is_ph)
                    run = {'t': text, 'sz': round(rp['size'] * autofit_scale, 1), 'b': rp['b'], 'i': rp['i'],
                           'u': bool(rp['u']), 'c': rp['color']}
                    rpr = child.find('a:rPr', NS)
                    if rpr is not None:
                        if rpr.get('strike') not in (None, 'noStrike'):
                            run['s'] = True
                        hl = rpr.find('a:highlight', NS)
                        if hl is not None and len(hl):
                            run['hl'] = self.colors.resolve(hl[0])
                            if run['hl']:
                                r_, g_, b_ = (int(run['hl'][i:i + 2], 16) for i in (1, 3, 5))
                                if (r_ * 299 + g_ * 587 + b_ * 114) / 1000 > 140:
                                    run['c'] = '#231F20'
                    sym = child.find('a:rPr/a:sym', NS)
                    fnt = (sym.get('typeface') if sym is not None else None) or rp['font'] or ''
                    if fnt.lower().startswith(('wingdings', 'webdings', 'symbol')) and (len(text.strip()) <= 2 or any(0xF000 <= ord(ch) <= 0xF0FF for ch in text)):
                        run['f'] = fnt
                    low = fnt.lower()
                    if 'black' in low or 'heavy' in low:
                        run['w'] = 900
                    elif 'semibold' in low or 'demi' in low:
                        run['w'] = 600
                    elif 'light' in low or 'thin' in low:
                        run['w'] = 300
                    self.keep_font(run, rp['font'])
                    runs.append(run)
                elif tag == 'br':
                    runs.append({'t': '\n', 'sz': 0})
                elif tag == 'fld':
                    t = child.find('a:t', NS)
                    text = t.text if t is not None and t.text else ''
                    if text:
                        rp = self.tr.run_props(sp, p_el, child, level, is_ph)
                        runs.append(self.keep_font({'t': text, 'sz': round(rp['size'] * autofit_scale, 1), 'b': rp['b'], 'i': rp['i'], 'u': False, 'c': rp['color']}, rp['font']))
            if not runs:
                # empty paragraph: keep a spacer sized like the paragraph default
                rp = self.tr.run_props(sp, p_el, None, level, is_ph)
                epr = p_el.find('a:endParaRPr', NS)
                if epr is not None and epr.get('sz'):
                    rp['size'] = int(epr.get('sz')) / 100 * SCALE
                paras.append({'runs': [], 'sz': round(rp['size'] * autofit_scale, 1), 'align': pp['align'], 'bullet': pp['bullet'] or '',
                              'level': level, 'lnSpc': pp['lnSpc'], 'spcBef': pp['spcBef'], 'spcAft': pp['spcAft']})
                continue
            paras.append({'runs': runs, 'align': pp['align'], 'bullet': (pp['bullet'] or '') if is_ph or pp['bullet'] else '',
                          'level': level, 'lnSpc': pp['lnSpc'], 'spcBef': pp['spcBef'], 'spcAft': pp['spcAft'],
                          'marL': pp['marL'], 'indent': pp['indent'], 'buFont': pp['buFont'], 'buColor': pp['buColor']})
        return paras

    def body_props(self, txBody, inherited=()):
        """Anchor, wrap, insets, and autofit of a text body. A placeholder takes what its own bodyPr leaves
        unset from the layout's placeholder, then the master's (a title is usually centred or
        bottom-anchored there); the autofit's font scale is the slide's own."""
        chain = [el for el in [txBody.find('a:bodyPr', NS)] + [i.find('p:txBody/a:bodyPr', NS) for i in inherited if i is not None] if el is not None]
        first = lambda attr, default: next((el.get(attr) for el in chain if el.get(attr) is not None), default)
        out = {'anchor': first('anchor', 't'), 'wrap': first('wrap', 'square') != 'none', 'scale': 1.0,
               'ins': [int(first('lIns', 91440)), int(first('tIns', 45720)), int(first('rIns', 91440)), int(first('bIns', 45720))]}
        fit = next(((tag, el) for el in chain for tag in ('normAutofit', 'spAutoFit', 'noAutofit') if el.find(f'a:{tag}', NS) is not None), None)
        out['autofit'] = bool(fit) and fit[0] == 'normAutofit'
        own = chain[0].find('a:normAutofit', NS) if chain and chain[0] is txBody.find('a:bodyPr', NS) else None
        if own is not None and own.get('fontScale'):
            out['scale'] = int(own.get('fontScale')) / 100000
        return out

    # ---- shapes ----
    def line_props(self, sppr, style):
        """(colour, width px, dash, headEnd, tailEnd) for a stroked shape, or None."""
        ln = sppr.find('a:ln', NS) if sppr is not None else None
        if ln is not None and ln.find('a:noFill', NS) is not None:
            return None
        colour = self.colors.solid_fill(ln) if ln is not None else None
        if colour == 'none':
            colour = None
        if colour is None and style is not None:
            lr = style.find('a:lnRef', NS)
            if lr is not None and lr.get('idx', '0') != '0':
                for child in lr:
                    colour = self.colors.resolve(child)
                    if colour:
                        break
        if not colour:
            return None
        lw = (int(ln.get('w', 9525)) / 12700 * PT_TO_PX if ln is not None else 0.75 * PT_TO_PX) * SCALE
        dash = None
        if ln is not None:
            pd = ln.find('a:prstDash', NS)
            if pd is not None and pd.get('val') not in (None, 'solid'):
                dash = pd.get('val')
        head = ln.find('a:headEnd', NS).get('type') if ln is not None and ln.find('a:headEnd', NS) is not None else None
        tail = ln.find('a:tailEnd', NS).get('type') if ln is not None and ln.find('a:tailEnd', NS) is not None else None
        return colour, round(lw, 2), dash, head, tail

    @staticmethod
    def adjusts(geom):
        adj = {}
        if geom is not None:
            for gd in geom.findall('a:avLst/a:gd', NS):
                try:
                    adj[gd.get('name')] = int(gd.get('fmla').split()[-1])
                except (ValueError, AttributeError):
                    pass
        return adj

    def emit_connector(self, n, el, tf, out, prst):
        """A connector drawn natively as an SVG path with its arrowheads. False if it can't be."""
        sppr = el.find('p:spPr', NS)
        xf = xfrm_of(sppr) if sppr is not None else None
        if xf is None:
            return False
        lp = self.line_props(sppr, el.find('p:style', NS))
        if lp is None:
            return False
        colour, lw, dash, head, tail = lp
        x, y, w, h = tf.apply(*xf[:4])
        px, py, pw, ph_ = emu_px(x), emu_px(y), emu_px(w), emu_px(h)
        segs = connector_path(prst, pw, ph_, self.adjusts(sppr.find('a:prstGeom', NS)))
        if segs is None:
            return False
        pts = [p for _, ps in segs for p in ps]
        placed = place(pts, pw, ph_, xf[4], xf[5], xf[6])
        # rebuild the segments with the placed points
        it = iter(placed)
        segs2 = [(cmd, [next(it) for _ in ps]) for cmd, ps in segs]
        heads = []
        HL = max(lw * 4.0, 11.0)

        def pull_back(pt, ref, d):
            vx, vy = pt[0] - ref[0], pt[1] - ref[1]
            n = math.hypot(vx, vy) or 1
            return (pt[0] - vx / n * d, pt[1] - vy / n * d)
        start_prev = segs2[1][1][0] if len(segs2) > 1 else None
        if head and head != 'none' and start_prev is not None:
            hs = head_shape(head, segs2[0][1][0], start_prev, lw)
            if hs:
                heads.append(hs)
                segs2[0][1][0] = pull_back(segs2[0][1][0], start_prev, HL * 0.85)
        if tail and tail != 'none':
            last = segs2[-1][1]
            prev = last[-2] if len(last) > 1 else (segs2[-2][1][-1] if len(segs2) > 1 else None)
            if prev is not None:
                hs = head_shape(tail, last[-1], prev, lw)
                if hs:
                    heads.append(hs)
                    last[-1] = pull_back(last[-1], prev, HL * 0.85)
        allpts = [p for _, ps in segs2 for p in ps]
        for _, hp in heads:
            allpts.extend(hp)
        pad = max(lw * 2, 6)
        minx, miny = min(p[0] for p in allpts) - pad, min(p[1] for p in allpts) - pad
        maxx, maxy = max(p[0] for p in allpts) + pad, max(p[1] for p in allpts) + pad
        ox, oy = px + minx, py + miny
        f = lambda p: f'{p[0] - minx:.1f} {p[1] - miny:.1f}'
        d = ' '.join(cmd + ' ' + ' '.join(f(p) for p in ps) for cmd, ps in segs2)
        node = {'k': 'line', 'x': round(ox, 2), 'y': round(oy, 2), 'w': round(maxx - minx, 2), 'h': round(maxy - miny, 2),
                'd': d, 'c': colour, 'lw': lw, 'dash': dash,
                'heads': [[kind, [[round(p[0] - minx, 1), round(p[1] - miny, 1)] for p in hp]] for kind, hp in heads]}
        out.append(node)
        self.stats['lines'] = self.stats.get('lines', 0) + 1
        return True

    def emit_arrow(self, n, sp, tf, out, prst, fill, line):
        """A block arrow drawn natively as an SVG polygon. False if it can't be."""
        sppr = sp.find('p:spPr', NS)
        xf = xfrm_of(sppr)
        if xf is None or not (fill or line):
            return False
        x, y, w, h = tf.apply(*xf[:4])
        px, py, pw, ph_ = emu_px(x), emu_px(y), emu_px(w), emu_px(h)
        poly = arrow_polygon(prst, pw, ph_, self.adjusts(sppr.find('a:prstGeom', NS)))
        if poly is None:
            return False
        placed = place(poly, pw, ph_, xf[4], xf[5], xf[6])
        pad = 2
        minx, miny = min(p[0] for p in placed) - pad, min(p[1] for p in placed) - pad
        maxx, maxy = max(p[0] for p in placed) + pad, max(p[1] for p in placed) + pad
        out.append({'k': 'poly', 'x': round(px + minx, 2), 'y': round(py + miny, 2), 'w': round(maxx - minx, 2), 'h': round(maxy - miny, 2),
                    'pts': [[round(p[0] - minx, 1), round(p[1] - miny, 1)] for p in placed],
                    'fill': fill if fill and fill != 'none' else None, 'line': line})
        self.stats['arrows'] = self.stats.get('arrows', 0) + 1
        return True

    def emit_custom(self, n, sp, tf, out, fill, line):
        """A freeform (custGeom) without text, drawn natively as an SVG path. False if it can't be."""
        sppr = sp.find('p:spPr', NS)
        xf = xfrm_of(sppr)
        cg = sppr.find('a:custGeom', NS) if sppr is not None else None
        if xf is None or cg is None:
            return False
        lp = self.line_props(sppr, sp.find('p:style', NS))
        if lp is None and not fill:
            return False
        x, y, w, h = tf.apply(*xf[:4])
        px, py, pw, ph_ = emu_px(x), emu_px(y), emu_px(w), emu_px(h)
        segs = []          # (cmd, [(x, y), ...]) in local px
        closed = False
        for path in cg.findall('a:pathLst/a:path', NS):
            sw, sh_ = int(path.get('w') or 0) or 1, int(path.get('h') or 0) or 1
            sx, sy = pw / sw, ph_ / sh_

            def pt(e):
                return (int(e.get('x')) * sx, int(e.get('y')) * sy)
            for c in path:
                tag = etree.QName(c).localname
                if tag == 'moveTo':
                    segs.append(('M', [pt(c.find('a:pt', NS))]))
                elif tag == 'lnTo':
                    segs.append(('L', [pt(c.find('a:pt', NS))]))
                elif tag == 'cubicBezTo':
                    segs.append(('C', [pt(e) for e in c.findall('a:pt', NS)]))
                elif tag == 'quadBezTo':
                    segs.append(('Q', [pt(e) for e in c.findall('a:pt', NS)]))
                elif tag == 'close':
                    segs.append(('Z', []))
                    closed = True
                else:
                    return False        # arcTo etc.: leave it to the crop
        if not segs or segs[0][0] != 'M':
            return False
        pts = [q for _, ps in segs for q in ps]
        placed = place(pts, pw, ph_, xf[4], xf[5], xf[6])
        it = iter(placed)
        segs2 = [(cmd, [next(it) for _ in ps]) for cmd, ps in segs]
        colour, lw, dash, head, tail = lp if lp else (None, 0, None, None, None)
        heads = []
        if lp and not closed:
            flat = [(cmd, ps) for cmd, ps in segs2 if ps]
            if head and len(flat) > 1:
                hs = head_shape(head, flat[0][1][0], flat[1][1][0], lw)
                if hs:
                    heads.append(hs)
            if tail and len(flat) > 1:
                last, prev = flat[-1][1], flat[-2][1]
                pp = last[-2] if len(last) > 1 else prev[-1]
                hs = head_shape(tail, last[-1], pp, lw)
                if hs:
                    heads.append(hs)
        allpts = list(placed) + [q for _, hp in heads for q in hp]
        pad = max(lw * 2, 4)
        minx, miny = min(q[0] for q in allpts) - pad, min(q[1] for q in allpts) - pad
        maxx, maxy = max(q[0] for q in allpts) + pad, max(q[1] for q in allpts) + pad
        f = lambda q: f'{q[0] - minx:.1f} {q[1] - miny:.1f}'
        d = ' '.join((cmd + ' ' + ' '.join(f(q) for q in ps)).strip() for cmd, ps in segs2)
        node = {'k': 'line', 'x': round(px + minx, 2), 'y': round(py + miny, 2), 'w': round(maxx - minx, 2), 'h': round(maxy - miny, 2),
                'd': d, 'c': colour or 'none', 'lw': lw, 'dash': dash,
                'heads': [[kind, [[round(q[0] - minx, 1), round(q[1] - miny, 1)] for q in hp]] for kind, hp in heads]}
        if fill and fill != 'none' and closed:
            node['fillc'] = fill
        out.append(node)
        self.stats['freeforms'] = self.stats.get('freeforms', 0) + 1
        return True

    def convert_shape(self, n, el, tf, out, text_boxes, layout_el, master_el):
        tag = etree.QName(el).localname
        if tag == 'grpSp':
            ctf = tf.child(el)
            for child in el:
                if etree.QName(child).localname in ('sp', 'pic', 'grpSp', 'graphicFrame', 'cxnSp'):
                    self.convert_shape(n, child, ctf, out, text_boxes, layout_el, master_el)
            return
        if tag == 'sp':
            self.convert_sp(n, el, tf, out, text_boxes, layout_el, master_el)
        elif tag == 'pic':
            self.convert_pic(n, el, tf, out)
        elif tag == 'graphicFrame':
            self.convert_frame(n, el, tf, out)
        elif tag == 'cxnSp':
            g = el.find('p:spPr/a:prstGeom', NS)
            prst = g.get('prst') if g is not None else None
            if prst in CONNECTOR_PRSTS and self.emit_connector(n, el, tf, out, prst):
                return
            xf = xfrm_of(el.find('p:spPr', NS))
            if xf:
                x, y, w, h = tf.apply(*xf[:4])
                ln = el.find('p:spPr/a:ln', NS)
                lw = int(ln.get('w', 9525)) / 12700 * PT_TO_PX * SCALE if ln is not None else 1
                pad = max(12.0, lw * 4)     # room for the arrowhead
                out.append({'k': 'crop', 'x': emu_px(x) - pad, 'y': emu_px(y) - pad, 'w': max(emu_px(w), 2) + 2 * pad, 'h': max(emu_px(h), 2) + 2 * pad, 'cxn': True, 'keyed': True})

    def convert_sp(self, n, sp, tf, out, text_boxes, layout_el, master_el):
        sppr = sp.find('p:spPr', NS)
        xf = xfrm_of(sppr) if sppr is not None else None
        is_ph = ph_info(sp) is not None
        if xf is None and is_ph:
            xf = ph_xfrm(sp, layout_el, master_el)
        if xf is None:
            return
        cx0, cy0, cw0, ch0 = xf[:4]
        rot = xf[4]
        txb0 = sp.find('p:txBody', NS)
        has_text0 = txb0 is not None and any((t_.text or '').strip() for t_ in txb0.iter(A + 't'))
        text_rot = 0
        if abs((rot % 180) - 90) < 2:
            if has_text0:
                # side-turned words (an axis label): keep the box as drawn and turn it, so
                # the words run up the slide instead of wrapping one letter to a line
                text_rot = rot
            else:
                # a shape turned on its side: swap its footprint in its own coordinate
                # space (before any group scaling), then drop the rotation
                ccx, ccy = cx0 + cw0 / 2, cy0 + ch0 / 2
                cw0, ch0 = ch0, cw0
                cx0, cy0 = ccx - cw0 / 2, ccy - ch0 / 2
                rot = 0
        bp0 = txb0.find('a:bodyPr', NS) if txb0 is not None else None
        vert = bp0.get('vert') if bp0 is not None else None
        if has_text0 and vert in ('vert', 'vert270', 'eaVert') and not rot:
            # vertical text in an upright box: lay the box down, set the words in it, and
            # turn the whole box, the way PowerPoint draws it
            ccx, ccy = cx0 + cw0 / 2, cy0 + ch0 / 2
            cw0, ch0 = ch0, cw0
            cx0, cy0 = ccx - cw0 / 2, ccy - ch0 / 2
            text_rot = 270 if vert == 'vert270' else 90
        g0 = sppr.find('a:prstGeom', NS) if sppr is not None else None
        if g0 is not None and g0.get('prst') in CONNECTOR_PRSTS and not has_text0:
            # a line drawn as a shape (pptxgenjs writes them this way): a native line
            if self.emit_connector(n, sp, tf, out, g0.get('prst')):
                return
        x, y, w, h = tf.apply(cx0, cy0, cw0, ch0)
        px, py, pw, ph_ = emu_px(x), emu_px(y), emu_px(w), emu_px(h)

        geom = sppr.find('a:prstGeom', NS) if sppr is not None else None
        prst = geom.get('prst') if geom is not None else ('custom' if (sppr is not None and sppr.find('a:custGeom', NS) is not None) else 'rect')
        fill = self.colors.solid_fill(sppr) if sppr is not None else None
        style = sp.find('p:style', NS)
        own_fill = sppr is not None and any(sppr.find(f'a:{k}', NS) is not None for k in ('gradFill', 'blipFill', 'pattFill'))
        if fill is None and style is not None and not own_fill:
            fr = style.find('a:fillRef', NS)
            if fr is not None and fr.get('idx', '0') not in ('0', '1000'):
                base = None
                for child in fr:
                    base = self.colors.resolve(child)
                    if base:
                        break
                idx = int(fr.get('idx'))
                if base and 1 <= idx <= len(self.theme_fills):
                    fs = self.theme_fills[idx - 1]
                    tag = etree.QName(fs).localname
                    if tag == 'solidFill':
                        fill = self.colors.resolve_ph(fs[0], base) if len(fs) else base
                    elif tag == 'gradFill':
                        gs = fs.find('a:gsLst/a:gs', NS)
                        fill = self.colors.resolve_ph(gs[0], base) if gs is not None and len(gs) else base
                    else:
                        fill = base
                elif base:
                    fill = base
        ln = sppr.find('a:ln', NS) if sppr is not None else None
        line = None
        if ln is not None and ln.find('a:noFill', NS) is None:
            lc = self.colors.solid_fill(ln)
            if lc and lc != 'none':
                line = {'c': lc, 'w': round(int(ln.get('w', 9525)) / 12700 * PT_TO_PX * SCALE, 2)}
        if line is None and (ln is None or ln.find('a:noFill', NS) is None) and style is not None and fill is None:
            lr = style.find('a:lnRef', NS)
            if lr is not None and lr.get('idx', '0') != '0':
                for child in lr:
                    c = self.colors.resolve(child)
                    if c:
                        line = {'c': c, 'w': 1.0}
                        break
        txBody = sp.find('p:txBody', NS)
        has_text = txBody is not None and any((t.text or '').strip() for t in txBody.iter(A + 't'))
        outline = None
        dash = ln.find('a:prstDash', NS) if ln is not None else None
        if line and dash is not None and dash.get('val') not in (None, 'solid') and prst in ('rect', 'ellipse', 'roundRect') \
                and getattr(self, 'dashed_outlines', False):
            # a dashed outline: the box can only draw a solid border, so draw it as a path
            W_, H_ = pw, ph_
            if prst == 'ellipse':
                kx, ky = W_ / 2 * 0.5523, H_ / 2 * 0.5523
                cx_, cy_ = W_ / 2, H_ / 2
                d = (f'M {cx_:.1f} 0 C {cx_ + kx:.1f} 0 {W_:.1f} {cy_ - ky:.1f} {W_:.1f} {cy_:.1f} '
                     f'C {W_:.1f} {cy_ + ky:.1f} {cx_ + kx:.1f} {H_:.1f} {cx_:.1f} {H_:.1f} '
                     f'C {cx_ - kx:.1f} {H_:.1f} 0 {cy_ + ky:.1f} 0 {cy_:.1f} '
                     f'C 0 {cy_ - ky:.1f} {cx_ - kx:.1f} 0 {cx_:.1f} 0 Z')
            else:
                d = f'M 0 0 L {W_:.1f} 0 L {W_:.1f} {H_:.1f} L 0 {H_:.1f} Z'
            outline = {'k': 'line', 'x': px, 'y': py, 'w': W_, 'h': H_, 'd': d, 'c': line['c'], 'lw': line['w'],
                       'dash': dash.get('val'), 'heads': []}
            line = None

        if prst == 'custom' and not has_text and sppr.find('a:blipFill', NS) is None and sppr.find('a:gradFill', NS) is None:
            if self.emit_custom(n, sp, tf, out, fill, line):
                return
        if prst in ARROW_PRSTS and sppr.find('a:blipFill', NS) is None and sppr.find('a:gradFill', NS) is None:
            if self.emit_arrow(n, sp, tf, out, prst, fill, line):
                if not has_text:
                    return
                fill, line = None, None
                prst = 'rect'
        # shapes with a drawn geometry we can't reproduce: crop from the render
        simple = prst in ('rect', 'roundRect', 'ellipse', 'flowChartProcess', 'snip1Rect', 'round2SameRect', 'round1Rect', 'round2DiagRect')
        if not simple and not has_text:
            if prst == 'custom' or fill or line or sppr.find('a:blipFill', NS) is not None or sppr.find('a:gradFill', NS) is not None:
                out.append({'k': 'crop', 'x': px, 'y': py, 'w': pw, 'h': ph_})
            return
        callout = False
        if not simple and has_text:
            # a callout / arrow with text: cropping it would bake the words in, so
            # approximate the shape as a rounded box and keep the text native
            callout = True
            if prst in ('wedgeRoundRectCallout', 'wedgeRectCallout', 'wedgeEllipseCallout') and (fill or line):
                # the speech-bubble tail, drawn as a triangle under the box
                adj = self.adjusts(geom)
                tipx = pw / 2 + pw * adj.get('adj1', -20833) / 100000
                tipy = ph_ / 2 + ph_ * adj.get('adj2', 62500) / 100000
                base = max(min(pw, ph_) / 4, 22.0)
                # the tail leaves through whichever edge the tip is furthest past
                ox = max(-tipx, tipx - pw, 0.0)
                oy = max(-tipy, tipy - ph_, 0.0)
                oval = prst == 'wedgeEllipseCallout'   # its tail starts inside the oval, which covers the join
                if ox <= 1 and oy <= 1:
                    tri = None                   # the tip sits inside the box: no tail
                elif oy > ox:
                    ey = (ph_ * 0.8 if tipy > ph_ else ph_ * 0.2) if oval else (ph_ if tipy > ph_ else 0)
                    bx = min(max(tipx, pw * 0.3), pw * 0.7) if oval else min(max(tipx, base), pw - base)
                    tri = [(bx - base / 2, ey), (bx + base / 2, ey), (tipx, tipy)]
                else:
                    ex = (pw * 0.8 if tipx > pw else pw * 0.2) if oval else (pw if tipx > pw else 0)
                    by = min(max(tipy, ph_ * 0.3), ph_ * 0.7) if oval else min(max(tipy, base), ph_ - base)
                    tri = [(ex, by - base / 2), (ex, by + base / 2), (tipx, tipy)]
                placed = place(tri, pw, ph_, rot, xf[5], xf[6]) if tri else None
                if placed:
                 minx, miny = min(q[0] for q in placed), min(q[1] for q in placed)
                 maxx, maxy = max(q[0] for q in placed), max(q[1] for q in placed)
                 out.append({'k': 'poly', 'x': round(px + minx, 2), 'y': round(py + miny, 2), 'w': round(maxx - minx + 1, 2), 'h': round(maxy - miny + 1, 2),
                             'pts': [[round(q[0] - minx, 1), round(q[1] - miny, 1)] for q in placed],
                             'fill': fill if fill and fill != 'none' else None, 'line': line})

        node = {'k': 'box', 'x': px, 'y': py, 'w': pw, 'h': ph_, 'fill': fill if fill and fill != 'none' else None,
                'line': line, 'rot': text_rot if has_text else rot}
        phi = ph_info(sp)
        if phi and phi['type'] in ('title', 'ctrTitle'):
            node['ph'] = 'title'
        elif has_text and py < 80 and pw > 500 and len(node.get('text') or []) == 1:
            szs = [r.get('sz') or 0 for r in node['text'][0].get('runs') or []]
            if szs and max(szs) >= 28:
                node['ph'] = 'title'
        if callout:
            node['radius'] = '50%' if prst == 'wedgeEllipseCallout' else 10
        elif prst == 'roundRect':
            adj = geom.find('a:avLst/a:gd', NS) if geom is not None else None
            frac = int(adj.get('fmla').split()[-1]) / 100000 if adj is not None else 0.1667
            node['radius'] = round(min(pw, ph_) * frac, 1)
        elif prst == 'ellipse':
            node['radius'] = '50%'
        if sppr is not None and sppr.find('a:blipFill', NS) is not None:
            # picture-filled shape: crop it from the render, keep any text on top
            out.append({'k': 'crop', 'x': px, 'y': py, 'w': pw, 'h': ph_, 'under_text': True})
            node['fill'] = None
        if sppr is not None and sppr.find('a:gradFill', NS) is not None and not node['fill']:
            css = self.grad_css(sppr.find('a:gradFill', NS))
            if css:
                node['fill'] = css
            else:
                out.append({'k': 'crop', 'x': px, 'y': py, 'w': pw, 'h': ph_, 'under_text': True})
        if has_text:
            inherited = []
            if phi:   # the same placeholder on the layout, then on the master (a centre title is the master's title)
                lay = find_layout_ph(layout_el, phi)
                mas = find_layout_ph(master_el, {'type': {'ctrTitle': 'title', 'subTitle': 'body'}.get(phi['type'], phi['type']), 'idx': None})
                inherited = [lay, mas]
            bp = self.body_props(txBody, inherited)
            node['text'] = self.text_body(sp, txBody, is_ph, bp['scale'])
            allruns = [r for para in node['text'] for r in (para.get('runs') or []) if r['t'] != '\n']
            if len(allruns) == 1 and allruns[0].get('f') and (allruns[0].get('sz') or 0) >= 72:
                # a big drawn mark (an X, a tick): keep only its own colour from the
                # render, so whatever it sits on top of stays native underneath
                out.append({'k': 'crop', 'x': px - pw * 0.6, 'y': py, 'w': pw * 2.2, 'h': ph_, 'keep': allruns[0].get('c')})
                return
            default_c = None
            if style is not None:
                fref = style.find('a:fontRef', NS)
                if fref is not None and len(fref):
                    default_c = self.colors.resolve(fref[0])
            fill_c = node.get('fill')
            if default_c is None and fill_c and fill_c.startswith('#'):
                r, g, b_ = (int(fill_c[i:i + 2], 16) for i in (1, 3, 5))
                if (r * 299 + g * 587 + b_ * 114) / 1000 < 128:
                    default_c = '#FFFFFF'
            if default_c:
                for para in node['text']:
                    for r in para.get('runs') or []:
                        if r.get('c') is None and r['t'] != '\n':
                            r['c'] = default_c
            for para in node['text']:   # a bullet or number takes its first word's colour, as in PowerPoint
                if para.get('bullet') and not para.get('buColor'):
                    para['buColor'] = next((r['c'] for r in para.get('runs') or [] if r.get('c') and r['t'].strip()), None)
            node['anchor'] = bp['anchor']
            node['autofit'] = bp['autofit']
            node['wrap'] = bp['wrap']
            node['ins'] = [emu_px(v * SCALE) for v in bp['ins']]
            # the box may be shorter than the text it holds (PowerPoint lets text spill);
            # estimate the rendered height so masks cover the words that actually show
            est = 0.0
            tw_max = tw_max_wide = 0.0
            align = None
            for para in node['text']:
                runs = para.get('runs') or []
                szpt = max([r.get('sz') or 0 for r in runs] + [para.get('sz') or 0, 12.0])
                szpx = szpt * PT_TO_PX
                chars = sum(len(r['t']) for r in runs if r['t'] != '\n')
                width = max(pw - 16, 40)
                tw_est = chars * szpx * 0.52
                tw_max = max(tw_max, min(tw_est, width))
                # a roomier guess for painting over (bold Arial runs wider than 0.52 em)
                tw_wide = sum(len(r['t']) * (r.get('sz') or szpt) * PT_TO_PX * (0.62 if r.get('b') else 0.56)
                              for r in runs if r['t'] != '\n')
                tw_max_wide = max(tw_max_wide, min(tw_wide + 12, max(pw, 40)))
                lines = max(1, int(tw_est / width + 0.999)) + sum(1 for r in runs if r['t'] == '\n')
                est += lines * szpx * 1.25
                align = align or para.get('align')
            if node.get('autofit') and est > ph_ * 1.6:
                node['autofit'] = False   # PowerPoint shrank this text as far as it would and let it run past the box: so does the deck
            # the mask covers where the words are, not the whole (often much wider) box
            mw = min(pw, tw_max + 10)
            if align == 'ctr':
                mx = px + (pw - mw) / 2
            elif align == 'r':
                mx = px + pw - mw - 8
            else:
                mx = px + 6
            mh = est if node.get('anchor', 't') == 't' else max(ph_, est)
            my = py + 2 if node.get('anchor', 't') == 't' else py
            if getattr(self, 'inpaint', False):
                # painting over only touches the words' colours, so the rect can follow the
                # box's own insets (a box with no inset starts its words at its very edge)
                il, it_, ir, _ = node['ins']
                ww = min(max(pw - il - ir, 10), tw_max_wide)
                mw = ww + 8
                mx = {'ctr': px + (pw - mw) / 2, 'r': px + pw - ir - ww - 4}.get(align, px + il - 4)
                if node.get('anchor', 't') == 't':
                    my, mh = py + it_ - 3, est + 4
                if node.get('rot') and abs((node['rot'] % 180) - 90) < 2:
                    # turned text: its words run up the slide, so take the box's upright footprint
                    mx, my, mw, mh = px + pw / 2 - ph_ / 2 - 3, py + ph_ / 2 - pw / 2 - 3, ph_ + 6, pw + 6
            if not node.get('fill'):
                text_boxes.append({'node': node, 'rect': (mx, my, mw, mh)})
            node['_words'] = (mx, my, mw, mh)
            self.stats['text'] += 1
        elif not node['fill'] and not node['line']:
            if outline:
                out.append(outline)
            return
        out.append(node)
        if outline:
            out.append(outline)

    def convert_pic(self, n, pic, tf, out):
        xf = xfrm_of(pic.find('p:spPr', NS))
        if xf is None:
            return
        x, y, w, h = tf.apply(*xf[:4])
        blip = pic.find('.//a:blip', NS)
        rid = blip.get('{%s}embed' % NS['r']) if blip is not None else None
        src = None
        if rid:
            try:
                part = (getattr(self, 'current_part', None) or self.current_slide.part).related_part(rid)
                ext = part.partname.ext.lstrip('.').lower() or 'png'
                if ext in ('emf', 'wmf', 'svg', 'tif', 'tiff'):
                    src = None
                else:
                    src = self.save_blob(part.blob, 'jpg' if ext in ('jpg', 'jpeg') else ext)
            except Exception:
                src = None
        node = {'k': 'pic', 'x': emu_px(x), 'y': emu_px(y), 'w': emu_px(w), 'h': emu_px(h), 'rot': xf[4]}
        if src is None:
            node['k'] = 'crop'
            out.append(node)
            return
        sr = pic.find('.//a:srcRect', NS)
        crop = [0, 0, 0, 0]
        if sr is not None:
            crop = [int(sr.get(k, 0)) / 100000 for k in ('l', 't', 'r', 'b')]
        node['src'] = src
        node['crop'] = crop
        node['radius'] = None
        geom = pic.find('.//a:prstGeom', NS)
        if geom is not None and geom.get('prst') == 'ellipse':
            node['radius'] = '50%'
        elif geom is not None and geom.get('prst') == 'roundRect':
            node['radius'] = round(min(node['w'], node['h']) * 0.1667, 1)
        if blip is not None:
            am = blip.find('a:alphaModFix', NS)
            if am is not None and am.get('amt'):
                node['opacity'] = int(am.get('amt')) / 100000
            # recoloured pictures (icons turned white, etc.) can't be reproduced from the
            # source file: take them from the render instead, with the background keyed out
            if any(blip.find('a:' + t, NS) is not None for t in ('grayscl', 'duotone', 'biLevel', 'clrChange', 'clrRepl')):
                node = {'k': 'crop', 'x': node['x'], 'y': node['y'], 'w': node['w'], 'h': node['h']}
        out.append(node)
        self.stats['pics'] += 1

    def convert_frame(self, n, fr, tf, out):
        xf = fr.find('p:xfrm', NS)
        if xf is None:
            return
        off, ext = xf.find('a:off', NS), xf.find('a:ext', NS)
        x, y, w, h = tf.apply(int(off.get('x')), int(off.get('y')), int(ext.get('cx')), int(ext.get('cy')))
        tbl = fr.find('.//a:tbl', NS)
        if tbl is not None:
            tblpr = tbl.find('a:tblPr', NS)
            first_row = tblpr is not None and tblpr.get('firstRow') == '1' and len(tbl.findall('a:tr', NS)) > 1
            rows = []
            for ri, tr in enumerate(tbl.findall('a:tr', NS)):
                cells = []
                for tc in tr.findall('a:tc', NS):
                    txt = ' '.join((t.text or '') for t in tc.iter(A + 't')).strip()
                    tcpr = tc.find('a:tcPr', NS)
                    fill = self.colors.solid_fill(tcpr) if tcpr is not None else None
                    bold = any(r.get('b') == '1' for r in tc.iter(A + 'rPr'))
                    italic = any(r.get('i') == '1' for r in tc.iter(A + 'rPr'))
                    col = None
                    for r in tc.iter(A + 'rPr'):
                        c = self.colors.solid_fill(r)
                        if c and c != 'none':
                            col = c
                            break
                    sz = None
                    for r in tc.iter(A + 'rPr'):
                        if r.get('sz'):
                            sz = int(r.get('sz')) / 100 * SCALE
                            break
                    if sz is None and txt.strip():   # no size of its own: the deck's default text size, as PowerPoint draws it
                        sz = self.default_size * SCALE
                    cell = {'t': txt, 'fill': fill if fill and fill != 'none' else None, 'b': bold, 'i': italic, 'c': col, 'sz': sz}
                    if first_row and ri == 0 and not cell['fill']:
                        cell['fill'] = '#272323'
                        cell['c'] = cell['c'] or '#FFFFFF'
                        cell['b'] = True
                    cells.append(cell)
                rows.append(cells)
            cols = [emu_px(int(gc.get('w', 0)) * tf.sx) for gc in tbl.findall('a:tblGrid/a:gridCol', NS)]
            # the frame's height can be a nominal one (pptxgenjs writes one inch); the rows say how
            # tall the table really is
            row_h = [emu_px(int(tr.get('h', 0)) * tf.sy) for tr in tbl.findall('a:tr', NS)]
            h_px = max(emu_px(h), round(sum(row_h), 2))
            out.append({'k': 'table', 'x': emu_px(x), 'y': emu_px(y), 'w': emu_px(w), 'h': h_px, 'rows': rows, 'cols': cols, 'rowH': row_h})
            self.stats['tables'] += 1
            return
        # chart, SmartArt, OLE: crop from the render
        out.append({'k': 'crop', 'x': emu_px(x), 'y': emu_px(y), 'w': emu_px(w), 'h': emu_px(h)})

    # ---- slide ----
    def convert_slide(self, n, slide):
        self.current_slide = slide
        self.use_master(slide.slide_layout.slide_master)
        layout_el, master_el = slide.slide_layout._element, slide.slide_layout.slide_master._element
        cmap = dict(self.base_cmap)
        for host in (layout_el, slide._element):
            ov = host.find('.//p:clrMapOvr/a:overrideClrMapping', NS)
            if ov is not None:
                cmap.update(dict(ov.attrib))
        self.colors.cmap = cmap
        self.tr = TextResolver(self.colors, master_el, layout_el)
        bg, bg_is_picture, bg_node = self.background(slide)
        if not bg_is_picture:
            sampled = self.sample_bg(n)
            if sampled:
                bg = sampled
        out, text_boxes = [], []
        if bg_node:
            bg_node.pop('avg', None)
            out.append(bg_node)
        tf = Transform(SCALE, SCALE, *OFFSET)
        # what the layout and master draw on every slide (a logo, a footer line, a band of colour) goes
        # under the slide's own shapes, unless the slide or its layout hides background graphics.
        # Their placeholders are only prompts: the slide has its own.
        hosts = []
        if slide._element.get('showMasterSp') != '0':
            if layout_el.get('showMasterSp') != '0':
                hosts.append((slide.slide_layout.slide_master.part, master_el))
            hosts.append((slide.slide_layout.part, layout_el))
        for part, host in hosts:
            self.current_part = part
            for el in host.find('.//p:cSld/p:spTree', NS):
                if etree.QName(el).localname in ('sp', 'pic', 'grpSp', 'graphicFrame', 'cxnSp') and el.find('.//p:nvPr/p:ph', NS) is None:
                    self.convert_shape(n, el, tf, out, text_boxes, layout_el, master_el)
        self.current_part = slide.part
        spTree = slide._element.find('.//p:cSld/p:spTree', NS)
        for el in spTree:
            if etree.QName(el).localname in ('sp', 'pic', 'grpSp', 'graphicFrame', 'cxnSp'):
                self.convert_shape(n, el, tf, out, text_boxes, layout_el, master_el)

        # resolve crops now. A big crop (chart, SmartArt, diagram) carries its own
        # words baked in, so native text boxes that sit inside it are dropped rather
        # than drawn twice. Small crops (icons, arrows, lines) are placed as they are.
        slide_area = SLIDE_W_PX * 562.5
        baked = set()
        final = []
        def isect(a, b):
            ix0, iy0 = max(a['x'], b['x']), max(a['y'], b['y'])
            ix1, iy1 = min(a['x'] + a['w'], b['x'] + b['w']), min(a['y'] + a['h'], b['y'] + b['h'])
            return (ix0, iy0, ix1 - ix0, iy1 - iy0) if ix1 > ix0 and iy1 > iy0 else None
        for ci, node in enumerate(out):
            if node['k'] != 'crop':
                final.append(node)
                continue
            area = node['w'] * node['h']
            big = area >= 0.08 * slide_area
            solid_bg = bg if (bg and not bg_is_picture) else None
            mask = []
            if big:
                # words that live mostly inside the crop stay baked in it (with --keep-text they
                # don't: every text box is taken out of the picture and drawn natively, so a
                # callout on a chart or a quadrant label under it stays editable); text boxes
                # that merely touch it are cut out of the picture and drawn natively
                for oj, other in enumerate(out):
                    if other['k'] == 'box' and other.get('text'):
                        ix = max(0, min(node['x'] + node['w'], other['x'] + other['w']) - max(node['x'], other['x']))
                        iy = max(0, min(node['y'] + node['h'], other['y'] + other['h']) - max(node['y'], other['y']))
                        if ix * iy > 0.92 * (other['w'] * other['h'] or 1) and not getattr(self, 'keep_text', False):
                            baked.add(id(other))
                        elif ix * iy > 0:
                            for tb in text_boxes:
                                if tb['node'] is other:
                                    mask.append(tb['rect'])
            elif node['w'] < 40 or node['h'] < 40 or node.get('cxn') or node.get('keep'):
                mask = [tb['rect'] for tb in text_boxes]
            else:
                mask = []
            regions = []
            padded = {'x': node['x'] - 3, 'y': node['y'] - 3, 'w': node['w'] + 6, 'h': node['h'] + 6}   # the crop carries 3px of padding
            for j, other in enumerate(out):
                if other is node or other['k'] != 'box' or not str(other.get('fill') or '').startswith('#') or id(other) in baked:
                    continue
                R = isect(padded, other)
                if not R:
                    continue
                if j > ci:
                    regions.append((R, None))
                else:
                    # the box's fill and its text colours all go: what is left is the
                    # crop's own drawing, and the native words show through the gaps
                    keys = [other['fill']]
                    # its words' colours only where its words could be: a mark the same colour
                    # as the words (a red sparkline under a red figure) must survive elsewhere
                    words = other.get('_words')
                    if words is None or isect(padded, {'x': words[0], 'y': words[1], 'w': words[2], 'h': words[3]}):
                        for para in other.get('text') or []:
                            for r in para.get('runs') or []:
                                if r.get('c') and r['c'] not in keys:
                                    keys.append(r['c'])
                    if solid_bg and solid_bg not in keys:
                        keys.append(solid_bg)
                    edge = None
                    if other.get('line') and other['line'].get('c') not in keys:
                        edge = ((other['x'], other['y'], other['w'], other['h']), other['line']['c'],
                                max(other['line'].get('w') or 1, 1) + 3)
                    regions.append((R, keys, edge))
            inpaint = None
            if getattr(self, 'inpaint', False) and not node.get('keep'):
                # take the baked words of native text boxes out of the picture by painting
                # them over with the colour around them, instead of punching a see-through
                # hole (which shows the slide background through a dark chevron or a bar)
                as_rect = lambda r: {'x': r[0], 'y': r[1], 'w': r[2], 'h': r[3]}
                if mask:
                    tbs = [tb for tb in text_boxes if tb['rect'] in mask]
                elif not big:
                    tbs = [tb for tb in text_boxes if id(tb['node']) not in baked]
                else:
                    tbs = []
                inpaint = [(tb['rect'], self.word_colours(tb['node'])) for tb in tbs if isect(padded, as_rect(tb['rect']))] or None
                mask = []
            flatten = None
            if getattr(self, 'jpeg_crops', False) and solid_bg and not node.get('keep'):
                if not any(isect(padded, o) for o in out[:ci]):
                    flatten = solid_bg
            c = self.crop_from_render(n, node['x'], node['y'], node['w'], node['h'],
                                      mask=mask or None, bg=solid_bg, key=solid_bg, strong=not big, regions=regions or None,
                                      keep=node.get('keep'), flatten=flatten, inpaint=inpaint)
            if not c:
                continue
            final.append({'k': 'pic', 'src': c['src'], 'x': c['x'], 'y': c['y'], 'w': c['w'], 'h': c['h'], 'crop': [0, 0, 0, 0], 'radius': None, 'rot': 0})
        if baked:
            final = [nd for nd in final if id(nd) not in baked]
            self.stats['skipped'] += len(baked)
        for nd in final:
            nd.pop('_words', None)
            if nd['k'] == 'pic' and not nd.get('rot'):
                clip_to_slide(nd)
        self.stats['slides'] += 1
        return {'bg': bg, 'bgpic': bg_is_picture and not bg_node, 'shapes': final}

    def run(self):
        result = {}
        only = getattr(self, 'only', None)
        for i, slide in enumerate(self.prs.slides, 1):
            if only and i not in only:
                continue
            try:
                result[i] = self.convert_slide(i, slide)
            except Exception as e:      # keep going; the builder falls back to the image
                result[i] = {'error': str(e)}
        return result


def clip_to_slide(nd):
    """A picture that runs off the slide (a full-bleed photo placed a little large) is cut at the slide's
    edge, as PowerPoint shows it: its crop grows by the part outside."""
    x, y, w, h = nd['x'], nd['y'], nd['w'], nd['h']
    if w <= 0 or h <= 0 or (x >= 0 and y >= 0 and x + w <= SLIDE_W_PX and y + h <= 562.5):
        return
    cl, ct, cr, cb = nd.get('crop') or [0, 0, 0, 0]
    sx, sy = (1 - cl - cr) / w, (1 - ct - cb) / h        # crop fraction per px shown
    left, top = max(0, -x), max(0, -y)
    right, bottom = max(0, x + w - SLIDE_W_PX), max(0, y + h - 562.5)
    if left + right >= w or top + bottom >= h:
        return
    nd['crop'] = [round(cl + left * sx, 5), round(ct + top * sy, 5), round(cr + right * sx, 5), round(cb + bottom * sy, 5)]
    nd['x'], nd['y'] = round(x + left, 2), round(y + top, 2)
    nd['w'], nd['h'] = round(w - left - right, 2), round(h - top - bottom, 2)


def render_pdf(pdf, render_dir, png_dir, prefix, pages, size=None, picture_width=1280, crop_width=2000, quality=80):
    """Render PDF pages as the slides they show: pages maps slide number -> page index. Writes
    <prefix>-NNN.jpg pictures (picture_width) into render_dir and <prefix>-NNN.png renders to crop
    from (crop_width) into png_dir. size is the deck's (width, height) in EMU: a deck of another
    shape than 16:9 is centred on a 16:9 picture, where the converter puts its shapes."""
    import fitz
    s, (dx, dy) = fit_slide(*(size or (0, 0)))
    os.makedirs(render_dir, exist_ok=True)
    doc = fitz.open(pdf)
    for n, i in sorted(pages.items()):
        if i >= doc.page_count:
            continue
        page = doc[i]
        for width, path in ((crop_width, os.path.join(png_dir, f'{prefix}-{n:03d}.png')),
                            (picture_width, os.path.join(render_dir, f'{prefix}-{n:03d}.jpg'))):
            k = width / SLIDE_W_PX                          # canvas px -> picture px
            inner = (width - 2 * emu_px(dx) * k) / page.rect.width
            pix = page.get_pixmap(matrix=fitz.Matrix(inner, inner), alpha=False)
            im = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
            if size and (dx or dy):
                corner = im.getpixel((2, 2))
                full = Image.new('RGB', (width, round(width * 0.5625)), corner)
                full.paste(im, (round(emu_px(dx) * k), round(emu_px(dy) * k)))
                im = full
            if path.endswith('.png'):
                im.save(path)
            else:
                im.save(path, quality=quality, optimize=True, progressive=True)
    return doc.page_count


def parse_slides(spec):
    """'4-13,15,17-21' -> {4, 5, ..., 13, 15, 17, ..., 21}"""
    out = set()
    for part in (spec or '').split(','):
        part = part.strip()
        if not part:
            continue
        if '-' in part:
            a, b = part.split('-', 1)
            out.update(range(int(a), int(b) + 1))
        else:
            out.add(int(part))
    return out


if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser(description='Convert a PPTX into editable native slides for a Decks deck.')
    ap.add_argument('pptx')
    ap.add_argument('render_dir', help='folder with <prefix>-NNN.jpg renders; crops are written here too')
    ap.add_argument('prefix')
    ap.add_argument('png_dir', nargs='?', default=None, help='optional folder with sharper <prefix>-NNN.png renders to crop from')
    ap.add_argument('--var', default='CT', help='name of the JS constant (default CT)')
    ap.add_argument('--slides', default='', help='only these slides, e.g. 4-13,15,17-21 (default: all)')
    ap.add_argument('--key', default='', help='prefix for the slide keys, e.g. "sp" gives sp1, sp2, ...')
    ap.add_argument('--append', action='store_true', help='emit Object.assign(VAR, {...}) to add to an existing constant')
    ap.add_argument('--jpeg-crops', action='store_true',
                    help='on a solid background, save a crop as JPEG (flattened onto the background) '
                         'when no native shape lies beneath it')
    ap.add_argument('--keep-text', action='store_true',
                    help='keep a text box that lies inside a chart or other big crop native (taken out of the '
                         'picture) instead of leaving its words baked into the picture')
    ap.add_argument('--inpaint', action='store_true',
                    help='take the words of native text boxes out of a crop by painting them over with the '
                         'colour beneath them, instead of cutting a see-through hole')
    ap.add_argument('--fonts', action='store_true',
                    help="keep each run's typeface (the deck's own font follows it, for a machine without it)")
    ap.add_argument('--dashed-outlines', action='store_true',
                    help='draw a dashed outline of a box or circle as a dashed path (a box border is always solid)')
    ap.add_argument('--pdf', help='the deck exported to PDF by PowerPoint. With it the converter renders the slides '
                                   'itself (PyMuPDF): <prefix>-NNN.jpg pictures into render_dir, and sharper PNGs '
                                   'in a temporary folder to crop from')
    ap.add_argument('--picture-width', type=int, default=1280, help='width of the <prefix>-NNN.jpg slide pictures (with --pdf)')
    ap.add_argument('--crop-width', type=int, default=2000, help='width of the renders crops are cut from (with --pdf)')
    ap.add_argument('--quality', type=int, default=80, help='JPEG quality of the slide pictures (with --pdf)')
    args = ap.parse_args()
    png_dir, tmp = args.png_dir, None
    conv = Converter(args.pptx, args.render_dir, args.prefix, args.render_dir, png_dir)
    if args.pdf:
        import shutil
        import tempfile
        import fitz
        tmp = conv.png_dir = tempfile.mkdtemp(prefix='pptx2native-')
        wanted = parse_slides(args.slides) or set(range(1, fitz.open(args.pdf).page_count + 1))
        render_pdf(args.pdf, args.render_dir, tmp, args.prefix, {n: n - 1 for n in wanted},
                   (conv.prs.slide_width, conv.prs.slide_height), args.picture_width, args.crop_width, args.quality)
    conv.only = parse_slides(args.slides)
    conv.jpeg_crops = args.jpeg_crops
    conv.keep_text = args.keep_text
    conv.inpaint = args.inpaint
    conv.dashed_outlines = args.dashed_outlines
    conv.keep_fonts = args.fonts
    data = conv.run()
    if args.key:
        data = {f'{args.key}{k}': v for k, v in data.items()}
    body = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    js = (f'Object.assign({args.var}, {body});\n' if args.append else f'const {args.var} = {body};\n')
    sys.stdout.write(js)
    sys.stderr.write(json.dumps(conv.stats) + '\n')
    if tmp:
        shutil.rmtree(tmp, ignore_errors=True)
