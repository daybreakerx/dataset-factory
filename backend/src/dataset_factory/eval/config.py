"""打分批次的可变配置模型：类型化对象 + 规则校验 + JSON 往返。

与打标批次「创建即冻结」相反，打分批次配置可反复修改、保存后重跑重算——
评分是「配置 × 数据」的派生结果、不产持久模型产物（PRD 既定口径）。配置落
``.dsf/eval/e<N>/config.json``；名称与描述不在此（住 eval state 条目，与打标
批次「state 存名、快照存组合」同构）。

校验分两层：**形状**（from_json）类型不对 = 文件损坏，抛 EvalConfigCorruptedError；
**规则**（validate）语义不合法 = 用户输入问题，聚合一次报完（EvalConfigError）。
引用存在性（被测批次 / 基准批次 / 裁判策略）不在此——要查工作目录与策略库，
见 batches.validate_references。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import cast

from .errors import EvalConfigCorruptedError, EvalConfigError

__all__ = [
    "DUAL_FULL",
    "DUAL_NONE",
    "DUAL_SAMPLED",
    "KIND_BINARY",
    "KIND_SCORE5",
    "DimensionSpec",
    "EvalBatchConfig",
    "HumanSettings",
    "PairwiseSettings",
]

#: 维度刻度：五档评分（1–5）与是非判断（无幻觉：有／无）——schema 派生的值域钉死。
KIND_SCORE5 = "score5"
KIND_BINARY = "binary"
_DIMENSION_KINDS = (KIND_SCORE5, KIND_BINARY)

#: 双序策略三档：全量双序（默认）／随机抽验双序（比例抽部分对）／不双序·单序随机左右。
DUAL_FULL = "full"
DUAL_SAMPLED = "sampled"
DUAL_NONE = "none"
_DUAL_ORDER_MODES = (DUAL_FULL, DUAL_SAMPLED, DUAL_NONE)


@dataclass
class DimensionSpec:
    """一条评测维度：名称 + 刻度。"""

    name: str
    kind: str  # KIND_SCORE5 / KIND_BINARY


@dataclass
class PairwiseSettings:
    """对比排名设置：双序策略、抽验比例与子采样上限。"""

    dual_order: str  # DUAL_FULL / DUAL_SAMPLED / DUAL_NONE
    dual_order_ratio: int | None  # DUAL_SAMPLED 时必填（1–100，百分比）
    limit: int | None  # None = 全量；正整数 = 按对数上限子采样（纯 API 成本、控钱用）


@dataclass
class HumanSettings:
    """人工介入设置：通道管「哪些题」、活动管「在这些题上做什么」（PRD 口径）。

    全量与随机抽检／定向筛查互斥；随机与定向各自独立开关、各自单独定数量
    （数量语义＝绝对题数）；维度人工／对比人工随评测模式显隐。
    """

    full: bool
    random_enabled: bool
    random_count: int | None
    targeted_enabled: bool
    targeted_count: int | None
    dimension_manual: bool
    pairwise_manual: bool


@dataclass
class EvalBatchConfig:
    """一份打分批次配置（名称与描述住 eval state 条目，不在此）。"""

    candidates: list[int]  # 被测批次序号（sN 的 N）
    benchmark: int | None  # 基准批次序号；None = 无基准（退化为候选互比）
    judges: list[str]  # 裁判策略库 ID 清单（多裁判 = 多条，可跨家族混编）
    dimensions: list[DimensionSpec]  # 维度清单（开了维度评分才非空）
    dimension_scoring: bool  # 维度评分模式（单点 rubric 绝对分）
    pairwise: bool  # 对比排名模式（pairwise 整体比）
    pairwise_settings: PairwiseSettings | None  # 开对比排名时必填
    human: HumanSettings
    dataset_source: str | None  # 参照来源数据集名（报告可复现层呈现）
    dataset_license: str | None  # 参照许可

    def validate(self) -> None:
        """规则校验（不含引用存在性）；不合法聚合全部问题抛 EvalConfigError。

        Raises:
            EvalConfigError: 任一规则不过；消息「；」连接全部问题。
        """
        problems: list[str] = []
        if not self.candidates:
            problems.append("被测批次至少选一个")
        if len(set(self.candidates)) != len(self.candidates):
            problems.append("被测批次有重复")
        if any(seq < 1 for seq in self.candidates):
            problems.append("被测批次序号必须 ≥1")
        if self.benchmark is not None and self.benchmark in self.candidates:
            problems.append("基准批次不能同时是被测批次")
        if not self.judges:
            problems.append("裁判策略至少选一条")
        if len(set(self.judges)) != len(self.judges):
            problems.append("裁判策略有重复")
        if not self.dimension_scoring and not self.pairwise:
            problems.append("评测模式至少开一个（维度评分或对比排名）")
        if self.dimension_scoring and not self.dimensions:
            problems.append("开了维度评分就必须声明维度清单")
        if not self.dimension_scoring and self.dimensions:
            problems.append("未开维度评分时不携带维度清单")
        if self.pairwise and self.pairwise_settings is None:
            problems.append("开了对比排名就必须给对比设置")
        if not self.pairwise and self.pairwise_settings is not None:
            problems.append("未开对比排名时不携带对比设置")
        names = [dim.name for dim in self.dimensions]
        if len(set(names)) != len(names):
            problems.append("维度名有重复")
        for dim in self.dimensions:
            if dim.kind not in _DIMENSION_KINDS:
                problems.append(f"维度「{dim.name}」的刻度不合法（{dim.kind}）")
        settings = self.pairwise_settings
        if settings is not None:
            if settings.dual_order not in _DUAL_ORDER_MODES:
                problems.append("双序策略不合法（full / sampled / none）")
            if settings.dual_order == DUAL_SAMPLED:
                ratio = settings.dual_order_ratio
                if ratio is None or not 1 <= ratio <= 100:
                    problems.append("随机抽验双序的比例须为 1–100 的整数")
            elif settings.dual_order_ratio is not None:
                problems.append("只有随机抽验双序才带比例")
            if settings.limit is not None and settings.limit < 1:
                problems.append("对比范围上限须 ≥1（对数）")
        human = self.human
        channels = human.random_enabled or human.targeted_enabled
        if human.full and channels:
            problems.append("全量与随机抽检／定向筛查互斥（全量时每条都人工打过了）")
        if human.random_enabled:
            if human.random_count is None or human.random_count < 1:
                problems.append("随机抽检数量须为 ≥1 的整数（按题计）")
        elif human.random_count is not None:
            problems.append("未开随机抽检时不携带其数量")
        if human.targeted_enabled:
            if human.targeted_count is None or human.targeted_count < 1:
                problems.append("定向筛查数量须为 ≥1 的整数（按题计）")
        elif human.targeted_count is not None:
            problems.append("未开定向筛查时不携带其数量")
        if human.dimension_manual and not self.dimension_scoring:
            problems.append("维度人工需要维度评分模式开启")
        if human.pairwise_manual and not self.pairwise:
            problems.append("对比人工需要对比排名模式开启")
        if (human.full or channels) and not (
            human.dimension_manual or human.pairwise_manual
        ):
            problems.append("开了人工通道就必须勾选至少一种人工活动（维度或对比）")
        if not (human.full or channels) and (
            human.dimension_manual or human.pairwise_manual
        ):
            problems.append("未开人工通道时不勾选人工活动")
        if problems:
            raise EvalConfigError("；".join(problems) + "。")

    def to_json(self) -> dict[str, object]:
        """序列化为落盘形状（与 from_json 互逆）。"""
        pairwise_json: dict[str, object] | None = None
        if self.pairwise_settings is not None:
            pairwise_json = {
                "dual_order": self.pairwise_settings.dual_order,
                "dual_order_ratio": self.pairwise_settings.dual_order_ratio,
                "limit": self.pairwise_settings.limit,
            }
        return {
            "candidates": list(self.candidates),
            "benchmark": self.benchmark,
            "judges": list(self.judges),
            "dimensions": [
                {"name": dim.name, "kind": dim.kind} for dim in self.dimensions
            ],
            "dimension_scoring": self.dimension_scoring,
            "pairwise": self.pairwise,
            "pairwise_settings": pairwise_json,
            "human": {
                "full": self.human.full,
                "random_enabled": self.human.random_enabled,
                "random_count": self.human.random_count,
                "targeted_enabled": self.human.targeted_enabled,
                "targeted_count": self.human.targeted_count,
                "dimension_manual": self.human.dimension_manual,
                "pairwise_manual": self.human.pairwise_manual,
            },
            "dataset_source": self.dataset_source,
            "dataset_license": self.dataset_license,
        }

    @classmethod
    def from_json(cls, data: object) -> EvalBatchConfig:
        """从落盘 JSON 解析（只做形状校验，不做规则校验——落盘前已验证过）。

        Raises:
            EvalConfigCorruptedError: 形状不对（文件损坏，fail loud 不兜底）。
        """
        record = _as_dict(data, "配置根")
        dimensions_raw = record.get("dimensions")
        if not isinstance(dimensions_raw, list):
            raise _corrupted("字段 dimensions 不是数组")
        dimensions = [
            DimensionSpec(
                name=_get_str(_as_dict(item, "维度条目"), "name"),
                kind=_get_str(_as_dict(item, "维度条目"), "kind"),
            )
            for item in cast("list[object]", dimensions_raw)
        ]
        pairwise_settings: PairwiseSettings | None = None
        pairwise_raw = record.get("pairwise_settings")
        if pairwise_raw is not None:
            pairwise_record = _as_dict(pairwise_raw, "字段 pairwise_settings")
            pairwise_settings = PairwiseSettings(
                dual_order=_get_str(pairwise_record, "dual_order"),
                dual_order_ratio=_get_opt_int(pairwise_record, "dual_order_ratio"),
                limit=_get_opt_int(pairwise_record, "limit"),
            )
        human_record = _as_dict(record.get("human"), "字段 human")
        return cls(
            candidates=_get_int_list(record, "candidates"),
            benchmark=_get_opt_int(record, "benchmark"),
            judges=_get_str_list(record, "judges"),
            dimensions=dimensions,
            dimension_scoring=_get_bool(record, "dimension_scoring"),
            pairwise=_get_bool(record, "pairwise"),
            pairwise_settings=pairwise_settings,
            human=HumanSettings(
                full=_get_bool(human_record, "full"),
                random_enabled=_get_bool(human_record, "random_enabled"),
                random_count=_get_opt_int(human_record, "random_count"),
                targeted_enabled=_get_bool(human_record, "targeted_enabled"),
                targeted_count=_get_opt_int(human_record, "targeted_count"),
                dimension_manual=_get_bool(human_record, "dimension_manual"),
                pairwise_manual=_get_bool(human_record, "pairwise_manual"),
            ),
            dataset_source=_get_opt_str(record, "dataset_source"),
            dataset_license=_get_opt_str(record, "dataset_license"),
        )


def _corrupted(detail: str) -> EvalConfigCorruptedError:
    """构造一条带修法的损坏错误。"""
    return EvalConfigCorruptedError(
        f"打分批次配置文件损坏（{detail}）——请检查对应批次的 config.json，"
        "或删除该打分批次后重建。"
    )


def _as_dict(data: object, where: str) -> dict[str, object]:
    """Narrow 到 dict[str, object]；不是对象按损坏处理。"""
    if not isinstance(data, dict):
        raise _corrupted(f"{where}不是对象")
    return cast("dict[str, object]", data)


def _get_bool(record: dict[str, object], key: str) -> bool:
    """取布尔字段；缺失或类型不对按损坏处理。"""
    value = record.get(key)
    if not isinstance(value, bool):
        raise _corrupted(f"字段 {key} 缺失或不是布尔")
    return value


def _get_opt_int(record: dict[str, object], key: str) -> int | None:
    """取可空整数字段；不是「整数或 null」按损坏处理。"""
    value = record.get(key)
    if value is None:
        return None
    if not isinstance(value, int) or isinstance(value, bool):
        raise _corrupted(f"字段 {key} 不是整数或 null")
    return value


def _get_str(record: dict[str, object], key: str) -> str:
    """取字符串字段；缺失或类型不对按损坏处理。"""
    value = record.get(key)
    if not isinstance(value, str):
        raise _corrupted(f"字段 {key} 缺失或不是字符串")
    return value


def _get_opt_str(record: dict[str, object], key: str) -> str | None:
    """取可空字符串字段；不是「字符串或 null」按损坏处理。"""
    value = record.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise _corrupted(f"字段 {key} 不是字符串或 null")
    return value


def _get_str_list(record: dict[str, object], key: str) -> list[str]:
    """取字符串数组字段；元素类型不对按损坏处理。"""
    value = record.get(key)
    if not isinstance(value, list):
        raise _corrupted(f"字段 {key} 不是字符串数组")
    items = cast("list[object]", value)
    if not all(isinstance(item, str) for item in items):
        raise _corrupted(f"字段 {key} 不是字符串数组")
    return list(cast("list[str]", value))


def _get_int_list(record: dict[str, object], key: str) -> list[int]:
    """取整数数组字段（bool 不算整数）；元素类型不对按损坏处理。"""
    value = record.get(key)
    if not isinstance(value, list):
        raise _corrupted(f"字段 {key} 不是整数数组")
    items = cast("list[object]", value)
    if not all(isinstance(item, int) and not isinstance(item, bool) for item in items):
        raise _corrupted(f"字段 {key} 不是整数数组")
    return list(cast("list[int]", value))
