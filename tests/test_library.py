import concurrent.futures
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import library


def source(data):
    return '// SB_LIBRARY_LOADER\nconst LIBRARY = ' + json.dumps(data, ensure_ascii=False) + ';\n'


def data():
    return {f's{i}': {'cat': 'main', 'layout': 'plain', 'title': f'Title {i}', 'body': ['Evidence'], 'notes': 'Note'} for i in range(500)}


class LibraryTests(unittest.TestCase):
    def test_chunk_roundtrip_and_initial_group(self):
        original = data(); html, chunks = library.split(source(original))
        self.assertEqual(len(chunks), 7)
        encoded = html.split('JSON.parse(', 1)[1].rsplit('));', 1)[0]
        index = json.loads(json.loads(encoded))
        self.assertEqual(index['s0'], original['s0'])
        self.assertNotIn('body', index['s499'])
        self.assertEqual(index['s499']['title'], 'Title 499')
        rebuilt = dict(index)
        for payload in chunks.values(): rebuilt.update(json.loads(payload))
        self.assertEqual(rebuilt, original)

    def test_handwritten_literal_comments_trailing_commas_and_unicode(self):
        entries = ','.join("'s%d': {cat:'main', layout:'plain', title:'Bob\\'s \\uD83D\\uDE80', body:['</script>',],}," % i for i in range(500)).replace(',,', ',')
        html, chunks = library.split('// SB_LIBRARY_LOADER\nconst LIBRARY = {/* comment */' + entries + '};')
        self.assertEqual(len(chunks), 7)
        self.assertTrue(all('</script>' not in p for p in chunks.values()))
        self.assertEqual(json.loads(next(iter(chunks.values())))['s64']['title'], "Bob's 🚀")

    def test_unsupported_expressions_unchanged(self):
        for expression in ('factory()', '...other', '`template ${x}`', 'undefined', '/regex/', 'new Thing()'):
            text = source(data()).replace('"s0": {', '"s0": {"dynamic": ' + expression + ', ', 1)
            self.assertEqual(library.split(text), (text, {}))

    def test_small_and_legacy_files_unchanged(self):
        for text in (source({'a': {'title': 'Small'}}), source(data()).replace('// SB_LIBRARY_LOADER', '')):
            self.assertEqual(library.split(text), (text, {}))

    def test_assignments_and_order(self):
        text = '// SB_LIBRARY_LOADER\nconst LIBRARY = {};\nObject.assign(LIBRARY,' + json.dumps(data()) + ');\nconst PITCHES = {};'
        html, chunks = library.split(text)
        self.assertEqual(len(chunks), 7)
        self.assertIn('Object.assign(LIBRARY,(Object.assign(window.__SB_LIBRARY_CHUNKS', html)
        self.assertTrue(html.endswith('const PITCHES = {};'))

    def test_cache_invalidates_same_size_rewrite_and_atomic_replace(self):
        with tempfile.TemporaryDirectory() as root:
            p = Path(root) / 'deck.html'; p.write_text(source(data()))
            before = library.prepare(p)
            self.assertIs(before, library.prepare(p))
            stamp = p.stat().st_mtime_ns
            p.write_text(p.read_text().replace('Evidence', 'New body'))
            os.utime(p, ns=(stamp, stamp))
            self.assertNotEqual(before, library.prepare(p))
            other = Path(root) / 'other'; other.write_text(source(data())); other.replace(p)
            self.assertEqual(before, library.prepare(p))

    def test_cache_bounded_and_concurrent(self):
        with tempfile.TemporaryDirectory() as root:
            paths = [Path(root) / f'{i}.html' for i in range(library.LIMIT + 3)]
            for p in paths: p.write_text(source(data()))
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                for html, chunks in pool.map(library.prepare, paths): self.assertEqual(len(chunks), 7)
            self.assertLessEqual(len(library._CACHE), library.LIMIT)

    def test_reserved_markers_preserve_source(self):
        for change in ({'__proto__': {}}, {'s0': {'__sbChunk': 'mine'}}, {'s0': {'body': [{'__proto__': {'title': 'inherited'}}]}}):
            text = source({**data(), **change}); self.assertEqual(library.split(text), (text, {}))


if __name__ == '__main__': unittest.main()
