"""服务运行端点：GET /api/service、GET /api/service/logs、GET /api/service/busy、POST /api/service/shutdown。

F6 服务生命周期的数据面：状态与日志供设置页「服务运行」子页展示，shutdown 供页头
「关闭服务」按钮调用。serve 把 uvicorn 实例与启动信息挂到 app.state（见 cli.main.serve）；
不经 serve 拉起（如测试直建 app）时状态与 shutdown 返回 409、消息可操作。
跨站防护：shutdown 只接受 application/json——浏览器跨站表单与简单请求发不出这个
Content-Type（带上它必触发 CORS 预检，本服务不应答 CORS 头即被拦下），同源界面、
SSH 隧道与局域网直访都不受影响。
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Protocol, cast

from fastapi import APIRouter, Query, Request, Response, status

from .._fs import data_root
from ..tasks import TaskManager
from ..workdir.errors import WorkdirPathError
from ..workdir.locks import read_live_occupier
from ..workdir.store import WorkdirRegistry
from .problems import ProblemError, problem
from .schemas import ServiceBusy, ServiceLogs, ServiceStatus

router = APIRouter(prefix="/api/service", tags=["服务运行"])

_LOG_FILENAME = "server.log"
_DEFAULT_TAIL_LINES = 200
_MAX_TAIL_LINES = 1000
_TAIL_BLOCK_SIZE = 8192


class _ServerHandle(Protocol):
    """serve 注入的 uvicorn.Server 在本模块用到的最小形状（api 不依赖 uvicorn）。"""

    should_exit: bool


@router.get("", response_model=ServiceStatus)
def service_status(request: Request) -> ServiceStatus:
    """报告服务运行状态（serve 启动时注入；信息缺位视为非 serve 场景，409）。"""
    info = getattr(request.app.state, "service_info", None)
    if info is None:
        raise ProblemError(
            409,
            "service-not-served",
            "服务非 dsf serve 拉起",
            "服务不是由 dsf serve 拉起，运行状态不可用。",
        )
    return ServiceStatus(
        version=str(info["version"]),
        host=str(info["host"]),
        port=int(info["port"]),
        started_at=str(info["started_at"]),
        log_file=str(info["log_file"]),
    )


@router.get("/logs", response_model=ServiceLogs)
def service_logs(
    lines: int = Query(default=_DEFAULT_TAIL_LINES, ge=1, le=_MAX_TAIL_LINES),
) -> ServiceLogs:
    """运行日志尾部（最近 N 行）；日志文件尚未创建时 exists=false、内容为空。"""
    path = server_log_path()
    if not path.is_file():
        return ServiceLogs(path=str(path), exists=False, content="")
    return ServiceLogs(path=str(path), exists=True, content=_tail(path, lines))


@router.get("/busy", response_model=ServiceBusy)
def service_busy(request: Request) -> ServiceBusy:
    """现在关服务会不会打断事情：跑批按各工作目录的活锁占用者数，任务按进程内管理器数。

    目录已消失／已迁移／正被维护的条目读不到占用者，一律不算进行中——这个端点只回答
    「有没有事情在跑」，不把读盘故障报成忙碌或把它算成进行中。
    """
    runs = 0
    for entry in WorkdirRegistry.list_all():
        dsf = Path(entry.path) / ".dsf"
        try:
            # 目录已消失时连维护锁都取不了（FileNotFoundError 是 OSError 的子类，一并吞）
            owner = read_live_occupier(dsf) if dsf.is_dir() else None
        except (OSError, ValueError, WorkdirPathError):
            continue
        if owner is not None and owner.get("batch"):
            runs += 1
    manager = cast(TaskManager, request.app.state.task_manager)
    return ServiceBusy(runs=runs, tasks=manager.active_count())


@router.post(
    "/shutdown",
    status_code=status.HTTP_202_ACCEPTED,
    responses={
        409: problem("服务不是由 dsf serve 拉起"),
        415: problem("Content-Type 不是 application/json"),
    },
)
def shutdown(request: Request) -> Response:
    """请求停止服务：置位退出开关，进行中的请求处理完后服务自行退出。"""
    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type != "application/json":
        raise ProblemError(
            415,
            "unsupported-content-type",
            "Content-Type 不支持",
            "关闭服务请求必须使用 application/json。",
        )
    server = getattr(request.app.state, "uvicorn_server", None)
    if server is None:
        raise ProblemError(
            409,
            "service-not-served",
            "服务非 dsf serve 拉起",
            "服务不是由 dsf serve 拉起，无法由此关闭。",
        )
    cast(_ServerHandle, server).should_exit = True
    return Response(status_code=status.HTTP_202_ACCEPTED)


def server_log_path() -> Path:
    """运行日志文件位置：数据根 logs/server.log（serve 侧写、日志端点读，路径单一来源）。"""
    return data_root() / "logs" / _LOG_FILENAME


def _tail(path: Path, lines: int) -> str:
    """读文本文件尾部 lines 行（从文件末尾按块回退定位，不整读大文件）。"""
    with path.open("rb") as f:
        f.seek(0, os.SEEK_END)
        remaining = f.tell()
        chunks: list[bytes] = []
        found_newlines = 0
        while remaining > 0 and found_newlines <= lines:
            step = min(_TAIL_BLOCK_SIZE, remaining)
            remaining -= step
            f.seek(remaining)
            chunk = f.read(step)
            chunks.append(chunk)
            found_newlines += chunk.count(b"\n")
        data = b"".join(reversed(chunks))
    text = data.decode("utf-8", errors="replace")
    return "\n".join(text.splitlines()[-lines:])
