"""服务器目录浏览：仅列当前层的元信息，不提供任意文件内容读取。

「素材来源目录」的导入预演（GET /source-scan）也挂在本面：那时候目录还没登记成
工作目录、没有 wid 可查，能问的只有服务器上的这条路径。
"""

from __future__ import annotations

import os
import platform
import shutil
import socket
import stat
import subprocess
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Literal, cast

from fastapi import APIRouter, Query, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from .._fs import data_root, is_empty_dir
from ..tasks import RETRY_AFTER_SECONDS, TaskCancelledError, TaskManager, TaskResult
from ..workdir import WorkdirPathError, WorkdirRegistry
from ..workdir.assets import media_kind, preview_source_import
from ..workdir.locks import (
    maintenance_guard,
    registry_guard,
    require_directory_identity,
)
from ..workdir.relocation import relocate_workdir
from .problems import problem, problem_response
from .schemas import ScanPreviewItem, ScanPreviewView, WorkdirRelocateAccepted


class RenameDirectoryRequest(BaseModel):
    """把指定目录改名到同一父目录下的新名称。"""

    model_config = ConfigDict(extra="forbid")

    path: str = Field(min_length=1, description="现有目录的绝对路径")
    new_name: str = Field(min_length=1, description="新的目录名，不含路径分隔符")


class CreateDirectoryRequest(BaseModel):
    """在既有父目录下创建一层目录。"""

    model_config = ConfigDict(extra="forbid")
    parent: str = Field(min_length=1)
    name: str = Field(min_length=1)


class DirectoryPath(BaseModel):
    """目录操作返回的服务器绝对路径。"""

    path: str


router = APIRouter(prefix="/api/filesystem", tags=["服务器目录"])


class FilesystemCapabilities(BaseModel):
    """后端当前桌面会话的可选能力。"""

    open_in_file_manager: bool


def _file_manager_command() -> list[str] | None:
    """仅在后端具备桌面会话及启动程序时提供系统打开。"""
    system = platform.system()
    if system == "Windows":
        session = os.environ.get("SESSIONNAME", "").casefold()
        executable = shutil.which("explorer.exe")
        if executable and (session == "console" or session.startswith("rdp-")):
            return [executable]
    elif system == "Darwin":
        executable = shutil.which("open")
        if executable:
            return [executable]
    elif os.environ.get("DISPLAY"):
        executable = shutil.which("xdg-open")
        if executable:
            return [executable]
    return None


@router.get("/capabilities", response_model=FilesystemCapabilities)
def filesystem_capabilities() -> FilesystemCapabilities:
    """按后端环境报告能力，不推断浏览器是否与后端同机。"""
    return FilesystemCapabilities(
        open_in_file_manager=_file_manager_command() is not None
    )


