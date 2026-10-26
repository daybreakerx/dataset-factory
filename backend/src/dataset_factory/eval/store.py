"""``.dsf/eval/`` 门面与状态条目：eval 域数据的唯一写者。

布局（tdd 暂存件「三、数据与存储」）::

    .dsf/eval/
    ├── state.json           # 打分批次清单（eN→名称/描述/创建时刻）＋下一个序号
    ├── e<N>/config.json     # 可变配置（EvalBatchConfig 往返）
    ├── runs/                # 每次打分运行一个子目录
    ├── reports/             # 报告快照
    └── manual-scores.jsonl  # 人工打分追加流

锁与打标域同构但独立（用户裁乙：评测与打标并行）——eval 自己的 run.lock /
state.lock 落 ``.dsf/eval/`` 下，与 ``.dsf/run.lock`` 互不阻塞；两域从不交叉
持锁，不成环。状态写入口与 ``WorkdirStore.mutate_state`` 同一形态：读—改—写
全在状态锁内、调用方只交 mutator——结构性杜绝漏包。
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import cast

from .._fs import atomic_write_text
from ..workdir import WorkdirMetadataCorruptedError
from ..workdir.locks import StateLock, maintenance_guard, require_workdir_writable
from .config import EvalBatchConfig
from .errors import EvalConfigCorruptedError

__all__ = ["EvalBatchEntry", "EvalStore", "entries_from_state", "entries_into_state"]

_DSF_DIR_NAME = ".dsf"
_EVAL_DIR_NAME = "eval"
_STATE_FILE_NAME = "state.json"
_MANUAL_SCORES_FILE_NAME = "manual-scores.jsonl"


@dataclass
class EvalBatchEntry:
    """eval state.json 里的一条打分批次记录（显示元数据；评测配置在 config.json）。"""

    seq: int
    name: str
    description: str
    created_at: str


def entries_from_state(state: dict[str, object]) -> list[EvalBatchEntry]:
    """从 state 字典取打分批次列表（缺键视为空；形状不对 fail loud）。

    Raises:
        WorkdirMetadataCorruptedError: state.json 的批次列表形状不对。
    """
    value = state.get("batches")
    if value is None:
        return []
    if not isinstance(value, list):
        raise WorkdirMetadataCorruptedError(
            "评测状态文件的批次列表损坏——请检查 .dsf/eval/state.json。"
        )
    entries: list[EvalBatchEntry] = []
    for item in cast("list[object]", value):
        if not isinstance(item, dict):
            raise WorkdirMetadataCorruptedError(
                "评测状态文件的批次记录形状不对——请检查 .dsf/eval/state.json。"
            )
        record = cast("dict[str, object]", item)
        seq = record.get("seq")
        name = record.get("name")
        description = record.get("description")
        created_at = record.get("created_at")
        if (
            not isinstance(seq, int)
            or isinstance(seq, bool)
            or seq < 1
            or not isinstance(name, str)
            or not isinstance(description, str)
            or not isinstance(created_at, str)
        ):
            raise WorkdirMetadataCorruptedError(
                "评测状态文件的批次记录缺字段或类型不对——请检查 .dsf/eval/state.json。"
            )
        entries.append(
            EvalBatchEntry(
                seq=seq,
                name=name,
                description=description,
                created_at=created_at,
            )
        )
    return entries


def entries_into_state(
    state: dict[str, object],
    entries: list[EvalBatchEntry],
    *,
    seq_floor: int = 0,
) -> None:
    """把批次列表写回 state 字典；序号计数只增不减（与打标批次同一纪律）。

    ``next_seq`` 落盘值不低于「现有批次最大序号 + 1」与 ``seq_floor`` 的较大者，
    防止删除路径把计数写回去导致序号复用。
    """
    state["batches"] = [
        {
            "seq": entry.seq,
            "name": entry.name,
            "description": entry.description,
            "created_at": entry.created_at,
        }
        for entry in entries
    ]
    current = state.get("next_seq")
    current_floor = (
        current if isinstance(current, int) and not isinstance(current, bool) else 0
    )
    state["next_seq"] = max(
        current_floor,
        max((entry.seq for entry in entries), default=0) + 1,
        seq_floor,
    )


class EvalStore:
    """单个工作目录 ``.dsf/eval/`` 的门面——eval 域文件的唯一写者。"""

    def __init__(self, workdir_path: Path) -> None:
        """构造并确保 eval 目录结构就位（幂等；首个 eval 操作顺带创建 ``.dsf``）。

        目录身份锚 = ``.dsf`` 的 (st_dev, st_ino)：StateLock 按「锁目录的父级」
        核身份，eval 锁住 ``.dsf/eval/``、对应锚即 ``.dsf``——工作目录被搬迁
        替换后，旧 store 对象的写入会被拒（防写错目录）。
        """
        dsf = workdir_path / _DSF_DIR_NAME
        with maintenance_guard(workdir_path, timeout=10):
            require_workdir_writable(dsf)
            eval_dir = dsf / _EVAL_DIR_NAME
            eval_dir.mkdir(parents=True, exist_ok=True)
            for name in ("runs", "reports"):
                (eval_dir / name).mkdir(exist_ok=True)
            info = dsf.stat()
            self._directory_identity = (info.st_dev, info.st_ino)
        self._workdir = workdir_path
        self._eval_dir = eval_dir

    @property
    def workdir(self) -> Path:
        """工作目录路径。"""
        return self._workdir

    @property
    def eval_dir(self) -> Path:
        """``.dsf/eval/`` 绝对路径。"""
        return self._eval_dir

    @property
    def state_file(self) -> Path:
        """``.dsf/eval/state.json`` 路径（打分批次清单的唯一可变状态）。"""
        return self._eval_dir / _STATE_FILE_NAME

    @property
    def runs_dir(self) -> Path:
        """``.dsf/eval/runs/`` 路径（每次打分运行一个子目录）。"""
        return self._eval_dir / "runs"

    @property
    def reports_dir(self) -> Path:
        """``.dsf/eval/reports/`` 路径（报告快照）。"""
        return self._eval_dir / "reports"

    @property
    def manual_scores_file(self) -> Path:
        """``.dsf/eval/manual-scores.jsonl`` 路径（人工打分追加流）。"""
        return self._eval_dir / _MANUAL_SCORES_FILE_NAME

    def batch_dir(self, seq: int) -> Path:
        """某打分批次的配置目录（``.dsf/eval/e<N>/``）。"""
        return self._eval_dir / f"e{seq}"

    def config_file(self, seq: int) -> Path:
        """某打分批次的配置文件路径。"""
        return self.batch_dir(seq) / "config.json"

    def read_state(self) -> dict[str, object]:
        """读 eval state.json；不存在或空 → 空字典。

        读不需要状态锁：写入侧只有 ``mutate_state`` 一个入口 + 原子写，读到的
        要么是完整旧版、要么是完整新版。文件损坏抛 WorkdirMetadataCorruptedError
        （fail loud——坏文件不静默兜底）。根必须是 JSON 对象：数组 / 标量当作
        损坏报，而不是让它流进下游换成 ``AttributeError``（那会变成 500 的裸栈）。
        """
        if not self.state_file.exists():
            return {}
        try:
            raw = self.state_file.read_text(encoding="utf-8")
            data: object = json.loads(raw) if raw.strip() else {}
        except (UnicodeDecodeError, json.JSONDecodeError, OSError) as exc:
            raise WorkdirMetadataCorruptedError(
                f"评测状态文件损坏（{self.state_file}），请重建或删除该文件后重试。",
            ) from exc
        if not isinstance(data, dict):
            raise WorkdirMetadataCorruptedError(
                f"评测状态文件的根不是对象（{self.state_file}），"
                "请重建或删除该文件后重试。"
            )
        return cast("dict[str, object]", data)

    def mutate_state[T](self, mutator: Callable[[dict[str, object]], T]) -> T:
        """eval state.json 的唯一写入口：读—改—写三步全在状态锁内完成。

        形态与 ``WorkdirStore.mutate_state`` 一致——调用方只交一个 mutator
        （原地修改、返回值透传），非状态资源的 IO 留在锁外由调用方安排。

        Args:
            mutator: 拿到旧 state、原地修改、返回透传值的函数。

        Returns:
            mutator 的返回值。
        """
        lock = StateLock(self._eval_dir, directory_identity=self._directory_identity)
        lock.acquire()
        try:
            state = self.read_state()
            result = mutator(state)
            atomic_write_text(
                self.state_file,
                json.dumps(state, ensure_ascii=False, indent=2),
            )
            return result
        finally:
            lock.release()

    def read_config(self, seq: int) -> EvalBatchConfig:
        """读某打分批次的配置；文件缺失或无法解析按损坏处理（fail loud）。

        Raises:
            EvalConfigCorruptedError: 配置文件读不了、不是合法 UTF-8 或 JSON 不合法；
                形状问题由 ``EvalBatchConfig.from_json`` 继续判。
        """
        path = self.config_file(seq)
        try:
            data: object = json.loads(path.read_text(encoding="utf-8"))
        except (UnicodeDecodeError, OSError, json.JSONDecodeError) as exc:
            raise EvalConfigCorruptedError(
                f"打分批次 e{seq} 的配置文件缺失或无法读取（{path}）——"
                "请检查后重试，或删除该打分批次重建。",
            ) from exc
        return EvalBatchConfig.from_json(data)

    def write_config(self, seq: int, config: EvalBatchConfig) -> None:
        """原子写某打分批次的配置（先确保批次目录在）。"""
        self.batch_dir(seq).mkdir(parents=True, exist_ok=True)
        atomic_write_text(
            self.config_file(seq),
            json.dumps(config.to_json(), ensure_ascii=False, indent=2),
        )
