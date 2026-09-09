from __future__ import annotations

import json
import os
import random
import re
import queue
import base64
import hashlib
import hmac
import html
import secrets
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "yiju-users.db"
HOST = os.environ.get("XIANGQI_HOST", "127.0.0.1")
PORT = int(os.environ.get("XIANGQI_PORT", "8765"))
ACCESS_USER = os.environ.get("XIANGQI_USER", "")
ACCESS_PASSWORD = os.environ.get("XIANGQI_PASSWORD", "")
SESSION_TOKEN = hmac.new(
    ACCESS_PASSWORD.encode("utf-8"), b"yiju-xiangqi-session-v1", "sha256"
).hexdigest() if ACCESS_PASSWORD else ""
ENGINE_SLOTS = threading.BoundedSemaphore(max(1, int(os.environ.get("XIANGQI_ENGINE_SLOTS", "2"))))
ENGINE_PRIORITY_LOCK = threading.Lock()
ENGINE_MOVE_REQUESTS = 0
RATE_LOCK = threading.Lock()
RATE_BUCKETS: dict[str, list[float]] = {}
ENGINE_HEALTH_LOCK = threading.Lock()
ENGINE_HEALTH_CHECK_LOCK = threading.Lock()
ENGINE_LOG_LOCK = threading.Lock()
ENGINE_HEALTH: dict[str, object] = {"engine": "fallback", "healthy": False, "checked_at": 0.0}
MAX_JSON_BYTES = 16 * 1024
STATIC_PATHS = {"/", "/index.html", "/styles.css", "/app.js", "/rules-core.js", "/piece-glyphs.png", "/favicon.ico"}


def init_auth_db() -> None:
    with sqlite3.connect(DB_PATH, timeout=10) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("""CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL COLLATE NOCASE UNIQUE,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )""")
        db.execute("""CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at INTEGER NOT NULL
        )""")
        db.execute("CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at)")
        db.execute("""CREATE TABLE IF NOT EXISTS rooms (
            code TEXT PRIMARY KEY,
            red_user_id INTEGER NOT NULL REFERENCES users(id),
            black_user_id INTEGER REFERENCES users(id),
            moves_json TEXT NOT NULL DEFAULT '[]',
            turn TEXT NOT NULL DEFAULT 'red',
            status TEXT NOT NULL DEFAULT 'waiting',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )""")
        db.execute("CREATE INDEX IF NOT EXISTS rooms_updated ON rooms(updated_at)")


def password_digest(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310_000).hex()


def valid_username(username: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9_\u4e00-\u9fff]{3,20}", username))


ONLINE_START = [list(row) for row in (
    "rnbakabnr", ".........", ".c.....c.", "p.p.p.p.p", ".........",
    ".........", "P.P.P.P.P", ".C.....C.", ".........", "RNBAKABNR",
)]
ONLINE_FILES = "abcdefghi"


def board_side(piece: str) -> str | None:
    return None if piece == "." else ("red" if piece.isupper() else "black")


def board_inside(row: int, col: int) -> bool:
    return 0 <= row < 10 and 0 <= col < 9


def board_palace(side: str, row: int, col: int) -> bool:
    return 3 <= col <= 5 and (7 <= row <= 9 if side == "red" else 0 <= row <= 2)


