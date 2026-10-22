"""RFC 9457 problem+json 错误响应助手（全库统一错误形）。

分工（design 横切约定）：所有错误响应一律 problem+json——``type`` 放机器可读的
slug、``title`` 短语、``status`` 状态码、``detail`` 中文可操作消息，扩展字段
（occupier / field / 冲突清单等）按需附加。域异常由 ``app.py`` 的规则表统一映射；
没有对应域异常的入口层就地翻译点（请求形状校验、装配状态检查等）抛
:class:`ProblemError`，由同一个处理器翻成同形响应。
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from fastapi.responses import JSONResponse

from .schemas import Problem

__all__ = [
    "PROBLEM_MEDIA_TYPE",
    "ProblemError",
    "problem",
    "problem_response",
    "problem_schema_responses",
]

#: RFC 9457 规定的 problem+json 媒体类型。
PROBLEM_MEDIA_TYPE = "application/problem+json"


class ProblemError(Exception):
    """入口层就地抛出的 problem+json 错误（无对应域异常的翻译点用）。

    Args:
        status_code: HTTP 状态码。
        type_slug: 机器可读的错误类别短标识（如 ``media-exclusive``）。
        title: 人读的短语概括。
        detail: 中文可操作消息。
        extras: 扩展字段（RFC 9457 允许 extension members）；None = 不附加。
    """

    def __init__(
        self,
        status_code: int,
        type_slug: str,
        title: str,
        detail: str,
        extras: dict[str, Any] | None = None,
    ) -> None:
        """字段语义见类 docstring；detail 同时作为异常消息（str(exc) 取它）。"""
        super().__init__(detail)
        self.status_code = status_code
        self.type_slug = type_slug
        self.title = title
        self.extras = extras


def problem_response(
    status_code: int,
    type_slug: str,
    title: str,
    detail: str,
    extras: dict[str, Any] | None = None,
) -> JSONResponse:
    """构造一个 problem+json 错误响应。

    Args:
        status_code: HTTP 状态码（同时写入响应体 status 字段）。
        type_slug: 机器可读的错误类别短标识（如 ``task-not-found``）。
        title: 人读的短语概括（如「任务不存在」）。
        detail: 中文可操作消息——讲清下一步该做什么。
        extras: 扩展字段（RFC 9457 允许 extension members，如占用者信息 occupier）；
            None = 不附加。
    """
    content: dict[str, Any] = {
        "type": type_slug,
        "title": title,
        "status": status_code,
        "detail": detail,
    }
    if extras:
        content.update(extras)
    return JSONResponse(
        status_code=status_code,
        content=content,
        media_type=PROBLEM_MEDIA_TYPE,
    )


def problem(description: str | None = None) -> dict[str, Any]:
    """路由 ``responses=`` 里的一条 problem+json 声明（契约声明面，不是运行时响应）。

    收敛前这个形状在 6 个路由文件里手摊了 58 处；「哪个状态码用哪种错误形」这件事因此有 58 个
    副本，改一处忘别处就是契约漂移。说明文案照旧由调用方给（它会进 OpenAPI，前端生成类型时
    看得到）；不给就不写 ``description`` 键，让 FastAPI 按默认方式渲染——键在不在都影响快照。

    Args:
        description: 这个状态码意味着什么的中文说明（进契约快照，逐字保留）。
    """
    declared: dict[str, Any] = {
        "model": Problem,
        "content": {PROBLEM_MEDIA_TYPE: {}},
    }
    if description is not None:
        declared["description"] = description
    return declared


def problem_schema_responses(codes: Sequence[int]) -> dict[int | str, dict[str, Any]]:
    """一组「只声明媒体类型与 schema、不带说明」的 problem+json 声明。

    与 :func:`problem` 是两种不同的契约产物（前者给 `$ref Problem` + 一个空的媒体类型条目，
    这里内联整份 schema），所以不合并成一种写法——合并等于改 ``openapi.json``。

    返回类型按 FastAPI ``responses=`` 参数要的形状标：``dict`` 的键型是不变的，
    ``dict[int, ...]`` 不能直接当 ``dict[int | str, ...]`` 用。
    """
    declared: dict[int | str, dict[str, Any]] = {}
    for code in codes:
        declared[code] = {
            "content": {PROBLEM_MEDIA_TYPE: {"schema": Problem.model_json_schema()}}
        }
    return declared
