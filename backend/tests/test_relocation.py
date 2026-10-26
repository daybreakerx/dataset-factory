"""迁移复制：完整副本、内容校验、取消与失败时的数据保全。"""

import json
import threading
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import cast

import pytest

from dataset_factory._fs import atomic_write_text
from dataset_factory.tasks import TaskCancelledError
from dataset_factory.workdir import (
    RunOccupiedError,
    WorkdirPathError,
    WorkdirRegistry,
    WorkdirStore,
)
from dataset_factory.workdir.locks import (
    RunLock,
    StateLock,
    import_guard,
    maintenance_record,
)
from dataset_factory.workdir.relocation import (
    abandon_copy,
    abandon_switchover,
    copy_verified,
    relocate_workdir,
    relocation_evidence,
    relocation_status,
    retry_relocation_cleanup,
)

pytestmark = pytest.mark.usefixtures("temp_data_root")


def test_copy_verified_includes_metadata_and_empty_directories(tmp_path: Path) -> None:
    """素材、产物、隐藏元数据及空目录全部复制，返回实际数量与字节。"""
    source = tmp_path / "source"
    source.mkdir()
    store = WorkdirStore(source)
    (source / "a.jpg").write_bytes(b"image")
    (source / "s1__a.txt").write_bytes(b"caption")
    (store.dsf_path / "imports.jsonl").write_bytes(b"record")
    destination = tmp_path / "destination"

    summary = copy_verified(source, destination)

    assert summary.file_count == 3
    assert summary.total_bytes == 18
    assert (destination / "a.jpg").read_bytes() == b"image"
    assert (destination / "s1__a.txt").read_bytes() == b"caption"
    assert (destination / ".dsf/imports.jsonl").read_bytes() == b"record"
    assert (destination / ".dsf/runs").is_dir()
    assert (source / "a.jpg").read_bytes() == b"image"


def test_copy_verified_cancel_preserves_source(tmp_path: Path) -> None:
    """复制中取消只清理本次副本，原目录字节保持完整。"""
    source = tmp_path / "source"
    source.mkdir()
    (source / "a.jpg").write_bytes(b"image")
    destination = tmp_path / "destination"
    stop = threading.Event()

    def cancel(progress: float) -> None:
        stop.set()

    with pytest.raises(TaskCancelledError):
        copy_verified(source, destination, should_stop=stop, progress=cancel)

    assert (source / "a.jpg").read_bytes() == b"image"
    assert not destination.exists()


def test_copy_progress_callback_failure_removes_only_its_copy(tmp_path: Path) -> None:
    """进度回调异常也清理本次副本，不影响原文件。"""
    source = tmp_path / "source"
    source.mkdir()
    (source / "a.jpg").write_bytes(b"image")
    destination = tmp_path / "destination"

    def fail(progress: float) -> None:
        raise RuntimeError("progress delivery failed")

    with pytest.raises(RuntimeError, match="progress delivery failed"):
        copy_verified(source, destination, progress=fail)

    assert not destination.exists()
    assert (source / "a.jpg").read_bytes() == b"image"


def test_copy_verified_while_directory_locks_are_held(tmp_path: Path) -> None:
    """持有目录内三把锁时仍能复制业务元数据，不读取独占锁文件。"""
    source = tmp_path / "source"
    source.mkdir()
    store = WorkdirStore(source)
    store.mutate_state(lambda state: state.update({"version": 1}))
    destination = tmp_path / "destination"
    run = RunLock(store.dsf_path)
    state = StateLock(store.dsf_path)

    run.acquire({"operation": "relocate"})
    try:
        with import_guard(store.dsf_path):
            state.acquire()
            try:
                summary = copy_verified(source, destination)
            finally:
                state.release()
    finally:
        run.release()

    assert summary.file_count == 1
    assert (
        destination / ".dsf/state.json"
    ).read_bytes() == store.state_file.read_bytes()
    assert not (destination / ".dsf/run-info.json").exists()
    assert not list((destination / ".dsf").glob("*.lock"))