@router.post("/open", status_code=204, response_class=Response)
def open_directory(body: DirectoryPath) -> Response:
    """在后端的桌面文件管理器中显示目录，不读取其文件内容。"""
    command = _file_manager_command()
    if command is None:
        return problem_response(
            409,
            "filesystem-desktop-unavailable",
            "桌面不可用",
            "当前后端不能打开系统文件管理器。",
        )
    if "\0" in body.path or not Path(body.path).is_absolute():
        raise WorkdirPathError("请输入有效的服务器绝对路径。")
    try:
        directory = Path(body.path).resolve(strict=True)
        if not directory.is_dir():
            raise WorkdirPathError("请选择一个目录后打开。")
        subprocess.Popen(  # noqa: S603 -- 固定程序 + 已校验绝对目录，独立参数且无 shell
            [*command, str(directory)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except OSError as exc:
        raise WorkdirPathError(
            "无法打开系统文件管理器，请检查目录与桌面会话。"
        ) from exc
    return Response(status_code=204)


class DirectoryEntry(BaseModel):
    """当前目录的一项；文件只提供元信息。"""

    name: str
    path: str
    kind: Literal["directory", "file"]
    # 图标四态的判据（image／video／file）——扩展名集合只住 workdir.assets，界面不另抄一份。
    media: Literal["image", "video", "file"]
    # 目录才有「空不空」这件事：#20 的「要求目标为空」定制按它判，不让前端数子项。
    is_empty: bool | None
    modified_at: str
    size: int | None


class DirectoryListing(BaseModel):
    """服务器身份、规范路径与当前层条目。"""

    hostname: str
    system: str
    path: str
    parent: str | None
    # 当前层条目受 show_files／show_hidden／suffixes 三重筛选，数不出「这个目录空不空」；
    # 「要求目标为空」的调用点要的是真判空，由后端现算。
    is_empty: bool
    entries: list[DirectoryEntry]
    unavailable_count: int


@router.get(
    "",
    response_model=DirectoryListing,
    responses={
        400: {"description": "路径无效或不是目录"},
        403: {"description": "服务进程无权读取目录"},
        404: {"description": "目录不存在"},
        500: {"description": "目录读取失败"},
    },
)
def list_directory(
    path: str | None = None,
    show_files: bool = False,
    show_hidden: bool = False,
    suffixes: Annotated[list[str] | None, Query()] = None,
) -> DirectoryListing | Response:
    """列出服务器当前层目录，可按后缀筛选文件；默认从用户主目录开始。

    浏览范围由服务进程的系统权限决定；文件预览端点继续使用各自的路径边界。
    扫描时消失或无权读取的单项计入 unavailable_count，不影响其他条目。
    """
    try:
        if path is not None and "\0" in path:
            return problem_response(
                400, "filesystem-path-invalid", "路径无效", "路径不能包含空字符。"
            )
        directory = Path(path).expanduser() if path else Path.home()
        if not directory.is_absolute():
            return problem_response(
                400, "filesystem-path-invalid", "路径无效", "请输入服务器绝对路径。"
            )
        directory = directory.resolve(strict=True)
        allowed = {suffix.casefold() for suffix in suffixes or []}
        entries: list[DirectoryEntry] = []
        unavailable = 0
        children = 0
        with os.scandir(directory) as scanner:
            for entry in scanner:
                children += 1
                if not show_hidden and entry.name.startswith("."):
                    continue
                try:
                    metadata = entry.stat()
                except OSError:
                    unavailable += 1
                    continue
                is_directory = stat.S_ISDIR(metadata.st_mode)
                if not is_directory:
                    if not show_files or not stat.S_ISREG(metadata.st_mode):
                        continue
                    if allowed and Path(entry.name).suffix.casefold() not in allowed:
                        continue
                entries.append(
                    DirectoryEntry(
                        name=entry.name,
                        path=str(directory / entry.name),
                        kind="directory" if is_directory else "file",
                        media=media_kind(entry.name),
                        is_empty=is_empty_dir(directory / entry.name)
                        if is_directory
                        else None,
                        modified_at=datetime.fromtimestamp(
                            metadata.st_mtime, UTC
                        ).isoformat(),
                        size=None if is_directory else metadata.st_size,
                    )
                )
        entries.sort(
            key=lambda entry: (
                entry.kind != "directory",
                entry.name.casefold(),
                entry.name,
            )
        )
        return DirectoryListing(
            hostname=socket.gethostname(),
            system=platform.system(),
            path=str(directory),
            parent=str(directory.parent) if directory.parent != directory else None,
            is_empty=children == 0,
            entries=entries,
            unavailable_count=unavailable,
        )
    except (ValueError, RuntimeError):
        return problem_response(
            400, "filesystem-path-invalid", "路径无效", "请检查路径内容与符号链接。"
        )
    except FileNotFoundError:
        return problem_response(
            404, "filesystem-not-found", "目录不存在", "请检查服务器路径后重新跳转。"
        )
    except NotADirectoryError:
        return problem_response(
            400, "filesystem-not-directory", "不是目录", "请选择文件所在的目录。"
        )
    except PermissionError:
        return problem_response(
            403,
            "filesystem-permission-denied",
            "无法读取目录",
            "服务进程没有此目录的读取权限。",
        )
    except OSError:
        return problem_response(
            500,
            "filesystem-read-failed",
            "目录读取失败",
            "请检查目录是否可访问后重试。",
        )


@router.post(
    "/rename",
    status_code=202,
    response_model=WorkdirRelocateAccepted,
    responses={
        400: problem(),
        404: problem(),
        409: problem(),
    },
)
async def rename_directory(body: RenameDirectoryRequest, request: Request) -> Response:
    """受理目录改名，已登记工作目录通过迁移流程保留身份和恢复记录。"""
    try:
        source, destination, wid = _rename_paths(body)
        metadata = source.stat()
        identity = (metadata.st_dev, metadata.st_ino)
    except OSError as exc:
        raise WorkdirPathError("无法读取目录，请检查路径与权限后重试。") from exc
    manager = cast(TaskManager, request.app.state.task_manager)

    def runner(task_id: str, should_stop: threading.Event) -> TaskResult:
        with maintenance_guard(source), maintenance_guard(destination):
            if should_stop.is_set():
                raise TaskCancelledError("重命名已取消。")
            current_source, current_destination, current_wid = _rename_paths(body)
            if (current_source, current_destination, current_wid) != (
                source,
                destination,
                wid,
            ):
                raise WorkdirPathError("目录位置或登记发生变化，请刷新后重试。")
            require_directory_identity(source, identity)
            if wid is not None:
                return relocate_workdir(wid, destination, should_stop=should_stop)
            with registry_guard(data_root()):
                if _rename_paths(body) != (source, destination, None):
                    raise WorkdirPathError("目录登记发生变化，请刷新后重试。")
                require_directory_identity(source, identity)
                source.rename(destination)
            return {"path": str(destination), "cleanup_pending": False}

    task_id = manager.create(runner)
    return JSONResponse(
        status_code=202,
        content={"task_id": task_id},
        headers={"Retry-After": str(RETRY_AFTER_SECONDS)},
    )


def _rename_paths(body: RenameDirectoryRequest) -> tuple[Path, Path, str | None]:
    """受理及执行前分别校验路径，目录中的登记资源不能绕过各自维护流程。"""
    name = body.new_name
    _validate_directory_name(name)
    if "\0" in body.path or not Path(body.path).is_absolute():
        raise WorkdirPathError("请输入有效的服务器绝对路径。")
    original = Path(body.path)
    if original.is_symlink() or original.is_junction():
        raise WorkdirPathError("请选择实际目录，不能直接重命名符号链接或目录联接。")
    source = original.resolve(strict=True)
    # 改名受理＝目录或文件（2026-10-09 格 3 裁「文件重命名入列」）；根级与卷根仍拒。
    if not source.is_dir() and not source.is_file():
        raise WorkdirPathError("请选择要重命名的目录或文件。")
    if source == source.parent:
        raise WorkdirPathError("请选择一个非根目录后重命名。")
    destination = source.with_name(name)
    if os.path.lexists(destination):
        raise WorkdirPathError("目标名称已存在，请换一个名称。")
    wid: str | None = None
    for entry in WorkdirRegistry.list_all():
        registered = Path(entry.path).resolve()
        if registered == source:
            wid = entry.id
        elif registered.is_relative_to(source) or source.is_relative_to(registered):
            raise WorkdirPathError(
                "目录包含已登记工作目录或位于其内部，请使用工作目录维护入口。"
            )
    if wid is None and (source / ".dsf").exists():
        raise WorkdirPathError("目录包含工作记录，请先登记为工作目录再修改路径。")
    return source, destination, wid


def _validate_directory_name(name: str) -> None:
    """目录名称不能携带路径或平台间含义不同的尾部字符。"""
    if (
        not name.strip()
        or name in (".", "..")
        or any(character in name for character in ("\0", "/", "\\", ":"))
        or name.endswith((" ", "."))
    ):
        raise WorkdirPathError("请输入一个不含路径分隔符的目录名。")


@router.post("/directories", response_model=DirectoryPath, status_code=201)
def create_directory(body: CreateDirectoryRequest) -> DirectoryPath:
    """创建一层新目录，已有同名项不覆盖；文件操作失败明确反馈。"""
    _validate_directory_name(body.name)
    if "\0" in body.parent or not Path(body.parent).is_absolute():
        raise WorkdirPathError("请输入有效的服务器绝对路径。")
    try:
        parent = Path(body.parent).resolve(strict=True)
        destination = parent / body.name
        with maintenance_guard(parent), maintenance_guard(destination):
            destination.mkdir()
        return DirectoryPath(path=str(destination))
    except FileExistsError as exc:
        raise WorkdirPathError("目标名称已存在，请换一个名称。") from exc
    except OSError as exc:
        raise WorkdirPathError("创建目录失败，请检查父目录与写入权限。") from exc


@router.get(
    "/source-scan",
    response_model=ScanPreviewView,
    responses={
        400: {"description": "路径无效（相对路径或含空字符）"},
        404: {"description": "目录不存在或不是目录"},
    },
)
def scan_source_directory(path: str) -> ScanPreviewView | Response:
    """按「素材来源目录」预演一次导入：会收多少张、哪些收不进来、为什么。

    新建批次表单的扫描钮吃这条——点扫描时目录还没登记（没有 wid），扫描对象是
    素材来源目录本身，与工作目录无关（2026-10-09 用户裁「扫描独立」）。只读现算、
    不落任何状态。
    """
    if "\0" in path:
        return problem_response(
            400, "filesystem-path-invalid", "路径无效", "路径不能包含空字符。"
        )
    directory = Path(path).expanduser()
    if not directory.is_absolute():
        return problem_response(
            400, "filesystem-path-invalid", "路径无效", "请输入服务器绝对路径。"
        )
    if not directory.is_dir():
        return problem_response(
            404,
            "filesystem-directory-missing",
            "目录不存在",
            f"来源目录「{path}」不存在或不是目录——请检查后重试。",
        )
    accepted, rejected = preview_source_import(directory)
    return ScanPreviewView(
        total=len(accepted),
        images=sum(1 for entry in accepted if media_kind(entry.name) == "image"),
        videos=sum(1 for entry in accepted if media_kind(entry.name) == "video"),
        unimported=[
            ScanPreviewItem(
                name=entry.name,
                media=media_kind(entry.name),
                reason=entry.reason,
                size=entry.size,
                limit=entry.limit,
            )
            for entry in rejected
        ],
    )
