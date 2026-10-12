"""工作目录迁移的复制与内容校验。"""

from __future__ import annotations

import json
import os
import shutil
import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import cast

from .._fs import atomic_write_text, data_root, hash_stream, is_empty_dir
from ..tasks import TaskCancelledError
from .errors import WorkdirPathError
from .locks import (
    MAINTENANCE_WAIT_SECONDS,
    RunLock,
    StateLock,
    import_guard,
    maintenance_guard,
    maintenance_record,
)
from .store import WorkdirRegistry, WorkdirStore, registered_path

_RUNTIME_FILES = frozenset(
    Path(".dsf") / name
    for name in (
        "run.lock",
        "state.lock",
        "imports.lock",
        "run-info.json",
        "run-status.json",
        "run-stop.json",
        "MIGRATED",
    )
)


@dataclass(frozen=True)
class CopySummary:
    """完整副本的文件数量与实际字节数。"""

    file_count: int
    total_bytes: int
    directories: tuple[str, ...]
    files: dict[str, tuple[int, str]]


def _check_stop(should_stop: threading.Event | None) -> None:
    if should_stop is not None and should_stop.is_set():
        raise TaskCancelledError("迁移已取消，原工作目录保持完整。")


def _inventory(root: Path) -> tuple[list[Path], list[Path]]:
    directories: list[Path] = []
    files: list[Path] = []

    def fail(error: OSError) -> None:
        raise error

    for directory, subdirs, names in os.walk(root, followlinks=False, onerror=fail):
        parent = Path(directory)
        for name in subdirs + names:
            path = parent / name
            if path.relative_to(root) in _RUNTIME_FILES:
                continue
            if path.is_symlink() or path.is_junction():
                raise WorkdirPathError(
                    f"迁移目录内包含文件或文件夹的链接 {path}，请检查后重试。"
                )
            if path.is_dir():
                directories.append(path.relative_to(root))
            elif path.is_file():
                files.append(path.relative_to(root))
            else:
                raise WorkdirPathError(f"迁移目录包含非普通文件 {path}。")
    return sorted(directories), sorted(files)


def _digest(path: Path, should_stop: threading.Event | None) -> tuple[int, str]:
    with path.open("rb") as handle:
        digest, size = hash_stream(
            handle, on_chunk=lambda _chunk: _check_stop(should_stop)
        )
    return size, digest


def _verify_copy(
    source: Path,
    destination: Path,
    directories: list[Path],
    files: list[Path],
    should_stop: threading.Event | None,
    progress: Callable[[float], None] | None,
) -> CopySummary:
    """独立回读副本与源文件，对比内容和目录清单。"""
    total = 0
    fingerprints: dict[str, tuple[int, str]] = {}
    source_stats = {relative: (source / relative).stat() for relative in files}
    for index, relative in enumerate(files):
        _check_stop(should_stop)
        original = _digest(source / relative, should_stop)
        copied = _digest(destination / relative, should_stop)
        if original != copied:
            raise WorkdirPathError(f"迁移校验失败：{relative} 的内容或大小不一致。")
        total += original[0]
        fingerprints[str(relative)] = original
        if progress is not None:
            progress(0.5 + 0.5 * (index + 1) / max(1, len(files)))
    if _inventory(source) != (directories, files):
        raise WorkdirPathError("迁移期间原目录文件清单发生变化，请重试。")
    if _inventory(destination) != (directories, files):
        raise WorkdirPathError("迁移副本文件清单不一致，请重试。")
    for relative, before in source_stats.items():
        after = (source / relative).stat()
        if (
            before.st_dev,
            before.st_ino,
            before.st_size,
            before.st_mtime_ns,
            before.st_ctime_ns,
        ) != (
            after.st_dev,
            after.st_ino,
            after.st_size,
            after.st_mtime_ns,
            after.st_ctime_ns,
        ):
            raise WorkdirPathError(f"迁移校验期间源文件 {relative} 发生变化，请重试。")
    _check_stop(should_stop)
    return CopySummary(
        len(files), total, tuple(str(path) for path in directories), fingerprints
    )


