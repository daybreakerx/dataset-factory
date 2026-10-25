"""接口测试：eval 端点（打分批次 CRUD＋基准位端点）。

全部同步端点，TestClient 直测；资产与被测批次用 fixture 经域接口预置。
"""

from __future__ import annotations

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
