# Lexical regressions

Run `python -m unittest discover -s tests -v` from the repository root with Python 3.12. No third-party libraries, dictionaries, or model files are required.

- `test_bktree.py` compares BK-tree results with exhaustive edit-distance results for the existing Burmese query fixtures.
- `test_lmbrain_bktree.py` checks that `AdvancedSegmenter` builds its index and ranks the expected spelling suggestions first.

Assertions produce a failing process status. Timing measurements are not used as correctness gates. CI also checks Python formatting, undefined names, and authored JavaScript syntax. Neural parsing and full document integration require external resources.
