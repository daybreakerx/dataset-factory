"""接口测试：cli 入口层（Typer CliRunner 跑命令、断言输出与退出码；FakeCompleter 注入离线跑）。

打标类命令（label / chat）monkeypatch cli.label.build_engine 注入假引擎；管理类命令
（config / prompt / skill / session）直连数据域、天然离线。全部用 temp_data_root 隔离数据根。
"""

from __future__ import annotations

import io
import json
import logging
import logging.handlers
import sys
from collections.abc import Iterator, Mapping, Sequence
from pathlib import Path
from typing import cast

import pytest
import typer
import uvicorn
from fastapi import FastAPI
from typer.testing import CliRunner

import dataset_factory.cli.config as config_module
import dataset_factory.cli.label as label_module
from dataset_factory.cli import app
from dataset_factory.cli.operations import confirm_or_abort
from dataset_factory.llm import (
    EndpointConfig,
    ImagePart,
    LLMTimeoutError,
    Message,
    ProbeResult,
    StreamDelta,
    TextPart,
    VideoPart,
    config_id_by_display_name,
    create_config,
    delete_config,
    list_configs,
)
from dataset_factory.prompts import Prompt, read_prompt, save_prompt
from dataset_factory.sessions import (
    create_session,
    list_sessions,
    read_events,
    read_session_source,
    read_strategy_id,
)
from dataset_factory.sessions.model import SettingsEvent
from dataset_factory.skills import import_skill
from dataset_factory.strategies import (
    create_strategy,
    get_strategy,
)

from .conftest import FakeCompleter


def _config_dir(root: Path, name: str) -> Path:
    """按显示名找配置的数据目录（ID 化后目录名 = 稳定 ID）。"""
    cid = next(info.id for info in list_configs() if info.name == name)
    return root / "endpoints" / cid


_SKILL_PACK = Path(__file__).parent / "fixtures" / "skill-pack"
runner = CliRunner()


@pytest.fixture
def fake_engine(monkeypatch: pytest.MonkeyPatch) -> FakeCompleter:
    """把 CLI 的引擎装配换成假客户端版（离线、记录每轮消息）。

    顺手在数据根造一套名为 e-test 的真实端点配置——批3 后端点解析留在命令体
    （缺省语境与显式覆盖的真解析不再被引擎注入位屏蔽），显式 ``--endpoint e-test``
    要能解析通过。
    """
    create_config("e-test", "https://api.example.com/v1", "test-model", api_key=None)
    completer = FakeCompleter()
    from dataset_factory.labeling import LabelingEngine

    def fake_build(endpoint_id: str) -> LabelingEngine:
        return LabelingEngine(completer, "test-model", source="cli")

    monkeypatch.setattr(label_module, "build_engine", fake_build)
    return completer


def _save_prompt(name: str, body: str) -> None:
    """往提示词库存一条测试提示词。"""
    save_prompt(Prompt(name=name, description="测试提示词", body=body))


def _seed_strategy(with_skill: bool = False) -> str:
    """造「当前使用策略」的完整语境（端点 e-test + 提示词 h3 + 可选 Skill）。

    返回策略 id；供 use / label / chat 缺省链路类用例从同一条种子出发。端点按
    **显示名**幂等（has_config 只认 ID，显示名解析要用 config_id_by_display_name）
    ——本助手不依赖任何 fixture。
    """
    if config_id_by_display_name("e-test") is None:
        create_config(
            "e-test", "https://api.example.com/v1", "test-model", api_key=None
        )
    _save_prompt("h3", "你是打标助手。")
    skill_ids = [import_skill(_SKILL_PACK).skill.id] if with_skill else []
    return create_strategy(
        name="当前策略",
        endpoint_id="e-test",
        prompt_id=read_prompt("h3").id,
        skill_ids=skill_ids,
    ).id


class _FlakyCompleter:
    """第一轮抛超时、之后正常回复的假客户端（测 chat 的逐轮容错）。"""

    def __init__(self) -> None:
        self.calls = 0

    def complete(self, messages: Sequence[Message]) -> str:
        self.calls += 1
        if self.calls == 1:
            raise LLMTimeoutError("模型调用超时；可重试或调大 timeout。")
        return "第二轮回复"

    def stream(self, messages: Sequence[Message]) -> Iterator[StreamDelta]:
        self.calls += 1
        if self.calls == 1:
            raise LLMTimeoutError("模型调用超时；可重试或调大 timeout。")
        yield StreamDelta(kind="content", text="第二轮回复")


def test_label_outputs_caption_and_session_hint(
    temp_data_root: Path, fake_engine: FakeCompleter
) -> None:
    """首轮 label：stdout 只有 caption（供外部 agent 解析），stderr 提示会话 id 续接。"""
    _save_prompt("h3", "你是打标助手。")

    result = runner.invoke(
        app, ["label", "--endpoint", "e-test", "-p", "h3", "-m", "打标"]
    )

    assert result.exit_code == 0
    assert result.stdout == "打标结果\n"
    (session_id,) = list_sessions()
    assert session_id in (result.stderr or result.output)


def test_label_json_mode(temp_data_root: Path, fake_engine: FakeCompleter) -> None:
    """--json：stdout 输出 {session_id, caption} 结构化 JSON。"""
    _save_prompt("h3", "你是打标助手。")

    result = runner.invoke(
        app, ["label", "--endpoint", "e-test", "-p", "h3", "-m", "打标", "--json"]
    )

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    (session_id,) = list_sessions()
    assert payload == {"session_id": session_id, "caption": "打标结果"}


