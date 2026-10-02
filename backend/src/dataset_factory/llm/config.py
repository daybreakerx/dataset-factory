"""llm 模块的请求侧配置视图——把**指定的**端点配置组装成可发请求的 EndpointConfig。

存储侧（endpoints/ 多配置目录、迁移、增删改查）见同目录 endpoints.py；本模块是其上的
「请求视图」：按调用方显式给出的配置（请求显式携带端点——ADR 2026-09-30「全局当前使用
退役」），套上密钥双通道与请求参数，产出构建 API 客户端所需的类型化对象。本模块不设、
也不读任何「当前使用」状态。

设计要点：

- 密钥双通道：指定配置的 credentials 文件为主，环境变量 DSF_API_KEY 为辅且优先覆盖；
- 全程脱敏：密钥绝不进 repr / str / 日志 / 错误信息；
- 边界 Fail-Fast：缺失 / 损坏给可操作错误（哪里错、怎么修），不甩原始栈、不泄密钥。
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import cast

from .endpoints import (
    ConfigError,
    SecretValue,
    read_config_data,
    read_stored_api_key,
    validated_request_params,
)

ENV_API_KEY = "DSF_API_KEY"  # pragma: allowlist secret —— 环境变量名常量、非密钥值（辅通道，优先覆盖 credentials 文件）

# 请求参数的默认值（可被 config.json 覆盖；见 design「llm 模块实现基调」的生成参数条）。
_DEFAULT_TIMEOUT_SECONDS = 120.0
_DEFAULT_MAX_RETRIES = 2


@dataclass(frozen=True)
class RequestConfig:
    """一次模型请求的可调参数：生成参数（标准层 + 透传层）与传输参数。

    分两层是刻意的（见 design「llm 模块实现基调」）：**标准层**只放 OpenAI 标准参数
    （temperature / top_p / max_tokens，语义跨端点通用）；**透传层** `extra_body` 原样转发
    端点专有参数（如 Qwen 的 `chat_template_kwargs.enable_thinking`、`top_k`），llm 不解释
    其语义——这样将来端点冒出的新参数不必改核心接口，符合「不绑定厂商」的方向。

    所有字段都有默认值：不配也能跑，配了才生效。

    Attributes:
        temperature: 采样温度；None = 不传该参数（用端点默认）。
        top_p: 核采样阈值；None = 不传。
        max_tokens: **输出** token 上限；None = 不传。注意它管输出侧，不是上下文窗口——
            上下文窗口是模型的固有属性、不可设置。
        enable_thinking: 思考模式开关（一等参数，B 方案 2026-09-23）；None = 不传
            （跟随模型默认）。布尔值按 SiliconFlow / DashScope 等国内端点的官方顶层
            口径进请求体；其余厂商形状（reasoning_effort / thinking 等）走 extra_body。
        extra_body: 端点专有参数，原样放进 SDK 的 extra_body 转发；None = 不传。
        timeout_seconds: 单次 HTTP 调用超时（秒）。推理型模型默认带思考模式时响应明显更慢，
            必要时调大它。
        max_retries: SDK 内建重试次数（对超时 / 5xx / 429 指数退避）。
    """

    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = None
    enable_thinking: bool | None = None
    extra_body: Mapping[str, object] | None = None
    timeout_seconds: float = _DEFAULT_TIMEOUT_SECONDS
    max_retries: int = _DEFAULT_MAX_RETRIES


@dataclass(frozen=True)
class EndpointConfig:
    """构建 API 客户端所需的端点配置。

    api_key 为 SecretValue，因此本对象自动生成的 repr 也不会泄露密钥。

    Attributes:
        base_url: 端点地址。
        model: 模型名。
        api_key: 密钥（脱敏包裹）。
        request: 请求参数（生成 + 传输），全部有默认值——调用方不关心时无需提供。
    """

    base_url: str
    model: str
    api_key: SecretValue
    request: RequestConfig = RequestConfig()


def read_config(cid: str) -> EndpointConfig:
    """按显式指定的端点配置 + 请求参数 + 密钥，组装成 EndpointConfig。

    端点由调用方显式给出（请求显式携带端点——ADR 2026-09-30「全局当前使用退役」）；
    本函数不存在「缺省用哪套」的语义。入参接受配置 ID 或唯一显示名（解析口径同存储层）。

    Args:
        cid: 端点配置 ID（或唯一显示名）。

    Returns:
        EndpointConfig：端点三要素 + 请求参数（未配置时用内置默认）。

    Raises:
        ConfigNotFoundError: 配置不存在。
        ConfigError: config.json 损坏 / 字段不全 / 密钥两通道都拿不到（消息可操作、不含密钥）。
    """
    data = read_config_data(cid)
    resolved = cast(str, data["id"])
    # read_config_data 已把 base_url / model 校验为非空字符串，这里收窄只是让类型系统知道。
    base_url = cast(str, data["base_url"])
    model = cast(str, data["model"])
    return EndpointConfig(
        base_url=base_url,
        model=model,
        api_key=resolve_api_key(read_stored_api_key(resolved)),
        request=_parse_request_config(resolved, data),
    )


def _parse_request_config(name: str, data: Mapping[str, object]) -> RequestConfig:
    """解析 config.json 里可选的请求参数（没配就用内置默认）。

    Args:
        name: 配置名（仅用于报错信息）。
        data: config.json 解析出的顶层对象。

    Returns:
        请求参数；所有字段都可缺省。

    Raises:
        ConfigError: 某个参数字段存在但类型不对。
    """
    return parse_request_params(validated_request_params(data, name))


def parse_request_params(params: Mapping[str, object]) -> RequestConfig:
    """把「已过类型校验的请求参数键值」装配成 RequestConfig（没配的键用内置默认）。

    公开出口——二期跑批从策略快照的 request_params 块装配请求参数时复用同一份
    收窄逻辑（快照装配时已校验过类型，这里只做「有值就用、没值回默认」）。

    Args:
        params: 只含实际存在的参数键的字典（temperature / top_p / max_tokens /
            enable_thinking / extra_body / timeout_seconds / max_retries）。

    Returns:
        RequestConfig。

    Raises:
        ConfigError: 某个参数键存在但类型不对（bool 不算数字 / 整数）。
    """
    timeout = params.get("timeout_seconds")
    retries = params.get("max_retries")
    extra_body = params.get("extra_body")
    thinking = params.get("enable_thinking")
    return RequestConfig(
        temperature=_as_opt_float(params.get("temperature")),
        top_p=_as_opt_float(params.get("top_p")),
        max_tokens=_as_opt_int(params.get("max_tokens")),
        enable_thinking=cast(bool, thinking) if thinking is not None else None,
        extra_body=cast("dict[str, object] | None", extra_body),
        timeout_seconds=(
            float(cast(float, timeout))
            if timeout is not None
            else _DEFAULT_TIMEOUT_SECONDS
        ),
        max_retries=(
            cast(int, retries) if retries is not None else _DEFAULT_MAX_RETRIES
        ),
    )


def _as_opt_float(raw: object | None) -> float | None:
    """已校验的数字值收窄为 float；缺失返回 None。"""
    return float(cast("int | float", raw)) if raw is not None else None


def _as_opt_int(raw: object | None) -> int | None:
    """已校验的整数值收窄为 int；缺失返回 None。"""
    return cast(int, raw) if raw is not None else None


def env_api_key() -> SecretValue | None:
    """环境变量通道 `DSF_API_KEY`：未设或全空白都按「没有密钥」处理。

    这条空白判定只能出现在这里——各出口（跑批、CLI 测端点、Web 测连接）都靠它决定是否
    回落下一级通道，写歪一处就会出现「设了空环境变量当成有密钥」这种难查的分歧。
    """
    raw = os.environ.get(ENV_API_KEY, "").strip()
    return SecretValue(raw) if raw else None


def first_api_key(*candidates: SecretValue | None) -> SecretValue | None:
    """按给定顺序返回第一个可用密钥，全不可用返回 None——报错方式归各出口自己定。

    候选项必须已经是「空白即 None」的形态（`env_api_key` / `_parse_key` /
    `read_stored_api_key` 三条通道都是这口径），所以这里只认 `is not None`，
    不去比对密钥内容：`SecretValue` 的字符串化是掩码，比内容只会把密钥引到不该出现的地方。
    """
    for candidate in candidates:
        if candidate is not None:
            return candidate
    return None


def resolve_api_key(file_key: SecretValue | None) -> SecretValue:
    """按双通道解析 API 密钥：环境变量 DSF_API_KEY 优先，其次 credentials 文件密钥。

    公开出口——二期跑批从策略快照装配客户端时复用同一份双通道判定。

    Args:
        file_key: credentials 文件里的密钥（读不到为 None）。

    Returns:
        包好的密钥（SecretValue，字符串化时脱敏）。

    Raises:
        ConfigError: 两个通道都拿不到非空密钥。
    """
    resolved = first_api_key(env_api_key(), file_key)
    if resolved is not None:
        return resolved
    raise ConfigError(
        "未找到 API 密钥：请为该端点配置密钥（Web 设置页或 `dsf config add`），"
        f"或使用环境变量 {ENV_API_KEY}。"
    )
