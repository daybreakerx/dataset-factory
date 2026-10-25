"""单元测试：judge 调用协议（消息组装 / schema 派生 / 降级链与修复重试 / 解析）。

假客户端记录每轮收到的消息与 response_format、按脚本回文本——不真调端点。
"""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from typing import cast

import pytest

from dataset_factory.eval import (
    KIND_BINARY,
    KIND_SCORE5,
    DimensionSpec,
    EvalJudgeFormatError,
    JudgeCaller,
    build_dimension_messages,
    build_pairwise_messages,
    dimension_response_schema,
    pairwise_response_schema,
    parse_dimension_output,
    parse_pairwise_output,
)
from dataset_factory.llm import (
    ImagePart,
    LLMBadRequestError,
    Message,
    StreamDelta,
    TextPart,
)

_DIMENSIONS = [
    DimensionSpec(name="场景描述", kind=KIND_SCORE5),
    DimensionSpec(name="无幻觉", kind=KIND_BINARY),
]

_GOOD_DIMENSION_REPLY = '{"场景描述": 4, "无幻觉": "无", "理由": "描述准确且无编造。"}'


class FakeStructuredCompleter:
    """记录每轮消息与 response_format、按脚本回复；可指定拒绝哪些输出档。"""

    def __init__(
        self,
        replies: Sequence[str],
        reject_formats: Sequence[str] = (),
    ) -> None:
        """存逐轮回复脚本与拒绝档集合（值为 response_format 的 type 字段）。"""
        self._replies = list(replies)
        self._reject = set(reject_formats)
        self.calls: list[tuple[list[Message], dict[str, object] | None]] = []

    def complete(self, messages: Sequence[Message]) -> str:
        """纯文本档：不带 response_format。"""
        self.calls.append((list(messages), None))
        return self._pop_reply()

    def stream(self, messages: Sequence[Message]) -> Iterator[StreamDelta]:
        """judge 协议不走流式——Protocol 齐备性桩。"""
        raise NotImplementedError("judge 调用不使用流式路径")

    def complete_structured(
        self, messages: Sequence[Message], response_format: dict[str, object] | None
    ) -> str:
        """带 response_format 的档：命中拒绝集合即抛 LLMBadRequestError。"""
        mode = str((response_format or {}).get("type"))
        if mode in self._reject:
            raise LLMBadRequestError(f"端点不支持 response_format={mode}")
        self.calls.append((list(messages), response_format))
        return self._pop_reply()

    def _pop_reply(self) -> str:
        return self._replies.pop(0) if self._replies else "{}"


class FakePlainCompleter:
    """只有 complete、无结构化能力的最小假客户端。"""

    def __init__(self, replies: Sequence[str]) -> None:
        """存逐轮回复脚本与调用记录。"""
        self._replies = list(replies)
        self.calls: list[list[Message]] = []

    def complete(self, messages: Sequence[Message]) -> str:
        """记录消息并返回脚本回复。"""
        self.calls.append(list(messages))
        return self._replies.pop(0) if self._replies else "{}"

    def stream(self, messages: Sequence[Message]) -> Iterator[StreamDelta]:
        """judge 协议不走流式——Protocol 齐备性桩。"""
        raise NotImplementedError("judge 调用不使用流式路径")


def _texts(messages: Sequence[Message]) -> str:
    """把一条消息序列里的全部文本块拼成一串（断言消息内容用）。"""
    return "\n".join(
        part.text
        for message in messages
        for part in message.parts
        if isinstance(part, TextPart)
    )


def _media() -> ImagePart:
    """测试用媒体块（字节内容无意义，只验证位置与身份盲化）。"""
    return ImagePart(b"fake-image")


# --------------------------------------------------------------------------
# schema 派生与解析
# --------------------------------------------------------------------------


def test_dimension_schema_pins_value_domains() -> None:
    """schema 值域钉死：五档评分 enum 1–5、是非维度 enum 有／无、「理由」必填。"""
    schema = dimension_response_schema(_DIMENSIONS)
    properties = cast("dict[str, object]", schema["properties"])
    assert properties["场景描述"] == {"type": "integer", "enum": [1, 2, 3, 4, 5]}
    assert properties["无幻觉"] == {"type": "string", "enum": ["有", "无"]}
    assert properties["理由"] == {"type": "string"}
    assert schema["required"] == ["场景描述", "无幻觉", "理由"]
    assert schema["additionalProperties"] is False


def test_pairwise_schema_pins_winner_enum() -> None:
    """pairwise schema：winner 三值＋理由必填。"""
    schema = pairwise_response_schema()
    assert cast("dict[str, object]", schema["properties"])["winner"] == {
        "type": "string",
        "enum": ["A", "B", "tie"],
    }
    assert schema["required"] == ["winner", "理由"]


