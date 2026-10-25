"""单元测试：eval 数据域（配置规则校验 / 引用校验 / 打分批次生命周期 / 独立锁）。

eval 数据落 tmp_path 工作目录的 ``.dsf/eval/``；裁判策略与被测批次的引用经
temp_data_root 隔离的资产夹具建立（端点配置＋提示词→库策略→打标批次）。
"""

from __future__ import annotations

import json
import threading
from pathlib import Path

import pytest

from dataset_factory.eval import (
    DUAL_FULL,
    DUAL_SAMPLED,
    KIND_BINARY,
    KIND_SCORE5,
    DimensionSpec,
    EvalBatchConfig,
    EvalBatchNotFoundError,
    EvalConfigCorruptedError,
    EvalConfigError,
    HumanSettings,
    PairwiseSettings,
    create_eval_batch,
    delete_eval_batch,
    get_eval_batch,
    list_eval_batches,
    parse_seq,
    read_eval_config,
    update_eval_batch,
    update_eval_config,
)
from dataset_factory.llm import create_config
from dataset_factory.prompts import Prompt, save_prompt
from dataset_factory.strategies import (
    create_batch,
    create_strategy,
    delete_strategy,
    list_batches,
    set_batch_benchmark,
)


@pytest.fixture
def workdir(tmp_path: Path) -> Path:
    """一个真实存在的空临时工作目录（无 .dsf——首个 eval 操作顺带建）。"""
    target = tmp_path / "photos"
    target.mkdir()
    return target


@pytest.fixture
def assets(temp_data_root: Path) -> None:
    """预置一套可引用的资产：端点配置＋提示词（裁判策略的最小引用集）。"""
    create_config("main", "https://api.example.com/v1", "test-model", api_key=None)
    save_prompt(Prompt(name="详细描述", description="描述画面", body="你是打标器"))


@pytest.fixture
def seeded(workdir: Path, assets: None) -> tuple[Path, str, list[int]]:
    """建两个打标批次（s1、s2）与一条裁判策略，返回（工作目录、裁判 ID、序号表）。"""
    create_batch(
        workdir,
        name="候选甲",
        description="",
        endpoint_id="main",
        prompt_id="详细描述",
        skill_ids=[],
    )
    create_batch(
        workdir,
        name="候选乙",
        description="",
        endpoint_id="main",
        prompt_id="详细描述",
        skill_ids=[],
    )
    judge = create_strategy(
        name="裁判", endpoint_id="main", prompt_id="详细描述", skill_ids=[]
    )
    return workdir, judge.id, [1, 2]