def test_copy_verified_detects_changed_copy(tmp_path: Path) -> None:
    """复制后副本被改写，哈希校验失败而不是发布损坏副本。"""
    source = tmp_path / "source"
    source.mkdir()
    (source / "a.jpg").write_bytes(b"image")
    destination = tmp_path / "destination"

    def corrupt(progress: float) -> None:
        if progress == 0.5:
            (destination / "a.jpg").write_bytes(b"other")

    with pytest.raises(WorkdirPathError, match="校验失败"):
        copy_verified(source, destination, progress=corrupt)

    assert (source / "a.jpg").read_bytes() == b"image"
    assert not destination.exists()


@pytest.mark.parametrize("target", ["source", "source/nested", "existing"])
def test_copy_verified_rejects_conflicting_target(tmp_path: Path, target: str) -> None:
    """同目录、嵌套目录与「已存在且非空」的目标都在复制前拒绝（空目录放行见下一例）。"""
    source = tmp_path / "source"
    source.mkdir()
    (source / "a.jpg").write_bytes(b"image")
    (tmp_path / "existing").mkdir()
    (tmp_path / "existing" / "occupied.txt").write_bytes(b"x")

    with pytest.raises(WorkdirPathError):
        copy_verified(source, tmp_path / target)

    assert (source / "a.jpg").read_bytes() == b"image"


def test_copy_verified_allows_existing_empty_target(tmp_path: Path) -> None:
    """目标已存在但为空＝放行（2026-10-10 裁：判空才是条件，不是「必须不存在」）。"""
    source = tmp_path / "source"
    source.mkdir()
    (source / "a.jpg").write_bytes(b"image")
    destination = tmp_path / "empty-target"
    destination.mkdir()

    summary = copy_verified(source, destination)

    assert summary.file_count == 1
    assert (destination / "a.jpg").read_bytes() == b"image"


def test_copy_verified_detects_new_source_file(tmp_path: Path) -> None:
    """复制期间源目录新增文件，校验拒绝漏文件的副本。"""
    source = tmp_path / "source"
    source.mkdir()
    (source / "a.jpg").write_bytes(b"image")
    destination = tmp_path / "destination"

    def add_file(progress: float) -> None:
        if progress == 0.5:
            (source / "b.jpg").write_bytes(b"new")

    with pytest.raises(WorkdirPathError, match="清单发生变化"):
        copy_verified(source, destination, progress=add_file)

    assert not destination.exists()
    assert (source / "b.jpg").read_bytes() == b"new"


def test_copy_verified_scan_error_does_not_publish_partial_inventory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """目录扫描被权限拒绝时直接失败，不把缺少子目录的清单当成成功。"""
    source = tmp_path / "source"
    source.mkdir()
    destination = tmp_path / "destination"

    def unreadable_walk(
        root: Path,
        *,
        followlinks: bool,
        onerror: Callable[[OSError], None],
    ) -> Iterator[tuple[str, list[str], list[str]]]:
        onerror(PermissionError("test unreadable directory"))
        return iter([])

    monkeypatch.setattr("dataset_factory.workdir.relocation.os.walk", unreadable_walk)

    with pytest.raises(PermissionError):
        copy_verified(source, destination)

    assert source.is_dir()
    assert not destination.exists()


def test_relocate_updates_registry_and_cleans_old_location(
    tmp_path: Path, temp_data_root: Path
) -> None:
    """迁移保留标识与业务内容，完整校验后自动清理旧目录。"""
    source = tmp_path / "source"
    source.mkdir()
    store = WorkdirStore(source)
    store.mutate_state(lambda state: state.update({"keep": 1}))
    (source / "a.jpg").write_bytes(b"image")
    entry = WorkdirRegistry.register(source)
    destination = tmp_path / "destination"

    result = relocate_workdir(entry.id, destination)

    assert result["cleanup_pending"] is False
    assert not source.exists()
    assert Path(WorkdirRegistry.get(entry.id).path) == destination
    assert WorkdirStore(destination).read_state() == {"keep": 1}
    assert (destination / "a.jpg").read_bytes() == b"image"
    with pytest.raises(WorkdirPathError):
        store.mutate_state(lambda state: state.update({"keep": 2}))
    assert not source.exists()