def copy_verified(
    source: Path,
    destination: Path,
    *,
    should_stop: threading.Event | None = None,
    progress: Callable[[float], None] | None = None,
    created: Callable[[], None] | None = None,
    resume: bool = False,
) -> CopySummary:
    """复制目录并校验文件清单、大小和哈希；调用方负责持有源目录写入锁。

    新复制要求目标不存在，失败只清理本次创建的副本。resume 模式由调用方验证
    目录身份后启用：已有文件必须是源文件的完整前缀，再补齐剩余字节；失败保留
    副本。取消检查覆盖复制与校验阶段，原目录没有任何写入。

    Raises:
        WorkdirPathError: 路径冲突、包含链接或复制校验不一致。
        TaskCancelledError: 用户取消迁移。
        OSError: 复制或校验读取失败。
    """
    source = source.resolve()
    destination = destination.absolute()
    if destination.is_symlink() or destination.is_junction():
        raise WorkdirPathError("迁移目标不能是符号链接或目录联接，请检查后重试。")
    resolved = destination.resolve()
    if not source.is_dir():
        raise WorkdirPathError("原工作目录不存在，请刷新后重试。")
    if resolved.is_relative_to(source) or source.is_relative_to(resolved):
        raise WorkdirPathError("迁移目标与原目录不能相同或互相嵌套。")
    # 目标允许是「已存在的空目录」（2026-10-10 裁：判空由界面给，基础能力支持迁到空目录）；
    # 非空一律拒，避免把别人的目录当成迁移副本往里写。
    if os.path.lexists(destination) and not resume and not is_empty_dir(destination):
        raise WorkdirPathError("迁移目标已存在且不是空目录，请选择空目录。")
    if not destination.parent.is_dir():
        raise WorkdirPathError("迁移目标的父目录不存在，请先创建父目录。")
    directories, files = _inventory(source)
    _check_stop(should_stop)
    if resume:
        present_dirs, present_files = _inventory(destination)
        if not set(present_dirs).issubset(directories) or not set(
            present_files
        ).issubset(files):
            raise WorkdirPathError("副本新增了内容，请检查后重试。")
        for relative in present_files:
            with (
                (source / relative).open("rb") as original,
                (destination / relative).open("rb") as copied,
            ):
                while chunk := copied.read(1024 * 1024):
                    _check_stop(should_stop)
                    if original.read(len(chunk)) != chunk:
                        raise WorkdirPathError(
                            f"副本文件 {relative} 已变更，请检查后重试。"
                        )
    else:
        destination.mkdir(exist_ok=True)
    try:
        if created is not None:
            created()
        for relative in directories:
            _check_stop(should_stop)
            (destination / relative).mkdir(exist_ok=resume)
        for index, relative in enumerate(files):
            _check_stop(should_stop)
            original = source / relative
            copied = destination / relative
            offset = copied.stat().st_size if resume and copied.exists() else 0
            with (
                original.open("rb") as reader,
                copied.open("ab" if resume else "xb") as writer,
            ):
                reader.seek(offset)
                while chunk := reader.read(1024 * 1024):
                    _check_stop(should_stop)
                    writer.write(chunk)
                writer.flush()
                os.fsync(writer.fileno())
            shutil.copystat(original, copied)
            if progress is not None:
                progress(0.5 * (index + 1) / max(1, len(files)))
        summary = _verify_copy(
            source, destination, directories, files, should_stop, progress
        )
    except BaseException:
        if resume:
            raise
        try:
            shutil.rmtree(destination)
        except OSError as cleanup_error:
            raise WorkdirPathError(
                f"迁移未完成，原目录保持完整；副本残留于 {destination}，请检查权限。"
            ) from cleanup_error
        raise
    return summary


