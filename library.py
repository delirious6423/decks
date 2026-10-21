"""Read-only serving cache for large, data-only JavaScript slide libraries.

Never executes deck JavaScript. Unsupported expressions stay in the original HTML.
The editable file remains the authority; raw/file:// copies retain all definitions.
"""
import hashlib
import json
import re
import threading
from collections import OrderedDict

_CACHE = OrderedDict()
_LOCK = threading.Lock()
LIMIT = 8
CHUNK = 64
MIN_SLIDES = 256
METADATA = frozenset("cat layout title q panel short n mod alt fac only for in lib copyOf brk v2 prop replaces ext".split())
_TOKEN = re.compile(r'\s+|//[^\n]*|/\*[\s\S]*?\*/|(?P<string>"(?:\\[\s\S]|[^"\\])*"|\'(?:\\[\s\S]|[^\'\\])*\')|(?P<number>-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)|(?P<word>[A-Za-z_$][\w$]*)|(?P<punct>[{}\[\]:,])')


def string_value(raw):
    # Convert JavaScript's single-quoted strings to JSON without interpreting code.
    chars, i = [], 1
    while i < len(raw) - 1:
        c = raw[i]
        if c == '\\':
            i += 1
            c = raw[i]
            if c in "'\"/\\": chars.append(c)
            elif c in 'bfnrt': chars.append(dict(b='\b', f='\f', n='\n', r='\r', t='\t')[c])
            elif c in 'ux':
                n = 4 if c == 'u' else 2
                chars.append(chr(int(raw[i + 1:i + 1 + n], 16))); i += n
            elif c == '\n': pass
            elif c == '\r':
                if raw[i + 1:i + 2] == '\n': i += 1
            else: raise ValueError('unsupported escape')
        else: chars.append(c)
        i += 1
    # JS represents astral characters as surrogate pairs, Python as one code point.
    return ''.join(chars).encode('utf-16', 'surrogatepass').decode('utf-16')


class Literal:
    def __init__(self, source, pos): self.source, self.pos = source, pos
    def token(self):
        while True:
            m = _TOKEN.match(self.source, self.pos)
            if not m: raise ValueError('not a data literal')
            self.pos = m.end()
            if m.lastgroup: return m.lastgroup, m.group()
    def value(self, token=None):
        kind, value = token or self.token()
        if kind == 'string': return string_value(value)
        if kind == 'number': return json.loads(value)
        if kind == 'word' and value in ('true', 'false', 'null'): return json.loads(value)
        if value not in ('{', '['): raise ValueError('expression')
        obj = {} if value == '{' else []; end = '}' if value == '{' else ']'
        token = self.token()
        while token[1] != end:
            if isinstance(obj, dict):
                if token[0] not in ('string', 'word'): raise ValueError('key')
                key = string_value(token[1]) if token[0] == 'string' else token[1]
                if key == '__proto__' or key in obj: raise ValueError('special/duplicate key')
                if self.token()[1] != ':': raise ValueError('colon')
                obj[key] = self.value()
            else: obj.append(self.value(token))
            token = self.token()
            if token[1] == end: break
            if token[1] != ',': raise ValueError('comma')
            token = self.token()
        return obj


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).replace('</', '<\\/')


def plain_object(value):
    # Object literals give __proto__ special semantics at every nesting level.
    # JSON.parse would produce an ordinary property instead: keep these embedded.
    if '__proto__' in value: raise ValueError('prototype literal')
    return value


def split(source):
    """Return (served HTML, content-addressed JSON chunks), conservatively."""
    if '// SB_LIBRARY_LOADER' not in source: return source, {}
    edits, chunks, numbers = [], {}, {}
    for match in re.finditer(r'(?m)^[ \t]*(?:const\s+LIBRARY\s*=\s*|Object\.assign\(LIBRARY\s*,\s*)(?=\{)', source):
        try:
            reader = Literal(source, match.end())
            try: library, reader.pos = json.JSONDecoder(object_hook=plain_object).raw_decode(source, match.end())
            except json.JSONDecodeError: library = reader.value()
            if not isinstance(library, dict) or len(library) < MIN_SLIDES: continue
            if '__proto__' in library or any(not isinstance(v, dict) or '__sbChunk' in v or '__proto__' in v for v in library.values()): continue
            entries = list(library.items()); index = {}
            for at in range(0, len(entries), CHUNK):
                group = dict(entries[at:at + CHUNK])
                payload = compact(group)
                digest = hashlib.sha256(payload.encode()).hexdigest()
                if at:
                    chunks[digest] = payload
                    number = numbers.setdefault(digest, len(numbers) + 1)
                for id, value in group.items():
                    # Keep the search/version index and copyable basic layouts.
                    # Repeated hashes and large note/image strings stay out of it.
                    index[id] = value if not at or value.get('lib') else {**{k: v for k, v in value.items() if k in METADATA}, '__sbChunk': number}
            # JSON.parse avoids compiling thousands of JS object expressions.
            manifest = {number: digest for digest, number in numbers.items()}
            replacement = '(Object.assign(window.__SB_LIBRARY_CHUNKS ||= {},' + compact(manifest) + '),JSON.parse(' + compact(compact(index)) + '))'
            edits.append((match.end(), reader.pos, replacement))
        except (ValueError, RecursionError, UnicodeError, OverflowError):
            continue   # hand-written functions, spread, references: serve unchanged
    for start, end, replacement in reversed(edits): source = source[:start] + replacement + source[end:]
    return source, chunks


def prepare(path):
    """Cache is bounded and invalidated by atomic replacement or in-place writes."""
    stat = path.stat(); key = (str(path), stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
    with _LOCK:
        if key in _CACHE:
            _CACHE.move_to_end(key); return _CACHE[key]
        result = split(path.read_text(encoding='utf-8'))
        # Remove old revisions; a stale page gets an explicit 409 instead of mixed data.
        for old in list(_CACHE):
            if old[0] == str(path): del _CACHE[old]
        _CACHE[key] = result
        while len(_CACHE) > LIMIT: _CACHE.popitem(last=False)
        return result
