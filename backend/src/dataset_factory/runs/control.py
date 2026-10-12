"""CLI 与 HTTP 共用的跨进程进度读取及协作停止请求。"""

import json
from pathlib import Path
from typing import Any

from .._fs import atomic_write_text
from ..workdir.locks import maintenance_guard, read_live_occupier, read_occupier
from .errors import RunNotActiveError
from .journal import empty_counters
from .progress import RUN_STATUS_RUNNING, TERMINAL_RUN_STATUSES


def current_run(workdir: Path, seq: int) -> dict[str, Any]:
    """读取正在持锁的指定批次进度，不将历史快照当作运行中。"""
    dsf = workdir / ".dsf"
    with maintenance_guard(workdir, timeout=10):
        owner = read_live_occupier(dsf)
        if owner is None or owner.get("batch") != f"s{seq}":
            raise RunNotActiveError("该批次当前没有进行中的跑批。")
        run_id = owner.get("run_id")
        if not isinstance(run_id, str):
            raise RunNotActiveError("当前占用操作不是可控制的跑批。")
        progress = read_occupier(dsf / "run-status.json")
        if progress is not None and progress.get("run_id") == run_id:
            return progress
        return {
            "run_id": run_id,
            "batch": seq,
            "mode": owner.get("mode", "full"),
            "status": RUN_STATUS_RUNNING,
            "counters": empty_counters(),
            "current_item": None,
            "error": None,
        }


def request_stop(workdir: Path, seq: int, *, immediate: bool = False) -> str:
    """请求当前运行在安全点停止；运行 ID 防止误停后续运行。

    ``immediate`` 只多写一个停法字段——置位与「等条目完成」走同一份停止文件，读到的
    执行器在**每一段增量之间**也检查它，随即掐断在途生成（当前条目不记账、不落半截产物）。
    """
    with maintenance_guard(workdir, timeout=10):
        progress = current_run(workdir, seq)
        if progress["status"] in TERMINAL_RUN_STATUSES:
            raise RunNotActiveError("该批次当前没有进行中的跑批。")
        run_id = str(progress["run_id"])
        atomic_write_text(
            workdir / ".dsf" / "run-stop.json",
            json.dumps(
                {"run_id": run_id, "mode": "immediate" if immediate else "graceful"}
            ),
        )
        return run_id


def stop_requested(workdir: Path, run_id: str) -> bool:
    """执行器只接受属于本次运行的停止请求。"""
    return stop_mode(workdir, run_id) is not None


def stop_mode(workdir: Path, run_id: str) -> str | None:
    """本次停止请求的停法（``graceful``／``immediate``）；没有属于本运行的停止请求时 None。"""
    request = read_occupier(workdir / ".dsf" / "run-stop.json")
    if request is None or request.get("run_id") != run_id:
        return None
    mode = request.get("mode")
    return mode if isinstance(mode, str) else "graceful"
