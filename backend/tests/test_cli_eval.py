"""CLI 测试：dsf eval 分组（批次 CRUD、前台打分、人工打分、报告读取）。"""

from __future__ import annotations

import json
from collections.abc import Iterator, Sequence
from pathlib import Path

import pytest
from typer.testing import CliRunner

from dataset_factory.cli.main import app
from dataset_factory.eval import (
    KIND_BINARY,
    KIND_SCORE5,
    RUN_STATUS_INTERRUPTED,
    DimensionSpec,
    EvalBatchConfig,
    EvalRunner,
    HumanSettings,
    PairwiseSettings,
    RunReport,
)
from dataset_factory.llm import (
    Message,
    SecretValue,
    StreamDelta,
    TextPart,
    create_config,
)
from dataset_factory.prompts import Prompt, save_prompt
from dataset_factory.strategies import create_batch, create_strategy
from dataset_factory.workdir import WorkdirRegistry, WorkdirStore

runner = CliRunner()


def _fake_factory(_config: object) -> object:
    """快回假件工厂。"""
    return _FakeJudge()


def _broken_factory(_config: object) -> object:
    """恒定输出不可解析文本的假裁判工厂（制造条目级失败）。"""
    return _BrokenJudge()


_GOOD_DIMENSION = '{"场景描述": 4, "无幻觉": "无", "理由": "准确。"}'
_GOOD_PAIRWISE = '{"winner": "A", "理由": "A 更准确。"}'


class _FakeJudge:
    """固定好回复的假裁判端点。"""

    def complete(self, messages: Sequence[Message]) -> str:
        """纯文本档。"""
        return self._reply(messages)

    def stream(self, messages: Sequence[Message]) -> Iterator[StreamDelta]:
        """Protocol 齐备性桩。"""
        raise NotImplementedError

    def complete_structured(
        self, messages: Sequence[Message], response_format: dict[str, object] | None
    ) -> str:
        """结构化档（同路由）。"""
        return self._reply(messages)

    def _reply(self, messages: Sequence[Message]) -> str:
        text = chr(10).join(
            part.text
            for message in messages
            for part in message.parts
            if isinstance(part, TextPart)
        )
        return _GOOD_PAIRWISE if "<caption-a>" in text else _GOOD_DIMENSION


class _BrokenJudge:
    """输出永远解析不了的假裁判（每个调用都记条目级失败）。"""

    def complete(self, messages: Sequence[Message]) -> str:
        """纯文本档：交一段没有 JSON 的文本。"""
        return "完全看不懂的输出"

    def stream(self, messages: Sequence[Message]) -> Iterator[StreamDelta]:
        """Protocol 齐备性桩。"""
        raise NotImplementedError

    def complete_structured(
        self, messages: Sequence[Message], response_format: dict[str, object] | None
    ) -> str:
        """结构化档：同样的坏输出。"""
        return "完全看不懂的输出"


@pytest.fixture
def prepared(tmp_path: Path, temp_data_root: Path) -> tuple[Path, str, str]:
    """登记工作目录、两个被测批次（含产物）、裁判策略；返回 (root, 配置 JSON, 裁判 ID)。"""
    create_config(
        "main",
        "https://api.example.com/v1",
        "test-model",
        api_key=SecretValue("test-key"),
    )
    save_prompt(Prompt(name="详细描述", description="", body="你是裁判"))
    root = tmp_path / "work"
    root.mkdir()
    for name in ("cat.jpg", "dog.jpg"):
        (root / name).write_bytes(b"fake")
    WorkdirRegistry.register(root)
    WorkdirStore(root).append_import_record(
        {
            "imported_at": "2026-01-01T00:00:00Z",
            "source": "",
            "files": [
                {"name": "cat.jpg", "sha256": "0" * 64},
                {"name": "dog.jpg", "sha256": "0" * 64},
            ],
        }
    )
    for seq in (1, 2):
        create_batch(
            root,
            name=f"批次{seq}",
            description="",
            endpoint_id="main",
            prompt_id="详细描述",
            skill_ids=[],
        )
        (root / f"s{seq}__cat.txt").write_text("一只猫", encoding="utf-8")
        (root / f"s{seq}__dog.txt").write_text("一只狗", encoding="utf-8")
    judge = create_strategy(
        name="裁判", endpoint_id="main", prompt_id="详细描述", skill_ids=[]
    )
    config = EvalBatchConfig(
        candidates=[1, 2],
        benchmark=None,
        judges=[judge.id],
        dimensions=[
            DimensionSpec(name="场景描述", kind=KIND_SCORE5),
            DimensionSpec(name="无幻觉", kind=KIND_BINARY),
        ],
        dimension_scoring=True,
        pairwise=True,
        pairwise_settings=PairwiseSettings(
            dual_order="full", dual_order_ratio=None, limit=None
        ),
        human=HumanSettings(
            full=False,
            random_enabled=False,
            random_count=None,
            targeted_enabled=False,
            targeted_count=None,
            dimension_manual=False,
            pairwise_manual=False,
        ),
        dataset_source=None,
        dataset_license=None,
    )
    return root, json.dumps(config.to_json(), ensure_ascii=False), judge.id


