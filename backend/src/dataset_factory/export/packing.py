"""按文件现状生成交付计划，ZIP 只包含素材与同名 caption。"""

from __future__ import annotations

import hashlib
import os
import tempfile
from collections.abc import Callable, Mapping, Set
from dataclasses import dataclass, replace
from pathlib import Path
from threading import Event
from zipfile import ZIP_DEFLATED, ZipFile

from .._fs import hash_stream, is_single_path_segment
from ..tasks import TaskCancelledError
from ..workdir.assets import (
    ASSET_EXTENSIONS,
    confine_to_workdir,
    product_path,
    registered_origins,
    unimported_files,
)
from ..workdir.errors import AssetPathError, WorkdirPathError
from ..workdir.integrity import IntegrityStatus, scan_integrity
from ..workdir.store import WorkdirStore


class ExportError(Exception):
    """导出无法完成，错误消息说明可重试或需要处置的原因。"""


@dataclass(frozen=True)
class ExportRow:
    """一条配对计划或排除记录；大小为未压缩的实际字节数。

    ``source`` / ``recoverable`` 只在「缺失」排除行上填：界面据此决定给
    「重新导入」（来源还在）还是「重新指定」（来源已没了）——与左列缺失行同一把尺。
    ``name_conflict`` 只在关态同名行上置位（2026-10-13 稿㉑）：照常入包，
    界面行内挂琥珀标记「有同名文件(仅大小写不同)，建议开启顺序重命名」。
    """

    item: str
    name: str
    asset_name: str | None = None
    caption_name: str | None = None
    asset_bytes: int = 0
    caption_bytes: int = 0
    asset_hash: str | None = None
    caption_hash: str | None = None
    integrity: IntegrityStatus | None = None
    reason: str | None = None
    source: str | None = None
    recoverable: bool | None = None
    name_conflict: bool = False


# 「素材在、本批还没有可用产物」的两类：不入将入包、也不进被排除清单——它们的家在
# 左列「排队中」分组（2026-10-10 用户裁：还没打标不该在打包清单里重复报警，无效产物
# 下次全量天然重打）。
_QUIET_REASONS = frozenset({"无配对产物", "产物异常"})


@dataclass(frozen=True)
class ExportPlan:
    """当前批次的将入包、被排除清单与原名兼容性提示。"""

    batch: int
    sequential: bool
    included: list[ExportRow]
    excluded: list[ExportRow]
    total_bytes: int
    non_ascii_names: bool