def board_pseudo_moves(board: list[list[str]], row: int, col: int) -> list[tuple[int, int]]:
    piece = board[row][col]
    side = board_side(piece)
    kind = piece.lower()
    moves: list[tuple[int, int]] = []

    def add(target_row: int, target_col: int) -> None:
        if board_inside(target_row, target_col) and (board[target_row][target_col] == "." or board_side(board[target_row][target_col]) != side):
            moves.append((target_row, target_col))

    if kind == "k":
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if board_palace(str(side), row + dr, col + dc): add(row + dr, col + dc)
        for dr in (-1, 1):
            rr = row + dr
            while board_inside(rr, col) and board[rr][col] == ".": rr += dr
            if board_inside(rr, col) and board[rr][col].lower() == "k": add(rr, col)
    elif kind == "a":
        for dr, dc in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
            if board_palace(str(side), row + dr, col + dc): add(row + dr, col + dc)
    elif kind == "b":
        for dr, dc in ((2, 2), (2, -2), (-2, 2), (-2, -2)):
            rr, cc = row + dr, col + dc
            crossed = rr < 5 if side == "red" else rr > 4
            if not crossed and board_inside(rr, cc) and board[row + dr // 2][col + dc // 2] == ".": add(rr, cc)
    elif kind == "n":
        for dr, dc, lr, lc in ((2,1,1,0),(2,-1,1,0),(-2,1,-1,0),(-2,-1,-1,0),(1,2,0,1),(-1,2,0,1),(1,-2,0,-1),(-1,-2,0,-1)):
            if board_inside(row + lr, col + lc) and board[row + lr][col + lc] == ".": add(row + dr, col + dc)
    elif kind in {"r", "c"}:
        for dr, dc in ((1,0),(-1,0),(0,1),(0,-1)):
            rr, cc, screen = row + dr, col + dc, False
            while board_inside(rr, cc):
                target = board[rr][cc]
                if kind == "r":
                    if target == ".": moves.append((rr, cc))
                    else:
                        if board_side(target) != side: moves.append((rr, cc))
                        break
                elif not screen:
                    if target == ".": moves.append((rr, cc))
                    else: screen = True
                elif target != ".":
                    if board_side(target) != side: moves.append((rr, cc))
                    break
                rr, cc = rr + dr, cc + dc
    elif kind == "p":
        dr = -1 if side == "red" else 1
        add(row + dr, col)
        crossed = row <= 4 if side == "red" else row >= 5
        if crossed:
            add(row, col - 1); add(row, col + 1)
    return moves


def board_in_check(board: list[list[str]], side: str) -> bool:
    king = next(((r, c) for r in range(10) for c in range(9) if board[r][c].lower() == "k" and board_side(board[r][c]) == side), None)
    if king is None: return True
    enemy = "black" if side == "red" else "red"
    return any(king in board_pseudo_moves(board, r, c) for r in range(10) for c in range(9) if board_side(board[r][c]) == enemy)


def board_key(board: list[list[str]], turn: str) -> str:
    return "/".join("".join(row) for row in board) + " " + turn


def validate_online_move(existing_moves: list[str], candidate: str) -> str | None:
    board = [row[:] for row in ONLINE_START]
    turn = "red"
    keys = [board_key(board, turn)]
    for move in [*existing_moves, candidate]:
        from_col, from_row = ONLINE_FILES.index(move[0]), 9 - int(move[1])
        to_col, to_row = ONLINE_FILES.index(move[2]), 9 - int(move[3])
        piece = board[from_row][from_col]
        if piece == "." or board_side(piece) != turn:
            return "该位置没有可走的棋子"
        if (to_row, to_col) not in board_pseudo_moves(board, from_row, from_col):
            return "这不是合法走法"
        test = [row[:] for row in board]
        test[to_row][to_col], test[from_row][from_col] = piece, "."
        if board_in_check(test, turn):
            return "该走法会导致己方被将军"
        next_turn = "black" if turn == "red" else "red"
        key = board_key(test, next_turn)
        occurrences = keys.count(key)
        if move == candidate and ((board_in_check(test, next_turn) and occurrences >= 1) or occurrences >= 2):
            return "禁止重复将军或三次重复局面"
        board, turn = test, next_turn
        keys.append(key)
    return None


def api_rate_allowed(client: str, limit: int = 45, window: int = 60) -> bool:
    now = time.time()
    with RATE_LOCK:
        recent = [stamp for stamp in RATE_BUCKETS.get(client, []) if stamp > now - window]
        if len(recent) >= limit:
            RATE_BUCKETS[client] = recent
            return False
        recent.append(now)
        RATE_BUCKETS[client] = recent
        return True


def find_engine() -> str | None:
    candidates = [
        ROOT / "pikafish.exe",
        ROOT / "engine" / "pikafish.exe",
        ROOT / "pikafish",
        ROOT / "engine" / "pikafish",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return shutil.which("pikafish")


def engine_output_queue(process: subprocess.Popen[str]) -> queue.Queue[str | None]:
    lines: queue.Queue[str | None] = queue.Queue()

    def read_output() -> None:
        assert process.stdout
        pending = b""
        try:
            while True:
                chunk = os.read(process.stdout.fileno(), 4096)
                if not chunk:
                    break
                pending += chunk
                while b"\n" in pending:
                    raw_line, pending = pending.split(b"\n", 1)
                    lines.put(raw_line.decode("utf-8", errors="replace").strip())
            if pending:
                lines.put(pending.decode("utf-8", errors="replace").strip())
        finally:
            lines.put(None)

    threading.Thread(target=read_output, daemon=True).start()
    return lines


def next_engine_line(lines: queue.Queue[str | None], timeout: float) -> str:
    try:
        line = lines.get(timeout=timeout)
    except queue.Empty as exc:
        raise RuntimeError("Pikafish 响应超时") from exc
    if line is None:
        raise RuntimeError("Pikafish 意外退出")
    return line


def wait_for_engine(lines: queue.Queue[str | None], marker: str, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        line = next_engine_line(lines, max(0.1, deadline - time.monotonic()))
        if line == marker:
            return
    raise RuntimeError(f"Pikafish 未返回 {marker}")


def pikafish_move(engine: str, fen: str, depth: int, allowed_moves: list[str] | None = None) -> str:
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    process = subprocess.Popen(
        [engine],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        cwd=str(ROOT),
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=flags,
    )
    assert process.stdin and process.stdout
    lines = engine_output_queue(process)
    try:
        process.stdin.write("uci\n")
        process.stdin.flush()
        wait_for_engine(lines, "uciok", 8)
        nnue = ROOT / "pikafish.nnue"
        if nnue.is_file():
            process.stdin.write(f"setoption name EvalFile value {nnue}\n")
        process.stdin.write("isready\n")
        process.stdin.flush()
        wait_for_engine(lines, "readyok", 12)
        process.stdin.write(f"position fen {fen}\n")
        command = f"go depth {max(1, min(depth, 20))}"
        if allowed_moves:
            command += " searchmoves " + " ".join(allowed_moves)
        process.stdin.write(command + "\n")
        process.stdin.flush()
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            line = next_engine_line(lines, max(0.1, deadline - time.monotonic()))
            if line.startswith("bestmove "):
                move = line.split()[1]
                if move not in {"(none)", "0000"}:
                    return move
                break
        raise RuntimeError("引擎没有返回可用走法")
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


def start_engine_worker(payload: dict) -> tuple[subprocess.Popen[bytes], Path, Path]:
    jobs = ROOT / "engine-jobs"
    jobs.mkdir(exist_ok=True)
    job_id = secrets.token_hex(12)
    request_path = jobs / f"{job_id}.request.json"
    result_path = jobs / f"{job_id}.result.ndjson"
    request_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    process = subprocess.Popen(
        [sys.executable, str(ROOT / "engine_worker.py"), str(request_path), str(result_path)],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        cwd=str(ROOT), creationflags=flags,
    )
    return process, request_path, result_path


def cleanup_engine_job(process: subprocess.Popen[bytes], *paths: Path) -> None:
    if process.poll() is None:
        # Cancelling the worker alone leaves its Pikafish child running on Windows.
        if os.name == "nt":
            try:
                subprocess.run(
                    ["taskkill.exe", "/PID", str(process.pid), "/T", "/F"],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    creationflags=subprocess.CREATE_NO_WINDOW, timeout=10,
                )
            except (OSError, subprocess.TimeoutExpired) as exc:
                log_engine_failure("cleanup", exc)
        if process.poll() is None:
            process.kill()
    process.wait()
    for path in paths:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass


def worker_move(fen: str, depth: int, allowed_moves: list[str]) -> str:
    process, request_path, result_path = start_engine_worker({
        "action": "move", "fen": fen, "depth": depth, "allowedMoves": allowed_moves,
    })
    deadline = time.monotonic() + 30
    try:
        while time.monotonic() < deadline:
            if result_path.is_file() and result_path.stat().st_size:
                payload = json.loads(result_path.read_text(encoding="utf-8").splitlines()[-1])
                if payload.get("move"):
                    return str(payload["move"])
                if payload.get("error"):
                    raise RuntimeError(str(payload["error"]))
            if process.poll() is not None:
                raise RuntimeError("Pikafish 工作进程异常退出")
            time.sleep(0.05)
        raise RuntimeError("Pikafish 工作进程超时")
    finally:
        cleanup_engine_job(process, request_path, result_path)


def mark_engine_health(healthy: bool) -> None:
    with ENGINE_HEALTH_LOCK:
        ENGINE_HEALTH.update({
            "engine": "pikafish" if healthy else "fallback",
            "healthy": healthy,
            "checked_at": time.time(),
        })


def log_engine_failure(context: str, exc: BaseException) -> None:
    log_path = ROOT / "engine-errors.log"
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {context}: {type(exc).__name__}: {exc}\n"
    with ENGINE_LOG_LOCK:
        try:
            if log_path.exists() and log_path.stat().st_size > 64 * 1024:
                log_path.replace(ROOT / "engine-errors.log.1")
            with log_path.open("a", encoding="utf-8") as stream:
                stream.write(line)
        except OSError:
            pass


def acquire_analysis_slot() -> bool:
    with ENGINE_PRIORITY_LOCK:
        return ENGINE_MOVE_REQUESTS == 0 and ENGINE_SLOTS.acquire(blocking=False)


def acquire_move_slot(timeout: float = 15) -> bool:
    global ENGINE_MOVE_REQUESTS
    with ENGINE_PRIORITY_LOCK:
        ENGINE_MOVE_REQUESTS += 1
    acquired = False
    try:
        acquired = ENGINE_SLOTS.acquire(timeout=timeout)
        return acquired
    finally:
        if not acquired:
            with ENGINE_PRIORITY_LOCK:
                ENGINE_MOVE_REQUESTS -= 1


def release_move_slot() -> None:
    global ENGINE_MOVE_REQUESTS
    with ENGINE_PRIORITY_LOCK:
        ENGINE_SLOTS.release()
        ENGINE_MOVE_REQUESTS -= 1


def move_requested() -> bool:
    with ENGINE_PRIORITY_LOCK:
        return ENGINE_MOVE_REQUESTS > 0


def cached_engine_health(max_age: int = 30, cached_only: bool = False) -> dict[str, object]:
    now = time.time()
    with ENGINE_HEALTH_LOCK:
        cached = dict(ENGINE_HEALTH)
    if now - float(cached["checked_at"]) <= max_age:
        return cached

    engine = find_engine()
    if not engine:
        mark_engine_health(False)
        with ENGINE_HEALTH_LOCK:
            return dict(ENGINE_HEALTH)

    if cached_only:
        return {"engine": "pikafish", "healthy": None, "checked_at": cached["checked_at"]}

    if not ENGINE_HEALTH_CHECK_LOCK.acquire(blocking=False):
        return {"engine": "pikafish", "healthy": None, "checked_at": cached["checked_at"]}
    try:
        if not acquire_analysis_slot():
            return {"engine": "pikafish", "healthy": None, "checked_at": cached["checked_at"]}
        try:
            test_fen = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/P8/2P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 1"
            healthy = worker_move(test_fen, 1, ["a6a5"]) == "a6a5"
            mark_engine_health(healthy)
        except (OSError, RuntimeError) as exc:
            log_engine_failure("health", exc)
            mark_engine_health(False)
        finally:
            ENGINE_SLOTS.release()
        with ENGINE_HEALTH_LOCK:
            return dict(ENGINE_HEALTH)
    finally:
        ENGINE_HEALTH_CHECK_LOCK.release()


def parse_analysis_line(line: str, side: str) -> dict | None:
    if not line.startswith("info ") or " depth " not in f" {line} ":
        return None
    depth_match = re.search(r"\bdepth (\d+)", line)
    score_match = re.search(r"\bscore (cp|mate) (-?\d+)", line)
    wdl_match = re.search(r"\bwdl (\d+) (\d+) (\d+)", line)
    pv_match = re.search(r"\bpv ([a-i][0-9][a-i][0-9](?:\s+[a-i][0-9][a-i][0-9])*)", line)
    if not depth_match or not score_match:
        return None

    score_type, score_value = score_match.group(1), int(score_match.group(2))
    if wdl_match:
        win, draw, loss = map(int, wdl_match.groups())
    elif score_type == "mate":
        win, draw, loss = (1000, 0, 0) if score_value > 0 else (0, 0, 1000)
    else:
        # Fallback for engines that omit WDL: convert centipawns to an expected score.
        expected = 1 / (1 + 10 ** (-score_value / 600))
        draw = max(0, round(260 * (1 - min(abs(score_value) / 700, 1))))
        win = round((1000 - draw) * expected)
        loss = 1000 - draw - win

    if side == "red":
        red, black = win, loss
    else:
        red, black = loss, win
    return {
        "depth": int(depth_match.group(1)),
        "red": red / 10,
        "draw": draw / 10,
        "black": black / 10,
        "scoreType": score_type,
        "score": score_value,
        "bestMove": pv_match.group(1).split()[0] if pv_match else None,
    }


PIECE_VALUES = {"k": 10000, "r": 900, "c": 450, "n": 400, "b": 220, "a": 220, "p": 100}


def fallback_move(moves: list[dict]) -> str:
    if not moves:
        raise RuntimeError("没有合法走法")
    best_score = -10**9
    choices: list[str] = []
    for item in moves:
        captured = str(item.get("captured", "")).lower()
        score = PIECE_VALUES.get(captured, 0) + random.randint(0, 35)
        # Prefer central activity a little so the fallback does not look entirely random.
        target_file = int(item.get("to", {}).get("c", 4))
        score += 4 - abs(4 - target_file)
        move = str(item.get("uci", ""))
        if not move:
            continue
        if score > best_score:
            best_score, choices = score, [move]
        elif score == best_score:
            choices.append(move)
    if not choices:
        raise RuntimeError("走法数据无效")
    return random.choice(choices)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def end_headers(self) -> None:
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
            "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        )
        super().end_headers()

    def send_json(self, payload: dict, status: int = 200, headers: dict[str, str] | None = None) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(data)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length < 0 or length > MAX_JSON_BYTES:
            raise ValueError("请求内容过大")
        payload = json.loads(self.rfile.read(length) or b"{}")
        return payload if isinstance(payload, dict) else {}

    def auth_user(self) -> dict | None:
        supplied = ""
        for item in self.headers.get("Cookie", "").split(";"):
            name, separator, value = item.strip().partition("=")
            if separator and name == "yiju_auth":
                supplied = value
                break
        if not supplied:
            return None
        token_hash = hashlib.sha256(supplied.encode("ascii", errors="ignore")).hexdigest()
        now = int(time.time())
        with sqlite3.connect(DB_PATH, timeout=10) as db:
            row = db.execute(
                """SELECT users.id, users.username FROM sessions
                   JOIN users ON users.id=sessions.user_id
                   WHERE sessions.token_hash=? AND sessions.expires_at>?""",
                (token_hash, now),
            ).fetchone()
        return {"id": row[0], "username": row[1]} if row else None

    def create_auth_session(self, user_id: int) -> str:
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
        expires_at = int(time.time()) + 7 * 24 * 60 * 60
        with sqlite3.connect(DB_PATH, timeout=10) as db:
            db.execute("DELETE FROM sessions WHERE expires_at<=?", (int(time.time()),))
            db.execute(
                "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",
                (token_hash, user_id, expires_at),
            )
        return token

    def cookie_secure_attribute(self) -> str:
        forwarded_proto = self.headers.get("X-Forwarded-Proto", "").split(",", 1)[0].strip().lower()
        return "; Secure" if forwarded_proto == "https" else ""

    def handle_auth_post(self, path: str) -> None:
        client_key = "auth:" + self.client_address[0]
        if not api_rate_allowed(client_key, limit=12, window=60):
            self.send_json({"error": "操作过于频繁，请稍后再试"}, 429)
            return
        if path == "/api/auth/logout":
            user_cookie = ""
            for item in self.headers.get("Cookie", "").split(";"):
                name, separator, value = item.strip().partition("=")
                if separator and name == "yiju_auth":
                    user_cookie = value
                    break
            if user_cookie:
                token_hash = hashlib.sha256(user_cookie.encode("ascii", errors="ignore")).hexdigest()
                with sqlite3.connect(DB_PATH, timeout=10) as db:
                    db.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash,))
            self.send_json(
                {"ok": True},
                headers={"Set-Cookie": f"yiju_auth=; Path=/; HttpOnly{self.cookie_secure_attribute()}; SameSite=Lax; Max-Age=0"},
            )
            return
        try:
            body = self.read_json()
        except (ValueError, json.JSONDecodeError):
            self.send_json({"error": "提交的数据格式不正确"}, 400)
            return
        username = str(body.get("username", "")).strip()
        password = str(body.get("password", ""))
        if path == "/api/auth/register":
            if not valid_username(username):
                self.send_json({"error": "用户名需为3至20位中文、字母、数字或下划线"}, 400)
                return
            if not 6 <= len(password) <= 72:
                self.send_json({"error": "密码需为6至72位"}, 400)
                return
            salt = secrets.token_bytes(16)
            try:
                with sqlite3.connect(DB_PATH, timeout=10) as db:
                    cursor = db.execute(
                        "INSERT INTO users(username,password_hash,salt,created_at) VALUES(?,?,?,?)",
                        (username, password_digest(password, salt), salt.hex(), int(time.time())),
                    )
                    user_id = int(cursor.lastrowid)
            except sqlite3.IntegrityError:
                self.send_json({"error": "该用户名已被使用"}, 409)
                return
        elif path == "/api/auth/login":
            with sqlite3.connect(DB_PATH, timeout=10) as db:
                row = db.execute(
                    "SELECT id,username,password_hash,salt FROM users WHERE username=?",
                    (username,),
                ).fetchone()
            if not row or not hmac.compare_digest(row[2], password_digest(password, bytes.fromhex(row[3]))):
                self.send_json({"error": "用户名或密码不正确"}, 401)
                return
            user_id, username = int(row[0]), str(row[1])
        else:
            self.send_json({"error": "Not found"}, 404)
            return
        token = self.create_auth_session(user_id)
        self.send_json(
            {"user": {"id": user_id, "username": username}},
            headers={"Set-Cookie": f"yiju_auth={token}; Path=/; HttpOnly{self.cookie_secure_attribute()}; SameSite=Lax; Max-Age=604800"},
        )

    def room_payload(self, db: sqlite3.Connection, code: str, user_id: int) -> dict | None:
        row = db.execute(
            """SELECT rooms.code,rooms.red_user_id,rooms.black_user_id,rooms.moves_json,
                      rooms.turn,rooms.status,red.username,black.username,rooms.updated_at
               FROM rooms
               JOIN users AS red ON red.id=rooms.red_user_id
               LEFT JOIN users AS black ON black.id=rooms.black_user_id
               WHERE rooms.code=?""",
            (code,),
        ).fetchone()
        if not row or user_id not in {row[1], row[2]}:
            return None
        return {
            "code": row[0],
            "seat": "red" if user_id == row[1] else "black",
            "red": row[6],
            "black": row[7],
            "moves": json.loads(row[3]),
            "turn": row[4],
            "status": row[5],
            "updatedAt": row[8],
        }

    def handle_room_get(self, code: str, user: dict, version: int = -1, expected_status: str = "", wait: bool = False) -> None:
        deadline = time.monotonic() + (15 if wait else 0)
        room = None
        while True:
            with sqlite3.connect(DB_PATH, timeout=10) as db:
                room = self.room_payload(db, code, int(user["id"]))
            if not room or not wait or len(room["moves"]) != version or room["status"] != expected_status or time.monotonic() >= deadline:
                break
            time.sleep(0.15)
        if room:
            self.send_json({"room": room})
        else:
            self.send_json({"error": "房间不存在或你不在该房间"}, 404)

    def handle_room_post(self, path: str, user: dict) -> None:
        try:
            body = self.read_json()
        except (ValueError, json.JSONDecodeError):
            self.send_json({"error": "提交的数据格式不正确"}, 400)
            return
        now = int(time.time())
        if path == "/api/rooms/create":
            alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
            with sqlite3.connect(DB_PATH, timeout=10) as db:
                db.execute("DELETE FROM rooms WHERE updated_at<?", (now - 2 * 24 * 60 * 60,))
                for _ in range(12):
                    code = "".join(secrets.choice(alphabet) for _ in range(6))
                    try:
                        db.execute(
                            """INSERT INTO rooms(code,red_user_id,moves_json,turn,status,created_at,updated_at)
                               VALUES(?,?,'[]','red','waiting',?,?)""",
                            (code, int(user["id"]), now, now),
                        )
                        room = self.room_payload(db, code, int(user["id"]))
                        self.send_json({"room": room}, 201)
                        return
                    except sqlite3.IntegrityError:
                        continue
            self.send_json({"error": "暂时无法创建房间，请重试"}, 503)
            return
        if path == "/api/rooms/join":
            code = str(body.get("code", "")).strip().upper()
            if not re.fullmatch(r"[A-Z2-9]{6}", code):
                self.send_json({"error": "请输入正确的六位房间码"}, 400)
                return
            with sqlite3.connect(DB_PATH, timeout=10, isolation_level=None) as db:
                db.execute("BEGIN IMMEDIATE")
                row = db.execute("SELECT red_user_id,black_user_id FROM rooms WHERE code=?", (code,)).fetchone()
                if not row:
                    db.rollback(); self.send_json({"error": "没有找到这个房间"}, 404); return
                if int(user["id"]) == row[0]:
                    pass
                elif row[1] is None:
                    db.execute(
                        "UPDATE rooms SET black_user_id=?,status='active',updated_at=? WHERE code=?",
                        (int(user["id"]), now, code),
                    )
                elif int(user["id"]) != row[1]:
                    db.rollback(); self.send_json({"error": "这个房间已经满了"}, 409); return
                db.commit()
                room = self.room_payload(db, code, int(user["id"]))
            self.send_json({"room": room})
            return
        move_match = re.fullmatch(r"/api/rooms/([A-Z2-9]{6})/move", path)
        if not move_match:
            self.send_json({"error": "Not found"}, 404)
            return
        code = move_match.group(1)
        move = str(body.get("move", "")).lower()
        try:
            version = int(body.get("version", -1))
        except (TypeError, ValueError):
            version = -1
        if not re.fullmatch(r"[a-i][0-9][a-i][0-9]", move):
            self.send_json({"error": "走法格式不正确"}, 400)
            return
        with sqlite3.connect(DB_PATH, timeout=10, isolation_level=None) as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT red_user_id,black_user_id,moves_json,turn,status FROM rooms WHERE code=?",
                (code,),
            ).fetchone()
            if not row or int(user["id"]) not in {row[0], row[1]}:
                db.rollback(); self.send_json({"error": "房间不存在或你不在该房间"}, 404); return
            moves = json.loads(row[2])
            seat = "red" if int(user["id"]) == row[0] else "black"
            if row[4] != "active":
                db.rollback(); self.send_json({"error": "还在等待另一位玩家加入"}, 409); return
            if row[3] != seat:
                db.rollback(); self.send_json({"error": "还没轮到你行棋"}, 409); return
            if version != len(moves):
                db.rollback(); self.send_json({"error": "棋局已更新，请稍后重试"}, 409); return
            move_error = validate_online_move(moves, move)
            if move_error:
                db.rollback(); self.send_json({"error": move_error}, 400); return
            moves.append(move)
            next_turn = "black" if row[3] == "red" else "red"
            db.execute(
                "UPDATE rooms SET moves_json=?,turn=?,updated_at=? WHERE code=?",
                (json.dumps(moves, separators=(",", ":")), next_turn, now, code),
            )
            db.commit()
            room = self.room_payload(db, code, int(user["id"]))
        self.send_json({"room": room})

    def send_login_page(self, error: str = "", status: int = 200) -> None:
        message = f'<p class="error">{html.escape(error)}</p>' if error else ""
        data = f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>弈局 · 访问验证</title>