def test_add_list_show_edit_rm_roundtrip(
    prepared: tuple[Path, str, str],
) -> None:
    """建列查改删闭环；rm 需 --yes（非交互缺 --yes 报用法错）。"""
    root, config_json, _ = prepared
    added = runner.invoke(
        app,
        ["eval", "add", str(root), "--name", "第一评", "--json", config_json],
    )
    assert added.exit_code == 0, added.output
    assert json.loads(added.stdout)["id"] == "e1"
    listed = runner.invoke(app, ["eval", "list", str(root)])
    assert [row["id"] for row in json.loads(listed.stdout)] == ["e1"]
    shown = runner.invoke(app, ["eval", "show", str(root), "e1"])
    assert json.loads(shown.stdout)["config"]["candidates"] == [1, 2]
    renamed = runner.invoke(app, ["eval", "edit", str(root), "e1", "--name", "改名"])
    assert json.loads(renamed.stdout)["name"] == "改名"
    denied = runner.invoke(app, ["eval", "rm", str(root), "e1"])
    assert denied.exit_code == 2  # 非交互缺 --yes：用法错误
    removed = runner.invoke(app, ["eval", "rm", str(root), "e1", "--yes"])
    assert removed.exit_code == 0, removed.output
    assert runner.invoke(app, ["eval", "show", str(root), "e1"]).exit_code == 1


def test_score_append_and_scores_read(prepared: tuple[Path, str, str]) -> None:
    """score 追加（低分缺理由被拒）与 scores 读当前有效记录。"""
    root, config_json, _ = prepared
    runner.invoke(
        app, ["eval", "add", str(root), "--name", "第一评", "--json", config_json]
    )
    bad = runner.invoke(
        app,
        [
            "eval",
            "score",
            str(root),
            "e1",
            "--json",
            json.dumps(
                {
                    "kind": "dimension",
                    "item": "cat",
                    "batch": 1,
                    "annotator": "我",
                    "scores": {"场景描述": 1},
                },
                ensure_ascii=False,
            ),
        ],
    )
    assert bad.exit_code == 1  # 低分缺理由：运行失败（退出码 1）
    good = runner.invoke(
        app,
        [
            "eval",
            "score",
            str(root),
            "e1",
            "--json",
            json.dumps(
                {
                    "kind": "dimension",
                    "item": "cat",
                    "batch": 1,
                    "annotator": "我",
                    "scores": {"场景描述": 1},
                    "reason": "编造了细节",
                },
                ensure_ascii=False,
            ),
        ],
    )
    assert good.exit_code == 0, good.output
    scores = runner.invoke(app, ["eval", "scores", str(root), "e1"])
    rows = json.loads(scores.stdout)
    assert len(rows) == 1
    assert rows[0]["item"] == "cat"


