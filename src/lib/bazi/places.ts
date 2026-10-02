/**
 * 出生地查询。
 *
 * 数据在 regions.ts（34 省 / 344 市 / 3291 区县），本文件只负责查。
 *
 * 为什么县不单独存经度：同一地级市内各点的经度差通常不足 1°，合 4 分钟；
 * 而时辰的边界是两小时。县级精度对判柱没有意义，列出来只是为了让人认得出自己的家。
 *
 * 查不到就返回 undefined，让调用方**跳过**真太阳时校正 —— 绝不拿一个默认经度硬算，
 * 那会把"没算"伪装成"算过了"，比不校正更糟。
 */

import { APPROXIMATED, REGIONS, type RegionCity, type RegionProvince } from "./regions.ts";

export { REGIONS, APPROXIMATED };
export type { RegionCity, RegionProvince };

export const PROVINCE_NAMES: readonly string[] = REGIONS.map((p) => p.n);

function findProvince(name: string | undefined): RegionProvince | undefined {
  if (!name) return undefined;
  return REGIONS.find((p) => p.n === name);
}

/** 某省下辖的市。省名不存在时返回空数组。 */
export function citiesOf(province: string | undefined): readonly RegionCity[] {
  return findProvince(province)?.c ?? [];
}

/** 某市下辖的区县。 */
export function countiesOf(province: string | undefined, city: string | undefined): readonly string[] {
  if (!city) return [];
  return citiesOf(province).find((c) => c.n === city)?.d ?? [];
}

/** 某市的经度（东经正数）。查不到返回 undefined。 */
export function longitudeOfCity(
  province: string | undefined,
  city: string | undefined
): number | undefined {
  if (!city) return undefined;
  return citiesOf(province).find((c) => c.n === city)?.g;
}

/** 该市的经度是否为"省内中位数"估值而非实测 —— 界面上要如实标出来。 */
export function isApproximate(city: string | undefined): boolean {
  if (!city) return false;
  return APPROXIMATED.includes(city);
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