def build_export_plan(
    workdir: Path,
    seq: int,
    *,
    labeling_hashes: Mapping[str, str],
    failed_items: Set[str] = frozenset(),
    excluded_items: Set[str] = frozenset(),
    sequential: bool = True,
    should_stop: Event | None = None,
) -> ExportPlan:
    """扫描当前批次配对，按导入顺序生成清单；过期和未知锚点不自动排除。

    批次存在性、活跃状态与运行流水由入口层核实并传入；本模块只依赖工作目录域。
    磁盘上的同主干多素材（顺序态也用 001 编号之外的物理撞名）按配对冲突排除，
    避免悄悄选择其中一份交付；关态用原名时的同类名（仅大小写不同）不再排除
    （2026-10-13 稿㉑）——仍入包、行内挂标记，出路＝开回顺序重命名。
    """
    _check_cancel(should_stop)
    if seq < 1:
        raise ExportError("批次序号必须为正整数。")
    if not workdir.is_dir():
        raise WorkdirPathError("工作目录不存在，请检查路径后重试。")
    origins = registered_origins(WorkdirStore(workdir))
    integrity = scan_integrity(workdir, labeling_hashes, should_stop=should_stop)
    counts: dict[str, int] = {}
    for path in workdir.iterdir():
        if path.is_file() and path.suffix.lower() in ASSET_EXTENSIONS:
            counts[path.stem] = counts.get(path.stem, 0) + 1
    included: list[ExportRow] = []
    excluded: list[ExportRow] = []
    for checked in integrity:
        _check_cancel(should_stop)
        row = ExportRow(checked.item, checked.name, integrity=checked.status)
        reason: str | None = None
        if checked.status in ("missing", "unreadable"):
            # 「素材不可读取」并入「缺失」（2026-10-10 用户裁：与缺失同构——都是素材本身
            # 读不到，处置出口也同一个）。两类都带来源只读探测，界面据此分「重新导入」
            # （来源还在）与「重新指定」（来源已失效），与左列缺失行同一把尺。
            reason = "缺失"
            origin = origins.get(checked.name)
            if origin is not None:
                source_file = Path(origin.source) / origin.name
                row = replace(
                    row,
                    source=str(source_file),
                    recoverable=source_file.is_file(),
                )
        elif counts.get(checked.item, 0) > 1:
            reason = "配对冲突"
        elif checked.item in excluded_items:
            reason = "用户排除"
        elif checked.item in failed_items:
            reason = "未完成"
        else:
            try:
                caption = product_path(workdir, seq, checked.item)
                if not caption.is_file():
                    reason = "无配对产物"
                else:
                    content = caption.read_bytes()
                    if not content.decode("utf-8").strip():
                        reason = "产物异常"
                    else:
                        row = replace(
                            row,
                            asset_bytes=(workdir / checked.name).stat().st_size,
                            caption_bytes=len(content),
                            asset_hash=checked.current_hash,
                            caption_hash=hashlib.sha256(content).hexdigest(),
                        )
            except (OSError, UnicodeDecodeError, AssetPathError):
                reason = "产物异常"
        if reason is None:
            included.append(row)
        elif reason not in _QUIET_REASONS:
            excluded.append(replace(row, reason=reason))
    for unimported in unimported_files(workdir, set(origins)):
        excluded.append(
            ExportRow(Path(unimported.name).stem, unimported.name, reason="未登记")
        )
    if not sequential:
        # 关态用原名：同类名（仅大小写不同）不再整批移入被排除——2026-10-13
        # 稿㉑「默认入包＋琥珀色警告」：仍入包、行内挂标记（一句即含出路＝
        # 开回顺序重命名得 001／002 天然不撞名）；打包层对撞名行随行消歧，
        # 不硬失败（原 ExportError 兜底让 Linux 用户打不出包）。
        stems: dict[str, int] = {}
        for row in included:
            key = row.item.casefold()
            stems[key] = stems.get(key, 0) + 1
        conflicts = {key for key, count in stems.items() if count > 1}
        included = [
            replace(row, name_conflict=row.item.casefold() in conflicts)
            if row.item.casefold() in conflicts
            else row
            for row in included
        ]
    width = max(3, len(str(len(included))))
    included = [
        replace(
            row,
            asset_name=(
                f"{index:0{width}d}{Path(row.name).suffix}" if sequential else row.name
            ),
            caption_name=(
                f"{index:0{width}d}.txt" if sequential else f"{row.item}.txt"
            ),
        )
        for index, row in enumerate(included, 1)
    ]
    _check_cancel(should_stop)
    return ExportPlan(
        seq,
        sequential,
        included,
        excluded,
        sum(row.asset_bytes + row.caption_bytes for row in included),
        not sequential and any(not row.name.isascii() for row in included),
    )


def _disambiguate(name: str, used: set[str]) -> str:
    """ZIP 内条目名撞名（仅大小写不同）时随行加序号后缀，返回可用的条目名。

    2026-10-13 稿㉑兜底：关态同名行照常入包，写包层不再整包失败——对撞名行
    逐个消歧（``stem (2).ext`` 起，资源管理器同款），顺序态编号唯一本是 no-op。
    """
    if name.casefold() not in used:
        used.add(name.casefold())
        return name
    stem, suffix = Path(name).stem, Path(name).suffix
    index = 2
    while f"{stem} ({index}){suffix}".casefold() in used:
        index += 1
    unique = f"{stem} ({index}){suffix}"
    used.add(unique.casefold())
    return unique