def test_run_status_and_report(
    prepared: tuple[Path, str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """前台打分（假端点）→ status 读快照 → 报告列出与全文可读。"""
    root, config_json, _ = prepared
    monkeypatch.setattr("dataset_factory.eval.runner.build_completer", _fake_factory)
    runner.invoke(
        app, ["eval", "add", str(root), "--name", "第一评", "--json", config_json]
    )
    ran = runner.invoke(app, ["eval", "run", str(root), "e1"])
    assert ran.exit_code == 0, ran.output
    assert json.loads(ran.stdout)["status"] == "completed"
    status = runner.invoke(app, ["eval", "status", str(root), "e1"])
    assert json.loads(status.stdout)["status"] == "completed"
    listed = runner.invoke(app, ["eval", "report", "list", str(root), "e1"])
    reports = json.loads(listed.stdout)
    assert len(reports) == 1
    shown = runner.invoke(app, ["eval", "report", "show", str(root), "e1"])
    assert shown.exit_code == 0, shown.output
    layers = json.loads(shown.stdout)["layers"]
    assert layers["ranking"] is not None
    assert layers["dimensions"] is not None


def test_domain_errors_go_to_stderr_with_exit_1(
    prepared: tuple[Path, str, str],
) -> None:
    """eval 域异常 → stderr「错误：…」＋退出码 1，绝不甩原始 traceback。"""
    root, config_json, _ = prepared
    runner.invoke(
        app, ["eval", "add", str(root), "--name", "第一评", "--json", config_json]
    )

    missing = runner.invoke(app, ["eval", "show", str(root), "e99"])
    assert missing.exit_code == 1
    assert "错误：" in missing.stderr
    assert "e99" in missing.stderr
    assert "Traceback" not in missing.output

    bad_ref = json.loads(config_json)
    bad_ref["candidates"] = [99]
    bad_add = runner.invoke(
        app,
        [
            "eval",
            "add",
            str(root),
            "--name",
            "坏引用",
            "--json",
            json.dumps(bad_ref, ensure_ascii=False),
        ],
    )
    assert bad_add.exit_code == 1
    assert "错误：" in bad_add.stderr
    assert "被测批次不存在" in bad_add.stderr
    assert "Traceback" not in bad_add.output

    low_score = runner.invoke(
        app,
        [
            "eval",
            "score",
            str(root),
            "e1",
            "--json",
            json.dumps(
                {
                    "kind": "dimension",
                    "item": "cat",
                    "batch": 1,
                    "annotator": "我",
                    "scores": {"场景描述": 1},
                },
                ensure_ascii=False,
            ),
        ],
    )
    assert low_score.exit_code == 1
    assert "错误：" in low_score.stderr
    assert "理由必填" in low_score.stderr
    assert "Traceback" not in low_score.output


def test_add_rejects_malformed_config_json(
    prepared: tuple[Path, str, str],
) -> None:
    """--json 语法错与形状错都按用法错误给 2（形状错不再甩域异常栈）。"""
    root, _, _ = prepared
    for payload in ("{不是 JSON", "[]"):
        rejected = runner.invoke(
            app, ["eval", "add", str(root), "--name", "坏配置", "--json", payload]
        )
        # 用法错误走 click 的错误框（exit 2）；框内正文在 pytest 的捕获流上会被
        # 本地编码折损，故只断言「是用法错误」这一可编码的事实与无 traceback。
        assert rejected.exit_code == 2, rejected.output
        assert "Invalid value" in rejected.stderr
        assert "Traceback" not in rejected.output


def test_run_exits_130_on_interruption(
    prepared: tuple[Path, str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """中断报告照常出 stdout，但退出码是 130（与打标跑批同口径）。"""
    root, config_json, _ = prepared
    runner.invoke(
        app, ["eval", "add", str(root), "--name", "第一评", "--json", config_json]
    )

    def fake_run(_self: EvalRunner) -> RunReport:
        return RunReport(
            run_id="中断样例",
            status=RUN_STATUS_INTERRUPTED,
            counters={
                "planned": 2,
                "attempted": 1,
                "succeeded": 1,
                "failed": 0,
                "skipped": 0,
            },
            run_dir=root,
        )

    monkeypatch.setattr(EvalRunner, "run", fake_run)
    interrupted = runner.invoke(app, ["eval", "run", str(root), "e1"])
    assert interrupted.exit_code == 130, interrupted.output
    assert json.loads(interrupted.stdout)["status"] == "interrupted"


def test_run_exits_1_when_items_failed(
    prepared: tuple[Path, str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """有条目失败 → 报告照常出 stdout，退出码 1（脚本据此判定没全绿）。"""
    root, config_json, _ = prepared
    monkeypatch.setattr("dataset_factory.eval.runner.build_completer", _broken_factory)
    runner.invoke(
        app, ["eval", "add", str(root), "--name", "第一评", "--json", config_json]
    )
    ran = runner.invoke(app, ["eval", "run", str(root), "e1"])
    assert ran.exit_code == 1, ran.output
    payload = json.loads(ran.stdout)
    assert payload["status"] == "completed"
    assert payload["counters"]["failed"] > 0
    assert "Traceback" not in ran.output


def test_status_skips_corrupt_run_record(
    prepared: tuple[Path, str, str],
) -> None:
    """最近一次 run.json 损坏 → 跳过并输出 null（不给 traceback）。"""
    root, config_json, _ = prepared
    runner.invoke(
        app, ["eval", "add", str(root), "--name", "第一评", "--json", config_json]
    )
    broken = root / ".dsf" / "eval" / "runs" / "20261026T000000Z"
    broken.mkdir()
    (broken / "run.json").write_text("{坏记录", encoding="utf-8")
    status = runner.invoke(app, ["eval", "status", str(root), "e1"])
    assert status.exit_code == 0
    assert json.loads(status.stdout) is None
    assert "Traceback" not in status.output


def test_status_reads_run_record_only_once(
    prepared: tuple[Path, str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """选中后不再二次读 run.json：读取期文件被移走/改坏也不会甩原始栈。"""
    root, config_json, _ = prepared
    runner.invoke(
        app, ["eval", "add", str(root), "--name", "第一评", "--json", config_json]
    )
    run_dir = root / ".dsf" / "eval" / "runs" / "20261026T000000Z"
    run_dir.mkdir()
    (run_dir / "run.json").write_text(
        json.dumps({"batch": "e1", "status": "completed"}), encoding="utf-8"
    )
    original_read_text = Path.read_text
    reads = {"count": 0}

    def counting(
        self: Path, encoding: str | None = None, errors: str | None = None
    ) -> str:
        if self.name == "run.json":
            reads["count"] += 1
            if reads["count"] > 1:
                raise OSError("模拟读取期文件被移走")
        return original_read_text(self, encoding=encoding, errors=errors)

    monkeypatch.setattr(Path, "read_text", counting)
    status = runner.invoke(app, ["eval", "status", str(root), "e1"])
    assert status.exit_code == 0, status.output
    assert json.loads(status.stdout)["status"] == "completed"
    assert reads["count"] == 1
    assert "Traceback" not in status.output