def relocate_workdir(
    wid: str,
    destination: Path,
    *,
    should_stop: threading.Event | None = None,
    progress: Callable[[float], None] | None = None,
) -> dict[str, object]:
    """复制校验后切换注册表，自动清理旧目录，删除失败保留重试记录。"""
    source = registered_path(wid).resolve()
    if destination.is_symlink() or destination.is_junction():
        raise WorkdirPathError("迁移目标不能是符号链接或目录联接，请检查后重试。")
    destination = destination.resolve()
    with (
        maintenance_guard(source, timeout=MAINTENANCE_WAIT_SECONDS),
        maintenance_guard(destination, timeout=MAINTENANCE_WAIT_SECONDS),
    ):
        if registered_path(wid).resolve() != source:
            raise WorkdirPathError("工作目录位置已变化，请刷新后重试。")
        store = WorkdirStore(source)
        run = RunLock(store.dsf_path)
        state = StateLock(store.dsf_path)
        run.acquire({"operation": "relocate", "pid": os.getpid()})
        try:
            with import_guard(store.dsf_path):
                state.acquire()
                try:
                    record = maintenance_record(source)
                    # 空目标＝还没开始复制的新迁移（不是续传）；有内容才按记录判续传／校验续跑。
                    if destination.exists() and not is_empty_dir(destination):
                        previous = _read_record(record)
                        if (
                            previous.get("wid") != wid
                            or previous.get("source") != str(source)
                            or previous.get("destination") != str(destination)
                            or previous.get("status")
                            not in ("prepared", "aborted", "copying")
                        ):
                            raise WorkdirPathError("目标已存在且不是本次迁移副本。")
                        identity = destination.stat()
                        if (identity.st_dev, identity.st_ino) != (
                            previous.get("destination_device"),
                            previous.get("destination_inode"),
                        ):
                            raise WorkdirPathError("迁移副本已被替换，请检查后重试。")
                        original_identity = source.stat()
                        if (original_identity.st_dev, original_identity.st_ino) != (
                            previous.get("source_device"),
                            previous.get("source_inode"),
                        ):
                            raise WorkdirPathError("原工作目录已被替换，请检查后重试。")
                        if previous.get("copy_complete") is True:
                            directories, files = _inventory(source)
                            summary = _verify_copy(
                                source,
                                destination,
                                directories,
                                files,
                                should_stop,
                                progress,
                            )
                        else:
                            summary = copy_verified(
                                source,
                                destination,
                                should_stop=should_stop,
                                progress=progress,
                                resume=True,
                            )
                    else:
                        pending: dict[str, object] = {
                            "wid": wid,
                            "source": str(source),
                            "destination": str(destination),
                            "status": "copying",
                            "source_device": source.stat().st_dev,
                            "source_inode": source.stat().st_ino,
                        }
                        atomic_write_text(record, json.dumps(pending))

                        def record_destination() -> None:
                            info = destination.stat()
                            pending["destination_device"] = info.st_dev
                            pending["destination_inode"] = info.st_ino
                            atomic_write_text(record, json.dumps(pending))

                        summary = copy_verified(
                            source,
                            destination,
                            should_stop=should_stop,
                            progress=progress,
                            created=record_destination,
                        )
                    payload: dict[str, object] = {
                        "wid": wid,
                        "source": str(source),
                        "destination": str(destination),
                        "status": "prepared",
                        "copy_complete": True,
                        "source_device": source.stat().st_dev,
                        "source_inode": source.stat().st_ino,
                        "destination_device": destination.stat().st_dev,
                        "destination_inode": destination.stat().st_ino,
                        "directories": list(summary.directories),
                        "files": {
                            path: list(fingerprint)
                            for path, fingerprint in summary.files.items()
                        },
                    }
                    atomic_write_text(record, json.dumps(payload))
                    WorkdirRegistry.update_path(wid, destination)
                    payload["status"] = "cleanup-pending"
                    atomic_write_text(record, json.dumps(payload))
                finally:
                    state.release()
        finally:
            run.release()
        remaining = _remove_old_location(source, destination, payload)
        if not remaining:
            payload["status"] = "cleaned"
            atomic_write_text(record, json.dumps(payload))
        return {
            "wid": wid,
            "path": str(destination),
            "old_path": str(source),
            "cleanup_pending": remaining,
            "file_count": summary.file_count,
            "total_bytes": summary.total_bytes,
        }


