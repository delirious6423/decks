"""Proposed slides: the reviewer's decisions, and baking them into a deck file.

A proposal is a LIBRARY entry with prop:true, replaces:'<original id>'. In the deck, the reviewer accepts it
(the proposal takes the original's place) or keeps the original (the proposal goes). The page saves each
decision in review.json and applies it to the version on screen at once; `sb proposals <deck> --bake`
then writes it into the deck file:

  accept  the original gets alt:true (it moves to the extras), the proposal loses prop and replaces,
          and in every version that lists its slides by hand the original's id becomes the proposal's
  keep    the proposal's LIBRARY entry is deleted (git keeps it), and it leaves every hand-made version

Only the deck file's text changes. The edits work on the JavaScript as written: strings, template
literals, comments, and regular expressions are skipped, so a slide's words are never touched.
"""
import re


# ---------- reading the deck's JavaScript ----------

REGEX_BEFORE = set('(,=:[!&|?{};+-*%<>~^')
REGEX_WORDS = ('return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'new', 'else', 'do')


def code_mask(src):
    """One byte per character: 0 where it is code, 1 inside a string, template text, comment, or regex.
    In an HTML file only the scripts are code; everything outside them is 1."""
    if re.search(r'<script\b', src, re.I):
        m = bytearray(b'\x01' * len(src))
        for mm in re.finditer(r'<script\b([^>]*)>([\s\S]*?)</script>', src, re.I):
            if re.search(r'type\s*=\s*["\']?application/(?:ld\+)?json', mm.group(1), re.I) or 'src=' in mm.group(1):
                continue
            m[mm.start(2):mm.end(2)] = js_mask(mm.group(2))
        return m
    return js_mask(src)


def js_mask(src):
    n, m = len(src), bytearray(len(src))
    stack = []        # brace depth at each open ${ in a template literal
    depth = 0         # braces open in code
    prev = ''         # the last code character that wasn't whitespace
    i = 0

    def template(j):   # from just inside a template's text: to its closing ` (end) or the next ${ (expr)
        while j < n:
            c = src[j]
            if c == '\\':
                j += 2; continue
            if c == '`':
                return j, 'end'
            if c == '$' and j + 1 < n and src[j + 1] == '{':
                return j, 'expr'
            j += 1
        return n - 1, 'end'

    def mark(a, b):
        m[a:b] = b'\x01' * (b - a)

    while i < n:
        c = src[i]
        if c in ' \t\r\n':
            i += 1; continue
        if c in '"\'':
            j = i + 1
            while j < n and src[j] != c and src[j] != '\n':
                j += 2 if src[j] == '\\' else 1
            mark(i, min(j + 1, n)); i = j + 1; prev = '"'; continue
        if c == '`':
            j, how = template(i + 1)
            if how == 'end':
                mark(i, j + 1); i = j + 1; prev = '"'; continue
            mark(i, j + 2); stack.append(depth); depth += 1; i = j + 2; prev = '{'; continue
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            j = src.find('\n', i); j = n if j < 0 else j
            mark(i, j); i = j; continue
        if c == '/' and i + 1 < n and src[i + 1] == '*':
            j = src.find('*/', i + 2); j = n if j < 0 else j + 2
            mark(i, j); i = j; continue
        if c == '/':
            word = re.search(r'([A-Za-z_$][\w$]*)\s*$', src[max(0, i - 12):i])
            if prev in REGEX_BEFORE or prev == '' or (word and word.group(1) in REGEX_WORDS and prev not in ')]'):
                j, cls = i + 1, False
                while j < n and src[j] != '\n':
                    if src[j] == '\\':
                        j += 2; continue
                    if src[j] == '[':
                        cls = True
                    elif src[j] == ']':
                        cls = False
                    elif src[j] == '/' and not cls:
                        break
                    j += 1
                j += 1
                while j < n and (src[j].isalpha()):
                    j += 1
                mark(i, j); i = j; prev = '"'; continue
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if stack and depth == stack[-1]:   # the } that closes a ${ … }: back into the template's text
                stack.pop()
                j, how = template(i + 1)
                if how == 'end':
                    mark(i, j + 1); i = j + 1; prev = '"'; continue
                mark(i, j + 2); stack.append(depth); depth += 1; i = j + 2; prev = '{'; continue
        prev = c
        i += 1
    return m


def value_end(src, mask, i):
    """Where the expression starting at i ends: the first , } ] or ) outside any brackets it opens."""
    depth, n = 0, len(src)
    while i < n:
        if not mask[i]:
            c = src[i]
            if c in '([{':
                depth += 1
            elif c in ')]}':
                if depth == 0:
                    return i
                depth -= 1
            elif c == ',' and depth == 0:
                return i
        i += 1
    return n


def library_extents(src, mask):
    """The object literals that hold the slides: const LIBRARY = { … }, and any Object.assign(LIBRARY, { … })."""
    out = []
    for mm in re.finditer(r'\bLIBRARY\s*=\s*\{|Object\.assign\(\s*LIBRARY\s*,\s*\{', src):
        if mask[mm.start()]:
            continue
        a = mm.end() - 1
        out.append((a, match_close(src, mask, a)))
    return out


def match_close(src, mask, a):
    """The index just past the bracket that closes the one at a."""
    depth = 0
    for i in range(a, len(src)):
        if mask[i]:
            continue
        if src[i] in '([{':
            depth += 1
        elif src[i] in ')]}':
            depth -= 1
            if depth == 0:
                return i + 1
    return len(src)


def find_entry(src, mask, sid):
    """A slide's entry in LIBRARY: (key start, value start, value end), or None unless there is exactly one."""
    hits = [(k, v, e) for a, b in library_extents(src, mask) for name, k, v, e in props(src, mask, a, b) if name == sid]
    return hits[0] if len(hits) == 1 else None


def _string_starts(src, mask, k):
    """k is the opening quote of a string token in code."""
    return mask[k] and (k == 0 or not mask[k - 1])


def _trim(src, a, b):
    while b > a and src[b - 1] in ' \t\r\n':
        b -= 1
    return b


def props(src, mask, a, b):
    """The properties of the object literal src[a:b] ({ … }), one level deep: [(name, key start, value start, value end)]."""
    out, i = [], a + 1
    while i < b - 1:
        while i < b - 1 and (src[i] in ' \t\r\n,' or (mask[i] and src[i] not in '\'"')):
            i += 1
        if i >= b - 1:
            break
        mm = re.compile(r'([\'"]?)([\w$-]+)\1\s*:\s*').match(src, i)
        if not mm:   # a spread, a method, or something else: skip to the next comma
            i = value_end(src, mask, i) + 1
            continue
        v = mm.end()
        e = _trim(src, v, value_end(src, mask, v))
        out.append((mm.group(2), i, v, e))
        i = e
    return out


# ---------- editing ----------

class Edit:
    """Text edits on the deck file, applied at once (last first), so positions stay valid while planning."""

    def __init__(self, src):
        self.src, self.ops = src, []

    def replace(self, a, b, text):
        self.ops.append((a, b, text))

    def apply(self):
        out, ops = self.src, sorted(self.ops, key=lambda o: (o[0], o[1]), reverse=True)
        for k in range(1, len(ops)):
            if ops[k][1] > ops[k - 1][0]:
                raise ValueError('two edits overlap')
        for a, b, text in ops:
            out = out[:a] + text + out[b:]
        return out


def drop_prop(ed, src, mask, a, b, name, value_re):
    """Remove a  name: value  property inside src[a:b] (any depth; code only). True if it was there."""
    found = False
    for mm in re.finditer(r'\b' + name + r'\s*:\s*' + value_re, src[a:b]):
        s, e = a + mm.start(), a + mm.end()
        if mask[s]:
            continue
        after = re.compile(r'\s*,[ \t]*').match(src, e)
        if after:
            ed.replace(s, after.end(), '')
        else:   # the last property: take the comma before it instead
            before = re.search(r',\s*$', src[a:s])
            ed.replace(a + before.start() if before else s, e, '')
        found = True
    return found


def set_alt(ed, src, mask, k, v, e):
    """Give the entry whose value is src[v:e] alt:true: a property in an object literal, or Object.assign(…) around a helper call."""
    if src[v] != '{':
        ed.replace(v, v, 'Object.assign(')
        ed.replace(e, e, ', { alt: true })')
        return 'wrapped'
    ps = props(src, mask, v, e)
    for name, ks, vs, ve in ps:
        if name == 'alt':
            if src[vs:ve].strip() != 'true':
                ed.replace(vs, ve, 'true')
            return 'set'
    cat = next((p for p in ps if p[0] == 'cat'), None)
    if cat:
        comma = re.compile(r'\s*,[ \t]*').match(src, cat[3])
        at = comma.end() if comma else cat[3]
        ed.replace(at, at, 'alt: true, ' if comma else ', alt: true')
    else:
        first = ps[0][1] if ps else v + 1
        ed.replace(first, first, 'alt: true, ' if ps else ' alt: true ')
    return 'added'


def delete_entry(ed, src, k, e):
    """Delete a whole LIBRARY entry: its key, value, and the comma after it, and its line when it stands alone."""
    comma = re.compile(r'[ \t]*,').match(src, e)
    end = comma.end() if comma else e
    line_start = src.rfind('\n', 0, k) + 1
    rest = re.compile(r'[ \t]*(//[^\n]*)?\n').match(src, end)
    if src[line_start:k].strip() == '' and rest:
        ed.replace(line_start, rest.end(), '')
    else:
        ed.replace(k, end, '')


def pitches_extent(src, mask):
    mm = next((x for x in re.finditer(r'\bPITCHES\s*=\s*\{', src) if not mask[x.start()]), None)
    if not mm:
        return None
    a = mm.end() - 1
    return a, match_close(src, mask, a)


def string_tokens(src, mask, a, b, sid):
    """Each 'sid' (or "sid") written as an element of an array literal inside src[a:b]: [(start, end, array start, array end)]."""
    out = []
    for mm in re.finditer(r'([\'"])' + re.escape(sid) + r'\1', src[a:b]):
        s, e = a + mm.start(), a + mm.end()
        if not _string_starts(src, mask, s):
            continue
        before = src[:s].rstrip()[-1:]
        after = src[e:].lstrip()[:1]
        if before not in '[,' or after not in ',]':
            continue
        # the array it sits in
        depth, j = 0, s
        while j > a:
            j -= 1
            if mask[j]:
                continue
            if src[j] in ')]}':
                depth += 1
            elif src[j] in '([{':
                if depth == 0:
                    break
                depth -= 1
        if src[j] != '[':
            continue
        out.append((s, e, j, match_close(src, mask, j)))
    return out


def drop_element(ed, src, s, e):
    after = re.compile(r'\s*,[ \t]*').match(src, e)
    if after:
        ed.replace(s, after.end(), '')
    else:
        before = re.search(r',\s*$', src[:s])
        ed.replace(before.start() if before else s, e, '')


def bake(src, decisions, used_figs=True):
    """Write decisions into a deck file's text. decisions: {proposal id: {'decision': 'accept'|'keep', 'replaces': id}}.
    Returns (new text, notes per proposal, problems per proposal). A proposal with a problem is left as it was."""
    mask = code_mask(src)
    ed, notes, problems = Edit(src), {}, {}
    pit = pitches_extent(src, mask)
    for p, d in decisions.items():
        o, how = d.get('replaces') or '', d['decision']
        ent = find_entry(src, mask, p)
        if not ent:
            problems[p] = f"couldn't find one LIBRARY entry written as '{p}': {{ … }}"
            continue
        k, v, e = ent
        trial = Edit(src)   # plan this proposal on its own first, so one that fails leaves nothing half done
        msgs = []
        try:
            if how == 'accept':
                if not drop_prop(trial, src, mask, v, e, 'prop', r'(?:true|1|!0)\b'):
                    raise ValueError('it no longer has prop:true')
                drop_prop(trial, src, mask, v, e, 'replaces', r'([\'"])' + re.escape(o) + r'\1')
                oe = find_entry(src, mask, o) if o else None
                if o and not oe:
                    msgs.append(f"its original '{o}' isn't in the file, so only the proposal changed")
                elif oe:
                    r = set_alt(trial, src, mask, *oe)
                    msgs.append({'wrapped': f"'{o}' is made by a helper, so it is now Object.assign(…, {{ alt: true }})",
                                 'set': f"'{o}' was already an extra", 'added': f"'{o}' gets alt: true"}[r])
                if pit and o:
                    hand = string_tokens(src, mask, pit[0], pit[1], o)
                    for s1, e1, aa, ab in hand:
                        if string_tokens(src, mask, aa, ab, p):
                            drop_element(trial, src, s1, e1)
                        else:
                            trial.replace(s1, e1, src[s1] + p + src[s1])
                    if hand:
                        msgs.append(f"{'a version' if len(hand) == 1 else f'{len(hand)} versions'} that list{'s' if len(hand) == 1 else ''} '{o}' by hand now list{'s' if len(hand) == 1 else ''} '{p}'")
            elif how == 'keep':
                delete_entry(trial, src, k, e)
                if pit:
                    hand = string_tokens(src, mask, pit[0], pit[1], p)
                    for s1, e1, aa, ab in hand:
                        drop_element(trial, src, s1, e1)
                    if hand:
                        msgs.append(f"left out of {'a version' if len(hand) == 1 else f'{len(hand)} versions'} that listed '{p}' by hand")
                fig = re.search(r'\bfig\s*:\s*([\'"])([\w$]+)\1', src[v:e])
                if fig and used_figs and len(re.findall(r'\bfig\s*:\s*([\'"])' + re.escape(fig.group(2)) + r'\1', src)) == 1:
                    msgs.append(f"FIGS.{fig.group(2)} drew only this slide; delete it from FIGS if you like")
            else:
                raise ValueError(f'unknown decision {how!r}')
        except (ValueError, AttributeError) as x:
            problems[p] = str(x)
            continue
        ed.ops.extend(trial.ops)
        notes[p] = msgs
    try:
        return ed.apply(), notes, problems
    except ValueError as x:
        return src, {}, {p: f'edits overlap ({x}); bake these one at a time' for p in decisions}