<style>
*{{box-sizing:border-box}}body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#17130f;color:#f7ead2;font-family:system-ui,"Microsoft YaHei",sans-serif}}
.card{{width:min(92vw,390px);padding:34px;border:1px solid #6f5638;border-radius:18px;background:#241c15;box-shadow:0 20px 60px #0008}}
h1{{margin:0 0 8px;font-family:serif;font-size:34px}}p{{color:#cbb79b}}label{{display:block;margin:18px 0 7px}}input{{width:100%;padding:12px 14px;border:1px solid #796044;border-radius:9px;background:#110e0b;color:#fff;font-size:16px}}
button{{width:100%;margin-top:22px;padding:13px;border:0;border-radius:9px;background:#c7954c;color:#1b130a;font-size:17px;font-weight:700;cursor:pointer}}.error{{color:#ff9a86}}
</style></head><body><main class="card"><h1>弈局</h1><p>输入棋室账号和密码后进入。</p>{message}
<form method="post" action="/login"><label for="username">账号</label><input id="username" name="username" autocomplete="username" required>
<label for="password">密码</label><input id="password" name="password" type="password" autocomplete="current-password" required>
<button type="submit">进入棋室</button></form></main></body></html>""".encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def has_valid_session(self) -> bool:
        supplied_cookie = self.headers.get("Cookie", "")
        for item in supplied_cookie.split(";"):
            name, separator, value = item.strip().partition("=")
            if separator and name == "yiju_session":
                return hmac.compare_digest(value, SESSION_TOKEN)
        return False

    def require_auth(self) -> bool:
        if not ACCESS_PASSWORD:
            return True
        expected = "Basic " + base64.b64encode(f"{ACCESS_USER}:{ACCESS_PASSWORD}".encode()).decode()
        supplied = self.headers.get("Authorization", "")
        if hmac.compare_digest(supplied, expected) or self.has_valid_session():
            return True
        if self.command in {"GET", "HEAD"}:
            self.send_response(303)
            self.send_header("Location", "/login")
            self.send_header("Content-Length", "0")
        else:
            self.send_response(401)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", "0")
        self.end_headers()
        return False

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path == "/api/auth/me":
            user = self.auth_user()
            if user:
                self.send_json({"user": user})
            else:
                self.send_json({"error": "未登录"}, 401)
            return
        room_match = re.fullmatch(r"/api/rooms/([A-Z2-9]{6})", path)
        if room_match:
            user = self.auth_user()
            if not user:
                self.send_json({"error": "请先登录"}, 401)
                return
            if not api_rate_allowed("room-read:" + str(user["id"]), limit=120, window=60):
                self.send_json({"error": "同步过于频繁，请稍后再试"}, 429)
                return
            query = parse_qs(urlsplit(self.path).query)
            try:
                version = int(query.get("version", ["-1"])[0])
            except ValueError:
                version = -1
            expected_status = query.get("status", [""])[0]
            should_wait = query.get("wait", ["0"])[0] == "1"
            self.handle_room_get(room_match.group(1), user, version, expected_status, should_wait)
            return
        if path == "/api/status":
            health = cached_engine_health(cached_only=parse_qs(urlsplit(self.path).query).get("cached") == ["1"])
            self.send_json({
                "engine": health["engine"],
                "healthy": health["healthy"],
                "checkedAt": int(float(health["checked_at"])),
            })
            return
        if urlsplit(self.path).path == "/login":
            if not ACCESS_PASSWORD:
                self.send_response(303)
                self.send_header("Location", "/")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            self.send_login_page()
            return
        if not self.require_auth():
            return
        if path not in STATIC_PATHS:
            self.send_error(404, "Not found")
            return
        super().do_GET()

    def do_HEAD(self) -> None:
        if urlsplit(self.path).path == "/login":
            if not ACCESS_PASSWORD:
                self.send_response(303)
                self.send_header("Location", "/")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if not self.require_auth():
            return
        if urlsplit(self.path).path not in STATIC_PATHS:
            self.send_error(404, "Not found")
            return
        super().do_HEAD()

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        if path in {"/api/auth/register", "/api/auth/login", "/api/auth/logout"}:
            self.handle_auth_post(path)
            return
        if path in {"/api/rooms/create", "/api/rooms/join"} or re.fullmatch(r"/api/rooms/[A-Z2-9]{6}/move", path):
            user = self.auth_user()
            if not user:
                self.send_json({"error": "请先登录"}, 401)
                return
            client_key = "room:" + str(user["id"])
            if not api_rate_allowed(client_key, limit=60, window=60):
                self.send_json({"error": "操作过于频繁，请稍后再试"}, 429)
                return
            self.handle_room_post(path, user)
            return
        if urlsplit(self.path).path == "/login":
            if not ACCESS_PASSWORD:
                self.send_response(303)
                self.send_header("Location", "/")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            try:
                length = min(int(self.headers.get("Content-Length", "0")), 4096)
            except ValueError:
                length = 0
            fields = parse_qs(self.rfile.read(length).decode("utf-8", errors="replace"))
            username = fields.get("username", [""])[0]
            password = fields.get("password", [""])[0]
            if hmac.compare_digest(username, ACCESS_USER) and hmac.compare_digest(password, ACCESS_PASSWORD):
                self.send_response(303)
                self.send_header("Location", "/")
                self.send_header("Set-Cookie", f"yiju_session={SESSION_TOKEN}; Path=/; HttpOnly; Secure; SameSite=Lax")
                self.send_header("Content-Length", "0")
                self.end_headers()
            else:
                self.send_login_page("账号或密码不正确", 401)
            return
        if not self.require_auth():
            return
        client_key = self.client_address[0]
        if not api_rate_allowed(client_key):
            self.send_json({"error": "请求过于频繁，请稍后再试"}, 429)
            return
        if path not in {"/api/move", "/api/analyze"}:
            self.send_json({"error": "Not found"}, 404)
            return
        try:
            body = self.read_json()
            fen = str(body.get("fen", "")).strip()
            if not fen or len(fen) > 256:
                raise ValueError("局面数据不正确")
            if path == "/api/analyze":
                self.stream_analysis(body)
                return
            legal_moves = body.get("legalMoves", [])
            if not isinstance(legal_moves, list) or not 1 <= len(legal_moves) <= 256:
                raise ValueError("合法走法数据不正确")
            depth = int(body.get("depth", 8))
            if not 1 <= depth <= 22:
                raise ValueError("分析深度不正确")
            engine = find_engine()
            if engine:
                allowed = [
                    str(item.get("uci", "")) for item in legal_moves
                    if isinstance(item, dict) and re.fullmatch(r"[a-i][0-9][a-i][0-9]", str(item.get("uci", "")))
                ]
                if not allowed:
                    raise ValueError("合法走法数据不正确")
                if not acquire_move_slot():
                    self.send_json({"error": "引擎繁忙，请稍后再试"}, 503)
                    return
                try:
                    try:
                        move = worker_move(fen, depth, allowed)
                        source = "pikafish"
                        mark_engine_health(True)
                    except RuntimeError as exc:
                        log_engine_failure("move-first", exc)
                        time.sleep(0.25)
                        try:
                            move = worker_move(fen, depth, allowed)
                            source = "pikafish"
                            mark_engine_health(True)
                        except RuntimeError as exc:
                            log_engine_failure("move-retry", exc)
                            mark_engine_health(False)
                            move = fallback_move(legal_moves)
                            source = "fallback"
                finally:
                    release_move_slot()
            else:
                move = fallback_move(legal_moves)
                source = "fallback"
            self.send_json({"move": move, "source": source})
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            self.send_json({"error": str(exc) or "提交的数据格式不正确"}, 400)
        except Exception as exc:
            print(f"API error: {type(exc).__name__}: {exc}")
            self.send_json({"error": "服务器暂时无法处理请求"}, 500)

    def stream_analysis(self, body: dict) -> None:
        engine = find_engine()
        if not engine:
            self.send_json({"error": "Pikafish 未连接"}, 503)
            return
        if not acquire_analysis_slot():
            self.send_json({"error": "分析队列繁忙，请稍后再试"}, 503)
            return
        fen = str(body.get("fen", ""))
        max_depth = max(6, min(int(body.get("depth", 16)), 22))
        allowed_moves = [str(move) for move in body.get("allowedMoves", []) if move]
        try:
            process, request_path, result_path = start_engine_worker({
                "action": "analyze", "fen": fen, "depth": max_depth,
                "allowedMoves": allowed_moves,
            })
        except Exception:
            ENGINE_SLOTS.release()
            raise

        def emit(payload: dict) -> None:
            self.wfile.write((json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"))
            self.wfile.flush()

        try:
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            offset = 0
            deadline = time.monotonic() + 40
            completed = False
            while time.monotonic() < deadline:
                if move_requested():
                    emit({"done": True, "interrupted": True, "reason": "move-priority"})
                    return
                if result_path.is_file():
                    with result_path.open("r", encoding="utf-8") as stream:
                        stream.seek(offset)
                        while line := stream.readline():
                            payload = json.loads(line)
                            emit(payload)
                            offset = stream.tell()
                            if payload.get("done"):
                                completed = True
                                mark_engine_health(not payload.get("error"))
                                break
                if completed:
                    return
                if process.poll() is not None:
                    raise RuntimeError("Pikafish 工作进程异常退出")
                time.sleep(0.05)
            raise RuntimeError("Pikafish 分析超时")
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        except RuntimeError as exc:
            log_engine_failure("analysis", exc)
            mark_engine_health(False)
            try:
                emit({"done": True, "error": str(exc)})
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
        finally:
            try:
                cleanup_engine_job(process, request_path, result_path)
            finally:
                ENGINE_SLOTS.release()


def open_browser() -> None:
    if os.environ.get("XIANGQI_NO_BROWSER") == "1":
        return
    time.sleep(0.7)
    webbrowser.open(f"http://{HOST}:{PORT}")


if __name__ == "__main__":
    os.chdir(ROOT)
    init_auth_db()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"棋室已启动：http://{HOST}:{PORT}")
    print("按 Ctrl+C 关闭。")
    threading.Thread(target=open_browser, daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n棋室已关闭。")
    finally:
        server.server_close()