def test_label_resume_iterates_with_history(
    temp_data_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """带 --session 续接：第二轮携带第一轮历史（迭代改写）。"""
    create_config("e-test", "https://api.example.com/v1", "test-model", api_key=None)
    _save_prompt("h3", "你是打标助手。")
    completer = FakeCompleter(replies=["第一轮", "第二轮"])
    from dataset_factory.labeling import LabelingEngine

    def fake_build(endpoint_ref: str) -> LabelingEngine:
        return LabelingEngine(completer, "test-model", source="cli")

    monkeypatch.setattr(label_module, "build_engine", fake_build)
    first = runner.invoke(
        app, ["label", "--endpoint", "e-test", "-p", "h3", "-m", "描述图"]
    )
    assert first.exit_code == 0
    assert first.stdout == "第一轮\n"
    (session_id,) = list_sessions()
    second = runner.invoke(
        app,
        [
            "label",
            "--endpoint",
            "e-test",
            "--session",
            session_id,
            "-m",
            "改成一句话",
            "--json",
        ],
    )

    assert second.exit_code == 0
    assert json.loads(second.stdout)["caption"] == "第二轮"
    assert len(completer.calls) == 2
    _, history_user, history_assistant, _ = completer.calls[1]
    assert history_user.parts == (TextPart("描述图"),)
    assert history_assistant.parts == (TextPart("第一轮"),)


def test_label_with_image_and_skill(
    temp_data_root: Path, tmp_path: Path, fake_engine: FakeCompleter
) -> None:
    """label 带图与 skill：CLI 参数正确传到引擎（user 消息含图片块与 skill 包裹文本）。"""
    _save_prompt("h3", "你是打标助手。")
    skill_name = import_skill(_SKILL_PACK).skill.name
    image = tmp_path / "cat.jpg"
    image.write_bytes(b"png!")

    result = runner.invoke(
        app,
        [
            "label",
            "--endpoint",
            "e-test",
            "-p",
            "h3",
            "-s",
            skill_name,
            "-i",
            str(image),
            "-m",
            "描述",
        ],
    )

    assert result.exit_code == 0
    user = fake_engine.calls[0][1]
    assert any(isinstance(part, ImagePart) for part in user.parts)
    assert any(
        isinstance(part, TextPart) and part.text.startswith("<skill>")
        for part in user.parts
    )


def test_label_with_video_passes_frame_params(
    temp_data_root: Path, tmp_path: Path, fake_engine: FakeCompleter
) -> None:
    """label 带视频：视频块与抽帧参数按 CLI 选项传到引擎。"""
    _save_prompt("h3", "你是打标助手。")
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"mp4!")

    result = runner.invoke(
        app,
        [
            "label",
            "--endpoint",
            "e-test",
            "-p",
            "h3",
            "-v",
            str(video),
            "--video-fps",
            "4",
            "--video-max-frames",
            "8",
            "-m",
            "描述",
        ],
    )

    assert result.exit_code == 0
    user = fake_engine.calls[0][1]
    videos = [part for part in user.parts if isinstance(part, VideoPart)]
    assert len(videos) == 1
    assert videos[0].fps == 4.0
    assert videos[0].max_frames == 8


def test_label_image_and_video_together_is_usage_error(
    temp_data_root: Path, tmp_path: Path, fake_engine: FakeCompleter
) -> None:
    """同时给 --image 与 --video：退出码 2（用法错误）、不调模型。"""
    _save_prompt("h3", "你是打标助手。")
    image = tmp_path / "cat.jpg"
    image.write_bytes(b"png!")
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"mp4!")

    result = runner.invoke(
        app,
        [
            "label",
            "--endpoint",
            "e-test",
            "-p",
            "h3",
            "-i",
            str(image),
            "-v",
            str(video),
            "-m",
            "描述",
        ],
    )

    assert result.exit_code == 2
    assert "互斥" in result.output
    assert fake_engine.calls == []


def test_label_missing_prompt_exits_user_error(
    temp_data_root: Path, fake_engine: FakeCompleter
) -> None:
    """基础提示词不存在：退出码 1、stderr 给可操作错误。"""
    result = runner.invoke(
        app, ["label", "--endpoint", "e-test", "-p", "不存在", "-m", "打标"]
    )

    assert result.exit_code == 1
    assert "不存在" in result.stderr


def test_label_empty_turn_exits_user_error(
    temp_data_root: Path, fake_engine: FakeCompleter
) -> None:
    """无指令无图：退出码 1（EmptyTurnError 的可操作消息）。"""
    _save_prompt("h3", "你是打标助手。")

    result = runner.invoke(app, ["label", "--endpoint", "e-test", "-p", "h3"])

    assert result.exit_code == 1
    assert "内容" in result.stderr


def test_label_without_endpoint_or_strategy_exits_user_error(
    temp_data_root: Path, fake_engine: FakeCompleter
) -> None:
    """label 不带 --endpoint 且未设当前使用策略：用户错误退 1，给可操作提示。"""
    _save_prompt("h3", "你是打标助手。")

    result = runner.invoke(app, ["label", "-p", "h3", "-m", "打标"])

    assert result.exit_code == 1
    assert "未设置当前使用策略" in result.stderr
    assert "dsf strategy use" in result.stderr


def _last_settings(session_id: str) -> Mapping[str, object]:
    """取某会话最后一条设置事件的内容（缺省组合 / 覆盖断言用）。"""
    events = [
        event for event in read_events(session_id) if isinstance(event, SettingsEvent)
    ]
    return events[-1].settings


def test_label_defaults_to_current_strategy_combination(
    temp_data_root: Path, fake_engine: FakeCompleter
) -> None:
    """label 全缺省：端点 / 提示词用当前策略的，会话盖「发起时的当前策略」章（cli 来源）。"""
    strategy_id = _seed_strategy()
    assert runner.invoke(app, ["strategy", "use", strategy_id]).exit_code == 0

    result = runner.invoke(app, ["label", "-m", "打标", "--json"])

    assert result.exit_code == 0
    session_id = cast("str", json.loads(result.output)["session_id"])
    assert read_strategy_id(session_id) == strategy_id
    assert read_session_source(session_id) == "cli"
    assert _last_settings(session_id)["prompt"] == read_prompt("h3").id


def test_label_defaults_include_strategy_skills(
    temp_data_root: Path, fake_engine: FakeCompleter
) -> None:
    """label 全缺省且策略带 Skill：Skill 缺省取策略勾选（会话设置记录勾选 id）。"""
    strategy_id = _seed_strategy(with_skill=True)
    skill_ids = get_strategy(strategy_id).skill_ids
    assert runner.invoke(app, ["strategy", "use", strategy_id]).exit_code == 0

    result = runner.invoke(app, ["label", "-m", "打标", "--json"])

    assert result.exit_code == 0
    session_id = cast("str", json.loads(result.output)["session_id"])
    assert _last_settings(session_id)["skills"] == skill_ids


