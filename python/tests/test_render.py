import json
import shutil
import subprocess
import sys

import pytest

import rhylthyme_timeline as T

PROGRAM = {
    "programId": "p", "name": "Two eggs", "tracks": [
        {"trackId": "a", "name": "Pan", "steps": [
            {"stepId": "s1", "name": "Heat", "task": "pan", "duration": {"type": "fixed", "seconds": 120}, "startTrigger": {"type": "programStart"}},
            {"stepId": "s2", "name": "Fry", "task": "pan", "duration": {"type": "fixed", "seconds": "3m"}, "startTrigger": {"type": "afterStep", "stepId": "s1"}},
        ]}],
    "resourceConstraints": [{"task": "pan", "maxConcurrent": 1}],
}

needs_node = pytest.mark.skipif(not shutil.which("node"), reason="Node.js not installed")


def test_the_javascript_is_packaged():
    assert T.renderer_path().is_file() and T.render_script_path().is_file()
    assert "renderTimelineSvg" in T.renderer_path().read_text()


@needs_node
def test_render_from_python():
    svg = T.render(PROGRAM, style="web")
    assert svg.startswith("<svg") and "Fry" in svg and "Two eggs" in svg


@needs_node
def test_the_command(tmp_path):
    src = tmp_path / "p.json"
    src.write_text(json.dumps(PROGRAM))
    out = tmp_path / "p.svg"
    rc = subprocess.call([sys.executable, "-c", "import sys, rhylthyme_timeline as T; sys.exit(T.main(sys.argv[1:]))", str(src), "-o", str(out), "--style", "web"])
    assert rc == 0 and out.read_text().startswith("<svg")


def test_without_node_the_error_says_so(monkeypatch):
    monkeypatch.delenv("RHYLTHYME_NODE", raising=False)
    monkeypatch.setattr(shutil, "which", lambda name: None)
    with pytest.raises(T.NodeNotFound, match="nodejs.org"):
        T.render(PROGRAM)
    assert T.main(["x.json"]) == 2
