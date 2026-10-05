"""Skill 的数据模型 + SKILL.md frontmatter 解析（agentskills.io 开放标准）。

Skill 包按 agentskills.io 标准落盘（`<name>/SKILL.md` + references/ 等），本模块只**读**它的
frontmatter 取 name + description（外部标准，宽容多余字段如 license / metadata，但 name 与
description 必填、缺失即 fail loud）；skill 目录整体原样保存，不改写。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, cast

import yaml

from .errors import SkillFormatError

_DELIMITER = "---"


class _StrScalarsLoader(yaml.SafeLoader):
    """标量一律读成字符串的 SafeLoader。

    清掉非 str 的隐式解析器（YAML 1.1 会把 ``yes`` 读成布尔、纯数字读成 int、ISO 形态
    读成日期），保留 str 与 merge 的隐式解析、显式 ``!!`` 标签与 SafeLoader 的全部安全
    限制——agentskills.io 的 name 规则允许 ``yes`` 这类词，按字符串解析才贴合外部标准
    （2026-09-30 用户裁「连解析语义一起放宽，按你推荐」）。
    """


_StrScalarsLoader.yaml_implicit_resolvers = {
    prefix: [
        (tag, regexp)
        for tag, regexp in resolvers
        if tag in ("tag:yaml.org,2002:str", "tag:yaml.org,2002:merge")
    ]
    for prefix, resolvers in yaml.SafeLoader.yaml_implicit_resolvers.items()
}


@dataclass(frozen=True)
class Skill:
    """一个已导入的 skill。

    Attributes:
        name: 显示名（取自 SKILL.md frontmatter；可改、允许重名）。
        description: 用途说明（取自 frontmatter，供选择器展示）。
        enabled: 库级启用状态；停用的 skill 保留在库里、但不供打标注入（停用不删除）。
        body_chars: 注入全文字符数（SKILL.md + references/ 全部文件，即打标请求的实际
            注入量；列表展示用。非列表路径构造时可为 0）。
        id: 内部稳定 ID（= 库里的目录名，创建时分配、不随改名变化；2026-09-23 ID 化）。
        damage_kind: 损坏分类（健康包为 None），取值见 ``SkillDamageKind``。
        damage_file: 损坏涉及的包内相对路径（如 ``references/h3.md``）；健康包为空串。
    """

    name: str
    description: str
    enabled: bool
    body_chars: int = 0
    id: str = ""
    damage_kind: SkillDamageKind | None = None
    damage_file: str = ""


@dataclass(frozen=True)
class SkillImport:
    """一次导入的结果。

    Attributes:
        skill: 导入后的 skill（默认启用）。
        total_bytes: 整包字节数，供入口层给「体积提示」（skill 全量注入、不设字节上限）。
        transcoded: 导入时把非 UTF-8 文本文件转码成 UTF-8 的清单（包内相对路径 →
            探测出的原编码）；未发生转码为空表（2026-09-30 用户裁「导入时归一化」）。
        import_error: 包以「损坏行」入库时的损坏原因（frontmatter 解析不过——2026-10-01
            用户裁「直接入库＋警告反馈条」，frontmatter 坏不再拒导入）；正常导入为 None。
    """

    skill: Skill
    total_bytes: int
    transcoded: list[tuple[str, str]] = field(
        default_factory=lambda: list[tuple[str, str]]()
    )
    import_error: str | None = None


# 包内文件角色：skill / reference 均为注入源（SKILL.md 正文 + references/ 全部文件）；
# asset / script=包资产与脚本；other=其他文件。除前两者外均不参与注入。
SkillFileRole = Literal["skill", "reference", "asset", "script", "other"]

# 损坏分类（2026-10-01 随「损坏行两档」裁进契约）：frontmatter-corrupt＝frontmatter
# 解析不过（可修复档——详情里改名称/描述保存即自愈）；not-utf8＝包内文本不是合法
# UTF-8（不可修复档——去磁盘另存）；assembly-failed＝包体组装失败等其他损坏（不可修复）。
SkillDamageKind = Literal["frontmatter-corrupt", "not-utf8", "assembly-failed"]


@dataclass(frozen=True)
class SkillFileEntry:
    """技能包内一个文件的条目（包内容预览用）。

    Attributes:
        path: 包内相对路径（POSIX 风格，如 ``SKILL.md``、``references/h3.md``）。
        role: 文件角色（见 SkillFileRole）。
        previewable: 是否可通过 read_skill_file 预览内容——仅 SKILL.md 与 references/
            下文件开放（注入范围成文见 design「技能双栏模式」）。
    """

    path: str
    role: SkillFileRole
    previewable: bool


def parse_skill_frontmatter(text: str) -> tuple[str, str]:
    """从 SKILL.md 全文解析 frontmatter 的 name 与 description。

    agentskills.io 要求 SKILL.md 以 YAML frontmatter 开头、含 name 与 description；其余字段
    （license / metadata 等）宽容忽略。与本项目自有的提示词格式相反：这里是**外部标准**，
    多余字段合法、不报错，但缺 name / description 即 fail loud。

    Args:
        text: SKILL.md 全文。

    Returns:
        (name, description) 两个字符串。

    Raises:
        SkillFormatError: 缺 frontmatter / 未闭合 / 非法 YAML / 顶层非映射 / 缺 name 或 description。
    """
    # 入口先归一化两处 Windows 常见形状（实锤：WorkBuddy 生态的包是 CRLF——2026-09-13
    # 用户实机导入被误报「缺少 frontmatter」）：UTF-8 BOM 与 \r\n / \r 行尾。frontmatter
    # 是否存在的判定与分隔符比较只在归一化后的文本上做；分隔行按 strip() 口径（首行 /
    # 结束行带尾随空格不再误报「未闭合」——与写侧同一把尺，2026-09-30 用户裁统一）。
    normalized = text.lstrip(chr(0xFEFF)).replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized.split("\n")
    if not lines or lines[0].strip() != _DELIMITER:
        raise SkillFormatError(
            f"SKILL.md 缺少 YAML frontmatter（应以单独一行 {_DELIMITER} 开头）；"
            "不是合法的 agentskills.io skill 包。"
        )
    end = next(
        (i for i in range(1, len(lines)) if lines[i].strip() == _DELIMITER), None
    )
    if end is None:
        raise SkillFormatError(
            "SKILL.md 的 frontmatter 未闭合（开头有 ---，但找不到结束的 ---）。"
        )
    front_text = "\n".join(lines[1:end])
    try:
        loaded: object = yaml.load(  # pyright: ignore[reportUnknownMemberType]
            front_text,
            Loader=_StrScalarsLoader,  # noqa: S506 -- SafeLoader 子类，仅去掉标量隐式解析、未放开任何构造器
        )
    except yaml.YAMLError as exc:
        raise SkillFormatError(
            "SKILL.md 的 frontmatter 不是合法 YAML；请检查语法。"
        ) from exc
    if not isinstance(loaded, dict):
        raise SkillFormatError(
            "SKILL.md 的 frontmatter 顶层应是键值映射（含 name / description）。"
        )
    meta = cast(dict[object, object], loaded)
    name = meta.get("name")
    if not isinstance(name, str) or not name.strip():
        raise SkillFormatError("SKILL.md 的 frontmatter 缺少非空的 name 字段。")
    description = meta.get("description")
    if not isinstance(description, str):
        raise SkillFormatError(
            "SKILL.md 的 frontmatter 缺少 description 字段（应为字符串）。"
        )
    return name, description
