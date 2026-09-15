#!/usr/bin/env python3
"""
Regenerate test/fixtures/python-timings.json from the Python reference resolver.

For every program in test/fixtures/programs/*.json this runs the root
``rhylthyme`` package's ``expand_replicates`` followed by
``calculate_step_start_time`` (the same pass ``validate_program_file`` uses)
and records ``{stepId: {start, end}}`` in seconds from program start, in
expanded track/step order. ``engine.test.js`` compares the JS engine against
this file with a 0.5 s tolerance.

Usage (from the monorepo root, using the project virtualenv):

    .venv/bin/python rhylthyme-timeline/tools/gen-python-timings.py [--check]

``--check`` exits non-zero if the regenerated content differs from the file
on disk instead of rewriting it.
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TIMELINE_ROOT = os.path.dirname(HERE)
MONOREPO_ROOT = os.path.dirname(TIMELINE_ROOT)
FIXTURES = os.path.join(TIMELINE_ROOT, "test", "fixtures")
PROGRAMS_DIR = os.path.join(FIXTURES, "programs")
OUT_FILE = os.path.join(FIXTURES, "python-timings.json")

# Prefer the root package's source tree so this works without an editable
# install, but fall back to whatever ``rhylthyme`` is importable.
sys.path.insert(0, os.path.join(MONOREPO_ROOT, "src"))

from rhylthyme.expand_replicates import expand_replicates  # noqa: E402
from rhylthyme.validate_program import (  # noqa: E402
    calculate_step_start_time,
    parse_duration_to_seconds,
)

GENERATED_BY = (
    "rhylthyme.validate_program (Python) after expand_replicates; "
    "regenerate with rhylthyme-timeline/tools/gen-python-timings.py"
)


def timings_for(program):
    program = expand_replicates(program)
    out = {}
    for track in program.get("tracks", []):
        steps = track.get("steps", [])
        for step in steps:
            start = calculate_step_start_time(step, steps, program)
            duration = parse_duration_to_seconds(step.get("duration", "0s"))
            out[step["stepId"]] = {"start": start, "end": start + duration}
    return out


def main(argv):
    check = "--check" in argv
    programs = {}
    for name in sorted(os.listdir(PROGRAMS_DIR)):
        if not name.endswith(".json"):
            continue
        with open(os.path.join(PROGRAMS_DIR, name)) as fh:
            program = json.load(fh)
        programs[name] = timings_for(program)
    doc = {"generatedBy": GENERATED_BY, "programs": programs}
    text = json.dumps(doc, indent=1) + "\n"

    if check:
        with open(OUT_FILE) as fh:
            current = json.load(fh)
        if current.get("programs") != programs:
            print("python-timings.json is out of date; rerun without --check", file=sys.stderr)
            return 1
        print(f"python-timings.json up to date ({len(programs)} programs)")
        return 0

    with open(OUT_FILE, "w") as fh:
        fh.write(text)
    total = sum(len(p) for p in programs.values())
    print(f"wrote {OUT_FILE}: {len(programs)} programs, {total} steps")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
