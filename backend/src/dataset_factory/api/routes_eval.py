"""eval 域端点：打分批次生命周期 + 打分运行（质检与评测页的后端面）。

``eval_router``（/api/workdirs/{wid}/eval-batches）：
- 批次：列表 / 新建（201 + Location）/ 详情 / PATCH（名称 / 描述 / **评测配置
  全量替换**——与打标批次「组合不可改」相反，改了保存重跑即重算）/ 删除。
- 运行：POST ``/{eN}/runs``（受理 202）/ ``runs/current``（轮询）/ ``runs/stop``
  （协作取消）/ ``runs/stream``（SSE 帧与跑批同构）——与 routes_runs 同构：
  注册表按工作目录键控（内存态、重启即丢；磁盘 eval 运行锁是跨进程权威）、
  后台线程执行、受理后的失败走 SSE / current 呈现。

错误一律 problem+json（404 workdir / 打分批次 / 运行不存在、400 配置规则或
引用不合法、409 配置文件损坏 / 评测运行占用）。
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import queue
import threading
from collections.abc import AsyncIterator
from pathlib import Path
from typing import cast

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

from ..eval import (
    DimensionSpec,
    EvalBatchConfig,
    EvalBatchEntry,
    EvalRunner,
    EvalRunNotActiveError,
    EvalStore,
    HumanSettings,
    PairwiseSettings,
    append_manual_score,
    build_report,
    create_eval_batch,
    delete_eval_batch,
    get_eval_batch,
    latest_manual_scores,
    list_eval_batches,
    list_reports,
    manual_progress,
    parse_seq,
    read_eval_config,
    read_report,
    update_eval_batch,
    update_eval_config,
    validate_references,
)
from ..workdir import RunOccupiedError
from .deps import workdir_root
from .problems import ProblemError, problem
from .schemas import (
    EvalBatchCreateRequest,
    EvalBatchUpdateRequest,
    EvalBatchView,
    EvalConfigPayload,
    EvalReportCreateRequest,
    EvalReportSummaryView,
    EvalReportView,
    EvalRunAccepted,
    EvalRunStatusView,
    EvalSamplesView,
    ManualScoreRequest,
    ManualScoreView,
    Problem,
)

logger = logging.getLogger(__name__)

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


# -- 打分运行（受理＋进度＋停止＋SSE） ---------------------------------------

_TERMINAL_STATUSES = frozenset({"completed", "interrupted", "failed"})
_RETRY_AFTER_SECONDS = 2


def _run_registry(request: Request) -> tuple[dict[str, EvalRunner], threading.Lock]:
    """取应用级打分运行注册表与其守卫锁（create_app 装配，随应用实例隔离）。"""
    return (
        cast("dict[str, EvalRunner]", request.app.state.eval_run_registry),
        cast("threading.Lock", request.app.state.eval_run_registry_guard),
    )


def _active_runner(request: Request, workdir: Path, seq: int) -> EvalRunner:
    """查该工作目录的当前打分运行并校验批次归属；无运行 / 批次不符 → 404。

    批次校验不可省（URL 是批次作用域、注册表按工作目录键控）——e2 的 stop /
    current 不能命中 e1 的运行。
    """
    registry, guard = _run_registry(request)
    with guard:
        runner = registry.get(str(workdir))
    if runner is None or runner.snapshot()["batch"] != f"e{seq}":
        raise EvalRunNotActiveError(
            "该打分批次当前没有进行中的打分运行——启动一次打分后再试。"
        )
    return runner


def _require_active(runner: EvalRunner) -> EvalRunner:
    """对 stop / stream 的额外校验：已到终态的注册表残留按 404 处理。"""
    if runner.snapshot()["status"] in _TERMINAL_STATUSES:
        raise EvalRunNotActiveError(
            "该打分批次当前没有进行中的打分运行——启动一次打分后再试。"
        )
    return runner


@eval_router.post(
    "/{eN}/runs",
    status_code=202,
    response_model=EvalRunAccepted,
    responses={
        400: problem("裁判引用不成立（problem+json: eval-config-invalid）"),
        404: problem(
            "wid 或打分批次不存在（workdir-not-found / eval-batch-not-found）"
        ),
        409: {
            "model": Problem,
            "content": {"application/problem+json": {}},
            "description": "该工作目录已有打分（评测）运行（problem+json: eval-run-occupied）",
        },
    },
)
def start_eval_run(wid: str, eN: str, request: Request) -> JSONResponse:
    """受理一次打分运行：同步预检 + 登记注册表 + 后台线程执行，202 立即返回。

    预检（批次与配置可读、裁判引用现查）在受理之前完成，把能在请求内确定的
    错误同步报给客户端；跨进程的 eval 运行锁占用在后台线程抢锁时才暴露，经
    SSE / current 呈现（status=failed + 一条 failed 的 run-finished 事件）。
    """
    workdir = workdir_root(wid)
    seq = parse_seq(eN)
    get_eval_batch(workdir, seq)
    validate_references(workdir, read_eval_config(workdir, seq))

    registry, guard = _run_registry(request)
    key = str(workdir)
    runner = EvalRunner(workdir, seq, trigger="web")
    with guard:
        existing = registry.get(key)
        if existing is not None and existing.snapshot()["status"] != "failed":
            raise RunOccupiedError(
                "该工作目录已有打分（评测）运行——等它结束或停止后再试。",
                occupier={"pid": os.getpid(), "batch": f"e{seq}"},
            )
        registry[key] = runner
    run_id = str(runner.snapshot()["run_id"])

    def thread_body() -> None:
        try:
            runner.run()
        except Exception:
            logger.warning("打分运行 %s 失败（已通知订阅者）", run_id, exc_info=True)
        finally:
            with guard:
                if (
                    registry.get(key) is runner
                    and runner.snapshot()["status"] != "failed"
                ):
                    del registry[key]

    threading.Thread(target=thread_body, name=f"dsf-eval-{run_id}", daemon=True).start()
    return JSONResponse(
        status_code=202,
        content=EvalRunAccepted(run_id=run_id).model_dump(),
        headers={"Retry-After": str(_RETRY_AFTER_SECONDS)},
    )


@eval_router.get(
    "/{eN}/runs/current",
    response_model=EvalRunStatusView | None,
    responses={
        404: problem(
            "wid 或打分批次不存在（workdir-not-found / eval-batch-not-found）"
        ),
    },
)
def current_eval_run(wid: str, eN: str, request: Request) -> EvalRunStatusView | None:
    """当前打分运行进度快照（轮询用）；空闲时返回 200 + null（空闲轮询合法）。"""
    seq = parse_seq(eN)
    workdir = workdir_root(wid)
    get_eval_batch(workdir, seq)
    try:
        runner = _active_runner(request, workdir, seq)
    except EvalRunNotActiveError:
        return None
    return EvalRunStatusView(**runner.snapshot())


@eval_router.post(
    "/{eN}/runs/stop",
    status_code=204,
    responses={
        404: problem(
            "该打分批次当前没有进行中的打分运行（problem+json: eval-run-not-active）"
        ),
    },
)
def stop_eval_run(wid: str, eN: str, request: Request) -> Response:
    """请求停止当前打分运行（协作取消：当前调用在安全点停下）。"""
    seq = parse_seq(eN)
    runner = _require_active(_active_runner(request, workdir_root(wid), seq))
    runner.stop()
    return Response(status_code=204)


@eval_router.get(
    "/{eN}/runs/stream",
    responses={
        404: problem(
            "该打分批次当前没有进行中的打分运行（problem+json: eval-run-not-active）"
        ),
    },
)
def stream_eval_run(wid: str, eN: str, request: Request) -> StreamingResponse:
    """SSE 业务事件流：run-started → item-updated… → run-finished（终态即关流）。"""
    seq = parse_seq(eN)
    runner = _require_active(_active_runner(request, workdir_root(wid), seq))
    events: queue.Queue[object] = queue.Queue()

    def _forward(event: object) -> None:
        events.put(event)
        if getattr(event, "kind", "") == "run-finished":
            events.put(None)  # 终态哨兵：关流

    async def generate() -> AsyncIterator[str]:
        unsubscribe = runner.subscribe(_forward)  # type: ignore[arg-type]
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = events.get_nowait()
                except queue.Empty:
                    # 等模型期间保持可取消，不占线程池干等下一条业务事件。
                    await asyncio.sleep(0.1)
                    continue
                if event is None:
                    break
                yield _sse_frame(
                    getattr(event, "kind", ""),
                    getattr(event, "to_payload", dict)(),
                )
        finally:
            unsubscribe()

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _sse_frame(event: str, data: dict[str, object]) -> str:
    """一条 SSE 帧（event + data 两行）；JSON 不转义中文，与跑批流同构。"""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


# -- 人工打分与题单（人工数据不绑打分批次配置——经 eval 域全局存取） ---------


def _latest_eval_run_dir(workdir: Path, seq: int) -> Path | None:
    """该打分批次最近一次运行目录（目录名字典序即时间序）；没有运行返回 None。"""
    store = EvalStore(workdir)
    if not store.runs_dir.is_dir():
        return None
    best: Path | None = None
    for directory in store.runs_dir.iterdir():
        marker = directory / "run.json"
        if not marker.is_file():
            continue
        try:
            record: object = json.loads(marker.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(record, dict):
            continue
        matches = cast("dict[str, object]", record).get("batch") == f"e{seq}"
        if matches and (best is None or directory.name > best.name):
            best = directory
    return best


@eval_router.get(
    "/{eN}/samples",
    response_model=EvalSamplesView,
    responses={
        404: problem(
            "wid 或打分批次不存在（workdir-not-found / eval-batch-not-found）"
        ),
    },
)
def get_eval_samples(wid: str, eN: str) -> EvalSamplesView:
    """最近一次运行的题单（随机抽检／定向筛查）＋人工进度（按素材主干汇总）。

    没有运行过时 run_id 为 null、两份题单为空——页面据此引导先跑一次打分。
    """
    workdir = workdir_root(wid)
    seq = parse_seq(eN)
    get_eval_batch(workdir, seq)
    run_dir = _latest_eval_run_dir(workdir, seq)
    random_stems: list[str] = []
    targeted: dict[str, object] | None = None
    if run_dir is not None:
        try:
            data: object = json.loads(
                (run_dir / "samples.json").read_text(encoding="utf-8")
            )
        except (OSError, json.JSONDecodeError):
            data = None
        if isinstance(data, dict):
            record = cast("dict[str, object]", data)
            random_raw = record.get("random")
            if isinstance(random_raw, list):
                random_stems = [str(stem) for stem in cast("list[object]", random_raw)]
            targeted_raw = record.get("targeted")
            if isinstance(targeted_raw, dict):
                targeted = cast("dict[str, object]", targeted_raw)
                items = targeted.get("items")
                if isinstance(items, list):
                    random_stems = sorted(
                        set(random_stems)
                        | {str(stem) for stem in cast("list[object]", items)}
                    )
    stems = sorted(set(random_stems))
    return EvalSamplesView(
        run_id=run_dir.name if run_dir is not None else None,
        random=random_stems,
        targeted=targeted,
        progress=manual_progress(workdir, stems),
    )


@eval_router.put(
    "/{eN}/manual-scores",
    response_model=ManualScoreView,
    responses={
        400: problem("打分记录规则不过（problem+json: eval-config-invalid）"),
        404: problem(
            "wid 或打分批次不存在（workdir-not-found / eval-batch-not-found）"
        ),
    },
)
def put_manual_score(wid: str, eN: str, body: ManualScoreRequest) -> ManualScoreView:
    """追加一条人工打分（改分＝再提交一条，读取按每键最近一条）。

    人工数据不绑打分批次配置（删打分批次不随删）；路径挂在打分批次下只是
    页面作用域。低分（五档 ≤2）理由必填。
    """
    workdir = workdir_root(wid)
    get_eval_batch(workdir, parse_seq(eN))
    record: dict[str, object] = {"kind": body.kind, "item": body.item}
    if body.kind == "dimension":
        record["batch"] = body.batch
        record["scores"] = dict(body.scores) if body.scores is not None else {}
    else:
        record["a_batch"] = body.a_batch
        record["b_batch"] = body.b_batch
        record["winner"] = body.winner
    record["annotator"] = body.annotator
    if body.reason is not None:
        record["reason"] = body.reason
    stored = append_manual_score(workdir, record)
    return ManualScoreView.model_validate(stored)


@eval_router.get(
    "/{eN}/manual-scores",
    response_model=list[ManualScoreView],
    responses={
        404: problem(
            "wid 或打分批次不存在（workdir-not-found / eval-batch-not-found）"
        ),
    },
)
def get_manual_scores(
    wid: str,
    eN: str,
    kind: str | None = None,
    item: str | None = None,
    annotator: str | None = None,
) -> list[ManualScoreView]:
    """读当前有效的人工打分（每键最近一条；按 kind / item / annotator 过滤）。"""
    workdir = workdir_root(wid)
    get_eval_batch(workdir, parse_seq(eN))
    records = latest_manual_scores(workdir)
    if kind is not None:
        records = [row for row in records if row.get("kind") == kind]
    if item is not None:
        records = [row for row in records if row.get("item") == item]
    if annotator is not None:
        records = [row for row in records if row.get("annotator") == annotator]
    return [ManualScoreView.model_validate(row) for row in records]


# -- 报告（快照按次生成、历史可回看） ---------------------------------------


@eval_router.post(
    "/{eN}/reports",
    status_code=201,
    response_model=EvalReportView,
    responses={
        404: {
            "model": Problem,
            "content": {"application/problem+json": {}},
            "description": "wid / 打分批次 / 运行不存在"
            "（workdir-not-found / eval-batch-not-found / eval-run-not-found）",
        },
        422: problem("运行不属于该打分批次（problem+json: eval-report-mismatch）"),
    },
)
def create_eval_report(
    wid: str, eN: str, body: EvalReportCreateRequest | None = None
) -> EvalReportView:
    """从一次运行聚合报告快照（缺省＝最近一次运行；重出同 run_id 即覆盖）。"""
    workdir = workdir_root(wid)
    seq = parse_seq(eN)
    get_eval_batch(workdir, seq)
    run_id = body.run_id if body is not None and body.run_id else None
    if run_id is None:
        latest = _latest_eval_run_dir(workdir, seq)
        if latest is None:
            raise ProblemError(
                404,
                "eval-run-not-found",
                "没有可出报告的运行",
                "该打分批次还没有跑过打分——先启动一次打分运行。",
            )
        run_id = latest.name
    try:
        report = build_report(workdir, seq, run_id)
    except FileNotFoundError as exc:
        raise ProblemError(
            404,
            "eval-run-not-found",
            "运行不存在",
            f"运行 {run_id} 不存在——请检查运行标识。",
        ) from exc
    except ValueError as exc:
        raise ProblemError(
            422,
            "eval-report-mismatch",
            "运行与打分批次不匹配",
            str(exc),
        ) from exc
    return EvalReportView.model_validate(report)


@eval_router.get(
    "/{eN}/reports",
    response_model=list[EvalReportSummaryView],
    responses={
        404: problem(
            "wid 或打分批次不存在（workdir-not-found / eval-batch-not-found）"
        ),
    },
)
def list_eval_reports(wid: str, eN: str) -> list[EvalReportSummaryView]:
    """报告快照列表（最新在前）。"""
    workdir = workdir_root(wid)
    seq = parse_seq(eN)
    get_eval_batch(workdir, seq)
    return [
        EvalReportSummaryView.model_validate(row) for row in list_reports(workdir, seq)
    ]


@eval_router.get(
    "/{eN}/reports/{rid}",
    response_model=EvalReportView,
    responses={
        404: {
            "model": Problem,
            "content": {"application/problem+json": {}},
            "description": "wid / 打分批次 / 报告不存在"
            "（workdir-not-found / eval-batch-not-found / eval-report-not-found）",
        },
    },
)
def get_eval_report(wid: str, eN: str, rid: str) -> EvalReportView:
    """读一份报告快照全文（历史报告可回看、读数可复现）。"""
    workdir = workdir_root(wid)
    seq = parse_seq(eN)
    get_eval_batch(workdir, seq)
    try:
        report = read_report(workdir, seq, rid)
    except FileNotFoundError as exc:
        raise ProblemError(
            404,
            "eval-report-not-found",
            "报告不存在",
            f"报告 {rid} 不存在——可从 reports 列表核对标识。",
        ) from exc
    except ValueError as exc:
        raise ProblemError(
            404,
            "eval-report-not-found",
            "报告与打分批次不匹配",
            str(exc),
        ) from exc
    return EvalReportView.model_validate(report)
