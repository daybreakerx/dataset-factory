import { useEffect, useState } from "react";

/**
 * 订阅 CSS 媒体查询的匹配状态。
 *
 * 断点驱动的壳层形态（如窄桌面侧栏自动收起）用它合成视图态——不落 localStorage，
 * 不覆盖用户的手动偏好：进入/离开区间即时生效，离开后恢复用户上一次的意愿。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent): void => {
      setMatches(event.matches);
    };
    // query 变化时先对齐一次现值（首帧后 query 不变时无操作）。
    setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => {
      mql.removeEventListener("change", onChange);
    };
  }, [query]);

  return matches;
}
