#!/usr/bin/env python3
"""
Regenerate test/fixtures/runs/thanksgiving_one_oven.run.json.

Drives the CLI runner headlessly over the Thanksgiving example with a fake
clock, scripting a plausible cook so that the resulting run record contains
one step that finished EARLY, one that finished exactly ON TIME and a long
tail of LATE steps caused by an indefinite roast that ran over. The record
is the fixture behind:

  * ``rhylthyme-timeline/test/render.test.js`` — planned-vs-actual overlay
  * ``rhylthyme-timeline/test/engine.test.js`` — replay parity (JS)
  * ``rhylthyme-cli-runner/tests/test_replay.py`` — replay parity (Python)

The clock is patched so every number in the record is deterministic: the run
starts at epoch 1700000000 (2023-11-14T22:13:20Z) and advances in fixed
0.25 s program-clock ticks, which bounds the lag between a trigger becoming
satisfiable and the runner observing it to a quarter of a second.

Scripted interventions (what the cook does):

  turkey-prep     ends 200 s early ('c' key)          -> early
  stuffing-prep   left to its timer                   -> on time
  turkey-roast    ended by hand 11400 s in ('t' key)  -> 1500 s over default
  potatoes-boil   ended by hand 950 s in ('t' key)    -> inside min/max
  guests-seated   manual gate, fired 300 s after the turkey comes to rest

Usage (from the monorepo root, using the project virtualenv):

    .venv/bin/python rhylthyme-timeline/tools/gen-run-fixture.py [--check]

``--check`` exits non-zero if the regenerated record differs from the file
on disk instead of rewriting it.
"""

import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
TIMELINE_ROOT = os.path.dirname(HERE)
MONOREPO_ROOT = os.path.dirname(TIMELINE_ROOT)
FIXTURES = os.path.join(TIMELINE_ROOT, "test", "fixtures")
PROGRAM_FILE = os.path.join(FIXTURES, "programs", "thanksgiving_one_oven.json")
OUT_DIR = os.path.join(FIXTURES, "runs")
OUT_FILE = os.path.join(OUT_DIR, "thanksgiving_one_oven.run.json")

# Prefer the source trees so this works without an editable install.
sys.path.insert(0, os.path.join(MONOREPO_ROOT, "src"))
sys.path.insert(0, os.path.join(MONOREPO_ROOT, "rhylthyme-cli-runner", "src"))

START_EPOCH = 1_700_000_000.0
TICK = 0.25
MAX_TICKS = 120_000
RUN_SUFFIX = "beef"

PREP_EARLY_END = 1000.0  # turkey-prep: 'c' at t=1000 (planned 1200)
ROAST_SECONDS = 11400.0  # turkey-roast: 't' 11400 s in (default 9900)
BOIL_SECONDS = 950.0  # potatoes-boil: 't' 950 s in (min 900, max 1500)
GUESTS_DELAY = 300.0  # guests-seated: 300 s after turkey-rest ends


class FakeClock:
    """A monotonic stand-in for ``time.time`` we advance by hand."""

    def __init__(self, now=START_EPOCH):
        self.now = now

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


def simulate(program, clock):
    import rhylthyme_cli_runner.program_runner as program_runner_module
    from rhylthyme_cli_runner.history import RunRecorder
    from rhylthyme_cli_runner.program_runner import ProgramRunner, StepStatus

    runner = ProgramRunner(program, time_scale=1.0)
    recorder = RunRecorder(runner, source_program=program).attach()
    runner.start()
    runner.command_queue.put("start_program")
    runner.update()

    steps = runner.steps
    rest_ended_at = None
    for _ in range(MAX_TICKS):
        clock.advance(TICK)
        runner.update()
        now = runner.current_time

        prep = steps["turkey-prep"]
        if prep.status == StepStatus.RUNNING and now - prep.start_time >= PREP_EARLY_END:
            runner.complete_step(prep, now)  # the 'c' key

        roast = steps["turkey-roast"]
        if roast.status == StepStatus.RUNNING and now - roast.start_time >= ROAST_SECONDS:
            runner._trigger_step(roast)  # the 't' key

        boil = steps["potatoes-boil"]
        if boil.status == StepStatus.RUNNING and now - boil.start_time >= BOIL_SECONDS:
            runner._trigger_step(boil)  # the 't' key

        rest = steps["turkey-rest"]
        if rest_ended_at is None and rest.status == StepStatus.COMPLETED:
            rest_ended_at = rest.end_time
        if (
            rest_ended_at is not None
            and steps["guests-seated"].status == StepStatus.PENDING
            and now >= rest_ended_at + GUESTS_DELAY
        ):
            runner.trigger_manual_step("guests-seated")

        if all(s.status == StepStatus.COMPLETED for s in steps.values()):
            break

    unfinished = {
        k: v.status.value for k, v in steps.items() if v.status != StepStatus.COMPLETED
    }
    if unfinished:
        raise SystemExit(f"run did not complete: {unfinished}")

    recorder._run_suffix = RUN_SUFFIX
    return recorder.build_record()


def main(argv):
    check = "--check" in argv
    with open(PROGRAM_FILE, encoding="utf-8") as fh:
        program = json.load(fh)

    clock = FakeClock()
    real_time = time.time
    time.time = clock  # the runner and the recorder both read time.time
    try:
        record = simulate(program, clock)
    finally:
        time.time = real_time

    from rhylthyme_cli_runner.history import validate_run

    errors = validate_run(record)
    if errors:
        raise SystemExit("record does not validate against the runs schema:\n  " + "\n  ".join(errors))

    text = json.dumps(record, indent=2, ensure_ascii=False) + "\n"
    if check:
        if not os.path.isfile(OUT_FILE):
            print(f"MISSING: {OUT_FILE}")
            return 1
        with open(OUT_FILE, encoding="utf-8") as fh:
            if fh.read() != text:
                print(f"STALE: {OUT_FILE} differs from the regenerated record")
                return 1
        print(f"up to date: {OUT_FILE}")
        return 0

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        fh.write(text)
    print(f"wrote {OUT_FILE} ({len(record['steps'])} steps, outcome {record['outcome']})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