def _check_cancel(should_stop: Event | None) -> None:
    """在扫描和写入的安全点响应协作取消。"""
    if should_stop is not None and should_stop.is_set():
        raise TaskCancelledError()


def _write_member(
    archive: ZipFile,
    source: Path,
    name: str,
    expected_hash: str,
    should_stop: Event | None,
) -> None:
    """分块写入并校验实际写入字节，避免计划与交付内容之间的变更被遗漏。"""
    with (
        source.open("rb") as reader,
        archive.open(name, "w", force_zip64=True) as writer,
    ):
        digest, _ = hash_stream(
            reader, writer, on_chunk=lambda _chunk: _check_cancel(should_stop)
        )
    if digest != expected_hash:
        raise ExportError(
            f"文件「{source.name}」在打包期间发生变化，请重新生成导出计划。"
        )


def write_export(
    workdir: Path,
    plan: ExportPlan,
    destination: Path,
    *,
    should_stop: Event | None = None,
    progress: Callable[[float], None] | None = None,
) -> Path:
    """把已校验计划写为 ZIP，成功后原子发布，不覆盖已有文件。

    临时包与目标位于同一文件系统；Windows 用不覆盖改名，Unix 用硬链接原子发布。
    失败或取消只清除本次临时包，不修改素材、caption 和已存在的交付物。
    条目名撞名（关态同名行的两类文件）随行消歧加序号后缀（2026-10-13 稿㉑），
    不整包失败——提示与出路在计划行 ``name_conflict`` 标记。
    """
    _check_cancel(should_stop)
    if not plan.included:
        raise ExportError("没有可打包的配对，请先完成打标或检查排除清单。")
    destination = destination.absolute()
    if destination.exists():
        raise ExportError("输出文件已存在，请选择另一个文件名。")
    if destination.suffix.lower() != ".zip":
        raise ExportError("输出文件必须使用 .zip 扩展名。")
    if not destination.parent.is_dir():
        raise ExportError("输出目录不存在，请选择已有目录。")
    for row in plan.included:
        for name in (row.asset_name, row.caption_name):
            if not name or not is_single_path_segment(name):
                raise ExportError("导出文件名存在路径问题，请重新生成导出计划。")
            # 撞名不再整包失败（2026-10-13 稿㉑）：写入时随行消歧（见 _disambiguate），
            # 提示与出路在计划行 name_conflict 标记（界面琥珀句）。
    used: set[str] = set()
    with tempfile.NamedTemporaryFile(
        dir=destination.parent, prefix=".dsf-export-", suffix=".tmp", delete=False
    ) as handle:
        temporary = Path(handle.name)
    try:
        with ZipFile(temporary, "w", compression=ZIP_DEFLATED) as archive:
            for index, row in enumerate(plan.included, 1):
                _check_cancel(should_stop)
                if not row.asset_hash or not row.caption_hash:
                    raise ExportError("导出计划缺少文件哈希，请重新生成导出计划。")
                asset = confine_to_workdir(workdir, workdir / row.name)
                caption = product_path(workdir, plan.batch, row.item)
                _write_member(
                    archive,
                    asset,
                    _disambiguate(str(row.asset_name), used),
                    row.asset_hash,
                    should_stop,
                )
                _write_member(
                    archive,
                    caption,
                    _disambiguate(str(row.caption_name), used),
                    row.caption_hash,
                    should_stop,
                )
                if progress is not None:
                    progress(index / len(plan.included))
        _check_cancel(should_stop)
        with temporary.open("r+b") as reader:
            os.fsync(reader.fileno())
        if os.name == "nt":
            os.rename(temporary, destination)
        else:
            os.link(temporary, destination)
    except OSError as exc:
        raise ExportError(
            "写入导出文件失败，请检查输出目录权限、空间或文件占用。"
        ) from exc
    finally:
        temporary.unlink(missing_ok=True)
    return destination
