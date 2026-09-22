"""The Rhylthyme timeline renderer, packaged for pip.

The engine and renderer are JavaScript (``@rhylthyme/timeline``); this
package carries a copy and runs it with Node. Use :func:`renderer_path` to
hand the module to your own Node code, :func:`render` to get an SVG from
Python, or the ``rhylthyme-render`` command for SVG, PNG and PDF files.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

__version__ = "2.0.0b5"

_JS = Path(__file__).resolve().parent / "js"
NODE_ENV = "RHYLTHYME_NODE"


def renderer_path() -> Path:
    """Path of ``index.js``: the UMD module exporting ``renderTimelineSvg``,
    ``computeStepTimings`` and the rest."""
    return _JS / "src" / "index.js"


def render_script_path() -> Path:
    """Path of the ``rhylthyme-render`` command's JavaScript."""
    return _JS / "bin" / "render.js"


def find_node() -> Optional[str]:
    """Node 18 or newer on PATH, or ``$RHYLTHYME_NODE``; None if absent."""
    explicit = os.environ.get(NODE_ENV)
    if explicit:
        return explicit
    return shutil.which("node")


class NodeNotFound(RuntimeError):
    pass


def _node() -> str:
    node = find_node()
    if not node:
        raise NodeNotFound(
            "rhylthyme-timeline renders with Node.js, which is not on PATH. "
            "Install it from https://nodejs.org (18 or newer), or set RHYLTHYME_NODE."
        )
    return node


_RENDER_SNIPPET = """
'use strict';
const fs = require('fs');
const R = require(process.argv[1]);
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const svg = R.renderTimelineSvg(input.program, input.options || {});
process.stdout.write(svg || '');
"""


def render(program: Dict[str, Any], **options: Any) -> str:
    """SVG for a program. ``options`` are ``renderTimelineSvg``'s, e.g.
    ``style="web"``, ``palette="vivid"``, ``colorBy="task"``, ``width=820``."""
    proc = subprocess.run(
        [_node(), "-e", _RENDER_SNIPPET, str(renderer_path())],
        input=json.dumps({"program": program, "options": options}),
        capture_output=True, text=True, check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or f"node exited {proc.returncode}")
    return proc.stdout


def main(argv: Optional[List[str]] = None) -> int:
    """``rhylthyme-render program.json [-o out.svg|png|pdf] [--style web] ...``:
    every option of the JavaScript command; ``--help`` lists them."""
    args = sys.argv[1:] if argv is None else list(argv)
    try:
        node = _node()
    except NodeNotFound as e:
        print(e, file=sys.stderr)
        return 2
    return subprocess.call([node, str(render_script_path()), *args])