def test_label_explicit_flags_override_strategy_but_keep_chapter(
    temp_data_root: Path, fake_engine: FakeCompleter
) -> None:
    """显式 -p / --endpoint 单次覆盖：组合用显式值、归属章仍是当前策略（章不断言组合）。"""
    strategy_id = _seed_strategy()
    assert runner.invoke(app, ["strategy", "use", strategy_id]).exit_code == 0
    _save_prompt("另一条", "另一套正文。")

    result = runner.invoke(
        app,
        ["label", "--endpoint", "e-test", "-p", "另一条", "-m", "打标", "--json"],
    )

    assert result.exit_code == 0
    session_id = cast("str", json.loads(result.output)["session_id"])
    assert read_strategy_id(session_id) == strategy_id
    assert _last_settings(session_id)["prompt"] == read_prompt("另一条").id


def test_chat_rounds_and_exit_on_eof(
    temp_data_root: Path, fake_engine: FakeCompleter
) -> None:
    """chat 新会话：两轮交互后 EOF 干净退出（exit 0），回复打印到 stdout。"""
    _save_prompt("h3", "你是打标助手。")

    result = runner.invoke(
        app, ["chat", "--endpoint", "e-test", "-p", "h3"], input="第一轮\n第二轮\n"
    )

    assert result.exit_code == 0
    assert "打标结果" in result.output
    assert len(fake_engine.calls) == 2
    (session_id,) = list_sessions()
    assert session_id is not None


def test_chat_resumes_current_strategy_latest_cli_session(
    temp_data_root: Path, fake_engine: FakeCompleter
) -> None:
    """chat 不带 --session：恢复当前策略最近一次 CLI 会话（先 label 全缺省开一轮）。"""
    strategy_id = _seed_strategy()
    use_result = runner.invoke(app, ["strategy", "use", strategy_id])
    first = runner.invoke(app, ["label", "-m", "首轮"])
    session_id = list_sessions()[0]
    result = runner.invoke(app, ["chat"], input="继续改写\n")

    assert use_result.exit_code == 0
    assert first.exit_code == 0
    assert result.exit_code == 0, (
        f"exit={result.exit_code} out={result.output!r} err={result.stderr!r}"
    )
    assert f"恢复会话 {session_id}" in result.output
    assert list_sessions() == [session_id]
    assert len(fake_engine.calls) == 2


def test_chat_at_image_syntax(
    temp_data_root: Path, tmp_path: Path, fake_engine: FakeCompleter
) -> None:
    """chat 的 @图片路径 语法：输入行解析出图片 + 指令。"""
    _save_prompt("h3", "你是打标助手。")
    image = tmp_path / "cat.jpg"
    image.write_bytes(b"png!")

    result = runner.invoke(
        app,
        ["chat", "--endpoint", "e-test", "-p", "h3"],
        input=f"@{image} 描述这张图\n",
    )

    assert result.exit_code == 0
    user = fake_engine.calls[0][1]
    assert any(isinstance(part, ImagePart) for part in user.parts)
    assert any(
        part.text == "描述这张图" for part in user.parts if isinstance(part, TextPart)
    )


def test_chat_with_skill_flag(temp_data_root: Path, fake_engine: FakeCompleter) -> None:
    """chat 带 --skill：首轮注入 skill 全文，之后由会话设置携带、后续轮继续注入。"""
    _save_prompt("h3", "你是打标助手。")
    skill_name = import_skill(_SKILL_PACK).skill.name

    result = runner.invoke(
        app,
        ["chat", "--endpoint", "e-test", "-p", "h3", "-s", skill_name],
        input="第一轮\n第二轮\n",
    )

    assert result.exit_code == 0
    assert len(fake_engine.calls) == 2
    for call in fake_engine.calls:
        # skill 全文注入在「本轮的 user 消息」里（messages 末位；前面是 system 与历史）。
        assert any(
            isinstance(part, TextPart) and part.text.startswith("<skill>")
            for part in call[-1].parts
        )


def test_chat_at_video_syntax(
    temp_data_root: Path, tmp_path: Path, fake_engine: FakeCompleter
) -> None:
    """chat 的 @ 语法发视频：按扩展名识别为视频块，抽帧参数取默认值。"""
    _save_prompt("h3", "你是打标助手。")
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"mp4!")

    result = runner.invoke(
        app,
        ["chat", "--endpoint", "e-test", "-p", "h3"],
        input=f"@{video} 描述这段视频\n",
    )

    assert result.exit_code == 0
    user = fake_engine.calls[0][1]
    videos = [part for part in user.parts if isinstance(part, VideoPart)]
    assert len(videos) == 1
    assert videos[0].fps == 2.0
    assert videos[0].max_frames == 16
    assert any(
        part.text == "描述这段视频" for part in user.parts if isinstance(part, TextPart)
    )


def test_chat_at_video_with_frame_options(
    temp_data_root: Path, tmp_path: Path, fake_engine: FakeCompleter
) -> None:
    """chat 的 --video-fps / --video-max-frames 随 @ 视频传到引擎（.mov 扩展名同样识别）。"""
    _save_prompt("h3", "你是打标助手。")
    video = tmp_path / "clip.mov"
    video.write_bytes(b"mov!")

    result = runner.invoke(
        app,
        [
            "chat",
            "--endpoint",
            "e-test",
            "-p",
            "h3",
            "--video-fps",
            "4",
            "--video-max-frames",
            "8",
        ],
        input=f"@{video} 描述\n",
    )

    assert result.exit_code == 0
    videos = [
        part for part in fake_engine.calls[0][1].parts if isinstance(part, VideoPart)
    ]
    assert len(videos) == 1
    assert videos[0].fps == 4.0
    assert videos[0].max_frames == 8