def _read_record(path: Path) -> dict[str, object]:
    """维护记录读取失败时明确报错，不把损坏记录当成没有记录。"""
    try:
        raw: object = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise WorkdirPathError("迁移记录无法读取，请检查后重试。") from exc
    if not isinstance(raw, dict):
        raise WorkdirPathError("迁移记录损坏，请检查后重试。")
    return cast(dict[str, object], raw)


def relocation_status(wid: str) -> list[dict[str, object]]:
    """从持久记录发现中断副本与待清理旧位置，状态以当前注册表为准。"""
    current = registered_path(wid).resolve()
    results: list[dict[str, object]] = []
    for path in sorted((data_root() / "workdir-maintenance").glob("*.json")):
        record = _read_record(path)
        if (
            record.get("wid") != wid
            or record.get("status") == "cleaned"
            or record.get("operation") == "delete"
        ):
            continue
        source = record.get("source")
        destination = record.get("destination")
        if not isinstance(source, str) or not isinstance(destination, str):
            raise WorkdirPathError("迁移记录缺少路径，请检查后重试。")
        if current == Path(destination).resolve():
            status = "cleanup-pending"
        elif current == Path(source).resolve():
            if not Path(destination).exists():
                continue
            status = "copy-retained"
        else:
            status = "location-changed"
        results.append({"old_path": source, "path": destination, "status": status})
    return results


def _remove_old_location(
    source: Path, destination: Path, record: dict[str, object], *, force: bool = False
) -> bool:
    """删除已切换目录的旧位置，持久标记保留以拒绝过期写者。

    内容变更不再拦删（2026-10-10 裁：改由界面二次确认知情放行，见 `_location_diverged`），
    目录身份仍校验——同名换过一层皮，删的就不是当初那份数据。
    """
    if (
        source == destination
        or source.is_relative_to(destination)
        or destination.is_relative_to(source)
    ):
        raise WorkdirPathError("旧位置与新目录冲突，不能执行清理。")
    if destination.is_symlink() or destination.is_junction():
        raise WorkdirPathError(
            "新位置已被替换为符号链接或目录联接，保留旧目录，请检查后重试。"
        )
    if not destination.is_dir():
        raise WorkdirPathError("新目录不存在，保留旧位置以防数据丢失。")
    if source.is_symlink() or source.is_junction():
        raise WorkdirPathError("旧位置已被替换为符号链接或目录联接，请检查后重试。")
    try:
        if source.exists():
            if not force and _source_replaced(source, record):
                raise WorkdirPathError("旧位置已被其他目录替换，不能自动删除。")
            shutil.rmtree(source)
    except OSError:
        return True
    return False


def _source_replaced(path: Path, record: dict[str, object]) -> bool:
    """旧路径现在指的是不是另一个目录（同名换了一层皮，删的就不是当初那份数据）。"""
    if not path.is_dir():
        return False
    try:
        info = path.stat()
    except OSError:
        return True
    return (info.st_dev, info.st_ino) != (
        record.get("source_device"),
        record.get("source_inode"),
    )