def test_parse_dimension_output_accepts_fenced_json() -> None:
    """解析容忍代码围栏与前后闲话（降级到纯文本档时的真实形态）。"""
    raw = "判定如下：\n```json\n" + _GOOD_DIMENSION_REPLY + "\n```\n以上。"
    verdict = parse_dimension_output(raw, _DIMENSIONS)
    assert verdict.scores == {"场景描述": 4, "无幻觉": "无"}
    assert verdict.reason.startswith("描述准确")


@pytest.mark.parametrize(
    "raw",
    [
        "这不是 JSON",
        '{"场景描述": 6, "无幻觉": "无", "理由": "x"}',
        '{"场景描述": 4, "无幻觉": "不知道", "理由": "x"}',
        '{"场景描述": 4, "无幻觉": "无", "理由": "  "}',
        '{"无幻觉": "无", "理由": "x"}',
    ],
)
def test_parse_dimension_output_aggregates_problems(raw: str) -> None:
    """缺维度、值出界、理由为空、非 JSON → 问题聚合抛 EvalJudgeFormatError。"""
    with pytest.raises(EvalJudgeFormatError) as exc_info:
        parse_dimension_output(raw, _DIMENSIONS)
    assert exc_info.value.problems


def test_parse_pairwise_output_roundtrip() -> None:
    """winner 三值与理由解析往返。"""
    verdict = parse_pairwise_output('{"winner": "B", "理由": "B 更准确。"}')
    assert verdict.winner == "B"
    with pytest.raises(EvalJudgeFormatError):
        parse_pairwise_output('{"winner": "C", "理由": "x"}')


# --------------------------------------------------------------------------
# 消息组装（身份盲化 / 参照插槽 / 静态自足）
# --------------------------------------------------------------------------


def test_dimension_messages_structure_and_blinding() -> None:
    """system=judge 提示词；user 含技能包裹、素材、候选块；无身份线索、无维度注入。"""
    messages = build_dimension_messages(
        prompt_body="你是裁判",
        skill_texts=["评判总协议"],
        media=_media(),
        candidate_caption="一只猫坐在窗台上。",
        reference_caption="一只猫在窗边。",
    )
    assert messages[0].role == "system"
    assert messages[1].role == "user"
    body = _texts(messages)
    assert "<skill>\n评判总协议\n</skill>" in body
    assert "<candidate>\n一只猫坐在窗台上。\n</candidate>" in body
    assert "<reference>" in body
    assert "参照是基准不是标准答案" in body
    # 身份盲化：不出现批次序号 / 模型名线索；运行时不注入维度清单。
    assert "s1" not in body
    assert "场景描述" not in body
    assert any(isinstance(part, ImagePart) for part in messages[1].parts)


def test_dimension_messages_without_reference_omit_block() -> None:
    """无参照时整块省掉（同一套骨架，插槽为空）。"""
    messages = build_dimension_messages(
        prompt_body="你是裁判",
        skill_texts=[],
        media=_media(),
        candidate_caption="一只猫坐在窗台上。",
        reference_caption=None,
    )
    assert "<reference>" not in _texts(messages)


def test_pairwise_messages_carry_rule_and_positions() -> None:
    """pairwise：A/B 位置块＋比较规则（准确性优先＋幻觉一票否决）＋参照插槽。"""
    messages = build_pairwise_messages(
        prompt_body="你是裁判",
        skill_texts=[],
        media=_media(),
        caption_a="甲的描述。",
        caption_b="乙的描述。",
        reference_caption="参照。",
    )
    body = _texts(messages)
    assert "<caption-a>\n甲的描述。\n</caption-a>" in body
    assert "<caption-b>\n乙的描述。\n</caption-b>" in body
    assert "准确性优先" in body
    assert "幻觉" in body
    assert "<reference>" in body


# --------------------------------------------------------------------------
# 降级链与修复重试
# --------------------------------------------------------------------------


def test_caller_happy_path_uses_schema_tier() -> None:
    """端点接受标准 schema：一次成功，轨迹记 json_schema、零修复。"""
    completer = FakeStructuredCompleter([_GOOD_DIMENSION_REPLY])
    verdict, record = JudgeCaller(completer).call(
        build_dimension_messages(
            prompt_body="你是裁判",
            skill_texts=[],
            media=_media(),
            candidate_caption="描述。",
            reference_caption=None,
        ),
        schema=dimension_response_schema(_DIMENSIONS),
        schema_name="dimension_verdict",
        parse=lambda raw: parse_dimension_output(raw, _DIMENSIONS),
    )
    assert verdict.scores["场景描述"] == 4
    assert record.schema_mode == "json_schema"
    assert record.repair_attempts == 0
    assert completer.calls[0][1] is not None


def test_caller_repairs_bad_output_once() -> None:
    """输出不过校验 → 回喂原文与问题清单重写一次；轨迹记修复次数。"""
    bad = '{"场景描述": 4, "无幻觉": "无", "理由": ""}'
    completer = FakeStructuredCompleter([bad, _GOOD_DIMENSION_REPLY])
    _, record = JudgeCaller(completer).call(
        build_dimension_messages(
            prompt_body="你是裁判",
            skill_texts=[],
            media=_media(),
            candidate_caption="描述。",
            reference_caption=None,
        ),
        schema=dimension_response_schema(_DIMENSIONS),
        schema_name="dimension_verdict",
        parse=lambda raw: parse_dimension_output(raw, _DIMENSIONS),
    )
    assert record.repair_attempts == 1
    repair_turn = completer.calls[1][0]
    assert _texts(repair_turn[-2:]).find(bad) != -1
    assert "未通过校验" in _texts([repair_turn[-1]])