def test_chat_at_video_missing_file_keeps_session_alive(
    temp_data_root: Path, fake_engine: FakeCompleter
) -> None:
    """@ 视频路径读不出来：报可操作错误后继续会话（逐轮容错），下一轮照常。"""
    _save_prompt("h3", "你是打标助手。")

    result = runner.invoke(
        app,
        ["chat", "--endpoint", "e-test", "-p", "h3"],
        input="@不存在的视频.mp4 描述\n第二轮\n",
    )

    assert result.exit_code == 0
    assert "无法读取视频" in result.stderr
    assert "重发本轮" in result.stderr
    assert "打标结果" in result.output
    assert len(fake_engine.calls) == 1


def test_config_set_and_show(temp_data_root: Path) -> None:
    """config set 点名更新已有配置：密钥留空沿用；show 按名显示（不显内容）。"""
    runner.invoke(
        app,
        ["config", "add", "alpha", "--base-url", "https://a/v1", "--model", "m-a"],
        input="test-key-123\n",
    )
    result_set = runner.invoke(
        app,
        [
            "config",
            "set",
            "alpha",
            "--base-url",
            "https://api.example.com/v1",
            "--model",
            "m1",
        ],
        input="\n",
    )
    result_show = runner.invoke(app, ["config", "show", "alpha"])

    assert result_set.exit_code == 0
    assert result_show.exit_code == 0
    assert "https://api.example.com/v1" in result_show.output
    assert "m1" in result_show.output
    assert "credentials 文件" in result_show.output
    assert "test-key-123" not in result_show.output


def test_config_set_missing_ref_fails(temp_data_root: Path) -> None:
    """set 只更新已存在的配置：点名不存在的配置退出 1、提示 add。"""
    result = runner.invoke(
        app,
        ["config", "set", "ghost", "--base-url", "https://x/v1", "--model", "m"],
        input="\n",
    )

    assert result.exit_code == 1
    assert "不存在" in result.stderr


def test_config_show_missing_ref_fails(temp_data_root: Path) -> None:
    """show 点名不存在的配置：退出码 1。"""
    result = runner.invoke(app, ["config", "show", "ghost"])

    assert result.exit_code == 1
    assert "不存在" in result.stderr


def test_config_list_empty(temp_data_root: Path) -> None:
    """config list 空数据根：显示引导提示（不报错）。"""
    result = runner.invoke(app, ["config", "list"])

    assert result.exit_code == 0
    assert "还没有端点配置" in result.output


def test_config_add_list_show_roundtrip(temp_data_root: Path) -> None:
    """add（密钥留空跳过）/ list / show——多配置命令闭环（无「当前使用」标记）。"""
    first = runner.invoke(
        app,
        ["config", "add", "alpha", "--base-url", "https://a/v1", "--model", "m-a"],
        input="test-key-123\n",
    )
    second = runner.invoke(
        app,
        ["config", "add", "beta", "--base-url", "https://b/v1", "--model", "m-b"],
        input="\n",
    )
    listing = runner.invoke(app, ["config", "list"])
    show = runner.invoke(app, ["config", "show", "beta"])

    assert first.exit_code == 0
    assert second.exit_code == 0
    assert listing.exit_code == 0
    lines = listing.output.splitlines()
    assert lines[0].startswith("alpha")
    assert "密钥已配置" in lines[0]
    assert lines[1].startswith("beta")
    assert "密钥未配置" in lines[1]
    # 密钥只进不出：列表输出绝不含密钥明文。
    assert "test-key-123" not in listing.output
    assert show.exit_code == 0
    assert "beta" in show.output


def test_config_add_duplicate_display_name_allowed(temp_data_root: Path) -> None:
    """同显示名（不区分大小写）可并存：各自独立 ID（身份是 ID）。"""
    first = runner.invoke(
        app,
        ["config", "add", "alpha", "--base-url", "https://a/v1", "--model", "m"],
        input="\n",
    )
    second = runner.invoke(
        app,
        ["config", "add", "ALPHA", "--base-url", "https://b/v1", "--model", "m"],
        input="\n",
    )

    assert first.exit_code == 0
    assert second.exit_code == 0
    from dataset_factory.llm import list_configs as _lc

    infos = [info for info in _lc() if info.name.casefold() == "alpha"]
    assert len(infos) == 2
    assert infos[0].id != infos[1].id


def test_config_remove_roundtrip(temp_data_root: Path) -> None:
    """remove 删除一套配置成功；其余配置不受影响（删除不再有任何前置拦截）。"""
    runner.invoke(
        app,
        ["config", "add", "alpha", "--base-url", "https://a/v1", "--model", "m"],
        input="\n",
    )
    runner.invoke(
        app,
        ["config", "add", "beta", "--base-url", "https://b/v1", "--model", "m"],
        input="\n",
    )

    remove_beta = runner.invoke(app, ["config", "remove", "beta", "-y"])
    listing = runner.invoke(app, ["config", "list"])

    assert remove_beta.exit_code == 0
    assert [line.split(" ")[0] for line in listing.output.splitlines()] == ["alpha"]


def test_prompt_lifecycle(temp_data_root: Path, tmp_path: Path) -> None:
    """prompt save（--file）/ list / show / rm 全生命周期。"""
    body_file = tmp_path / "body.md"
    body_file.write_text("你是打标助手。", encoding="utf-8")

    save = runner.invoke(
        app, ["prompt", "save", "h3", "-d", "视频打标", "-f", str(body_file)]
    )
    listing = runner.invoke(app, ["prompt", "list"])
    show = runner.invoke(app, ["prompt", "show", "h3"])
    remove = runner.invoke(app, ["prompt", "rm", "h3", "-y"])
    after = runner.invoke(app, ["prompt", "list"])

    assert save.exit_code == 0
    assert listing.exit_code == 0
    assert "h3" in listing.output
    assert "视频打标" in listing.output
    assert show.exit_code == 0
    assert "你是打标助手。" in show.output
    assert remove.exit_code == 0
    assert after.exit_code == 0
    # prompt 子命令会播种内置预置：删光自建条目后库里仍有内置的「详细描述」。
    assert "h3" not in after.output
    assert "详细描述" in after.output


