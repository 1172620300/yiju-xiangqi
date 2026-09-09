"""Run one Pikafish job outside the long-lived HTTP server process."""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

import server


def append_result(path: Path, payload: dict) -> None:
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(payload, ensure_ascii=False) + "\n")
        stream.flush()


def analyze(engine: str, request: dict, result_path: Path) -> None:
    fen = str(request["fen"])
    side = "red" if " w " in f" {fen} " else "black"
    max_depth = max(6, min(int(request.get("depth", 16)), 22))
    allowed = [str(move) for move in request.get("allowedMoves", []) if move]
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    process = subprocess.Popen(
        [engine], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL, cwd=str(server.ROOT), text=True,
        encoding="utf-8", errors="replace", creationflags=flags,
    )
    assert process.stdin and process.stdout
    lines = server.engine_output_queue(process)
    try:
        process.stdin.write("uci\n")
        process.stdin.flush()
        server.wait_for_engine(lines, "uciok", 8)
        process.stdin.write("setoption name UCI_ShowWDL value true\n")
        nnue = server.ROOT / "pikafish.nnue"
        if nnue.is_file():
            process.stdin.write(f"setoption name EvalFile value {nnue}\n")
        process.stdin.write("isready\n")
        process.stdin.flush()
        server.wait_for_engine(lines, "readyok", 12)
        process.stdin.write(f"position fen {fen}\n")
        command = f"go depth {max_depth} movetime 5000"
        if allowed:
            command += " searchmoves " + " ".join(allowed)
        process.stdin.write(command + "\n")
        process.stdin.flush()
        last_depth = -1
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            line = server.next_engine_line(lines, max(0.1, deadline - time.monotonic()))
            if line.startswith("bestmove "):
                append_result(result_path, {"done": True, "bestMove": line.split()[1], "limited": last_depth < max_depth})
                return
            update = server.parse_analysis_line(line, side)
            if update and update["depth"] > last_depth:
                last_depth = update["depth"]
                append_result(result_path, update)
        raise RuntimeError("Pikafish 分析超时")
    finally:
        try:
            process.stdin.write("quit\n")
            process.stdin.flush()
        except (BrokenPipeError, OSError):
            pass
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            process.kill()


def main() -> None:
    request_path = Path(sys.argv[1])
    result_path = Path(sys.argv[2])
    request = json.loads(request_path.read_text(encoding="utf-8"))
    engine = server.find_engine()
    if not engine:
        raise RuntimeError("Pikafish 未连接")
    if request.get("action") == "move":
        move = server.pikafish_move(
            engine, str(request["fen"]), int(request.get("depth", 8)),
            [str(move) for move in request.get("allowedMoves", [])],
        )
        append_result(result_path, {"move": move, "source": "pikafish"})
    elif request.get("action") == "analyze":
        started = time.monotonic()
        try:
            analyze(engine, request, result_path)
        except RuntimeError as exc:
            # Retry only an early startup failure, before any estimate was emitted.
            if time.monotonic() - started >= 12 or (result_path.exists() and result_path.stat().st_size):
                raise
            server.log_engine_failure("analysis-start-retry", exc)
            time.sleep(0.25)
            analyze(engine, request, result_path)
    else:
        raise ValueError("未知引擎任务")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        append_result(Path(sys.argv[2]), {"done": True, "error": str(exc)})
        raise
