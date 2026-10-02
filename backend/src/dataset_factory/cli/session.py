"""会话命令：``dsf session list / show / remove``。

``list`` 默认列 CLI 会话（cli 来源不被 Web 的滚动删除清掉、只增不减，堆积靠手动
清理——ADR 2026-09-30「全局当前使用退役」）；``show`` 回放历史；``remove`` 删除
单个会话。恢复入口在 ``dsf chat``（缺省恢复当前策略最近一次 CLI 会话）与
``dsf label --session``。
"""

from __future__ import annotations

from typing import Annotated, Literal

import typer

from ..sessions import (
    delete_session,
    list_sessions,
    read_events,
    read_session_source,
)
from ..sessions.model import MessageEvent
from .errors import handle_domain_errors
from .operations import confirm_or_abort

app = typer.Typer(help="会话管理（list / show / remove）", no_args_is_help=True)


@app.command("list")
@handle_domain_errors
def session_list(
    source: Annotated[
        Literal["cli", "web", "all"],
        typer.Option("--source", help="按来源过滤：cli（默认）/ web / all"),
    ] = "cli",
) -> None:
    """列出会话 id（按创建时间正序；默认只列 CLI 会话）。"""
    sessions = [
        session_id
        for session_id in list_sessions()
        if source == "all" or read_session_source(session_id) == source
    ]
    if not sessions:
        typer.echo("（没有匹配的会话——dsf label / dsf chat 会自动创建）")
        return
    for session_id in sessions:
        typer.echo(session_id)


@app.command("show")
@handle_domain_errors
def session_show(
    session_id: Annotated[str, typer.Argument(help="会话 id")],
) -> None:
    """回放某会话的对话历史（user / assistant 消息 + 附件名）。"""
    events = read_events(session_id)
    messages = [
        event
        for event in events
        if isinstance(event, MessageEvent) and event.role in ("user", "assistant")
    ]
    if not messages:
        typer.echo("（该会话还没有对话消息）")
        return
    for event in messages:
        attachment = f"  [@{event.attachment}]" if event.attachment else ""
        typer.echo(f"{event.role}: {event.text}{attachment}")


@app.command("remove")
@handle_domain_errors
def session_remove(
    session_id: Annotated[str, typer.Argument(help="会话 id")],
    yes: Annotated[bool, typer.Option("--yes", "-y", help="跳过删除确认")] = False,
) -> None:
    """删除一个会话（整个目录：事件流 + 附件 + 元数据）。"""
    confirm_or_abort(f"确认删除会话 {session_id!r}？", yes)
    delete_session(session_id)
    typer.secho(f"已删除会话 {session_id!r}", fg=typer.colors.GREEN)
