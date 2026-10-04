/** 设置页两面板对壳层暴露的未保存处理接口（dirty 语义改写＋切页确认弹窗）。
 *
 * 住在 lib 而不是面板文件：App / page-viewport（壳层）也要引用这个类型，而壳层条
 * 禁止 import 页面目录深层文件（.dependency-cruiser.cjs）。
 */

/** 壳层未保存确认弹窗「保存修改／放弃修改」两路调用的面板接口。 */
export type PanelUnsavedActions = {
  /** 保存当前面板的未保存修改；业务错误随返回（环境类 error 为空串、浮层已承接）。 */
  save: () => Promise<{ ok: boolean; error: string }>;
  /** 回退未保存修改（详情回填落盘值）。 */
  revert: () => void;
};
