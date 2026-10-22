/** 跨页面共用的小类型与错误呈现分流。 */
import { ApiError, errorMessage } from "../api";
import { toast } from "./toast";

/**
 * 一次性操作反馈（成功 / 警告 / 错误提示）。
 *
 * 设置页的三个面板与提示词工作台都是「做一件事、给一条反馈、下一次操作覆盖它」，
 * 形状原本各抄一份；文案变体（如 `Alert` 的 variant 怎么映射）留给调用点，
 * 因为那是渲染差异，不在这里统一。
 */
export interface Feedback {
  /** warn＝操作成功但结果带瑕疵、要用户知情（如坏包以损坏行入库）。 */
  kind: "success" | "warn" | "error";
  text: string;
  /** 字段级标记：后端指认 text 属于哪个输入字段（如 name）时带上，供调用点把
   *  字段级错误精确挂到输入框（aria-invalid）；操作级错误不带。 */
  field?: string;
}

/**
 * 把一处失败分流成「就地展示」或「浮层提示」，返回需要就地展示的文字（浮层则返回 null）。
 *
 * 判据是这条信息要不要用户当场处理：连不上后端与等超时是**环境状态**——侧栏的服务状态点
 * 已经常驻表达它，页面上再铺一块红色提示条等于把临时状态焊在界面里，重新挂载一次还会再
 * 冒出来（2026-09-20 用户要求：不占界面位置，改用浮层提醒）。后端返回的业务错误（校验
 * 不通过、重名、并发冲突）是这一次操作的后果，用户要照着它改，必须留在原地。
 *
 * @param err - 捕获到的未知异常。
 * @returns 就地展示用的错误文字；已改由浮层提示时为 null。
 */
export function reportError(err: unknown): string | null {
  if (err instanceof ApiError && (err.kind === "network" || err.kind === "timeout")) {
    toast(errorMessage(err));
    // 既然连不上，侧栏那个点报的「运行中」当场就不成立了——广播一次让它重查（服务被脚本
    // 杀掉时页面收不到任何别的通知，这是唯一一条即时通路）。
    window.dispatchEvent(new Event("df:service-changed"));
    return null;
  }
  return errorMessage(err);
}

/**
 * 从捕获到的异常里取字段级标记（后端 problem+json 的 field 扩展字段）。
 *
 * 与 {@link reportError} 配套使用：reportError 给「就地文案」，本函数给「这句文案
 * 属于哪个字段」。后端未指认字段（操作级错误）或非 HTTP 异常时返回 null。
 *
 * @param err - 捕获到的未知异常。
 * @returns 字段名（如 name）；无标记时 null。
 */
export function errorField(err: unknown): string | null {
  return err instanceof ApiError ? err.field : null;
}
