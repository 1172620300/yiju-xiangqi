"""Start the public ECS server directly from Python's scheduled-task process."""

from __future__ import annotations

import os
import runpy
from pathlib import Path


ROOT = Path(__file__).resolve().parent
os.environ["XIANGQI_HOST"] = "0.0.0.0"
os.environ["XIANGQI_PORT"] = "80"
os.environ["XIANGQI_ENGINE_SLOTS"] = "1"
os.environ.pop("XIANGQI_USER", None)
os.environ.pop("XIANGQI_PASSWORD", None)
runpy.run_path(str(ROOT / "server.py"), run_name="__main__")
