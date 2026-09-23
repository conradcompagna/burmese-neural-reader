"""Compatibility runner for the maintained lexical regressions in tests/."""
from pathlib import Path
import subprocess
import sys

if __name__ == "__main__":
    root = Path(__file__).resolve().parents[3]
    raise SystemExit(subprocess.call([sys.executable, "-m", "pytest", "tests/test_lexical_search.py"], cwd=root))