def _default_config(
    *,
    judges: list[str] | None = None,
    candidates: list[int] | None = None,
    benchmark: int | None = None,
) -> EvalBatchConfig:
    """一份默认合法的配置（维度评分＋对比排名都开、无人工介入）；按需覆写。

    规则校验的各坏例测试再在返回值上就地改字段（配置对象可变）。
    """
    return EvalBatchConfig(
        candidates=candidates if candidates is not None else [1],
        benchmark=benchmark,
        judges=judges if judges is not None else ["judge-1"],
        dimensions=[
            DimensionSpec(name="场景描述", kind=KIND_SCORE5),
            DimensionSpec(name="无幻觉", kind=KIND_BINARY),
        ],
        dimension_scoring=True,
        pairwise=True,
        pairwise_settings=PairwiseSettings(
            dual_order=DUAL_FULL, dual_order_ratio=None, limit=None
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


# --------------------------------------------------------------------------
# eN 解析与配置规则校验
# --------------------------------------------------------------------------


def test_parse_seq_accepts_en() -> None:
    """e1 解析为 1。"""
    assert parse_seq("e1") == 1


@pytest.mark.parametrize(
    "raw",
    ["e", "e0", "ex", "s1", "1", ""],
)
def test_parse_seq_rejects_invalid(raw: str) -> None:
    """不合法的打分批次标识按不存在处理（EvalBatchNotFoundError）。"""
    with pytest.raises(EvalBatchNotFoundError):
        parse_seq(raw)


def test_config_validate_accepts_default() -> None:
    """默认配置（两模式都开、无人工介入）通过规则校验。"""
    _default_config().validate()


def test_config_validate_rejects_no_modes() -> None:
    """两种评测模式都不开 → 报「至少开一个」。"""
    config = _default_config()
    config.dimension_scoring = False
    config.dimensions = []
    config.pairwise = False
    config.pairwise_settings = None
    with pytest.raises(EvalConfigError, match="至少开一个"):
        config.validate()


def test_config_validate_rejects_scoring_without_dimensions() -> None:
    """开了维度评分但维度清单为空 → 报错。"""
    config = _default_config()
    config.dimensions = []
    with pytest.raises(EvalConfigError, match="维度清单"):
        config.validate()


def test_config_validate_rejects_pairwise_without_settings() -> None:
    """开了对比排名但缺对比设置 → 报错。"""
    config = _default_config()
    config.pairwise_settings = None
    with pytest.raises(EvalConfigError, match="对比设置"):
        config.validate()


def test_config_validate_rejects_benchmark_among_candidates() -> None:
    """基准批次同时是被测批次 → 报错。"""
    config = _default_config(candidates=[1, 2], benchmark=1)
    with pytest.raises(EvalConfigError, match="基准批次"):
        config.validate()


def test_config_validate_rejects_full_with_channels() -> None:
    """全量与随机抽检同开 → 报互斥。"""
    config = _default_config()
    config.human.full = True
    config.human.random_enabled = True
    config.human.random_count = 10
    config.human.dimension_manual = True
    with pytest.raises(EvalConfigError, match="互斥"):
        config.validate()


def test_config_validate_rejects_random_without_count() -> None:
    """开了随机抽检但没给数量 → 报「≥1 的整数」。"""
    config = _default_config()
    config.human.random_enabled = True
    config.human.dimension_manual = True
    with pytest.raises(EvalConfigError, match="随机抽检数量"):
        config.validate()


def test_config_validate_rejects_channels_without_activities() -> None:
    """开了通道但没勾任何人工活动 → 报错。"""
    config = _default_config()
    config.human.targeted_enabled = True
    config.human.targeted_count = 5
    with pytest.raises(EvalConfigError, match="人工活动"):
        config.validate()


def test_config_validate_rejects_sampled_ratio_out_of_range() -> None:
    """随机抽验双序比例出界（0）→ 报「1–100」。"""
    config = _default_config()
    assert config.pairwise_settings is not None
    config.pairwise_settings.dual_order = DUAL_SAMPLED
    config.pairwise_settings.dual_order_ratio = 0
    with pytest.raises(EvalConfigError, match="1–100"):
        config.validate()


def test_config_validate_accepts_sampled_ratio_in_range() -> None:
    """随机抽验双序比例取合法区间（1–100）→ 通过。"""
    config = _default_config()
    assert config.pairwise_settings is not None
    config.pairwise_settings.dual_order = DUAL_SAMPLED
    config.pairwise_settings.dual_order_ratio = 30
    config.validate()


def test_config_roundtrip_preserves_fields() -> None:
    """to_json → from_json 往返后逐字段相等（含人工设置与双序比例）。"""
    config = _default_config()
    config.human.random_enabled = True
    config.human.random_count = 20
    config.human.dimension_manual = True
    assert config.pairwise_settings is not None
    config.pairwise_settings.dual_order = DUAL_SAMPLED
    config.pairwise_settings.dual_order_ratio = 30
    config.pairwise_settings.limit = 500
    config.dataset_source = "DOCCI"
    config.dataset_license = "CC BY 4.0"
    assert EvalBatchConfig.from_json(config.to_json()) == config


@pytest.mark.parametrize(
    "payload",
    ['{"candidates": "x"}', '{"candidates": [1], "benchmark": true}', "[]", "{}"],
)
def test_config_from_json_rejects_bad_shapes(payload: str) -> None:
    """落盘 JSON 形状不对（类型错 / 缺字段）→ 按损坏报（EvalConfigCorruptedError）。"""
    with pytest.raises(EvalConfigCorruptedError, match="损坏"):
        EvalBatchConfig.from_json(json.loads(payload))


# --------------------------------------------------------------------------
# 打分批次生命周期
# --------------------------------------------------------------------------


def test_create_registers_entry_and_config(seeded: tuple[Path, str, list[int]]) -> None:
    """建批：state 落条目（名称规整 / 序号 / 时间）、e1/config.json 落配置全文。"""
    workdir, judge_id, _ = seeded
    entry = create_eval_batch(
        workdir,
        name=" 第一评 ",
        description="选型",
        config=_default_config(judges=[judge_id]),
    )
    assert entry.seq == 1
    assert entry.name == "第一评"
    assert entry.created_at
    raw = (workdir / ".dsf" / "eval" / "state.json").read_text(encoding="utf-8")
    assert '"name": "第一评"' in raw
    stored = read_eval_config(workdir, 1)
    assert stored.judges == [judge_id]
    assert stored.human.random_enabled is False
    assert (workdir / ".dsf" / "eval" / "e1" / "config.json").is_file()


def test_create_on_bare_workdir_builds_layout(
    seeded: tuple[Path, str, list[int]],
) -> None:
    """空工作目录（无 .dsf）上首个 eval 操作顺带建齐目录结构。"""
    workdir, judge_id, _ = seeded
    create_eval_batch(
        workdir,
        name="第一评",
        description="",
        config=_default_config(judges=[judge_id]),
    )
    assert (workdir / ".dsf" / "eval" / "runs").is_dir()
    assert (workdir / ".dsf" / "eval" / "reports").is_dir()


def test_create_rejects_unknown_candidate(seeded: tuple[Path, str, list[int]]) -> None:
    """被测批次不存在 → EvalConfigError 聚合报「被测批次不存在」。"""
    workdir, judge_id, _ = seeded
    with pytest.raises(EvalConfigError, match="被测批次不存在"):
        create_eval_batch(
            workdir,
            name="坏配置",
            description="",
            config=_default_config(judges=[judge_id], candidates=[99]),
        )
    assert list_eval_batches(workdir) == []


def test_create_rejects_unknown_judge(seeded: tuple[Path, str, list[int]]) -> None:
    """裁判策略不在库里 → 创建即报（带病运行不如早报）。"""
    workdir, _, _ = seeded
    with pytest.raises(EvalConfigError, match="不在策略库中"):
        create_eval_batch(
            workdir,
            name="坏配置",
            description="",
            config=_default_config(judges=["ghost"]),
        )


def test_create_rejects_broken_judge(seeded: tuple[Path, str, list[int]]) -> None:
    """裁判策略被删后再建打分批次 → 引用校验拦下。"""
    workdir, judge_id, _ = seeded
    delete_strategy(judge_id)
    with pytest.raises(EvalConfigError, match="不在策略库中"):
        create_eval_batch(
            workdir,
            name="坏配置",
            description="",
            config=_default_config(judges=[judge_id]),
        )


@pytest.mark.parametrize("name", ["", "   "])
def test_create_rejects_blank_name(
    seeded: tuple[Path, str, list[int]], name: str
) -> None:
    """空白名 → EvalConfigError。"""
    workdir, judge_id, _ = seeded
    with pytest.raises(EvalConfigError, match="不能为空"):
        create_eval_batch(
            workdir,
            name=name,
            description="",
            config=_default_config(judges=[judge_id]),
        )


def test_update_eval_batch_renames_only(seeded: tuple[Path, str, list[int]]) -> None:
    """改名只动 state 条目；配置原样。"""
    workdir, judge_id, _ = seeded
    create_eval_batch(
        workdir,
        name="第一评",
        description="旧述",
        config=_default_config(judges=[judge_id]),
    )
    updated = update_eval_batch(workdir, 1, name="新名", description="新述")
    assert updated.name == "新名"
    assert updated.description == "新述"
    assert read_eval_config(workdir, 1).judges == [judge_id]


def test_update_eval_config_replaces_and_rejects(
    seeded: tuple[Path, str, list[int]],
) -> None:
    """改配置全量替换生效；引用不合法的替换被拒且旧配置保持原样。"""
    workdir, judge_id, _ = seeded
    create_eval_batch(
        workdir,
        name="第一评",
        description="",
        config=_default_config(judges=[judge_id]),
    )
    replaced = _default_config(judges=[judge_id], candidates=[1, 2])
    assert update_eval_config(workdir, 1, replaced).candidates == [1, 2]
    assert read_eval_config(workdir, 1).candidates == [1, 2]
    broken = _default_config(judges=[judge_id], candidates=[99])
    with pytest.raises(EvalConfigError, match="不存在"):
        update_eval_config(workdir, 1, broken)
    assert read_eval_config(workdir, 1).candidates == [1, 2]


def test_read_eval_config_missing_file_raises_corrupted(
    seeded: tuple[Path, str, list[int]],
) -> None:
    """条目在而配置文件被外部删走 → 按损坏报（EvalConfigCorruptedError）。"""
    workdir, judge_id, _ = seeded
    create_eval_batch(
        workdir,
        name="第一评",
        description="",
        config=_default_config(judges=[judge_id]),
    )
    (workdir / ".dsf" / "eval" / "e1" / "config.json").unlink()
    with pytest.raises(EvalConfigCorruptedError):
        read_eval_config(workdir, 1)


def test_delete_removes_owned_runs_and_reports(
    seeded: tuple[Path, str, list[int]],
) -> None:
    """删除只清本批次的配置/运行/报告（移入可恢复暂存），人工打分与他批不动。"""
    workdir, judge_id, _ = seeded
    create_eval_batch(
        workdir,
        name="第一评",
        description="",
        config=_default_config(judges=[judge_id]),
    )
    create_eval_batch(
        workdir,
        name="第二评",
        description="",
        config=_default_config(judges=[judge_id], candidates=[2]),
    )
    runs = workdir / ".dsf" / "eval" / "runs"
    own_run = runs / "20261026T000000Z"
    other_run = runs / "20261026T000001Z"
    own_run.mkdir()
    other_run.mkdir()
    (own_run / "run.json").write_text(json.dumps({"batch": "e1"}), encoding="utf-8")
    (other_run / "run.json").write_text(json.dumps({"batch": "e2"}), encoding="utf-8")
    reports = workdir / ".dsf" / "eval" / "reports"
    (reports / "r1.json").write_text(json.dumps({"batch": "e1"}), encoding="utf-8")
    (reports / "r2.json").write_text(json.dumps({"batch": "e2"}), encoding="utf-8")
    manual = workdir / ".dsf" / "eval" / "manual-scores.jsonl"
    manual.write_text('{"stem": "cat_001"}\n', encoding="utf-8")

    result = delete_eval_batch(workdir, 1)

    assert result.runs_removed == 1
    assert result.reports_removed == 1
    assert not own_run.exists()
    assert not (reports / "r1.json").exists()
    assert other_run.exists()
    assert (reports / "r2.json").exists()
    assert manual.exists()
    assert not (workdir / ".dsf" / "eval" / "e1").exists()
    assert [item.seq for item in list_eval_batches(workdir)] == [2]
    trash = workdir / ".dsf" / "trash"
    assert any(path.name == "run.json" for path in trash.rglob("run.json"))


def test_delete_missing_raises(seeded: tuple[Path, str, list[int]]) -> None:
    """删不存在的打分批次 → EvalBatchNotFoundError。"""
    workdir, _, _ = seeded
    with pytest.raises(EvalBatchNotFoundError):
        delete_eval_batch(workdir, 3)


def test_seq_only_increases_after_delete(seeded: tuple[Path, str, list[int]]) -> None:
    """删掉最后一个批次后再建 → 拿新序号、不复用已用号。"""
    workdir, judge_id, _ = seeded
    create_eval_batch(
        workdir,
        name="第一评",
        description="",
        config=_default_config(judges=[judge_id]),
    )
    delete_eval_batch(workdir, 1)
    entry = create_eval_batch(
        workdir, name="再来", description="", config=_default_config(judges=[judge_id])
    )
    assert entry.seq == 2


def test_parallel_create_gets_distinct_seqs(
    seeded: tuple[Path, str, list[int]],
) -> None:
    """Web 与 CLI 并发建批：状态锁内预占序号，两线程拿到不同号。"""
    workdir, judge_id, _ = seeded
    config = _default_config(judges=[judge_id])
    results: list[int] = []
    barrier = threading.Barrier(2)

    def _create() -> None:
        barrier.wait()
        entry = create_eval_batch(workdir, name="并发", description="", config=config)
        results.append(entry.seq)

    threads = [threading.Thread(target=_create) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert sorted(results) == [1, 2]


def test_get_missing_raises(seeded: tuple[Path, str, list[int]]) -> None:
    """查不存在的打分批次 → EvalBatchNotFoundError。"""
    workdir, _, _ = seeded
    with pytest.raises(EvalBatchNotFoundError):
        get_eval_batch(workdir, 9)


# --------------------------------------------------------------------------
# 独立锁与基准位
# --------------------------------------------------------------------------


def test_eval_state_lives_beside_labeling_state(
    seeded: tuple[Path, str, list[int]],
) -> None:
    """eval 状态独立成目录：与打标 state 并存互不覆盖、各有完整清单。"""
    workdir, judge_id, _ = seeded
    create_eval_batch(
        workdir,
        name="第一评",
        description="",
        config=_default_config(judges=[judge_id]),
    )
    assert (workdir / ".dsf" / "eval" / "state.json").is_file()
    assert (workdir / ".dsf" / "eval" / "state.lock").is_file()
    assert (workdir / ".dsf" / "state.json").is_file()
    assert [entry.seq for entry in list_batches(workdir)] == [1, 2]
    assert [entry.seq for entry in list_eval_batches(workdir)] == [1]


def test_set_batch_benchmark_roundtrip(workdir: Path, assets: None) -> None:
    """基准位置位/复位往返；state 落 benchmark 键。"""
    create_batch(
        workdir,
        name="甲",
        description="",
        endpoint_id="main",
        prompt_id="详细描述",
        skill_ids=[],
    )
    entry = set_batch_benchmark(workdir, 1, True)
    assert entry.benchmark is True
    raw = (workdir / ".dsf" / "state.json").read_text(encoding="utf-8")
    assert '"benchmark": true' in raw
    assert set_batch_benchmark(workdir, 1, False).benchmark is False


def test_legacy_state_without_benchmark_reads_false(workdir: Path) -> None:
    """旧 state（无 benchmark 键）读出 False——向后兼容不逼迁移。"""
    dsf = workdir / ".dsf"
    (dsf / "strategies").mkdir(parents=True)
    (dsf / "state.json").write_text(
        json.dumps(
            {
                "batches": [
                    {
                        "seq": 1,
                        "name": "旧批",
                        "description": "",
                        "snapshot": "s1.json",
                        "active": True,
                        "created_at": "2026-01-01T00:00:00Z",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    assert list_batches(workdir)[0].benchmark is False
