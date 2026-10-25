"""api 入口层：FastAPI 应用工厂——路由组装、域异常 → HTTP 状态码映射、托管 frontend。

错误映射（域异常的消息已可操作，直接进 detail；Starlette 按 `type(exc).__mro__` 就近匹配
处理器——子类命中自身或最近基类的 handler，与注册顺序无关）：
400 输入/配置错、404 找不到、409 重名冲突、413 超限、502 上游模型端点错、500 数据
损坏 / 文件 IO（系统侧）。
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, NamedTuple, cast

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from ..eval import (
    EvalBatchNotFoundError,
    EvalConfigCorruptedError,
    EvalConfigError,
    EvalError,
    EvalRunNotActiveError,
    EvalRunOccupiedError,
)
from ..export import ExportError
from ..labeling import (
    EmptyTurnError,
    LabelingError,
    PromptNotSelectedError,
    SettingsFormatError,
)
from ..llm import (
    ConfigError,
    ConfigNameError,
    ConfigNotFoundError,
    ImageTooLargeError,
    LLMError,
    UnsupportedImageError,
)
from ..prompts import (
    PromptError,
    PromptExistsError,
    PromptNameError,
    PromptNotFoundError,
    PromptParseError,
    PromptTooLargeError,
    seed_builtin_presets,
)
from ..runs import (
    BatchInactiveError,
    BenchmarkBatchError,
    RetryItemNotEligibleError,
    RunError,
    RunJournalCorruptedError,
    RunNotActiveError,
)
from ..sessions import (
    SessionError,
    SessionEventError,
    SessionIdError,
    SessionNotFoundError,
)
from ..skills import (
    SkillError,
    SkillExistsError,
    SkillFileNotPreviewableError,
    SkillFilePathError,
    SkillFormatError,
    SkillNameError,
    SkillNotFoundError,
    SkillSourceError,
)
from ..strategies import (
    BatchNotFoundError,
    StrategyError,
    StrategyNameError,
    StrategyNotFoundError,
    StrategyRefsError,
)
from ..tasks import TaskManager, TaskNotFoundError
from ..workdir import (
    AssetNotFoundError,
    AssetPathError,
    ImportInProgressError,
    ImportSourceConflictError,
    ProductNotFoundError,
    RunOccupiedError,
    StateLockTimeoutError,
    WorkdirMaintenanceError,
    WorkdirMetadataCorruptedError,
    WorkdirNotFoundError,
    WorkdirPathError,
)
from ..workdir.locks import sweep_cleaned_maintenance_records
from . import (
    routes_endpoints,
    routes_eval,
    routes_export,
    routes_filesystem,
    routes_items,
    routes_labeling,
    routes_prompts,
    routes_runs,
    routes_service,
    routes_skills,
    routes_strategies,
    routes_tasks,
    routes_workdir,
)
from .middleware import RequestLogMiddleware
from .problems import ProblemError, problem_response

logger = logging.getLogger(__name__)


def create_app(frontend_dir: Path | None = None) -> FastAPI:
    """组装应用；frontend_dir 存在时把静态页面挂到根路径（API 路由先注册、优先匹配）。"""
    app = FastAPI(
        title="Dataset Factory",
        summary="AI 打标工具（发图 + 指令产出 caption，支持迭代改写）",
        version="0.1.0",
        lifespan=_lifespan,
    )
    # 访问日志中间件：放在最外层，它量到的耗时才是整个请求的真实总耗时。
    app.add_middleware(RequestLogMiddleware)
    _register_error_handlers(app)
    # 长任务管理器随应用实例装配（内存态、重启即丢；测试各自 create_app 天然隔离）。
    app.state.task_manager = TaskManager()
    # 导入槽位表：同一工作目录同时只允许一个导入任务（routes_workdir 检查与释放）。
    app.state.import_slots = {}
    app.state.import_slots_guard = threading.Lock()
    # 跑批运行注册表：工作目录 realpath → 运行中的 BatchRunner（内存态、重启即丢；
    # 磁盘运行锁是跨进程权威，注册表只做进程内快速拒绝与 current/stop/stream 的寻址）。
    app.state.run_registry = {}
    app.state.run_registry_guard = threading.Lock()
    # 打分运行注册表：同构的 eval 侧（工作目录 realpath → 运行中的 EvalRunner；
    # 评测与打标各自一把注册表——两类运行本就可并行，互不占用）。
    app.state.eval_run_registry = {}
    app.state.eval_run_registry_guard = threading.Lock()
    app.include_router(routes_labeling.router)
    app.include_router(routes_prompts.router)
    app.include_router(routes_skills.router)
    app.include_router(routes_endpoints.router)
    app.include_router(routes_service.router)
    app.include_router(routes_filesystem.router)
    app.include_router(routes_tasks.router)
    app.include_router(routes_workdir.router)
    app.include_router(routes_export.router)
    app.include_router(routes_runs.router)
    app.include_router(routes_runs.retry_router)
    app.include_router(routes_items.router)
    app.include_router(routes_strategies.library_router)
    app.include_router(routes_strategies.batches_router)
    app.include_router(routes_eval.eval_router)
    directory = frontend_dir if frontend_dir is not None else _default_frontend_dir()
    if directory.is_dir():
        app.mount("/", StaticFiles(directory=directory, html=True), name="frontend")
    return app


@asynccontextmanager
async def _lifespan(app: FastAPI):
    """应用启动钩子：播种产品内置预置提示词 + 清扫已完成（cleaned）的维护记录。"""
    seed_builtin_presets()
    swept = sweep_cleaned_maintenance_records()
    if swept:
        logger.info("已清扫 %d 条已完成的维护记录（workdir-maintenance）。", swept)
    yield


def _default_frontend_dir() -> Path:
    """frontend 默认位置 = backend 工程旁的 ../frontend/dist（前端构建产物）。

    前端已改为工程化构建（Vite + React + TypeScript）：托管的是构建产物而非源码。
    开发期改用 `npm run dev` 起 Vite dev server（它自带 /api 代理到后端），
    平时用 `npm run build` 产出 dist/ 后由本服务托管。
    """
    return Path(__file__).resolve().parents[3].parent / "frontend" / "dist"


class _ProblemRule(NamedTuple):
    """一条 problem+json 规则：异常类 → 状态码 + type slug + title（可附扩展字段）。"""

    exc: type[Exception]
    status: int
    slug: str
    title: str
    extras_from: str | None = None
    static_extras: dict[str, Any] | None = None


#: 域异常 → problem+json 规则表：一条一行 (异常类, 状态码, type slug, title, 扩展字段)。
#: 错误形状全库唯一（RFC 9457），不再按域分简形/标准形两套。
#: 原先每条各写一个闭包（168 行），彼此差别只有四个字段——摊成表才看得出全貌、也才改得动。
_PROBLEM_RULES: tuple[_ProblemRule, ...] = (
    _ProblemRule(ExportError, 400, "export-invalid", "无法导出"),
    _ProblemRule(TaskNotFoundError, 404, "task-not-found", "任务不存在"),
    _ProblemRule(WorkdirNotFoundError, 404, "workdir-not-found", "工作目录不存在"),
    # 占用者是「目录正在迁移 / 删除」，不是「有跑批在跑」——提示不能张冠李戴，故两条分开。
    _ProblemRule(
        WorkdirMaintenanceError, 409, "workdir-maintenance", "工作目录正在维护"
    ),
    _ProblemRule(WorkdirPathError, 400, "workdir-path-invalid", "路径不合法"),
    _ProblemRule(
        WorkdirMetadataCorruptedError,
        500,
        "workdir-metadata-corrupted",
        "工作目录元数据损坏",
    ),
    # 状态锁等满宽超时 = 诊断信号（临界区毫秒级，正常永不触发）：500 档。
    _ProblemRule(StateLockTimeoutError, 500, "state-lock-timeout", "状态锁等待超时"),
    _ProblemRule(AssetNotFoundError, 404, "asset-not-found", "素材不存在"),
    _ProblemRule(ProductNotFoundError, 404, "product-not-found", "产物不存在"),
    _ProblemRule(AssetPathError, 400, "asset-path-invalid", "条目名不合法"),
    _ProblemRule(
        ImportSourceConflictError, 422, "import-source-conflict", "导入来源冲突"
    ),
    _ProblemRule(ImportInProgressError, 409, "import-in-progress", "导入任务进行中"),
    _ProblemRule(StrategyNotFoundError, 404, "strategy-not-found", "库策略不存在"),
    _ProblemRule(StrategyNameError, 400, "strategy-name-invalid", "策略名不合法"),
    _ProblemRule(StrategyRefsError, 400, "strategy-refs-invalid", "策略引用不合法"),
    _ProblemRule(BatchNotFoundError, 404, "batch-not-found", "批次不存在"),
    # 基类兜底（库策略文件损坏等）：500 档，消息已可操作。
    _ProblemRule(StrategyError, 500, "strategy-error", "策略数据异常"),
    # —— 评测（打分批次）域 ——
    _ProblemRule(EvalBatchNotFoundError, 404, "eval-batch-not-found", "打分批次不存在"),
    _ProblemRule(
        EvalRunNotActiveError, 404, "eval-run-not-active", "没有进行中的打分运行"
    ),
    _ProblemRule(EvalConfigError, 400, "eval-config-invalid", "打分批次配置不合法"),
    _ProblemRule(
        EvalConfigCorruptedError, 409, "eval-config-corrupted", "打分批次配置损坏"
    ),
    # occupier 进扩展字段（谁在占用评测运行）；语义同 RunOccupiedError。
    _ProblemRule(
        EvalRunOccupiedError,
        409,
        "eval-run-occupied",
        "工作目录已有打分（评测）运行",
        extras_from="occupier",
    ),
    # eval 域基类兜底：500 档，消息已可操作。
    _ProblemRule(EvalError, 500, "eval-error", "评测数据异常"),
    # occupier 进 RFC 9457 扩展字段（前端提示「谁在占用」用）；跨进程残留信息损坏时为
    # None，detail 已有笼统文案兜底。
    _ProblemRule(
        RunOccupiedError,
        409,
        "run-occupied",
        "工作目录已有跑批在运行",
        extras_from="occupier",
    ),
    _ProblemRule(BatchInactiveError, 409, "batch-inactive", "批次已停用"),
    _ProblemRule(BenchmarkBatchError, 409, "batch-benchmark", "基准批次禁跑批"),
    _ProblemRule(RunNotActiveError, 404, "run-not-active", "当前没有进行中的跑批"),
    # run（损坏所在的那份运行目录名）进扩展字段：就地出口拿它去调清理端点。
    _ProblemRule(
        RunJournalCorruptedError,
        500,
        "run-journal-corrupted",
        "运行流水损坏",
        extras_from="run",
    ),
    # runs 域基类兜底：500 档，消息已可操作。
    _ProblemRule(RunError, 500, "run-error", "跑批数据异常"),
    # 逐条拒绝原因进扩展字段（前端弹「哪些没进名单、为什么」用）。
    _ProblemRule(
        RetryItemNotEligibleError,
        422,
        "retry-item-not-eligible",
        "有不可加入重试列表的条目",
        extras_from="rejections",
    ),
    # —— 打标 / 会话域 ——
    _ProblemRule(UnsupportedImageError, 400, "image-unsupported", "图片格式不支持"),
    _ProblemRule(ImageTooLargeError, 400, "image-too-large", "图片超出大小上限"),
    _ProblemRule(EmptyTurnError, 400, "empty-turn", "空轮次"),
    _ProblemRule(PromptNotSelectedError, 400, "prompt-not-selected", "未选择提示词"),
    _ProblemRule(LabelingError, 500, "labeling-error", "打标失败"),
    _ProblemRule(SettingsFormatError, 500, "settings-format-error", "设置文件损坏"),
    _ProblemRule(LLMError, 502, "llm-error", "模型端点调用失败"),
    _ProblemRule(SessionIdError, 400, "session-id-invalid", "会话 ID 不合法"),
    _ProblemRule(SessionNotFoundError, 404, "session-not-found", "会话不存在"),
    _ProblemRule(SessionEventError, 500, "session-event-error", "会话事件写入失败"),
    # 会话域基类兜底（数据损坏等）：500 档；路由内另有状态码不同的就地翻译（见各路由），
    # Starlette 按 MRO 就近匹配，子类命中自身规则、基类兜底到这里。
    _ProblemRule(SessionError, 500, "session-error", "会话数据异常"),
    # —— 提示词库域 ——
    _ProblemRule(PromptNameError, 400, "prompt-name-invalid", "提示词名不合法"),
    _ProblemRule(PromptParseError, 400, "prompt-parse-error", "提示词文件损坏"),
    _ProblemRule(PromptNotFoundError, 404, "prompt-not-found", "提示词不存在"),
    _ProblemRule(PromptExistsError, 409, "prompt-exists", "提示词已存在"),
    _ProblemRule(PromptTooLargeError, 413, "prompt-too-large", "提示词超出大小上限"),
    _ProblemRule(PromptError, 500, "prompt-error", "提示词数据异常"),
    # —— 技能包域 ——
    _ProblemRule(SkillNameError, 400, "skill-name-invalid", "技能名不合法"),
    _ProblemRule(SkillFormatError, 400, "skill-format-invalid", "技能包格式不合法"),
    _ProblemRule(SkillSourceError, 400, "skill-source-invalid", "技能来源不合法"),
    _ProblemRule(
        SkillFilePathError, 400, "skill-file-path-invalid", "技能包内路径不合法"
    ),
    _ProblemRule(
        SkillFileNotPreviewableError,
        400,
        "skill-file-not-previewable",
        "文件不参与预览",
    ),
    _ProblemRule(SkillNotFoundError, 404, "skill-not-found", "技能不存在"),
    _ProblemRule(SkillExistsError, 409, "skill-exists", "技能已存在"),
    _ProblemRule(SkillError, 500, "skill-error", "技能数据异常"),
    # —— 端点配置域 ——
    _ProblemRule(ConfigError, 400, "endpoint-config-invalid", "端点配置不合法"),
    # name 进扩展字段：前端把错误精确挂到「名称」输入框（aria-invalid 程序化关联）。
    _ProblemRule(
        ConfigNameError,
        400,
        "config-name-invalid",
        "配置名不合法",
        static_extras={"field": "name"},
    ),
    _ProblemRule(ConfigNotFoundError, 404, "config-not-found", "端点配置不存在"),
)


def _problem_handler(
    rule: _ProblemRule,
) -> Callable[[Request, Exception], JSONResponse]:
    """按规则表造一个 problem+json 处理器（响应体与逐条闭包写法逐字段一致）。

    Args:
        rule: 表里的一条规则（状态码 / type slug / title / 可选的扩展字段）。

    Returns:
        可直接交给 ``add_exception_handler`` 的处理器。
    """

    def handler(request: Request, exc: Exception) -> JSONResponse:
        extras: dict[str, Any] | None = None
        if rule.extras_from is not None:
            value = getattr(exc, rule.extras_from, None)
            if value:
                extras = {rule.extras_from: value}
        if rule.static_extras is not None:
            extras = {**(extras or {}), **rule.static_extras}
        return problem_response(rule.status, rule.slug, rule.title, str(exc), extras)

    return handler


def _problem_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """把入口层就地抛出的 :class:`ProblemError` 翻成 problem+json 响应。"""
    problem_exc = cast(ProblemError, exc)  # 注册键即 ProblemError，Starlette 只会喂它
    return problem_response(
        problem_exc.status_code,
        problem_exc.type_slug,
        problem_exc.title,
        str(problem_exc),
        problem_exc.extras,
    )


def _register_error_handlers(app: FastAPI) -> None:
    """注册 problem+json 异常处理器（规则表全量）＋入口层就地错误 ProblemError。"""
    for rule in _PROBLEM_RULES:
        app.add_exception_handler(rule.exc, _problem_handler(rule))
    app.add_exception_handler(ProblemError, _problem_error_handler)
