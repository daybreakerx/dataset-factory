"""评测（打分批次）命令入口：批次 CRUD、前台打分、人工打分与报告。

取舍沿 CLI 既有四条：路径参数不用 wid、危险命令（rm）默认确认＋``--yes``、
非交互缺 ``--yes`` 报用法错（退出码 2）、长任务（run）前台同步——进度与事件
打 stderr、最终报告打 stdout，Ctrl-C 协作停止（当前调用在安全点收尾后出
中断报告）。配置类入参走 ``--json`` 直传（与「外部 agent 可编排」的产品定位
一致），交互式表单不设。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, cast

import typer

from ..eval import (
    RUN_STATUS_INTERRUPTED,
    EvalBatchConfig,
    EvalError,
    EvalRunner,
    append_manual_score,
    create_eval_batch,
    delete_eval_batch,
    get_eval_batch,
    latest_eval_run_dir,
    latest_manual_scores,
    list_eval_batches,
    list_reports,
    parse_seq,
    read_eval_config,
    read_report,
    update_eval_batch,
    update_eval_config,
)
from ..eval.report import build_report
from ..strategies import list_batches
from ..workdir import WorkdirNotFoundError
from .errors import handle_domain_errors
from .operations import (
    cancellation,
    confirm_or_abort,
    print_result,
    registered_root,
)
from .workdir import registered_id

app = typer.Typer(help="评测（打分批次）", no_args_is_help=True)
report_app = typer.Typer(help="报告快照", no_args_is_help=True)
app.add_typer(report_app, name="report")


def _eval_location(path: Path, eval_batch: str) -> tuple[Path, int]:
    """解析已登记目录与打分批次（eN），读写前统一确认存在。"""
    root = registered_root(registered_id(path))
    seq = parse_seq(eval_batch)
    get_eval_batch(root, seq)
    return root, seq


def _config_from_json(raw: str) -> EvalBatchConfig:
    """--json 直传的配置 → 域配置对象（JSON 语法错与形状错都按用法错误处理）。

    ``EvalBatchConfig.from_json`` 抛的是 ``EvalConfigCorruptedError``（不是
    ``ValueError``）——这里必须一起接住，否则坏形状会甩原始栈而不是用法错误。
    """
    try:
        data: object = json.loads(raw)
        return EvalBatchConfig.from_json(data)
    except (ValueError, EvalError) as exc:
        raise typer.BadParameter(f"评测配置 JSON 不合法：{exc}") from exc


@app.command("add")
@handle_domain_errors
def add(
    path: Path,
    name: Annotated[str, typer.Option("--name", help="打分批次显示名")],
    config: Annotated[
        str, typer.Option("--json", help="评测配置 JSON（与 .dsf/eval 配置同形）")
    ],
    description: Annotated[str, typer.Option("--description", help="说明文字")] = "",
) -> None:
    """新建打分批次（配置以 JSON 直传，保存时全量校验）。"""
    root = registered_root(registered_id(path))
    entry = create_eval_batch(
        root,
        name=name,
        description=description,
        config=_config_from_json(config),
    )
    print_result({"seq": entry.seq, "id": f"e{entry.seq}", "name": entry.name})


@app.command("list")
@handle_domain_errors
def list_all(path: Path) -> None:
    """列出目录全部打分批次（含配置摘要与被测批次名）。"""
    root = registered_root(registered_id(path))
    batches = {entry.seq: entry.name for entry in list_batches(root)}
    rows: list[dict[str, object]] = []
    for entry in list_eval_batches(root):
        config = read_eval_config(root, entry.seq)
        rows.append(
            {
                "seq": entry.seq,
                "id": f"e{entry.seq}",
                "name": entry.name,
                "candidates": [
                    batches.get(seq, f"s{seq}") for seq in config.candidates
                ],
                "judges": len(config.judges),
                "created_at": entry.created_at,
            }
        )
    print_result(rows)


@app.command("show")
@handle_domain_errors
def show(path: Path, eval_batch: Annotated[str, typer.Argument(help="eN")]) -> None:
    """打分批次详情（元数据＋配置全文）。"""
    root, seq = _eval_location(path, eval_batch)
    entry = get_eval_batch(root, seq)
    print_result(
        {
            "seq": entry.seq,
            "id": f"e{entry.seq}",
            "name": entry.name,
            "description": entry.description,
            "created_at": entry.created_at,
            "config": read_eval_config(root, seq).to_json(),
        }
    )


@app.command("edit")
@handle_domain_errors
def edit(
    path: Path,
    eval_batch: Annotated[str, typer.Argument(help="eN")],
    name: Annotated[str | None, typer.Option("--name", help="改名")] = None,
    description: Annotated[
        str | None, typer.Option("--description", help="改描述")
    ] = None,
    config: Annotated[
        str | None,
        typer.Option("--json", help="评测配置 JSON（全量替换，改了重跑即重算）"),
    ] = None,
) -> None:
    """改名称／描述／评测配置（至少给一项；配置全量替换）。"""
    if name is None and description is None and config is None:
        raise typer.BadParameter("至少提供 --name、--description 或 --json 之一。")
    root, seq = _eval_location(path, eval_batch)
    if config is not None:
        update_eval_config(root, seq, _config_from_json(config))
    if name is not None or description is not None:
        update_eval_batch(root, seq, name=name, description=description)
    show(path, eval_batch)


@app.command("rm")
@handle_domain_errors
def remove(
    path: Path,
    eval_batch: Annotated[str, typer.Argument(help="eN")],
    yes: Annotated[bool, typer.Option("--yes", help="跳过确认")] = False,
) -> None:
    """删除打分批次（配置＋运行记录＋报告快照入可恢复暂存；人工打分保留）。"""
    root, seq = _eval_location(path, eval_batch)
    confirm_or_abort(
        f"将删除打分批次 e{seq} 的配置、运行记录与报告快照（人工打分保留），继续？",
        yes,
    )
    result = delete_eval_batch(root, seq)
    print_result(
        {
            "removed": True,
            "runs_removed": result.runs_removed,
            "reports_removed": result.reports_removed,
        }
    )


@app.command("run")
@handle_domain_errors
def run(
    path: Path,
    eval_batch: Annotated[str, typer.Argument(help="eN")],
) -> None:
    """前台执行打分（Ctrl-C 等当前调用安全收尾并输出中断报告）。"""
    root, seq = _eval_location(path, eval_batch)
    runner = EvalRunner(root, seq, trigger="cli")

    def progress(event: object) -> None:
        kind = getattr(event, "kind", "")
        if kind == "item-updated":
            typer.echo(
                f"[{getattr(event, 'phase', '')}] {getattr(event, 'item', '')}"
                f"（{getattr(event, 'judge', '')}）：{getattr(event, 'status', '')}",
                err=True,
            )

    runner.subscribe(progress)
    with cancellation(runner.stop) as stop:
        report = runner.run()
    print_result(
        {"run_id": report.run_id, "status": report.status, "counters": report.counters}
    )
    # 退出码与打标跑批同一口径：被中止照常出中断报告但取 130；有条目失败取 1，
    # 让脚本按退出码判定这次打分是否全绿（报告本身照样在 stdout）。
    if stop.is_set() or report.status == RUN_STATUS_INTERRUPTED:
        raise typer.Exit(130)
    if report.counters.get("failed", 0):
        raise typer.Exit(1)


@app.command("status")
@handle_domain_errors
def status(
    path: Path,
    eval_batch: Annotated[str, typer.Argument(help="eN")],
) -> None:
    """读最近一次打分运行的状态（run.json 快照；运行中的活锁另注一行）。"""
    from ..eval.store import EvalStore

    root, seq = _eval_location(path, eval_batch)
    runs_dir = EvalStore(root).runs_dir
    if not runs_dir.is_dir():
        print_result(None)
        return
    # 一次读盘：挑选与输出共用同一份解析结果。损坏或读不出的 run.json 在挑选阶段
    # 就被跳过（与打标 status 同一容忍度），选中的记录不再二次读取——避免「刚选中
    # 就又被改坏」时甩原始栈。
    latest: dict[str, object] | None = None
    for directory in sorted(runs_dir.iterdir(), reverse=True):
        marker = directory / "run.json"
        if not marker.is_file():
            continue
        try:
            record: object = json.loads(marker.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            continue
        if (
            isinstance(record, dict)
            and cast("dict[str, object]", record).get("batch") == f"e{seq}"
        ):
            latest = cast("dict[str, object]", record)
            break
    print_result(latest)


@app.command("score")
@handle_domain_errors
def score(
    path: Path,
    eval_batch: Annotated[str, typer.Argument(help="eN")],
    record: Annotated[
        str,
        typer.Option(
            "--json",
            help="人工打分记录 JSON（kind/item/batch 或 a_batch+b_batch/annotator/scores 或 winner，reason 可选）",
        ),
    ],
) -> None:
    """追加一条人工打分（改分＝再提交一条，读取按每键最近一条）。"""
    root, _ = _eval_location(path, eval_batch)
    try:
        data: object = json.loads(record)
    except json.JSONDecodeError as exc:
        raise typer.BadParameter(f"人工打分记录 JSON 不合法：{exc}") from exc
    if not isinstance(data, dict):
        raise typer.BadParameter("人工打分记录必须是 JSON 对象。")
    stored = append_manual_score(root, cast("dict[str, object]", data))
    print_result(stored)


@app.command("scores")
@handle_domain_errors
def scores(
    path: Path,
    eval_batch: Annotated[str, typer.Argument(help="eN")],
    item: Annotated[str | None, typer.Option("--item", help="按素材主干过滤")] = None,
) -> None:
    """读当前有效的人工打分（每键最近一条）。"""
    root, _ = _eval_location(path, eval_batch)
    records = latest_manual_scores(root)
    if item is not None:
        records = [row for row in records if row.get("item") == item]
    print_result(records)


@report_app.command("list")
@handle_domain_errors
def report_list(
    path: Path,
    eval_batch: Annotated[str, typer.Argument(help="eN")],
) -> None:
    """报告快照列表（最新在前）。"""
    root, seq = _eval_location(path, eval_batch)
    print_result(list_reports(root, seq))


@report_app.command("show")
@handle_domain_errors
def report_show(
    path: Path,
    eval_batch: Annotated[str, typer.Argument(help="eN")],
    run_id: Annotated[
        str | None,
        typer.Option("--run-id", help="指定运行；缺省 = 最近一次并就地（重）聚合"),
    ] = None,
) -> None:
    """读报告全文；缺省从最近一次运行聚合（无快照即生成，历史可回看）。"""
    root, seq = _eval_location(path, eval_batch)
    if run_id is None:
        latest = latest_eval_run_dir(root, seq)
        if latest is None:
            raise WorkdirNotFoundError(
                "该打分批次还没有跑过打分——先 dsf eval run 一次。"
            )
        run_id = latest.name
        try:
            print_result(read_report(root, seq, run_id))
        except FileNotFoundError:
            print_result(build_report(root, seq, run_id))
        return
    print_result(read_report(root, seq, run_id))