def test_recreated_old_path_can_register_without_accepting_stale_state_writer(
    tmp_path: Path, temp_data_root: Path
) -> None:
    """清理后同路径新目录可登记，旧存储对象不能改写新目录状态。

    陈旧检测以 (dev, ino) 为身份（StateLock / import_guard 写前核对）。inode 复用
    属机制盲区：Linux 上释放的 inode 可能被同路径新目录立即复用，此时新旧目录
    (dev, ino) 相同、检测在机制上无从分辨——与下一测试的登记侧取舍同源，设计
    接受此界。故断言只在「未复用」（可分辨）时生效：旧对象的写必须被拒；
    复用发生时跳过（写会落进新目录，属已知边界）。
    """
    source = tmp_path / "source"
    source.mkdir()
    stale = WorkdirStore(source)
    stale_identity = (source.stat().st_dev, source.stat().st_ino)
    entry = WorkdirRegistry.register(source)
    destination = tmp_path / "destination"
    relocate_workdir(entry.id, destination)
    source.mkdir()

    new_entry = WorkdirRegistry.register(source)
    current = WorkdirStore(source)
    current.mutate_state(lambda state: state.update({"new": True}))
    if (source.stat().st_dev, source.stat().st_ino) != stale_identity:
        with pytest.raises(WorkdirPathError):
            stale.mutate_state(lambda state: state.update({"unexpected": True}))
        with pytest.raises(WorkdirPathError):
            stale.append_import_record(
                {"imported_at": "now", "source": "", "files": []}
            )

    assert new_entry.id != entry.id
    assert current.read_state() == {"new": True}
    assert current.read_import_records() == []


def test_cleaned_record_allows_recreated_path_with_recycled_inode(
    tmp_path: Path, temp_data_root: Path
) -> None:
    """cleaned 后同路径重建可登记：inode 复用使 (dev, ino) 相同也不能误判为旧目录。

    回归锚（CI ubuntu 3 跑 2 红的根因）：迁移清理会移除旧目录、释放其 inode，
    紧随的重建在 Linux 文件系统上常复用该 inode——守卫若用 (st_dev, st_ino)
    当目录身份，重建的新目录会被误判成旧目录而拒绝登记。本用例把记录里的来源
    身份手工改写成重建目录的真实身份（即复用后的形态），钉死「cleaned 后一律
    放行」，在任何文件系统上确定性复现修复前的红。
    """
    source = tmp_path / "source"
    source.mkdir()
    entry = WorkdirRegistry.register(source)
    destination = tmp_path / "destination"
    relocate_workdir(entry.id, destination)
    source.mkdir()

    info = source.stat()
    record = maintenance_record(source)
    payload = cast(dict[str, object], json.loads(record.read_text(encoding="utf-8")))
    payload["source_device"] = info.st_dev
    payload["source_inode"] = info.st_ino
    atomic_write_text(record, json.dumps(payload, ensure_ascii=False))

    new_entry = WorkdirRegistry.register(source)
    assert new_entry.id != entry.id


def test_relocate_cancel_keeps_registry_and_original(
    tmp_path: Path, temp_data_root: Path
) -> None:
    """取消发生在路径切换前，原目录与注册表保持一致。"""
    source = tmp_path / "source"
    source.mkdir()
    (source / "a.jpg").write_bytes(b"image")
    entry = WorkdirRegistry.register(source)
    stop = threading.Event()
    stop.set()
    destination = tmp_path / "destination"

    with pytest.raises(TaskCancelledError):
        relocate_workdir(entry.id, destination, should_stop=stop)

    assert Path(WorkdirRegistry.get(entry.id).path) == source
    assert (source / "a.jpg").read_bytes() == b"image"
    assert not destination.exists()


