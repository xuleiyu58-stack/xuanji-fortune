/**
 * 出生地查询 —— **服务端专用**。
 *
 * 数据在 regions.ts（34 省 / 344 市 / 3291 区县），本文件把它包成几个顺手的查询函数。
 *
 * ⚠️ 本模块**静态**引用了那份 60KB 的数据，只该在服务端用（排盘要把城市换算成经度）。
 * 浏览器端不要 import 它 —— 那会把整份区划表拽进首屏包。前端请自己
 * `await import("@/lib/bazi/regions")` 按需取，再用 regions.ts 里那几个
 * 「把数据当参数传」的纯函数（citiesIn / countiesIn / cityLongitude）查询。
 *
 * 查不到就返回 undefined，让调用方**跳过**真太阳时校正 —— 绝不拿一个默认经度硬算，
 * 那会把"没算"伪装成"算过了"，比不校正更糟。
 */

import { APPROXIMATED, isApproximate } from "./approximated.ts";
import {
  REGIONS, citiesIn, cityLongitude, countiesIn,
  type RegionCity, type RegionProvince,
} from "./regions.ts";

export { REGIONS, APPROXIMATED, isApproximate, citiesIn, countiesIn, cityLongitude };
export type { RegionCity, RegionProvince };

/** 区划表的原始数组。给需要"先定位、再取规范名"的调用方（如 index.ts）。 */
export const regions: readonly RegionProvince[] = REGIONS;

export const PROVINCE_NAMES: readonly string[] = REGIONS.map((p) => p.n);

/** 某省下辖的市。 */
export function citiesOf(province: string | undefined): readonly RegionCity[] {
  return citiesIn(REGIONS, province);
}

/** 某市下辖的区县。 */
export function countiesOf(province: string | undefined, city: string | undefined): readonly string[] {
  return countiesIn(REGIONS, province, city);
}

/** 某市的经度（东经正数）。查不到返回 undefined。 */
export function longitudeOfCity(
  province: string | undefined,
  city: string | undefined
): number | undefined {
  return cityLongitude(REGIONS, province, city);
}

/**
 * 按市名直接查经度，不指定省份。
 *
 * 给老的调用方式留的兼容口子（`BaziInput.place`），跨省重名时取第一个命中。
 * 新代码请用 `longitudeOfCity` —— 带上省名才不会在重名时取错。
 */
export function longitudeOf(name: string | undefined): number | undefined {
  if (!name) return undefined;
  const trimmed = name.trim();
  for (const p of REGIONS) {
    const hit = p.c.find((c) => c.n === trimmed);
    if (hit) return hit.g;
  }
  return undefined;
}
