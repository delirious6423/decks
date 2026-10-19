"""Run with python3 -m unittest discover -s tests."""
import json
import unittest

from server import merge_saved, patch_saved


class IncrementalStateTests(unittest.TestCase):
    def test_independent_tab_changes_survive_stale_bases(self):
        base = {'s1': ['one'], 's2': ['two'], '__fb': {'s1': 'first', 's2': 'second'}}
        raw = json.dumps(base)
        raw = patch_saved(raw, [{'path': ['s1'], 'hadBase': True, 'base': ['one'], 'value': ['edited']}])
        raw = patch_saved(raw, [{'path': ['s2'], 'hadBase': True, 'base': ['two'], 'value': ['other']},
                                {'path': ['__fb', 's2'], 'hadBase': True, 'base': 'second', 'remove': True}])
        self.assertEqual(json.loads(raw), {'s1': ['edited'], 's2': ['other'], '__fb': {'s1': 'first'}})

    def test_patch_retry_is_idempotent(self):
        ops = [{'path': ['s'], 'hadBase': True, 'base': ['old'], 'value': ['new']}]
        once = patch_saved('{"s":["old"]}', ops)
        self.assertEqual(patch_saved(once, ops), once)

    def test_same_field_last_writer_and_order_are_atomic(self):
        raw = '{"s":["other"],"__order":["b","a"]}'
        raw = patch_saved(raw, [{'path': ['s'], 'hadBase': True, 'base': ['old'], 'value': ['mine']},
                                {'path': ['__order'], 'hadBase': True, 'base': ['a', 'b'], 'value': ['c', 'b', 'a']}])
        self.assertEqual(json.loads(raw), {'s': ['mine'], '__order': ['c', 'b', 'a']})

    def test_legacy_full_state_merge_still_works(self):
        base = {'a': [1], 'b': [2]}
        mine, theirs = {**base, 'a': [3]}, {**base, 'b': [4]}
        self.assertEqual(json.loads(merge_saved(*map(json.dumps, [base, mine, theirs]))), {'a': [3], 'b': [4]})

    def test_invalid_patch_is_rejected(self):
        for ops in [None, {}, [{'path': []}], [{'path': ['__proto__', 'x'], 'value': 1}],
                    [{'path': ['s']}], [{'path': [4], 'value': 1}]]:
            with self.subTest(ops=ops), self.assertRaises(ValueError):
                patch_saved('{}', ops)


if __name__ == '__main__':
    unittest.main()