def retry_relocation_cleanup(
    wid: str, old_path: Path, *, confirm_changed: bool = False
) -> dict[str, object]:
    """只清理由该工作目录迁移记录证明的旧位置，不能指定任意删除路径。

    旧目录被改动过或已被别的目录顶替时须带「confirm_changed」——界面对应的就是格 16
    那次知情确认；确认过就照删（2026-10-10 裁「删的能力永远保留，只是加知情确认」）。
    """
    source = old_path.absolute()
    destination = registered_path(wid).resolve()
    with (
        maintenance_guard(source, timeout=MAINTENANCE_WAIT_SECONDS),
        maintenance_guard(destination, timeout=MAINTENANCE_WAIT_SECONDS),
    ):
        if registered_path(wid).resolve() != destination:
            raise WorkdirPathError("工作目录位置已变化，请刷新后重试。")
        record = maintenance_record(source)
        if not record.is_file():
            raise WorkdirPathError("没有此旧位置的迁移记录，请刷新后重试。")
        data = _read_record(record)
        if (
            data.get("wid") != wid
            or data.get("source") != str(source)
            or data.get("destination") != str(destination)
        ):
            raise WorkdirPathError("迁移记录与当前目录不匹配，不能清理旧位置。")
        if data.get("status") == "cleaned":
            return {"old_path": str(source), "cleanup_pending": False}
        if (
            not confirm_changed
            and source.is_dir()
            and (_location_diverged(source, data) or _source_replaced(source, data))
        ):
            raise WorkdirPathError("旧目录在迁移后有变更或新增，请确认后重试。")
        store = WorkdirStore(destination)
        run = RunLock(store.dsf_path)
        state = StateLock(store.dsf_path)
        run.acquire({"operation": "relocation-cleanup", "pid": os.getpid()})
        try:
            with import_guard(store.dsf_path):
                state.acquire()
                try:
                    pending = _remove_old_location(
                        source, destination, data, force=confirm_changed
                    )
                finally:
                    state.release()
        finally:
            run.release()
        if not pending:
            data["status"] = "cleaned"
            atomic_write_text(record, json.dumps(data))
        return {"old_path": str(source), "cleanup_pending": pending}


def _location_diverged(path: Path, record: dict[str, object]) -> bool:
    """盘上内容与迁移记录里的清单是否已不一致（新增／缺失／大小变了）。

    只 stat 不哈希：这件事的用途是「要不要先问一声」和「新目录是不是已被用」，
    不是删除前的硬闸门——逐文件比哈希的旧口径已随 2026-10-10 裁放宽。
    """
    expected_files = record.get("files")
    expected_directories = record.get("directories")
    if not isinstance(expected_files, dict) or not isinstance(
        expected_directories, list
    ):
        return True
    sizes = cast("dict[str, object]", expected_files)
    try:
        directories, files = _inventory(path)
    except OSError:
        return True
    if any(str(relative) not in expected_directories for relative in directories):
        return True
    for relative in files:
        expected = sizes.get(str(relative))
        if (
            not isinstance(expected, list)
            or not expected
            or not isinstance(expected[0], int)
        ):
            return True
        try:
            if (path / relative).stat().st_size != expected[0]:
                return True
        except OSError:
            return True
    return len(files) != len(sizes)


def _record_for(wid: str, source: Path) -> dict[str, object]:
    """按旧位置取迁移记录并核对归属；记录不在或不属本次工作目录即拒。"""
    record = maintenance_record(source)
    if not record.is_file():
        raise WorkdirPathError("没有此旧位置的迁移记录，请刷新后重试。")
    data = _read_record(record)
    if data.get("wid") != wid or data.get("source") != str(source):
        raise WorkdirPathError("迁移记录与当前目录不匹配，不能处置。")
    return data


def _target_in_use(destination: Path, record: dict[str, object]) -> bool:
    """新位置是否已投入使用：内容与迁移那一刻的快照不同，或已留下运行记录。"""
    return _location_diverged(destination, record) or any(
        (destination / ".dsf" / name).exists()
        for name in ("run-info.json", "run-status.json")
    )


def relocation_evidence(wid: str, old_path: Path) -> dict[str, object]:
    """③类处置前给界面的一句话：旧位置在不在、被改动过没有、新位置能不能退。

    三个判据决定弹窗画哪一格——旧目录被改过才走「删除旧目录？」的知情确认（格 16），
    新位置已投入使用就不给「放弃迁移」（格 15，撤销会丢改动）。
    """
    source = old_path.absolute()
    data = _record_for(wid, source)
    destination = data.get("destination")
    if not isinstance(destination, str) or not destination:
        raise WorkdirPathError("迁移记录缺少目标路径，不能处置。")
    return {
        "old_present": source.exists(),
        "old_changed": source.is_dir() and _location_diverged(source, data),
        "old_replaced": _source_replaced(source, data),
        "target_in_use": _target_in_use(Path(destination), data),
    }


