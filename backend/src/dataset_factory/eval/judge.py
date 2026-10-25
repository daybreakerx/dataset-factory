"""judge 调用协议：维度评分与 pairwise 对比的消息组装、schema 派生、降级链与修复重试。

口径（tdd 暂存件「四、打标机制」）：
- **提示词静态自足**——格式说明与 rubric 住在裁判策略资产里，运行时不注入维度
  列表；维度清单只用于派生 response_format 的 JSON Schema（值域钉死：五档评分
  enum 1–5、是非维度 enum 有／无、「理由」固定字段）。两边由用户自己对齐，
  漂移由 κ 校准兜底。
- **身份盲化**——被评批次序号、模型名等身份线索不进任何消息；pairwise 的 A/B
  位置标签是双序交换的控制对象、不是身份，允许出现。
- **有参照与无参照同一套骨架**——参照块是插槽，插入时带使用规则；无参照整块
  省掉（G-Eval 实证：同一协议可切有无参考，一处维护）。
- **结构化输出三级降级**——标准 json_schema → JSON 模式（json_object）→ 纯
  文本；端点拒（LLMBadRequestError）即降一级、记入调用记录。解析／校验不过
  就地修复重试（原文＋问题清单回喂，次数上限），超限抛 EvalJudgeFormatError
  （运行层转条目失败）。
- pairwise 的比较规则（准确性优先＋幻觉一票否决）与输出形状（A/B/tie）是产品
  级常量、由本模块静态注入——它不是 rubric（rubric 住资产），是判胜负的协议。
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import cast

from ..llm import (
    Completer,
    ImagePart,
    LLMBadRequestError,
    Message,
    StructuredCompleter,
    TextPart,
    VideoPart,
)
from .config import KIND_SCORE5, DimensionSpec
from .errors import EvalJudgeFormatError

__all__ = [
    "DimensionVerdict",
    "JudgeCallRecord",
    "JudgeCaller",
    "PairwiseVerdict",
    "build_dimension_messages",
    "build_pairwise_messages",
    "dimension_response_schema",
    "pairwise_response_schema",
    "parse_dimension_output",
    "parse_pairwise_output",
]

_SKILL_OPEN = "<skill>"
_SKILL_CLOSE = "</skill>"

_REASON_KEY = "理由"

#: 输出档（调用记录里记的是这三个词）：标准 schema → JSON 模式 → 纯文本。
_MODE_SCHEMA = "json_schema"
_MODE_JSON = "json_object"
_MODE_PLAIN = "plain"

_REFERENCE_USAGE = (
    "参照 caption 使用规则：参照是基准不是标准答案；与参照措辞不同不代表错，"
    "须按语义比对；参照自身可能不准确；机器翻译的参照应降权采信。"
)

_PAIRWISE_RULE = (
    "比较规则：准确性优先——任一条有编造（幻觉）直接判负；都不编造时，"
    "比谁对画面的描述更准确、更完整；两条皆编造或难分高下判 tie。"
    '只输出 JSON 对象：{"winner": "A" 或 "B" 或 "tie", "理由": "判定理由"}。'
)


@dataclass(frozen=True)
class DimensionVerdict:
    """一次维度评分的解析结果：各维度取值（1–5 整数或「有／无」）＋理由。"""

    scores: dict[str, int | str]
    reason: str


@dataclass(frozen=True)
class PairwiseVerdict:
    """一次 pairwise 对比的解析结果：胜方（A / B / tie，两序不一致由运行层判平局）。"""

    winner: str
    reason: str


@dataclass(frozen=True)
class JudgeCallRecord:
    """一次 judge 调用的落地轨迹（随条目流水存档：原始输出与降级档位）。"""

    schema_mode: str  # json_schema / json_object / plain
    raw_output: str
    repair_attempts: int


def _skill_parts(skill_texts: list[str]) -> list[TextPart]:
    """评判技能包逐个 <skill> 包裹（与打标注入同一边界标记）。"""
    return [TextPart(f"{_SKILL_OPEN}\n{text}\n{_SKILL_CLOSE}") for text in skill_texts]


def build_dimension_messages(
    *,
    prompt_body: str,
    skill_texts: list[str],
    media: ImagePart | VideoPart,
    candidate_caption: str,
    reference_caption: str | None,
) -> list[Message]:
    """组装一次维度评分调用：judge 提示词进 system，素材与文本块进 user。

    身份盲化与静态自足都在构造上成立——消息里只有素材、候选 caption 与可选
    参照块，无任何批次／模型身份线索，也不注入维度列表。
    """
    parts: list[TextPart | ImagePart | VideoPart] = [*_skill_parts(skill_texts)]
    parts.append(media)
    parts.append(TextPart(f"<candidate>\n{candidate_caption}\n</candidate>"))
    if reference_caption is not None:
        parts.append(
            TextPart(
                f"<reference>\n{_REFERENCE_USAGE}\n{reference_caption}\n</reference>"
            )
        )
    return [
        Message(role="system", parts=(TextPart(prompt_body),)),
        Message(role="user", parts=tuple(parts)),
    ]


def build_pairwise_messages(
    *,
    prompt_body: str,
    skill_texts: list[str],
    media: ImagePart | VideoPart,
    caption_a: str,
    caption_b: str,
    reference_caption: str | None,
) -> list[Message]:
    """组装一次 pairwise 对比调用（A/B 为位置标签；双序交换＝换位重发一次）。"""
    parts: list[TextPart | ImagePart | VideoPart] = [*_skill_parts(skill_texts)]
    parts.append(media)
    parts.append(TextPart(f"<caption-a>\n{caption_a}\n</caption-a>"))
    parts.append(TextPart(f"<caption-b>\n{caption_b}\n</caption-b>"))
    if reference_caption is not None:
        parts.append(
            TextPart(
                f"<reference>\n{_REFERENCE_USAGE}\n{reference_caption}\n</reference>"
            )
        )
    parts.append(TextPart(_PAIRWISE_RULE))
    return [
        Message(role="system", parts=(TextPart(prompt_body),)),
        Message(role="user", parts=tuple(parts)),
    ]


def dimension_response_schema(dimensions: list[DimensionSpec]) -> dict[str, object]:
    """由维度清单派生维度评分输出的 JSON Schema（值域钉死，「理由」固定字段）。

    约束解码只保格式合法、不保判得对——语义校验在 parse 侧（修复重试的依据）。
    """
    properties: dict[str, object] = {}
    required: list[str] = []
    for dim in dimensions:
        if dim.kind == KIND_SCORE5:
            properties[dim.name] = {"type": "integer", "enum": [1, 2, 3, 4, 5]}
        else:
            properties[dim.name] = {"type": "string", "enum": ["有", "无"]}
        required.append(dim.name)
    properties[_REASON_KEY] = {"type": "string"}
    required.append(_REASON_KEY)
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": properties,
        "required": required,
    }


def pairwise_response_schema() -> dict[str, object]:
    """pairwise 对比输出的 JSON Schema（winner 三值；两序不一致由运行层判平局）。"""
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "winner": {"type": "string", "enum": ["A", "B", "tie"]},
            _REASON_KEY: {"type": "string"},
        },
        "required": ["winner", _REASON_KEY],
    }


def parse_dimension_output(
    raw: str, dimensions: list[DimensionSpec]
) -> DimensionVerdict:
    """解析维度评分输出；任何问题聚合抛 EvalJudgeFormatError（修复重试的信号）。"""
    data = _extract_json_object(raw)
    if data is None:
        raise EvalJudgeFormatError(["输出里找不到 JSON 对象"])
    problems: list[str] = []
    scores: dict[str, int | str] = {}
    for dim in dimensions:
        value = data.get(dim.name)
        if dim.kind == KIND_SCORE5:
            if (
                isinstance(value, int)
                and not isinstance(value, bool)
                and 1 <= value <= 5
            ):
                scores[dim.name] = value
            else:
                problems.append(
                    f"维度「{dim.name}」的分数须为 1–5 的整数，实际为 {value!r}"
                )
        elif value in ("有", "无"):
            scores[dim.name] = str(value)
        else:
            problems.append(
                f"维度「{dim.name}」的判定须为「有」或「无」，实际为 {value!r}"
            )
    reason_text = data.get(_REASON_KEY)
    reason = reason_text if isinstance(reason_text, str) else ""
    if not reason.strip():
        problems.append(f"「{_REASON_KEY}」须为非空文本")
    if problems:
        raise EvalJudgeFormatError(problems)
    return DimensionVerdict(scores=scores, reason=reason)


def parse_pairwise_output(raw: str) -> PairwiseVerdict:
    """解析 pairwise 对比输出；问题聚合抛 EvalJudgeFormatError。"""
    data = _extract_json_object(raw)
    if data is None:
        raise EvalJudgeFormatError(["输出里找不到 JSON 对象"])
    problems: list[str] = []
    winner = data.get("winner")
    if winner not in ("A", "B", "tie"):
        problems.append(f"winner 须为 A、B 或 tie，实际为 {winner!r}")
    reason_text = data.get(_REASON_KEY)
    reason = reason_text if isinstance(reason_text, str) else ""
    if not reason.strip():
        problems.append(f"「{_REASON_KEY}」须为非空文本")
    if problems:
        raise EvalJudgeFormatError(problems)
    return PairwiseVerdict(winner=str(winner), reason=reason)


def _extract_json_object(raw: str) -> dict[str, object] | None:
    """从模型输出提取 JSON 对象（容忍代码围栏与前后闲话；失败返回 None）。"""
    text = raw.strip()
    if text.startswith("```"):
        first_newline = text.find("\n")
        if first_newline != -1:
            text = text[first_newline + 1 :]
        stripped = text.rstrip()
        if stripped.endswith("```"):
            text = stripped[:-3]
    data: object | None = None
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end > start:
            try:
                data = json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                data = None
    if isinstance(data, dict):
        return cast("dict[str, object]", data)
    return None


def _response_payload(
    mode: str, schema: dict[str, object] | None, schema_name: str
) -> dict[str, object] | None:
    """输出档 → response_format 载荷（plain 档不带该参数）。"""
    if mode == _MODE_PLAIN:
        return None
    if mode == _MODE_JSON:
        return {"type": "json_object"}
    return {
        "type": "json_schema",
        "json_schema": {"name": schema_name, "strict": True, "schema": schema},
    }


def _repair_message(raw: str, problems: list[str]) -> Message:
    """构造修复重试的回喂消息：问题清单＋原文＋只输出修正 JSON 的指令。"""
    text = (
        "你上一条输出未通过校验，问题如下：\n- "
        + "\n- ".join(problems)
        + "\n\n你的上一条输出：\n"
        + raw
        + "\n\n请只输出修正后的 JSON 对象，不要输出任何其他内容。"
    )
    return Message(role="user", parts=(TextPart(text),))


class JudgeCaller:
    """持一个 Completer 跑 judge 调用：三级降级＋修复重试，产出解析结果与轨迹。

    Args:
        completer: 裁判端点的补全客户端（温度 0 由裁判端点配置自带——tdd「打标
            机制」：同一端点既打标又当裁判时备两份配置，属用户自己的事）。
        repair_limit: 每档的修复重试次数上限（默认 2——首次尝试之外最多补写两次）。
    """

    def __init__(self, completer: Completer, *, repair_limit: int = 2) -> None:
        """记住客户端与修复上限；探测结构化输出能力（不具备即只有纯文本档）。"""
        self._completer = completer
        self._repair_limit = repair_limit
        self._structured: StructuredCompleter | None = (
            completer if isinstance(completer, StructuredCompleter) else None
        )

    def call[T](
        self,
        messages: list[Message],
        *,
        schema: dict[str, object] | None,
        schema_name: str,
        parse: Callable[[str], T],
    ) -> tuple[T, JudgeCallRecord]:
        """跑一次 judge 调用：按档发送、解析、修复重试，全档被拒则抛最后一拒。

        Args:
            messages: 组装好的消息（build_*_messages 的产物）。
            schema: 输出 JSON Schema（维度清单派生或 pairwise 形状）；None = 该
                调用无 schema 可派，直接纯文本档。
            schema_name: json_schema 载荷里的名字（仅诊断用）。
            parse: 原文 → 解析结果的函数（parse_*_output；抛 EvalJudgeFormatError
                触发修复重试）。

        Returns:
            (解析结果, 调用轨迹)。

        Raises:
            EvalJudgeFormatError: 修复重试超限（该档已被端点接受、模型输出始终不过校验）。
            LLMBadRequestError: 所有档都被端点拒（或纯文本档本身就是坏请求）。
        """
        if schema is not None and self._structured is not None:
            tiers = (_MODE_SCHEMA, _MODE_JSON, _MODE_PLAIN)
        else:
            tiers = (_MODE_PLAIN,)
        last_reject: LLMBadRequestError | None = None
        for mode in tiers:
            repair_messages = list(messages)
            attempts = 0
            while True:
                response_format = _response_payload(mode, schema, schema_name)
                try:
                    raw = self._send(repair_messages, response_format)
                except LLMBadRequestError as exc:
                    last_reject = exc
                    break  # 本档被端点拒 → 降下一档
                try:
                    parsed = parse(raw)
                except EvalJudgeFormatError as format_error:
                    if attempts >= self._repair_limit:
                        raise format_error from None
                    attempts += 1
                    repair_messages = [
                        *repair_messages,
                        Message(role="assistant", parts=(TextPart(raw),)),
                        _repair_message(raw, format_error.problems),
                    ]
                    continue
                return parsed, JudgeCallRecord(
                    schema_mode=mode, raw_output=raw, repair_attempts=attempts
                )
        # tiers 至少含 plain 且必因「本档被拒」走到这里——重抛最后一次拒绝。
        if last_reject is not None:
            raise last_reject
        raise LLMBadRequestError("judge 调用没有可用的输出档。")

    def _send(
        self, messages: list[Message], response_format: dict[str, object] | None
    ) -> str:
        """按档发送：带 response_format 走结构化能力，纯文本档走 complete。"""
        structured = self._structured
        if response_format is None or structured is None:
            return self._completer.complete(messages)
        return structured.complete_structured(messages, response_format)
