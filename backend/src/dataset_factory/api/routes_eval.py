"""eval 域端点：打分批次生命周期（质检与评测页的后端面之一）。

``eval_router``（/api/workdirs/{wid}/eval-batches）：列表 / 新建（201 +
Location）/ 详情 / PATCH（名称 / 描述 / **评测配置全量替换**——与打标批次
「组合不可改」相反，改了保存重跑即重算）/ 删除（配置＋该批次的运行记录与
报告快照移入可恢复暂存；人工打分不随删）。

错误一律 problem+json（404 workdir / 打分批次不存在、400 配置规则或引用
不合法、409 配置文件损坏）。发车与条目评分视图等运行端点随后续主题长入。
"""

from __future__ import annotations

from fastapi import APIRouter, Response

from ..eval import (
    DimensionSpec,
    EvalBatchConfig,
    EvalBatchEntry,
    EvalStore,
    HumanSettings,
    PairwiseSettings,
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
from .deps import workdir_root
from .problems import problem
from .schemas import (
    EvalBatchCreateRequest,
    EvalBatchUpdateRequest,
    EvalBatchView,
    EvalConfigPayload,
)

eval_router = APIRouter(
    prefix="/api/workdirs/{wid}/eval-batches", tags=["评测（打分批次）"]
)


def _config_from_payload(payload: EvalConfigPayload) -> EvalBatchConfig:
    """请求体配置 → 域配置对象（形状已由 pydantic 收窄，语义规则交给域校验）。"""
    pairwise = payload.pairwise_settings
    return EvalBatchConfig(
        candidates=list(payload.candidates),
        benchmark=payload.benchmark,
        judges=list(payload.judges),
        dimensions=[
            DimensionSpec(name=item.name, kind=item.kind) for item in payload.dimensions
        ],
        dimension_scoring=payload.dimension_scoring,
        pairwise=payload.pairwise,
        pairwise_settings=None
        if pairwise is None
        else PairwiseSettings(
            dual_order=pairwise.dual_order,
            dual_order_ratio=pairwise.dual_order_ratio,
            limit=pairwise.limit,
        ),
        human=HumanSettings(
            full=payload.human.full,
            random_enabled=payload.human.random_enabled,
            random_count=payload.human.random_count,
            targeted_enabled=payload.human.targeted_enabled,
            targeted_count=payload.human.targeted_count,
            dimension_manual=payload.human.dimension_manual,
            pairwise_manual=payload.human.pairwise_manual,
        ),
        dataset_source=payload.dataset_source,
        dataset_license=payload.dataset_license,
    )


def _to_view(entry: EvalBatchEntry, config: EvalBatchConfig) -> EvalBatchView:
    """条目＋配置 → 响应模型。"""
    return EvalBatchView(
        id=f"e{entry.seq}",
        seq=entry.seq,
        name=entry.name,
        description=entry.description,
        created_at=entry.created_at,
        config=EvalConfigPayload.model_validate(config.to_json()),
    )


@eval_router.get("", response_model=list[EvalBatchView])
def list_eval(wid: str) -> list[EvalBatchView]:
    """列出工作目录全部打分批次（按序号升序，配置全文随视图携带）。"""
    workdir = workdir_root(wid)
    store = EvalStore(workdir)
    return [
        _to_view(entry, store.read_config(entry.seq))
        for entry in list_eval_batches(workdir)
    ]


@eval_router.post(
    "",
    status_code=201,
    response_model=EvalBatchView,
    responses={
        400: problem("配置规则或引用不合法（problem+json: eval-config-invalid）"),
        404: problem("wid 不存在（workdir-not-found）"),
        422: problem("请求体缺必填字段（FastAPI 校验）"),
    },
)
def create_eval(wid: str, body: EvalBatchCreateRequest) -> Response:
    """新建打分批次（保存时全量校验：规则聚合报、引用现查）。

    201 + Location 指向新打分批次。
    """
    workdir = workdir_root(wid)
    config = _config_from_payload(body.config)
    entry = create_eval_batch(
        workdir, name=body.name, description=body.description, config=config
    )
    view = _to_view(entry, config)
    return Response(
        status_code=201,
        content=view.model_dump_json(),
        media_type="application/json",
        headers={"Location": f"/api/workdirs/{wid}/eval-batches/{view.id}"},
    )


@eval_router.get(
    "/{eN}",
    response_model=EvalBatchView,
    responses={
        404: problem(
            "wid 或打分批次不存在（workdir-not-found / eval-batch-not-found）"
        ),
        409: problem("配置文件损坏（problem+json: eval-config-corrupted）"),
    },
)
def get_eval_detail(wid: str, eN: str) -> EvalBatchView:
    """按序号查单个打分批次（新建 201 的 Location 指向这里）。"""
    workdir = workdir_root(wid)
    seq = parse_seq(eN)
    return _to_view(get_eval_batch(workdir, seq), read_eval_config(workdir, seq))


@eval_router.patch(
    "/{eN}",
    response_model=EvalBatchView,
    responses={
        400: problem("配置规则或引用不合法（problem+json: eval-config-invalid）"),
        404: problem(
            "wid 或打分批次不存在（workdir-not-found / eval-batch-not-found）"
        ),
        409: problem("配置文件损坏（problem+json: eval-config-corrupted）"),
        422: problem("请求体空补丁或含未声明字段（extra=forbid）"),
    },
)
def patch_eval(wid: str, eN: str, body: EvalBatchUpdateRequest) -> EvalBatchView:
    """改名称 / 描述 / 评测配置（配置全量替换，改了保存重跑即重算）。

    配置替换先过域校验（规则＋引用）再动名称——名称与配置分两步落盘，
    校验不过时名称也不会被半改。
    """
    workdir = workdir_root(wid)
    seq = parse_seq(eN)
    config: EvalBatchConfig | None = None
    if body.config is not None:
        config = _config_from_payload(body.config)
        config.validate()
        validate_references(workdir, config)
    entry = update_eval_batch(
        workdir, seq, name=body.name, description=body.description
    )
    stored = (
        update_eval_config(workdir, seq, config)
        if config is not None
        else read_eval_config(workdir, seq)
    )
    return _to_view(entry, stored)


@eval_router.delete(
    "/{eN}",
    status_code=204,
    responses={
        404: problem(
            "wid 或打分批次不存在（workdir-not-found / eval-batch-not-found）"
        ),
        409: problem("评测运行占用中（problem+json: eval-run-occupied）"),
    },
)
def delete_eval(wid: str, eN: str) -> Response:
    """删除打分批次：配置、该批次的运行记录与报告快照移入可恢复暂存。

    人工打分不随删（绑素材 × 批次 × 条目 × 标注者、不绑打分批次配置）；
    删前告知内容量由界面负责（列表视图即数据源）。
    """
    delete_eval_batch(workdir_root(wid), parse_seq(eN))
    return Response(status_code=204)