def test_prompt_rename_roundtrip(temp_data_root: Path) -> None:
    """prompt rename：改名后 list / show 跟新名、旧名消失。"""
    _save_prompt("old", "你是打标助手。")

    renamed = runner.invoke(app, ["prompt", "rename", "old", "new"])
    listing = runner.invoke(app, ["prompt", "list"])
    show = runner.invoke(app, ["prompt", "show", "new"])

    assert renamed.exit_code == 0
    assert "new" in listing.output
    assert "old\t" not in listing.output
    assert show.exit_code == 0
    assert "你是打标助手。" in show.output


def test_prompt_rm_without_yes_outside_terminal_exits_usage_error(
    temp_data_root: Path,
) -> None:
    """prompt rm 在非终端环境不给 -y：按用法错误退 2 并点名 --yes，提示词仍在。"""
    _save_prompt("h3", "你是打标助手。")

    result = runner.invoke(app, ["prompt", "rm", "h3"])

    assert result.exit_code == 2
    assert "--yes" in result.stderr
    listing = runner.invoke(app, ["prompt", "list"])
    assert "h3" in listing.output


def test_config_remove_without_yes_outside_terminal_exits_usage_error(
    temp_data_root: Path,
) -> None:
    """config remove 在非终端环境不给 -y：按用法错误退 2 并点名 --yes，配置仍在列表里。"""
    added = runner.invoke(
        app,
        ["config", "add", "alpha", "--base-url", "https://a/v1", "--model", "m-a"],
        input="\n",
    )
    assert added.exit_code == 0

    result = runner.invoke(app, ["config", "remove", "alpha"])

    assert result.exit_code == 2
    assert "--yes" in result.stderr
    assert "alpha" in runner.invoke(app, ["config", "list"]).output


def test_skill_rm_without_yes_outside_terminal_exits_usage_error(
    temp_data_root: Path,
) -> None:
    """skill rm 在非终端环境不给 -y：按用法错误退 2 并点名 --yes，skill 仍在库里。"""
    assert runner.invoke(app, ["skill", "import", str(_SKILL_PACK)]).exit_code == 0

    result = runner.invoke(app, ["skill", "rm", "example-caption-skill"])

    assert result.exit_code == 2
    assert "--yes" in result.stderr
    assert "example-caption-skill" in runner.invoke(app, ["skill", "list"]).output


class _TerminalInput(io.StringIO):
    """模拟交互终端：确认类命令按 isatty 分流，要测「有人在终端前答话」那一侧就得站到这里。"""

    def isatty(self) -> bool:
        """此输入流代表交互终端。"""
        return True


def test_confirmation_helper_decline_aborts(monkeypatch: pytest.MonkeyPatch) -> None:
    """交互终端里回答「否」：落到 click 的 Abort（standalone 模式退 1）。"""
    monkeypatch.setattr(sys, "stdin", _TerminalInput("n\n"))

    with pytest.raises(typer.Abort):
        confirm_or_abort("确认删除该配置？", yes=False)


def test_confirmation_helper_missing_yes_outside_terminal_is_usage_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """非终端环境不给 --yes：按用法错误退 2，且不读 stdin 里现成的答复。"""
    monkeypatch.setattr(sys, "stdin", io.StringIO("y\n"))

    with pytest.raises(typer.Exit) as excinfo:
        confirm_or_abort("确认删除该配置？", yes=False)

    assert excinfo.value.exit_code == 2


def test_confirmation_helper_yes_skips_confirmation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """显式给了 --yes 就不再问：非终端环境照样放行。"""
    monkeypatch.setattr(sys, "stdin", io.StringIO(""))

    assert confirm_or_abort("确认删除该配置？", yes=True) is None


def test_skill_lifecycle(temp_data_root: Path) -> None:
    """skill import / list / disable / enable / rm 全生命周期。"""
    imported = runner.invoke(app, ["skill", "import", str(_SKILL_PACK)])
    listing = runner.invoke(app, ["skill", "list"])
    disable = runner.invoke(app, ["skill", "disable", "example-caption-skill"])
    listing_disabled = runner.invoke(app, ["skill", "list"])
    enable = runner.invoke(app, ["skill", "enable", "example-caption-skill"])
    remove = runner.invoke(app, ["skill", "rm", "example-caption-skill", "-y"])
    after = runner.invoke(app, ["skill", "list"])

    assert imported.exit_code == 0
    assert "example-caption-skill" in imported.output
    assert listing.exit_code == 0
    assert "[启用] example-caption-skill" in listing.output
    assert disable.exit_code == 0
    assert "[停用] example-caption-skill" in listing_disabled.output
    assert enable.exit_code == 0
    assert remove.exit_code == 0
    assert "为空" in after.output


def test_skill_files_and_read(temp_data_root: Path) -> None:
    """skill files / read：包内文件清单带角色标注；read 输出可预览文件内容。"""
    runner.invoke(app, ["skill", "import", str(_SKILL_PACK)])

    files = runner.invoke(app, ["skill", "files", "example-caption-skill"])
    read_main = runner.invoke(
        app, ["skill", "read", "example-caption-skill", "SKILL.md"]
    )
    read_ref = runner.invoke(
        app, ["skill", "read", "example-caption-skill", "references/detail.md"]
    )
    read_missing = runner.invoke(
        app, ["skill", "read", "example-caption-skill", "references/nope.md"]
    )

    assert files.exit_code == 0
    assert "SKILL.md\tskill" in files.output
    assert "references/detail.md\treference" in files.output
    assert read_main.exit_code == 0
    assert "Example Caption Skill" in read_main.output
    assert read_ref.exit_code == 0
    assert read_ref.output.strip() != ""
    assert read_missing.exit_code == 1
    assert "未找到" in read_missing.stderr or "不存在" in read_missing.stderr


