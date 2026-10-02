"""sessions 数据域：会话持久化——events.jsonl 事件流 + attachments/ 图片副本 + meta.json 元数据（归属与来源；全项目只有本模块碰会话文件）。

对外接口：
- 事件模型与序列化：MessageEvent / EnvelopeEvent / SettingsEvent / SessionEvent / JsonValue /
  dump_event / parse_event（events.jsonl 磁盘格式的唯一事实来源）
- 会话生命周期：create_session（带归属与来源盖章）/ list_sessions / latest_session_id（恢复 =
  读最新目录回放）/ delete_session；归属桶：read_strategy_id / write_strategy_id（改挂）/
  sessions_for_strategy / latest_session_id_for（按桶查最近，可按来源过滤）/
  retain_latest_for（滚动保留，只清指定来源）；来源：read_session_source（web / cli）
- 事件读写：append_message / append_envelope / append_settings（append-only + fsync）/
  read_events（回放）
- 附件：save_attachment（源文件复制）/ save_attachment_bytes（直接存字节）
  / attachment_path（原名 + 序号重名不覆盖）
- 异常：SessionError 基类 + SessionIdError / SessionNotFoundError / SessionEventError
"""

from .errors import (
    SessionError,
    SessionEventError,
    SessionIdError,
    SessionNotFoundError,
)
from .model import (
    EnvelopeEvent,
    JsonValue,
    MessageEvent,
    SessionEvent,
    SettingsEvent,
    dump_event,
    parse_event,
)
from .store import (
    SessionSource,
    append_envelope,
    append_message,
    append_settings,
    attachment_path,
    create_session,
    delete_session,
    latest_session_id,
    latest_session_id_for,
    list_sessions,
    read_events,
    read_session_source,
    read_strategy_id,
    retain_latest_for,
    save_attachment,
    save_attachment_bytes,
    sessions_for_strategy,
    write_strategy_id,
)

__all__ = [
    "EnvelopeEvent",
    "JsonValue",
    "MessageEvent",
    "SessionError",
    "SessionEvent",
    "SessionEventError",
    "SessionIdError",
    "SessionNotFoundError",
    "SessionSource",
    "SettingsEvent",
    "append_envelope",
    "append_message",
    "append_settings",
    "attachment_path",
    "create_session",
    "delete_session",
    "dump_event",
    "latest_session_id",
    "latest_session_id_for",
    "list_sessions",
    "parse_event",
    "read_events",
    "read_session_source",
    "read_strategy_id",
    "retain_latest_for",
    "save_attachment",
    "save_attachment_bytes",
    "sessions_for_strategy",
    "write_strategy_id",
]
