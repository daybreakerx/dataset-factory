"""eval 编排域：质检与评测——打分批次生命周期与 ``.dsf/eval/`` 存储。

公开面：EvalBatchConfig 配置模型与规则校验（config）、EvalStore 门面与状态条目
（store）、批次生命周期与引用校验（batches）、类型化异常（errors）。依赖方向：
eval → strategies（批次与裁判策略引用）+ workdir（门面与锁原语）；不 import
runs / labeling——judge 调用复用 llm 层而非打标引擎、运行记录三件套与 runs
同构复用不跨域引用（tdd 暂存件「二、模块划分」）。

锁模型（用户裁乙）：eval 运行锁与状态锁独立于打标域——评测与打标可并行、
评测之间互斥；两域从不交叉持锁、不成环。
"""

from .batches import (
    DeleteEvalBatchResult,
    create_eval_batch,
    delete_eval_batch,
    get_eval_batch,
    list_eval_batches,
    parse_seq,
    read_eval_config,
    update_eval_batch,
    update_eval_config,
    validate_references,
)
from .config import (
    DUAL_FULL,
    DUAL_NONE,
    DUAL_SAMPLED,
    KIND_BINARY,
    KIND_SCORE5,
    DimensionSpec,
    EvalBatchConfig,
    HumanSettings,
    PairwiseSettings,
)
from .errors import (
    EvalBatchNotFoundError,
    EvalConfigCorruptedError,
    EvalConfigError,
    EvalError,
    EvalJudgeFormatError,
    EvalRunNotActiveError,
    EvalRunOccupiedError,
)
from .judge import (
    DimensionVerdict,
    JudgeCaller,
    JudgeCallRecord,
    PairwiseVerdict,
    build_dimension_messages,
    build_pairwise_messages,
    dimension_response_schema,
    pairwise_response_schema,
    parse_dimension_output,
    parse_pairwise_output,
)
from .manual import (
    append_manual_score,
    latest_manual_scores,
    manual_progress,
    read_manual_scores,
)
from .report import LANDIS_KOCH_BANDS, build_report, list_reports, read_report
from .runner import (
    RUN_STATUS_COMPLETED,
    RUN_STATUS_INTERRUPTED,
    EvalRunner,
    RunReport,
)
from .store import EvalBatchEntry, EvalStore

__all__ = [
    "DUAL_FULL",
    "DUAL_NONE",
    "DUAL_SAMPLED",
    "KIND_BINARY",
    "KIND_SCORE5",
    "LANDIS_KOCH_BANDS",
    "RUN_STATUS_COMPLETED",
    "RUN_STATUS_INTERRUPTED",
    "DeleteEvalBatchResult",
    "DimensionSpec",
    "DimensionVerdict",
    "EvalBatchConfig",
    "EvalBatchEntry",
    "EvalBatchNotFoundError",
    "EvalConfigCorruptedError",
    "EvalConfigError",
    "EvalError",
    "EvalJudgeFormatError",
    "EvalRunNotActiveError",
    "EvalRunOccupiedError",
    "EvalRunner",
    "EvalStore",
    "HumanSettings",
    "JudgeCallRecord",
    "JudgeCaller",
    "PairwiseSettings",
    "PairwiseVerdict",
    "RunReport",
    "append_manual_score",
    "build_dimension_messages",
    "build_pairwise_messages",
    "build_report",
    "create_eval_batch",
    "delete_eval_batch",
    "dimension_response_schema",
    "get_eval_batch",
    "latest_manual_scores",
    "list_eval_batches",
    "list_reports",
    "manual_progress",
    "pairwise_response_schema",
    "parse_dimension_output",
    "parse_pairwise_output",
    "parse_seq",
    "read_eval_config",
    "read_manual_scores",
    "read_report",
    "update_eval_batch",
    "update_eval_config",
    "validate_references",
]