def test_caller_degrades_schema_to_json_mode() -> None:
    """端点拒标准 schema → 就地降 JSON 模式成功，轨迹记 json_object。"""
    completer = FakeStructuredCompleter(
        [_GOOD_DIMENSION_REPLY], reject_formats=["json_schema"]
    )
    _, record = JudgeCaller(completer).call(
        build_dimension_messages(
            prompt_body="你是裁判",
            skill_texts=[],
            media=_media(),
            candidate_caption="描述。",
            reference_caption=None,
        ),
        schema=dimension_response_schema(_DIMENSIONS),
        schema_name="dimension_verdict",
        parse=lambda raw: parse_dimension_output(raw, _DIMENSIONS),
    )
    assert record.schema_mode == "json_object"
    assert completer.calls[0][1] == {"type": "json_object"}


def test_caller_degrades_to_plain_when_all_structured_rejected() -> None:
    """两级结构化档都被拒 → 纯文本档兜底（围栏 JSON 靠解析侧容忍）。"""
    completer = FakeStructuredCompleter(
        ["```json\n" + _GOOD_DIMENSION_REPLY + "\n```"],
        reject_formats=["json_schema", "json_object"],
    )
    _, record = JudgeCaller(completer).call(
        build_dimension_messages(
            prompt_body="你是裁判",
            skill_texts=[],
            media=_media(),
            candidate_caption="描述。",
            reference_caption=None,
        ),
        schema=dimension_response_schema(_DIMENSIONS),
        schema_name="dimension_verdict",
        parse=lambda raw: parse_dimension_output(raw, _DIMENSIONS),
    )
    assert record.schema_mode == "plain"
    assert completer.calls[0][1] is None


def test_caller_plain_completer_skips_structured_tiers() -> None:
    """客户端无结构化能力（isinstance 探测不到）→ 只有纯文本档可用。"""
    completer = FakePlainCompleter([_GOOD_DIMENSION_REPLY])
    _, record = JudgeCaller(completer).call(
        build_dimension_messages(
            prompt_body="你是裁判",
            skill_texts=[],
            media=_media(),
            candidate_caption="描述。",
            reference_caption=None,
        ),
        schema=dimension_response_schema(_DIMENSIONS),
        schema_name="dimension_verdict",
        parse=lambda raw: parse_dimension_output(raw, _DIMENSIONS),
    )
    assert record.schema_mode == "plain"
    assert len(completer.calls) == 1


def test_caller_raises_after_repair_limit() -> None:
    """修复重试超限（模型始终不过校验）→ EvalJudgeFormatError 上抛（条目级失败）。"""
    always_bad = '{"场景描述": 4, "无幻觉": "无", "理由": ""}'
    completer = FakeStructuredCompleter([always_bad] * 5)
    caller = JudgeCaller(completer, repair_limit=1)
    with pytest.raises(EvalJudgeFormatError):
        caller.call(
            build_dimension_messages(
                prompt_body="你是裁判",
                skill_texts=[],
                media=_media(),
                candidate_caption="描述。",
                reference_caption=None,
            ),
            schema=dimension_response_schema(_DIMENSIONS),
            schema_name="dimension_verdict",
            parse=lambda raw: parse_dimension_output(raw, _DIMENSIONS),
        )
    assert len(completer.calls) == 2  # 首次尝试 + 一次修复重试


def test_caller_plain_tier_bad_request_propagates() -> None:
    """纯文本档（无参数可拒）收到 LLMBadRequestError = 真坏请求，原样上抛。"""
    completer = FakeStructuredCompleter(
        [], reject_formats=["json_schema", "json_object"]
    )
    # 纯文本档也被拒：让 complete 也抛——用只实现 complete 的假件演示同语义。
    plain = FakePlainCompleter([])
    plain.complete = _always_reject  # type: ignore[method-assign]
    caller = JudgeCaller(plain)
    _ = completer  # 上面那个证明结构化档被拒的路径，此处演示纯档传播
    with pytest.raises(LLMBadRequestError):
        caller.call(
            build_dimension_messages(
                prompt_body="你是裁判",
                skill_texts=[],
                media=_media(),
                candidate_caption="描述。",
                reference_caption=None,
            ),
            schema=dimension_response_schema(_DIMENSIONS),
            schema_name="dimension_verdict",
            parse=lambda raw: parse_dimension_output(raw, _DIMENSIONS),
        )


def _always_reject(messages: Sequence[Message]) -> str:
    """替身回复：无条件抛 LLMBadRequestError。"""
    raise LLMBadRequestError("请求被端点拒绝。")