def abandon_copy(wid: str, destination: Path) -> dict[str, object]:
    """②类「放弃迁移」：删掉没切换过去的副本并结清记录，注册表与原目录一概不动。

    副本是这次迁移自己造的中间物，删它不必比对内容——原目录才是权威。
    """
    copy_path = destination.absolute()
    source = registered_path(wid).resolve()
    with (
        maintenance_guard(source, timeout=MAINTENANCE_WAIT_SECONDS),
        maintenance_guard(copy_path, timeout=MAINTENANCE_WAIT_SECONDS),
    ):
        record = maintenance_record(source)
        data = _record_for(wid, source)
        if data.get("destination") != str(copy_path):
            raise WorkdirPathError("迁移记录与目标副本不匹配，不能删除副本。")
        if data.get("status") != "cleaned":
            if copy_path.is_symlink() or copy_path.is_junction():
                raise WorkdirPathError("副本是符号链接或目录联接，请手动检查后再处理。")
            if copy_path.exists():
                shutil.rmtree(copy_path)
            data["status"] = "cleaned"
            atomic_write_text(record, json.dumps(data))
        return {"path": str(source), "removed": str(copy_path)}


def abandon_switchover(wid: str, old_path: Path) -> dict[str, object]:
    """③类「放弃迁移」：注册表退回原目录、删掉新目录，并把记录标 「cleaned」。

    两件事都不能省：只回注册表不标记录，「require_workdir_writable」 会按「已迁移」
    把退回后的原目录判成不可写；只标记录不删新目录，盘上就多一份没人认领的副本。
    """
    source = old_path.absolute()
    new_location = registered_path(wid).resolve()
    with (
        maintenance_guard(source, timeout=MAINTENANCE_WAIT_SECONDS),
        maintenance_guard(new_location, timeout=MAINTENANCE_WAIT_SECONDS),
    ):
        record = maintenance_record(source)
        data = _record_for(wid, source)
        if data.get("destination") != str(new_location):
            raise WorkdirPathError("迁移记录与当前目录不匹配，不能退回。")
        if data.get("status") != "cleaned":
            if not source.is_dir():
                raise WorkdirPathError(
                    "旧目录已不在，这次迁移无法放弃，请改为清理旧位置。"
                )
            if _target_in_use(new_location, data):
                raise WorkdirPathError("新目录已投入使用，不能放弃这次迁移。")
            store = WorkdirStore(new_location)
            run = RunLock(store.dsf_path)
            state = StateLock(store.dsf_path)
            run.acquire({"operation": "relocation-rollback", "pid": os.getpid()})
            try:
                with import_guard(store.dsf_path):
                    state.acquire()
                    try:
                        data["status"] = "aborted"
                        atomic_write_text(record, json.dumps(data))
                        WorkdirRegistry.update_path(wid, source)
                    finally:
                        state.release()
            finally:
                run.release()
            # 锁全部放开后再删新目录：imports.lock 还被自己开着，Windows 不许 unlink。
            # 删不掉就让记录停在 aborted——它就此按②类「副本待处置」待认领，
            # 继续迁移或放弃都还有路，不会多出一份没人认领、又查不到的目录。
            pending = True
            try:
                if new_location.exists():
                    shutil.rmtree(new_location)
                pending = False
            except OSError:
                pass
            if not pending:
                data["status"] = "cleaned"
                atomic_write_text(record, json.dumps(data))
            return {
                "path": str(source),
                "rolled_back": True,
                "cleanup_pending": pending,
            }
        return {"path": str(source), "rolled_back": False, "cleanup_pending": False}
