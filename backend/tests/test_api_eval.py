"""接口测试：eval 端点（打分批次 CRUD＋基准位端点）。

全部同步端点，TestClient 直测；资产与被测批次用 fixture 经域接口预置。
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from dataset_factory.api import create_app
from dataset_factory.llm import create_config
from dataset_factory.prompts import Prompt, save_prompt
from dataset_factory.strategies import create_batch, create_strategy


@pytest.fixture
def client(tmp_path: Path, temp_data_root: Path) -> TestClient:
    """挂临时空 frontend 目录的测试客户端（依赖 temp_data_root 隔离数据根）。"""
    return TestClient(create_app(frontend_dir=tmp_path))


@pytest.fixture
def wid(client: TestClient, tmp_path: Path) -> str:
    """一个已登记的工作目录（走真实登记端点）。"""
    target = tmp_path / "photos"
    target.mkdir()
    response = client.post("/api/workdirs", json={"path": str(target)})
    return str(response.json()["workdir"]["id"])


@pytest.fixture
def seeded(client: TestClient, wid: str) -> tuple[TestClient, str, str, Path]:
    """预置资产（端点＋提示词）、两个打标批次（s1、s2）与一条裁判策略。"""
    create_config("main", "https://api.example.com/v1", "test-model", api_key=None)
    save_prompt(Prompt(name="详细描述", description="", body="你是打标器"))
    workdir_path = Path(str(client.get(f"/api/workdirs/{wid}").json()["path"]))
    create_batch(
        workdir_path,
        name="候选甲",
        description="",
        endpoint_id="main",
        prompt_id="详细描述",
        skill_ids=[],
    )
    create_batch(
        workdir_path,
        name="候选乙",
        description="",
        endpoint_id="main",
        prompt_id="详细描述",
        skill_ids=[],
    )
    judge = create_strategy(
        name="裁判", endpoint_id="main", prompt_id="详细描述", skill_ids=[]
    )
    return client, wid, judge.id, workdir_path


def _config_payload(judge_id: str, **overrides: Any) -> dict[str, Any]:
    """合法的评测配置请求体；测试按需覆盖顶层字段。"""
    payload: dict[str, Any] = {
        "candidates": [1],
        "benchmark": None,
        "judges": [judge_id],
        "dimensions": [
            {"name": "场景描述", "kind": "score5"},
            {"name": "无幻觉", "kind": "binary"},
        ],
        "dimension_scoring": True,
        "pairwise": True,
        "pairwise_settings": {
            "dual_order": "full",
            "dual_order_ratio": None,
            "limit": None,
        },
        "human": {
            "full": False,
            "random_enabled": False,
            "random_count": None,
            "targeted_enabled": False,
            "targeted_count": None,
            "dimension_manual": False,
            "pairwise_manual": False,
        },
        "dataset_source": None,
        "dataset_license": None,
    }
    payload.update(overrides)
    return payload


def test_create_returns_201_and_location(
    seeded: tuple[TestClient, str, str, Path],
) -> None:
    """新建打分批次：201 + Location 指向新资源，视图带配置全文。"""
    client, wid, judge_id, _ = seeded
    response = client.post(
        f"/api/workdirs/{wid}/eval-batches",
        json={
            "name": "第一评",
            "description": "选型",
            "config": _config_payload(judge_id),
        },
    )
    assert response.status_code == 201
    assert response.headers["Location"] == f"/api/workdirs/{wid}/eval-batches/e1"
    body = response.json()
    assert body["id"] == "e1"
    assert body["name"] == "第一评"
    assert body["config"]["judges"] == [judge_id]
    assert body["config"]["pairwise_settings"]["dual_order"] == "full"


def test_list_and_detail_roundtrip(seeded: tuple[TestClient, str, str, Path]) -> None:
    """列表与详情都带配置全文，详情可被 Location 解析。"""
    client, wid, judge_id, _ = seeded
    client.post(
        f"/api/workdirs/{wid}/eval-batches",
        json={"name": "第一评", "config": _config_payload(judge_id)},
    )
    listed = client.get(f"/api/workdirs/{wid}/eval-batches").json()
    assert [item["id"] for item in listed] == ["e1"]
    detail = client.get(f"/api/workdirs/{wid}/eval-batches/e1")
    assert detail.status_code == 200
    assert detail.json()["config"]["candidates"] == [1]


def test_get_unknown_eval_returns_problem(
    seeded: tuple[TestClient, str, str, Path],
) -> None:
    """查不存在的打分批次 → 404 problem+json（eval-batch-not-found）。"""
    client, wid, _, _ = seeded
    response = client.get(f"/api/workdirs/{wid}/eval-batches/e9")
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.json()["type"] == "eval-batch-not-found"


def test_patch_replaces_config_and_metadata(
    seeded: tuple[TestClient, str, str, Path],
) -> None:
    """PATCH 全量替换配置、改名独立生效；配置未给时保持原样。"""
    client, wid, judge_id, _ = seeded
    client.post(
        f"/api/workdirs/{wid}/eval-batches",
        json={"name": "第一评", "config": _config_payload(judge_id)},
    )
    patched = client.patch(
        f"/api/workdirs/{wid}/eval-batches/e1",
        json={"config": _config_payload(judge_id, candidates=[1, 2])},
    )
    assert patched.status_code == 200
    assert patched.json()["config"]["candidates"] == [1, 2]
    renamed = client.patch(
        f"/api/workdirs/{wid}/eval-batches/e1", json={"name": "改名"}
    )
    assert renamed.json()["name"] == "改名"
    assert renamed.json()["config"]["candidates"] == [1, 2]


def test_patch_rejects_invalid_config_without_side_effects(
    seeded: tuple[TestClient, str, str, Path],
) -> None:
    """配置引用不合法 → 400 聚合消息；名称与旧配置都不被半改。"""
    client, wid, judge_id, _ = seeded
    client.post(
        f"/api/workdirs/{wid}/eval-batches",
        json={"name": "第一评", "config": _config_payload(judge_id)},
    )
    response = client.patch(
        f"/api/workdirs/{wid}/eval-batches/e1",
        json={
            "name": "不该生效",
            "config": _config_payload(judge_id, candidates=[99]),
        },
    )
    assert response.status_code == 400
    assert response.json()["type"] == "eval-config-invalid"
    assert "不存在" in response.json()["detail"]
    detail = client.get(f"/api/workdirs/{wid}/eval-batches/e1").json()
    assert detail["name"] == "第一评"
    assert detail["config"]["candidates"] == [1]


def test_patch_rejects_empty_body(seeded: tuple[TestClient, str, str, Path]) -> None:
    """三样都不给的空补丁 → 422。"""
    client, wid, judge_id, _ = seeded
    client.post(
        f"/api/workdirs/{wid}/eval-batches",
        json={"name": "第一评", "config": _config_payload(judge_id)},
    )
    response = client.patch(f"/api/workdirs/{wid}/eval-batches/e1", json={})
    assert response.status_code == 422


def test_corrupted_config_returns_409(
    seeded: tuple[TestClient, str, str, Path],
) -> None:
    """配置文件被外部改坏 → 详情 409 problem+json（eval-config-corrupted）。"""
    client, wid, judge_id, workdir = seeded
    client.post(
        f"/api/workdirs/{wid}/eval-batches",
        json={"name": "第一评", "config": _config_payload(judge_id)},
    )
    config_file = workdir / ".dsf" / "eval" / "e1" / "config.json"
    config_file.write_text('{"candidates": "坏了"}', encoding="utf-8")
    response = client.get(f"/api/workdirs/{wid}/eval-batches/e1")
    assert response.status_code == 409
    assert response.json()["type"] == "eval-config-corrupted"


def test_delete_returns_204_then_404(
    seeded: tuple[TestClient, str, str, Path],
) -> None:
    """删除后详情与再删都 404。"""
    client, wid, judge_id, _ = seeded
    client.post(
        f"/api/workdirs/{wid}/eval-batches",
        json={"name": "第一评", "config": _config_payload(judge_id)},
    )
    assert client.delete(f"/api/workdirs/{wid}/eval-batches/e1").status_code == 204
    assert client.get(f"/api/workdirs/{wid}/eval-batches/e1").status_code == 404
    assert client.delete(f"/api/workdirs/{wid}/eval-batches/e1").status_code == 404


def test_benchmark_endpoints_toggle_flag(
    seeded: tuple[TestClient, str, str, Path],
) -> None:
    """基准位端点：置位后批次视图带 benchmark=true，复位还原。"""
    client, wid, _, _ = seeded
    set_response = client.post(f"/api/workdirs/{wid}/batches/s1/benchmark")
    assert set_response.status_code == 200
    assert set_response.json()["benchmark"] is True
    detail = client.get(f"/api/workdirs/{wid}/batches/s1").json()
    assert detail["benchmark"] is True
    assert client.get(f"/api/workdirs/{wid}/batches/s2").json()["benchmark"] is False
    cleared = client.post(f"/api/workdirs/{wid}/batches/s1/unbenchmark")
    assert cleared.json()["benchmark"] is False


# --------------------------------------------------------------------------
# 打分运行端点（受理 / 轮询 / SSE）——completer 经 monkeypatch 注入假件
# --------------------------------------------------------------------------

_GOOD_DIMENSION = '{"场景描述": 4, "无幻觉": "无", "理由": "准确。"}'
_GOOD_PAIRWISE = '{"winner": "A", "理由": "A 更准确。"}'


class _FakeJudgeCompleter:
    """按消息路由的假裁判端点（可设每调用延时，供 SSE 测试拉长运行）。"""

    def __init__(self, delay: float = 0.0) -> None:
        """存每调用延时。"""
        self._delay = delay

    def complete(self, messages: object) -> str:
        """纯文本档。"""
        return self._reply(messages)

    def stream(self, messages: object) -> object:
        """judge 协议不走流式——Protocol 齐备性桩。"""
        raise NotImplementedError

    def complete_structured(
        self, messages: object, response_format: dict[str, object] | None
    ) -> str:
        """结构化档（同路由）。"""
        return self._reply(messages)

    def _reply(self, messages: object) -> str:
        from dataset_factory.llm import TextPart

        if self._delay:
            import time

            time.sleep(self._delay)
        text = chr(10).join(
            part.text
            for message in messages
            for part in message.parts
            if isinstance(part, TextPart)
        )
        return _GOOD_PAIRWISE if "<caption-a>" in text else _GOOD_DIMENSION


@pytest.fixture
def seeded_for_runs(client: TestClient, wid: str) -> tuple[TestClient, str, str, Path]:
    """预置可评对象：两素材登记在册、s1/s2 各有产物、裁判策略与打分批次就绪。"""
    from dataset_factory.llm import SecretValue, create_config
    from dataset_factory.strategies import create_batch, create_strategy
    from dataset_factory.workdir import WorkdirStore

    create_config(
        "main",
        "https://api.example.com/v1",
        "test-model",
        api_key=SecretValue("test-key"),
    )
    save_prompt(Prompt(name="详细描述", description="", body="你是裁判"))
    workdir = Path(str(client.get(f"/api/workdirs/{wid}").json()["path"]))
    for name in ("cat.jpg", "dog.jpg"):
        (workdir / name).write_bytes(b"fake-image-bytes")
    WorkdirStore(workdir).append_import_record(
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
            workdir,
            name=f"批次{seq}",
            description="",
            endpoint_id="main",
            prompt_id="详细描述",
            skill_ids=[],
        )
        (workdir / f"s{seq}__cat.txt").write_text("一只猫", encoding="utf-8")
        (workdir / f"s{seq}__dog.txt").write_text("一只狗", encoding="utf-8")
    judge = create_strategy(
        name="裁判", endpoint_id="main", prompt_id="详细描述", skill_ids=[]
    )
    response = client.post(
        f"/api/workdirs/{wid}/eval-batches",
        json={"name": "第一评", "config": _config_payload(judge.id)},
    )
    assert response.status_code == 201
    return client, wid, judge.id, workdir


def test_start_run_completes_then_current_idle(
    seeded_for_runs: tuple[TestClient, str, str, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """受理 202 → 后台跑完 → current 回 null（成功后出注册表）、run.json 落盘。"""
    client, wid, _, workdir = seeded_for_runs
    monkeypatch.setattr(
        "dataset_factory.eval.runner.build_completer",
        lambda _config: _FakeJudgeCompleter(),
    )
    started = client.post(f"/api/workdirs/{wid}/eval-batches/e1/runs")
    assert started.status_code == 202
    run_id = str(started.json()["run_id"])
    final: object = None
    for _ in range(100):
        current = client.get(f"/api/workdirs/{wid}/eval-batches/e1/runs/current")
        body = current.json()
        if body is None:
            final = "idle"
            break
        final = body
        if body["status"] in ("completed", "interrupted", "failed"):
            break
        time.sleep(0.05)
    assert final == "idle"
    record = json.loads(
        (workdir / ".dsf" / "eval" / "runs" / run_id / "run.json").read_text(
            encoding="utf-8"
        )
    )
    assert record["status"] == "completed"


def test_start_run_rejects_broken_judge_reference(
    seeded_for_runs: tuple[TestClient, str, str, Path],
) -> None:
    """裁判策略被删后受理 → 400 同步报（预检在受理之前）。"""
    from dataset_factory.strategies import delete_strategy

    client, wid, judge_id, _ = seeded_for_runs
    delete_strategy(judge_id)
    response = client.post(f"/api/workdirs/{wid}/eval-batches/e1/runs")
    assert response.status_code == 400
    assert response.json()["type"] == "eval-config-invalid"


def test_stop_without_active_run_returns_404(
    seeded_for_runs: tuple[TestClient, str, str, Path],
) -> None:
    """无进行中的打分运行 → stop 404（eval-run-not-active）。"""
    client, wid, _, _ = seeded_for_runs
    response = client.post(f"/api/workdirs/{wid}/eval-batches/e1/runs/stop")
    assert response.status_code == 404
    assert response.json()["type"] == "eval-run-not-active"


def test_stream_emits_start_items_finish(
    seeded_for_runs: tuple[TestClient, str, str, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """SSE 流：run-started → item-updated… → run-finished 后关流。"""
    client, wid, _, _ = seeded_for_runs
    monkeypatch.setattr(
        "dataset_factory.eval.runner.build_completer",
        lambda _config: _FakeJudgeCompleter(delay=0.12),
    )
    started = client.post(f"/api/workdirs/{wid}/eval-batches/e1/runs")
    assert started.status_code == 202
    frames: list[str] = []
    with client.stream(
        "GET", f"/api/workdirs/{wid}/eval-batches/e1/runs/stream"
    ) as stream:
        for chunk in stream.iter_text():
            frames.append(chunk)
    joined = "".join(frames)
    assert "event: run-started" in joined
    assert "event: item-updated" in joined
    assert "event: run-finished" in joined