def test_crash_before_registry_switch_keeps_original_writable(
    tmp_path: Path, temp_data_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """副本完成后切换前崩溃，重新打开原目录可继续写入且两份素材均保留。"""
    source = tmp_path / "source"
    source.mkdir()
    (source / "a.jpg").write_bytes(b"image")
    entry = WorkdirRegistry.register(source)
    destination = tmp_path / "destination"

    def crash(wid: str, new_path: Path) -> None:
        raise KeyboardInterrupt("simulated process interruption")

    with monkeypatch.context() as patch:
        patch.setattr(WorkdirRegistry, "update_path", crash)
        with pytest.raises(KeyboardInterrupt):
            relocate_workdir(entry.id, destination)
    reopened = WorkdirStore(source)
    reopened.mutate_state(lambda state: state.update({"recovered": True}))

    assert Path(WorkdirRegistry.get(entry.id).path) == source
    assert reopened.read_state() == {"recovered": True}
    assert (source / "a.jpg").read_bytes() == b"image"
    assert (destination / "a.jpg").read_bytes() == b"image"


def test_crash_after_registry_switch_can_finish_old_location_cleanup(
    tmp_path: Path, temp_data_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """注册表切换后中断，prepared 记录仍足以验证并清理旧位置。"""
    source = tmp_path / "source"
    source.mkdir()
    (source / "a.jpg").write_bytes(b"image")
    entry = WorkdirRegistry.register(source)
    destination = tmp_path / "destination"
    update = WorkdirRegistry.update_path

    def crash(wid: str, new_path: Path) -> None:
        update(wid, new_path)
        raise KeyboardInterrupt("simulated process interruption")

    with monkeypatch.context() as patch:
        patch.setattr(WorkdirRegistry, "update_path", crash)
        with pytest.raises(KeyboardInterrupt):
            relocate_workdir(entry.id, destination)
    with pytest.raises(WorkdirPathError):
        WorkdirStore(source)
    result = retry_relocation_cleanup(entry.id, source)

    assert result["cleanup_pending"] is False
    assert not source.exists()
    assert (destination / "a.jpg").read_bytes() == b"image"


def test_retry_after_interrupted_registry_switch_reuses_verified_copy(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """切换前中断后重试相同目标，重新核验完整副本后完成迁移。"""
    source = tmp_path / "source"
    source.mkdir()
    (source / "a.jpg").write_bytes(b"image")
    entry = WorkdirRegistry.register(source)
    destination = tmp_path / "destination"

    def interrupt(wid: str, new_path: Path) -> None:
        raise KeyboardInterrupt("interrupted before switch")

    with monkeypatch.context() as patch:
        patch.setattr(WorkdirRegistry, "update_path", interrupt)
        with pytest.raises(KeyboardInterrupt):
            relocate_workdir(entry.id, destination)
    before = relocation_status(entry.id)
    result = relocate_workdir(entry.id, destination)

    assert before == [
        {
            "old_path": str(source),
            "path": str(destination),
            "status": "copy-retained",
        }
    ]
    assert result["cleanup_pending"] is False
    assert relocation_status(entry.id) == []
    assert not source.exists()
    assert Path(WorkdirRegistry.get(entry.id).path) == destination
    assert (destination / "a.jpg").read_bytes() == b"image"


def test_retry_after_interruption_preserves_changed_copy(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """中断副本被改写后重试必须拒绝，两侧文件均保留。"""
    source = tmp_path / "source"
    source.mkdir()
    (source / "a.jpg").write_bytes(b"image")
    entry = WorkdirRegistry.register(source)
    destination = tmp_path / "destination"

    def interrupt(wid: str, new_path: Path) -> None:
        raise KeyboardInterrupt("interrupted before switch")

    with monkeypatch.context() as patch:
        patch.setattr(WorkdirRegistry, "update_path", interrupt)
        with pytest.raises(KeyboardInterrupt):
            relocate_workdir(entry.id, destination)
    (destination / "a.jpg").write_bytes(b"new data")

    with pytest.raises(WorkdirPathError, match="校验失败"):
        relocate_workdir(entry.id, destination)

    assert Path(WorkdirRegistry.get(entry.id).path) == source
    assert (source / "a.jpg").read_bytes() == b"image"
    assert (destination / "a.jpg").read_bytes() == b"new data"


def test_relocate_cleanup_can_retry_without_deleting_recreated_directory(
    tmp_path: Path, temp_data_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """旧目录占用时保留重试，成功后的重复请求不删除后来同路径的新目录。"""
    source = tmp_path / "source"
    source.mkdir()
    (source / "a.jpg").write_bytes(b"image")
    entry = WorkdirRegistry.register(source)
    destination = tmp_path / "destination"

    def fail_delete(path: Path) -> None:
        raise PermissionError("test occupied directory")

    with monkeypatch.context() as patch:
        patch.setattr("dataset_factory.workdir.relocation.shutil.rmtree", fail_delete)
        result = relocate_workdir(entry.id, destination)
    retry = retry_relocation_cleanup(entry.id, source)
    source.mkdir()
    (source / "keep.txt").write_bytes(b"new")
    repeated = retry_relocation_cleanup(entry.id, source)

    assert result["cleanup_pending"] is True
    assert retry["cleanup_pending"] is False
    assert repeated["cleanup_pending"] is False
    assert (source / "keep.txt").read_bytes() == b"new"


def test_relocation_cleanup_refuses_changed_old_location(
    tmp_path: Path, temp_data_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """旧位置被改动过＝未确认时拒删，检测口先报「changed」，确认后才真删（旧口径的硬拒放宽）。"""
    source = tmp_path / "source"
    source.mkdir()
    (source / "a.jpg").write_bytes(b"image")
    entry = WorkdirRegistry.register(source)
    destination = tmp_path / "destination"

    def fail_delete(path: Path) -> None:
        raise PermissionError("test occupied directory")

    with monkeypatch.context() as patch:
        patch.setattr("dataset_factory.workdir.relocation.shutil.rmtree", fail_delete)
        relocate_workdir(entry.id, destination)
    (source / "a.jpg").write_bytes(b"changed")
    assert relocation_evidence(entry.id, source) == {
        "old_present": True,
        "old_changed": True,
        "old_replaced": False,
        "target_in_use": False,
    }
    with pytest.raises(WorkdirPathError, match="请确认后重试"):
        retry_relocation_cleanup(entry.id, source)

    retry_relocation_cleanup(entry.id, source, confirm_changed=True)

    assert not source.exists()


def test_relocation_rejects_another_threads_active_run(
    tmp_path: Path, temp_data_root: Path
) -> None:
    """另一线程持有运行锁时迁移被拒，注册表与原文件均不变化。"""
    source = tmp_path / "source"
    source.mkdir()
    store = WorkdirStore(source)
    (source / "a.jpg").write_bytes(b"image")
    entry = WorkdirRegistry.register(source)
    destination = tmp_path / "destination"
    run = RunLock(store.dsf_path)
    errors: list[Exception] = []

    def move() -> None:
        try:
            relocate_workdir(entry.id, destination)
        except RunOccupiedError as exc:
            errors.append(exc)

    run.acquire({"operation": "test"})
    try:
        worker = threading.Thread(target=move)
        worker.start()
        worker.join(5)
    finally:
        run.release()

    assert not worker.is_alive()
    assert len(errors) == 1
    assert isinstance(errors[0], RunOccupiedError)
    assert Path(WorkdirRegistry.get(entry.id).path) == source
    assert not destination.exists()
    assert (source / "a.jpg").read_bytes() == b"image"


def test_state_writer_waiting_for_relocation_cannot_recreate_source(
    tmp_path: Path, temp_data_root: Path
) -> None:
    """迁移中的并发状态写者等待后拒绝旧位置，不重建已删除的元数据目录。"""
    source = tmp_path / "source"
    source.mkdir()
    store = WorkdirStore(source)
    store.mutate_state(lambda state: state.update({"keep": 1}))
    entry = WorkdirRegistry.register(source)
    destination = tmp_path / "destination"
    started = threading.Event()
    errors: list[Exception] = []

    def write() -> None:
        started.set()
        try:
            store.mutate_state(lambda state: state.update({"unexpected": 2}))
        except WorkdirPathError as exc:
            errors.append(exc)

    writer = threading.Thread(target=write)

    def progress(value: float) -> None:
        if not started.is_set():
            writer.start()
            assert started.wait(5)

    relocate_workdir(entry.id, destination, progress=progress)
    writer.join(5)

    assert not writer.is_alive()
    assert len(errors) == 1
    assert isinstance(errors[0], WorkdirPathError)
    assert not source.exists()
    assert WorkdirStore(destination).read_state() == {"keep": 1}


def _crash_after_registry_switch(
    wid: str, destination: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """跑一次迁移，在注册表切换后立刻中断，留下「已切换未清旧」的③类现场。

    补丁随上下文退出：处置动作自己也要改注册表，补丁留着会把它们一起炸掉。
    """
    update = WorkdirRegistry.update_path

    def crash(_wid: str, new_path: Path) -> None:
        update(_wid, new_path)
        raise KeyboardInterrupt("interrupted after switch")

    with monkeypatch.context() as patch:
        patch.setattr(WorkdirRegistry, "update_path", crash)
        with pytest.raises(KeyboardInterrupt):
            relocate_workdir(wid, destination)


def test_abandon_copy_removes_the_unswitched_copy(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """②类「放弃迁移」删掉没切换过去的副本，原目录与注册表一概不动。"""
    source = tmp_path / "source"
    source.mkdir()
    (source / "a.jpg").write_bytes(b"image")
    entry = WorkdirRegistry.register(source)
    destination = tmp_path / "destination"

    def interrupt(_wid: str, _new_path: Path) -> None:
        raise KeyboardInterrupt("interrupted before switch")

    with monkeypatch.context() as patch:
        patch.setattr(WorkdirRegistry, "update_path", interrupt)
        with pytest.raises(KeyboardInterrupt):
            relocate_workdir(entry.id, destination)
    assert [item["status"] for item in relocation_status(entry.id)] == ["copy-retained"]

    result = abandon_copy(entry.id, destination)

    assert result["path"] == str(source)
    assert not destination.exists()
    assert (source / "a.jpg").read_bytes() == b"image"
    assert Path(WorkdirRegistry.get(entry.id).path) == source
    assert relocation_status(entry.id) == []
    WorkdirStore(source)


def test_abandon_switchover_returns_registry_to_the_old_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """③类「放弃迁移」退回原目录并删掉新目录，记录标 cleaned 后原位置重新可写。"""
    source = tmp_path / "source"
    source.mkdir()
    (source / "a.jpg").write_bytes(b"image")
    entry = WorkdirRegistry.register(source)
    destination = tmp_path / "destination"
    _crash_after_registry_switch(entry.id, destination, monkeypatch)
    assert [item["status"] for item in relocation_status(entry.id)] == [
        "cleanup-pending"
    ]

    result = abandon_switchover(entry.id, source)

    assert result["path"] == str(source)
    assert not destination.exists()
    assert (source / "a.jpg").read_bytes() == b"image"
    assert Path(WorkdirRegistry.get(entry.id).path) == source
    assert relocation_status(entry.id) == []
    WorkdirStore(source)


def test_abandon_switchover_refuses_when_new_directory_is_in_use(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """新目录已开始运行时「放弃迁移」拒办——撤销会丢改动，只剩「删除旧目录」一条去向。"""
    source = tmp_path / "source"
    source.mkdir()
    (source / "a.jpg").write_bytes(b"image")
    entry = WorkdirRegistry.register(source)
    destination = tmp_path / "destination"
    _crash_after_registry_switch(entry.id, destination, monkeypatch)

    (destination / "extra.jpg").write_bytes(b"work")

    assert relocation_evidence(entry.id, source)["target_in_use"] is True
    with pytest.raises(WorkdirPathError, match="已投入使用"):
        abandon_switchover(entry.id, source)
    assert destination.is_dir()
    assert (destination / "extra.jpg").read_bytes() == b"work"


def test_abandon_operations_reject_records_of_other_workdirs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """两个新操作都按记录证明归属，拿别人的旧路径来处置一律拒。"""
    source = tmp_path / "source"
    source.mkdir()
    (source / "a.jpg").write_bytes(b"image")
    entry = WorkdirRegistry.register(source)
    other_dir = tmp_path / "other"
    other_dir.mkdir()
    other = WorkdirRegistry.register(other_dir)
    destination = tmp_path / "destination"
    _crash_after_registry_switch(entry.id, destination, monkeypatch)

    with pytest.raises(WorkdirPathError, match="迁移记录与当前目录不匹配"):
        abandon_switchover(other.id, source)
    with pytest.raises(WorkdirPathError, match="迁移记录与当前目录不匹配"):
        relocation_evidence(other.id, source)


def test_relocation_refuses_while_eval_run_lock_held(tmp_path: Path) -> None:
    """整目录迁移要认评测运行锁：评测在跑就拒绝，注册表与原目录原样。

    评测运行持 ``.dsf/eval/run.lock``、与打标的 ``run.lock`` 互不阻塞——只认打标锁
    会在评测跑到一半时把目录搬走。
    """
    source = tmp_path / "source"
    source.mkdir()
    (source / "a.jpg").write_bytes(b"image")
    store = WorkdirStore(source)
    entry = WorkdirRegistry.register(source)
    destination = tmp_path / "destination"
    eval_dir = store.dsf_path / "eval"
    eval_dir.mkdir()
    holder = RunLock(eval_dir)
    errors: list[Exception] = []

    def move() -> None:
        try:
            relocate_workdir(entry.id, destination)
        except RunOccupiedError as exc:
            errors.append(exc)

    holder.acquire({"operation": "test", "batch": "e1"})
    try:
        worker = threading.Thread(target=move)
        worker.start()
        worker.join(15)
    finally:
        holder.release()

    assert not worker.is_alive()
    assert len(errors) == 1
    assert "评测" in str(errors[0])  # 占用者是评测运行，不能提示成「有跑批在跑」
    assert Path(WorkdirRegistry.get(entry.id).path) == source
    assert not destination.exists()
    assert (source / "a.jpg").read_bytes() == b"image"


def test_relocation_copies_eval_data_without_runtime_locks(tmp_path: Path) -> None:
    """有 ``.dsf/eval/`` 的目录照样能迁移：业务数据随迁，锁文件（读不了也没意义）不复制。"""
    source = tmp_path / "source"
    source.mkdir()
    (source / "a.jpg").write_bytes(b"image")
    store = WorkdirStore(source)
    eval_dir = store.dsf_path / "eval"
    eval_dir.mkdir()
    (eval_dir / "state.json").write_text('{"batches": []}', encoding="utf-8")
    lock = RunLock(eval_dir)
    lock.acquire({"operation": "test", "batch": "e1"})
    lock.release()  # 释放后锁文件仍在（preserve_lock_file），模拟一次跑过评测的目录
    entry = WorkdirRegistry.register(source)
    destination = tmp_path / "destination"

    result = relocate_workdir(entry.id, destination)

    assert result["cleanup_pending"] is False
    assert (destination / ".dsf" / "eval" / "state.json").is_file()
    assert not (destination / ".dsf" / "eval" / "run.lock").exists()
    assert (destination / "a.jpg").read_bytes() == b"image"
