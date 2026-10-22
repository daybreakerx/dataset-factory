"""错误映射的契约测试：把「域异常 → HTTP 响应」全部规则逐条钉住。

为什么单独写一件：`api/app.py` 的映射是一张规则表 + 一个工厂，错误形状全库统一为
problem+json。「表与预期等价」这件事不能只靠原有路由测试顺带覆盖——每条路由测试只
撞到自己那一条，表里另一条写错不会红。这里在测试内**独立列一份期望表**（不复用产码
的表，避免「一起写错就一起绿」），逐条造异常走真实 HTTP 栈，钉住状态码、problem+json
的四个字段、媒体类型与扩展字段的取舍。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from dataset_factory.api.app import create_app
from dataset_factory.export import ExportError
from dataset_factory.labeling import (
    EmptyTurnError,
    LabelingError,
    PromptNotSelectedError,
    SettingsFormatError,
)
from dataset_factory.llm import (
    ConfigError,
    ConfigNameError,
    ConfigNotFoundError,
    ImageTooLargeError,
    LLMError,
    UnsupportedImageError,
)
from dataset_factory.prompts import (
    PromptError,
    PromptExistsError,
    PromptNameError,
    PromptNotFoundError,
    PromptParseError,
    PromptTooLargeError,
)
from dataset_factory.runs import (
    BatchInactiveError,
    RetryItemNotEligibleError,
    RunError,
    RunJournalCorruptedError,
    RunNotActiveError,
)
from dataset_factory.sessions import (
    SessionError,
    SessionEventError,
    SessionIdError,
    SessionNotFoundError,
)
from dataset_factory.skills import (
    SkillError,
    SkillExistsError,
    SkillFileNotPreviewableError,
    SkillFilePathError,
    SkillFormatError,
    SkillNameError,
    SkillNotFoundError,
    SkillSourceError,
)
from dataset_factory.strategies import (
    BatchNotFoundError,
    StrategyError,
    StrategyNameError,
    StrategyNotFoundError,
    StrategyRefsError,
)
from dataset_factory.tasks import TaskNotFoundError
from dataset_factory.workdir import (
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

#: 期望契约：异常类 → (状态码, type slug, title, 扩展字段名)。与产码表各写一份是有意的。
#: ConfigNameError 的 field 扩展字段不在此表（静态值走专项测试，见下方）。
EXPECTED: list[tuple[type[Exception], int, str, str, str | None]] = [
    (ExportError, 400, "export-invalid", "无法导出", None),
    (TaskNotFoundError, 404, "task-not-found", "任务不存在", None),
    (WorkdirNotFoundError, 404, "workdir-not-found", "工作目录不存在", None),
    (WorkdirPathError, 400, "workdir-path-invalid", "路径不合法", None),
    (WorkdirMaintenanceError, 409, "workdir-maintenance", "工作目录正在维护", None),
    (
        WorkdirMetadataCorruptedError,
        500,
        "workdir-metadata-corrupted",
        "工作目录元数据损坏",
        None,
    ),
    (StateLockTimeoutError, 500, "state-lock-timeout", "状态锁等待超时", None),
    (AssetNotFoundError, 404, "asset-not-found", "素材不存在", None),
    (ProductNotFoundError, 404, "product-not-found", "产物不存在", None),
    (AssetPathError, 400, "asset-path-invalid", "条目名不合法", None),
    (ImportSourceConflictError, 422, "import-source-conflict", "导入来源冲突", None),
    (ImportInProgressError, 409, "import-in-progress", "导入任务进行中", None),
    (StrategyNotFoundError, 404, "strategy-not-found", "库策略不存在", None),
    (StrategyNameError, 400, "strategy-name-invalid", "策略名不合法", None),
    (StrategyRefsError, 400, "strategy-refs-invalid", "策略引用不合法", None),
    (BatchNotFoundError, 404, "batch-not-found", "批次不存在", None),
    (StrategyError, 500, "strategy-error", "策略数据异常", None),
    (RunOccupiedError, 409, "run-occupied", "工作目录已有跑批在运行", "occupier"),
    (BatchInactiveError, 409, "batch-inactive", "批次已停用", None),
    (RunNotActiveError, 404, "run-not-active", "当前没有进行中的跑批", None),
    # run ＝损坏所在的那份运行目录名：前端拿它去调清理端点，就地出口才有对象可指。
    (
        RunJournalCorruptedError,
        500,
        "run-journal-corrupted",
        "运行流水损坏",
        "run",
    ),
    (RunError, 500, "run-error", "跑批数据异常", None),
    (
        RetryItemNotEligibleError,
        422,
        "retry-item-not-eligible",
        "有不可加入重试列表的条目",
        "rejections",
    ),
    # —— 打标 / 会话域 ——
    (UnsupportedImageError, 400, "image-unsupported", "图片格式不支持", None),
    (ImageTooLargeError, 400, "image-too-large", "图片超出大小上限", None),
    (EmptyTurnError, 400, "empty-turn", "空轮次", None),
    (PromptNotSelectedError, 400, "prompt-not-selected", "未选择提示词", None),
    (LabelingError, 500, "labeling-error", "打标失败", None),
    (SettingsFormatError, 500, "settings-format-error", "设置文件损坏", None),
    (LLMError, 502, "llm-error", "模型端点调用失败", None),
    (SessionIdError, 400, "session-id-invalid", "会话 ID 不合法", None),
    (SessionNotFoundError, 404, "session-not-found", "会话不存在", None),
    (SessionEventError, 500, "session-event-error", "会话事件写入失败", None),
    (SessionError, 500, "session-error", "会话数据异常", None),
    # —— 提示词库域 ——
    (PromptNameError, 400, "prompt-name-invalid", "提示词名不合法", None),
    (PromptParseError, 400, "prompt-parse-error", "提示词文件损坏", None),
    (PromptNotFoundError, 404, "prompt-not-found", "提示词不存在", None),
    (PromptExistsError, 409, "prompt-exists", "提示词已存在", None),
    (PromptTooLargeError, 413, "prompt-too-large", "提示词超出大小上限", None),
    (PromptError, 500, "prompt-error", "提示词数据异常", None),
    # —— 技能包域 ——
    (SkillNameError, 400, "skill-name-invalid", "技能名不合法", None),
    (SkillFormatError, 400, "skill-format-invalid", "技能包格式不合法", None),
    (SkillSourceError, 400, "skill-source-invalid", "技能来源不合法", None),
    (SkillFilePathError, 400, "skill-file-path-invalid", "技能包内路径不合法", None),
    (
        SkillFileNotPreviewableError,
        400,
        "skill-file-not-previewable",
        "文件不参与预览",
        None,
    ),
    (SkillNotFoundError, 404, "skill-not-found", "技能不存在", None),
    (SkillExistsError, 409, "skill-exists", "技能已存在", None),
    (SkillError, 500, "skill-error", "技能数据异常", None),
    # —— 端点配置域 ——
    (ConfigError, 400, "endpoint-config-invalid", "端点配置不合法", None),
    (ConfigNotFoundError, 404, "config-not-found", "端点配置不存在", None),
]

#: 扩展字段的样例值（有值才该出现在响应体里）。带扩展字段的异常都由构造函数收，
#: 故下面用一个显式装配器造实例。
OCCUPIER: dict[str, Any] = {
    "pid": 4321,
    "batch": "s2",
    "started_at": "2026-01-01T00:00:00+00:00",
}
REJECTIONS: dict[str, str] = {"alpha": "素材缺失，无法重试"}
RUN_DIR = "20261012-010000-a1b2c3"

MISSING_FRONTEND = Path("__no_such_frontend_dir__")


def _build(
    exc_type: type[Exception],
    message: str,
    extras_from: str | None,
    *,
    with_extras: bool = True,
) -> Exception:
    """按契约造一个异常实例；扩展字段一律走构造参数，不在实例上事后赋值。

    Args:
        exc_type: 异常类。
        message: 进 detail 的可操作消息。
        extras_from: 扩展字段名；None = 该条规则不带扩展字段。
        with_extras: False = 造「扩展字段为空」的那一条（残留信息损坏 / 无逐条原因）。

    Returns:
        异常实例。
    """
    if exc_type is RunOccupiedError:
        return RunOccupiedError(message, occupier=OCCUPIER if with_extras else None)
    if exc_type is RetryItemNotEligibleError:
        return RetryItemNotEligibleError(
            message, rejections=REJECTIONS if with_extras else {}
        )
    if exc_type is RunJournalCorruptedError:
        return RunJournalCorruptedError(message, run=RUN_DIR if with_extras else None)
    return exc_type(message)


def _client_raising(exc: Exception) -> TestClient:
    """用真实应用工厂挂一条「必定抛出 exc」的端点，返回测试客户端。

    Args:
        exc: 端点要抛出的异常实例。

    Returns:
        TestClient；`frontend_dir` 指向不存在的路径，避免静态挂载吞掉探针路由。
    """
    app = create_app(frontend_dir=MISSING_FRONTEND)

    async def probe(request: Request) -> JSONResponse:
        raise exc

    app.add_route("/probe-error", probe, methods=["GET"])
    return TestClient(app)


@pytest.mark.parametrize(
    ("exc_type", "status", "slug", "title", "extras_from"),
    EXPECTED,
    ids=[entry[0].__name__ for entry in EXPECTED],
)
def test_problem_response_matches_contract(
    exc_type: type[Exception],
    status: int,
    slug: str,
    title: str,
    extras_from: str | None,
) -> None:
    """每条规则的状态码、媒体类型与 problem+json 四字段都要按契约出。"""
    message = "可操作的中文消息：下一步该做什么。"
    exc = _build(exc_type, message, extras_from)
    expected_body: dict[str, Any] = {
        "type": slug,
        "title": title,
        "status": status,
        "detail": message,
    }
    if extras_from == "occupier":
        expected_body["occupier"] = OCCUPIER
    if extras_from == "rejections":
        expected_body["rejections"] = REJECTIONS
    if extras_from == "run":
        expected_body["run"] = RUN_DIR

    response = _client_raising(exc).get("/probe-error")

    assert response.status_code == status
    assert response.headers["content-type"].startswith("application/problem+json")
    body: dict[str, Any] = response.json()
    assert body == expected_body


@pytest.mark.parametrize(
    ("exc_type", "extras_from"),
    [
        (RunOccupiedError, "occupier"),
        (RetryItemNotEligibleError, "rejections"),
        (RunJournalCorruptedError, "run"),
    ],
    ids=["run-occupied 无占用者", "retry 无拒绝清单", "journal 叫不出是哪一份"],
)
def test_empty_extension_member_is_omitted(
    exc_type: type[Exception], extras_from: str
) -> None:
    """扩展字段为空（跨进程残留信息损坏 / 无逐条原因）时不多出一个空键。"""
    empty = _build(exc_type, "笼统文案", extras_from, with_extras=False)
    body: dict[str, Any] = _client_raising(empty).get("/probe-error").json()

    assert extras_from not in body
    assert body["detail"] == "笼统文案"


def test_config_name_error_carries_field_extension() -> None:
    """字段级错误把 field 扩展字段带进 problem 体（前端把错误挂到名称输入框的依据）。"""
    response = _client_raising(ConfigNameError("配置名不合法。")).get("/probe-error")
    body: dict[str, Any] = response.json()

    assert response.status_code == 400
    assert response.headers["content-type"].startswith("application/problem+json")
    assert body["type"] == "config-name-invalid"
    assert body["field"] == "name"


def test_operational_error_has_no_field_member() -> None:
    """操作级错误不多出 field 键（前端按「键在不在」取字段标记）。"""
    body: dict[str, Any] = (
        _client_raising(ConfigError("配置缺失")).get("/probe-error").json()
    )

    assert "field" not in body
    assert body["detail"] == "配置缺失"


def test_one_handler_per_exception_class() -> None:
    """每张表项都在应用上注册到了处理器，且同异常类不被注册两次。"""
    app = create_app(frontend_dir=MISSING_FRONTEND)
    registered = [
        exc_type for exc_type, *_rest in EXPECTED if exc_type in app.exception_handlers
    ]

    assert len(registered) == len(EXPECTED)
    assert len(set(registered)) == len(EXPECTED)