def test_config_test_reports_success_and_failure(
    temp_data_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """config test：探测成功输出连接成功；失败退出码 1、分类消息进 stderr。"""
    created = runner.invoke(
        app,
        ["config", "add", "alpha", "--base-url", "https://a/v1", "--model", "m-a"],
        input="test-key-123\n",
    )
    assert created.exit_code == 0

    def fake_probe_ok(config: EndpointConfig) -> ProbeResult:
        return ProbeResult(ok=True, message="连接成功，模型应答正常。", latency_ms=12.0)

    monkeypatch.setattr(config_module, "probe_endpoint", fake_probe_ok)
    ok = runner.invoke(app, ["config", "test", "alpha"])

    assert ok.exit_code == 0
    assert "连接成功" in ok.output
    assert "alpha" in ok.output

    def fake_probe_fail(config: EndpointConfig) -> ProbeResult:
        return ProbeResult(
            ok=False, message="鉴权失败：API 密钥无效或过期。", latency_ms=8.0
        )

    monkeypatch.setattr(config_module, "probe_endpoint", fake_probe_fail)
    bad = runner.invoke(app, ["config", "test", "alpha"])

    assert bad.exit_code == 1
    assert "鉴权失败" in bad.stderr


def test_config_test_missing_name_reports_name(temp_data_root: Path) -> None:
    """config test 传不存在的配置名 → 报错回显该配置名（而非笼统的「没有配置」）。"""
    created = runner.invoke(
        app,
        ["config", "add", "alpha", "--base-url", "https://a/v1", "--model", "m-a"],
        input="test-key-123\n",
    )
    assert created.exit_code == 0

    result = runner.invoke(app, ["config", "test", "ghost"])

    assert result.exit_code == 1
    assert "ghost" in result.stderr
    assert "不存在" in result.stderr


def test_config_test_requires_ref_and_key_channels(
    temp_data_root: Path,
) -> None:
    """config test：不带配置名按用法错误退 2；配置无密钥（环境变量也没设）→ 提示补配。"""
    empty = runner.invoke(app, ["config", "test"])

    assert empty.exit_code == 2
    assert "test" in empty.stderr or "REF" in empty.stderr or "配置" in empty.stderr

    created = runner.invoke(
        app,
        ["config", "add", "beta", "--base-url", "https://b/v1", "--model", "m-b"],
        input="\n",
    )
    assert created.exit_code == 0

    no_key = runner.invoke(app, ["config", "test", "beta"])

    assert no_key.exit_code == 1
    assert "补配密钥" in no_key.stderr


def test_config_params_set_and_show_roundtrip(temp_data_root: Path) -> None:
    """config params：--set 写入后 show 读回一致；密钥文件不受影响（沿用语义）。"""
    runner.invoke(
        app,
        ["config", "add", "alpha", "--base-url", "https://a/v1", "--model", "m-a"],
        input="test-key-123\n",
    )

    result = runner.invoke(
        app,
        [
            "config",
            "params",
            "alpha",
            "--set",
            '{"temperature": 0.7, "max_tokens": 512}',
        ],
    )

    assert result.exit_code == 0
    assert '"temperature": 0.7' in result.output
    assert '"max_tokens": 512' in result.output
    # 参数块在 config.json 里平铺在顶层（存储层口径），读取侧按 validated_request_params 收取。
    data = json.loads(
        (_config_dir(temp_data_root, "alpha") / "config.json").read_text(
            encoding="utf-8"
        )
    )
    assert data["temperature"] == 0.7
    assert data["max_tokens"] == 512
    # params 只动参数块：密钥文件原样在（沿用语义的落盘证据）。
    assert (_config_dir(temp_data_root, "alpha") / "credentials").read_text(
        encoding="utf-8"
    ) == "test-key-123"

    show = runner.invoke(app, ["config", "params", "alpha"])

    assert show.exit_code == 0
    assert '"temperature": 0.7' in show.output
    assert '"max_tokens": 512' in show.output
    assert "test-key-123" not in show.output


def test_config_params_set_replaces_whole_block(temp_data_root: Path) -> None:
    """params --set 的整体替换语义：再次 --set 后只保留新给的一整块。"""
    runner.invoke(
        app,
        ["config", "add", "alpha", "--base-url", "https://a/v1", "--model", "m-a"],
        input="\n",
    )
    runner.invoke(app, ["config", "params", "alpha", "--set", '{"temperature": 0.7}'])

    result = runner.invoke(
        app, ["config", "params", "alpha", "--set", '{"max_tokens": 8}']
    )

    assert result.exit_code == 0
    data = json.loads(
        (_config_dir(temp_data_root, "alpha") / "config.json").read_text(
            encoding="utf-8"
        )
    )
    assert data["max_tokens"] == 8
    assert "temperature" not in data


def test_config_params_set_empty_clears(temp_data_root: Path) -> None:
    """params --set '{}'：清空全部请求参数（回到内置默认）。"""
    runner.invoke(
        app,
        ["config", "add", "alpha", "--base-url", "https://a/v1", "--model", "m-a"],
        input="\n",
    )
    runner.invoke(app, ["config", "params", "alpha", "--set", '{"temperature": 0.7}'])

    result = runner.invoke(app, ["config", "params", "alpha", "--set", "{}"])

    assert result.exit_code == 0
    assert "已清空" in result.output
    show = runner.invoke(app, ["config", "params", "alpha"])
    assert "未设置请求参数" in show.output


def test_config_params_set_unknown_keys_dropped(temp_data_root: Path) -> None:
    """params --set 只认六个参数键：其余键丢弃（与 Web / 存储层同口径）。"""
    runner.invoke(
        app,
        ["config", "add", "alpha", "--base-url", "https://a/v1", "--model", "m-a"],
        input="\n",
    )

    result = runner.invoke(
        app,
        [
            "config",
            "params",
            "alpha",
            "--set",
            '{"temperature": 0.5, "vendor_special": 1}',
        ],
    )

    assert result.exit_code == 0
    data = json.loads(
        (_config_dir(temp_data_root, "alpha") / "config.json").read_text(
            encoding="utf-8"
        )
    )
    assert data["temperature"] == 0.5
    assert "vendor_special" not in data


def test_config_params_set_invalid_json_is_usage_error(temp_data_root: Path) -> None:
    """params --set 非法 JSON / 非对象：退出码 2（用法错误）、stderr 给可操作消息。"""
    runner.invoke(
        app,
        ["config", "add", "alpha", "--base-url", "https://a/v1", "--model", "m-a"],
        input="\n",
    )

    broken = runner.invoke(
        app, ["config", "params", "alpha", "--set", "{temperature: 0.7}"]
    )
    not_object = runner.invoke(app, ["config", "params", "alpha", "--set", "[1, 2]"])

    assert broken.exit_code == 2
    assert "JSON 对象" in broken.output
    assert not_object.exit_code == 2
    assert "JSON 对象" in not_object.output


def test_config_params_set_bad_value_type_fails_loud(temp_data_root: Path) -> None:
    """params --set 值类型不合法（temperature 传字符串）：退出码 1、报错点名键名。"""
    runner.invoke(
        app,
        ["config", "add", "alpha", "--base-url", "https://a/v1", "--model", "m-a"],
        input="\n",
    )

    result = runner.invoke(
        app,
        ["config", "params", "alpha", "--set", '{"temperature": "hot"}'],
    )

    assert result.exit_code == 1
    assert "temperature" in result.stderr
    assert "数字" in result.stderr


def test_config_params_show_empty(temp_data_root: Path) -> None:
    """params 查看未设置参数的配置：提示未设置并给设置指引（不报错）。"""
    runner.invoke(
        app,
        ["config", "add", "alpha", "--base-url", "https://a/v1", "--model", "m-a"],
        input="\n",
    )

    result = runner.invoke(app, ["config", "params", "alpha"])

    assert result.exit_code == 0
    assert "未设置请求参数" in result.output
    assert "--set" in result.output


def test_config_params_errors_report_name(temp_data_root: Path) -> None:
    """params 不带配置名按用法错误退 2；配置名不存在：退出码 1、stderr 回显配置名。"""
    empty = runner.invoke(app, ["config", "params"])

    assert empty.exit_code == 2

    runner.invoke(
        app,
        ["config", "add", "alpha", "--base-url", "https://a/v1", "--model", "m-a"],
        input="\n",
    )
    ghost = runner.invoke(app, ["config", "params", "ghost"])

    assert ghost.exit_code == 1
    assert "ghost" in ghost.stderr
    assert "不存在" in ghost.stderr


def test_config_params_targets_named_config_not_active(temp_data_root: Path) -> None:
    """params 带配置名：写入指定配置，不动当前使用的另一套。"""
    runner.invoke(
        app,
        ["config", "add", "alpha", "--base-url", "https://a/v1", "--model", "m-a"],
        input="\n",
    )
    runner.invoke(
        app,
        ["config", "add", "beta", "--base-url", "https://b/v1", "--model", "m-b"],
        input="\n",
    )

    result = runner.invoke(
        app, ["config", "params", "beta", "--set", '{"temperature": 0.9}']
    )

    assert result.exit_code == 0
    beta = json.loads(
        (_config_dir(temp_data_root, "beta") / "config.json").read_text(
            encoding="utf-8"
        )
    )
    alpha = json.loads(
        (_config_dir(temp_data_root, "alpha") / "config.json").read_text(
            encoding="utf-8"
        )
    )
    assert beta["temperature"] == 0.9
    assert "temperature" not in alpha


def test_session_list_and_show(
    temp_data_root: Path, fake_engine: FakeCompleter
) -> None:
    """session list / show：label 一轮后可列出、回放对话历史。"""
    _save_prompt("h3", "你是打标助手。")
    runner.invoke(app, ["label", "--endpoint", "e-test", "-p", "h3", "-m", "描述图"])
    (session_id,) = list_sessions()

    listing = runner.invoke(app, ["session", "list"])
    show = runner.invoke(app, ["session", "show", session_id])

    assert listing.exit_code == 0
    assert session_id in listing.output
    assert show.exit_code == 0
    assert "user: 描述图" in show.output
    assert "assistant: 打标结果" in show.output


def test_session_list_defaults_to_cli_source(
    temp_data_root: Path, fake_engine: FakeCompleter
) -> None:
    """session list 默认只列 cli 来源；--source web / all 按口径过滤。"""
    _save_prompt("h3", "你是打标助手。")
    runner.invoke(app, ["label", "--endpoint", "e-test", "-p", "h3", "-m", "描述图"])
    web_id = create_session(source="web")
    cli_only_id = create_session(source="cli")

    listing = runner.invoke(app, ["session", "list"])
    web_only = runner.invoke(app, ["session", "list", "--source", "web"])
    everything = runner.invoke(app, ["session", "list", "--source", "all"])

    assert listing.exit_code == 0
    assert web_id not in listing.output
    assert cli_only_id in listing.output
    assert web_only.exit_code == 0
    assert web_id in web_only.output
    assert cli_only_id not in web_only.output
    assert everything.exit_code == 0
    assert web_id in everything.output
    assert cli_only_id in everything.output


def test_session_remove_requires_confirmation_then_deletes(
    temp_data_root: Path, fake_engine: FakeCompleter
) -> None:
    """session remove：非交互缺 --yes 按用法错误退 2；--yes 删除后列表不再含它。"""
    _save_prompt("h3", "你是打标助手。")
    runner.invoke(app, ["label", "--endpoint", "e-test", "-p", "h3", "-m", "描述图"])
    (session_id,) = list_sessions()

    refused = runner.invoke(app, ["session", "remove", session_id])
    removed = runner.invoke(app, ["session", "remove", session_id, "--yes"])

    assert refused.exit_code == 2
    assert removed.exit_code == 0
    assert "已删除" in removed.output
    assert list_sessions() == []


def test_strategy_use_set_and_show_roundtrip(temp_data_root: Path) -> None:
    """strategy use：设置后无参查看回显策略名与 id。"""
    strategy_id = _seed_strategy()

    use = runner.invoke(app, ["strategy", "use", strategy_id])
    view = runner.invoke(app, ["strategy", "use"])

    assert use.exit_code == 0
    assert "已设为当前使用" in use.output
    assert view.exit_code == 0
    assert "当前使用：当前策略" in view.output
    assert strategy_id in view.output


def test_strategy_use_without_pointer_says_unset(temp_data_root: Path) -> None:
    """strategy use 无参查看且未设置过：给「未设置」提示与设置指引。"""
    view = runner.invoke(app, ["strategy", "use"])

    assert view.exit_code == 0
    assert "当前没有使用中的策略" in view.output


def test_strategy_use_missing_strategy_fails(temp_data_root: Path) -> None:
    """strategy use 指向不存在的策略：用户错误退 1（指针只指向现存在的策略）。"""
    result = runner.invoke(app, ["strategy", "use", "s_missing"])

    assert result.exit_code == 1
    assert "不存在" in result.output + result.stderr


def test_stale_pointer_warns_but_does_not_block_explicit_call(
    temp_data_root: Path, fake_engine: FakeCompleter
) -> None:
    """指针失效（策略文件被手动删）：stderr 给提示但不阻断——全显式调用照常可跑。"""
    strategy_id = _seed_strategy()
    assert runner.invoke(app, ["strategy", "use", strategy_id]).exit_code == 0
    # 模拟盘上文件被外部删掉（绕过 delete_strategy，指针没有级联机会）。
    (temp_data_root / "strategies" / f"{strategy_id}.json").unlink()

    result = runner.invoke(
        app, ["label", "--endpoint", "e-test", "-p", "h3", "-m", "打标", "--json"]
    )

    assert result.exit_code == 0
    assert "指针失效" in result.stderr
    assert "dsf strategy use" in result.stderr


def test_label_explicit_endpoint_wins_over_dead_strategy_endpoint(
    temp_data_root: Path, fake_engine: FakeCompleter
) -> None:
    """显式 --endpoint 优先于当前策略：策略端点已失效时显式值照常可跑（反之必炸）。"""
    strategy_id = _seed_strategy()
    assert runner.invoke(app, ["strategy", "use", strategy_id]).exit_code == 0
    create_config(
        "另一端点", "https://other.example.com/v1", "other-model", api_key=None
    )
    # 删掉策略指向的端点配置：缺省回落若解析策略端点就会报「配置不存在」。
    cid = config_id_by_display_name("e-test")
    assert cid is not None
    delete_config(cid)

    result = runner.invoke(
        app, ["label", "--endpoint", "另一端点", "-m", "打标", "--json"]
    )

    assert result.exit_code == 0


def test_usage_error_exit_code(temp_data_root: Path) -> None:
    """用法错误（未知子命令）：退出码 2（Typer/click 默认用法错误语义）。"""
    result = runner.invoke(app, ["不存在的命令"])

    assert result.exit_code == 2


def test_label_unknown_skill_exits_user_error(
    temp_data_root: Path, fake_engine: FakeCompleter
) -> None:
    """勾选不存在的 skill：退出码 1、stderr 给可操作错误（不静默吞掉）。"""
    _save_prompt("h3", "你是打标助手。")

    result = runner.invoke(
        app, ["label", "--endpoint", "e-test", "-p", "h3", "-s", "不存在", "-m", "描述"]
    )

    assert result.exit_code == 1
    assert "不存在" in result.stderr


def test_chat_turn_failure_keeps_session_alive(
    temp_data_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """chat 某一轮失败（模型超时）：报错带重试提示后继续会话，下一轮照常进行。"""
    from dataset_factory.labeling import LabelingEngine

    create_config("e-test", "https://api.example.com/v1", "test-model", api_key=None)
    _save_prompt("h3", "你是打标助手。")
    completer = _FlakyCompleter()

    def fake_build(endpoint_ref: str) -> LabelingEngine:
        return LabelingEngine(completer, "test-model", source="cli")

    monkeypatch.setattr(label_module, "build_engine", fake_build)

    result = runner.invoke(
        app, ["chat", "--endpoint", "e-test", "-p", "h3"], input="第一轮\n第二轮\n"
    )

    assert result.exit_code == 0
    assert "错误：模型调用超时" in result.stderr
    assert "重发本轮" in result.stderr
    assert "第二轮回复" in result.output
    assert completer.calls == 2


def test_serve_wires_uvicorn_without_access_log(
    temp_data_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """serve：显式构造 uvicorn.Server（不覆盖应用日志、访问日志交中间件；实例挂 app.state）。"""
    captured: dict[str, object] = {}

    class FakeServer:
        def __init__(self, config: uvicorn.Config) -> None:
            captured["config"] = config

        def run(self) -> None:
            captured["ran"] = True

    monkeypatch.setattr("uvicorn.Server", FakeServer)
    root = logging.getLogger()
    saved_handlers = root.handlers[:]

    try:
        result = runner.invoke(app, ["serve", "--host", "127.0.0.1", "--port", "8123"])
        file_handlers = [
            h
            for h in logging.getLogger().handlers
            if isinstance(h, logging.handlers.RotatingFileHandler)
        ]
    finally:
        # serve 会往 root 挂文件日志 handler（指向临时数据根），测试后还原避免遗留。
        root.handlers[:] = saved_handlers

    assert result.exit_code == 0
    config = cast(uvicorn.Config, captured["config"])
    assert isinstance(config.app, FastAPI)
    assert config.host == "127.0.0.1"
    assert config.port == 8123
    assert config.log_config is None
    assert config.access_log is False
    assert captured["ran"] is True
    assert len(file_handlers) == 1
    assert file_handlers[0].baseFilename.endswith("server.log")


def test_serve_log_level_reconfigures_logging(
    temp_data_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """serve --log-level：显式值生效；无法识别的值回落 INFO（不崩、可启动）。"""
    root = logging.getLogger()
    saved_handlers = root.handlers[:]
    saved_level = root.level

    class FakeServer:
        def __init__(self, config: uvicorn.Config) -> None:
            return None

        def run(self) -> None:
            return None

    monkeypatch.setattr("uvicorn.Server", FakeServer)

    try:
        result = runner.invoke(app, ["serve", "--log-level", "warning"])
        assert result.exit_code == 0
        assert root.level == logging.WARNING

        result_bad = runner.invoke(app, ["serve", "--log-level", "不是级别"])
        assert result_bad.exit_code == 0
        assert root.level == logging.INFO
    finally:
        # serve 内部 basicConfig(force=True) 会把 handler 绑到 CliRunner 的临时 stderr，
        # 测试后还原 root 配置，避免遗留指向已关流的 handler 污染后续测试的日志输出。
        root.handlers[:] = saved_handlers
        root.setLevel(saved_level)
