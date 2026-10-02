/**
 * 经度是「省内中位数」估值、而非实测的市。
 *
 * 这两份坐标数据源（NGA GNS 与 GeoNames）都查不到它们，所以退用了所在省的中位数。
 * 误差在 1° 以内（合 4 分钟上下），远小于一个时辰，对判柱没有影响 ——
 * 但如实记着，免得将来有人以为它们是实测值，界面上也会标出来。
 *
 * **刻意与 regions.ts 分开。** 那份数据有 60KB，是要按需加载的；
 * 而这份名单在首屏就知道要不要用得上（用户选了城市就得判断），
 * 绑在一起会让整个 regions 被拽回首屏包。
 */

export const APPROXIMATED: readonly string[] = [
  "三沙市",
  "海北藏族自治州",
  "省直辖县级市",
];

/** 该市的经度是否为估值。 */
export function isApproximate(city: string | undefined): boolean {
  if (!city) return false;
  return APPROXIMATED.includes(city);
}
