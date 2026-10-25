"""eval 数据域的异常类型：只抛类型化异常，消息可操作、fail loud、不甩原始栈。

异常 → problem+json type slug 的对应关系写在本模块各类的 docstring 里
（映射落 api/app.py 的错误处理器）。
"""

from __future__ import annotations

from typing import Any


class EvalError(Exception):
    """评测域错误的基类；消息只描述「哪里错、怎么修」。"""


class EvalBatchNotFoundError(EvalError):
    """打分批次序号不存在（或 eN 格式不合法）——HTTP 404 problem+json（eval-batch-not-found）。"""


class EvalConfigError(EvalError):
    """打分批次配置不合法（规则校验或引用校验不过）——HTTP 400 problem+json（eval-config-invalid）。

    消息聚合全部问题（「；」连接）一次报完，不逐条打回。
    """


class EvalConfigCorruptedError(EvalError):
    """打分批次配置文件损坏（读不了或形状不对）——HTTP 409 problem+json（eval-config-corrupted）。

    与 EvalConfigError 分开：那边是用户输入不合法（改了再交），这边是盘上文件
    坏了（手修或重建打分批次）。
    """


class EvalRunOccupiedError(EvalError):
    """该工作目录已有打分（评测）运行在跑——HTTP 409 problem+json（eval-run-occupied）。"""

    def __init__(self, message: str, *, occupier: dict[str, Any] | None) -> None:
        """携占用者信息（进程号 / 启动时间），供 API 层挂到 problem 扩展字段。"""
        super().__init__(message)
        self.occupier = occupier


class EvalJudgeFormatError(EvalError):
    """judge 输出解析／校验不过——修复重试的信号与超限后的条目级失败原因。

    不直接映射 HTTP（运行层把它转成该条目的失败记录）；problems 携全部问题
    清单（修复重试的回喂消息与运行记录共用）。
    """

    def __init__(self, problems: list[str]) -> None:
        """携问题清单（每句一个可读问题）。"""
        super().__init__("；".join(problems))
        self.problems = problems
