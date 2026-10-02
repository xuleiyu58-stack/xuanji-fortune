/**
 * 出生地经度表。
 *
 * 只收省会与主要城市 —— 一个下拉框里塞几百个县，用户翻起来比不填还累。
 * 经度精确到小数点后两位，够算真太阳时了：1° 差 4 分钟，
 * 而同城内不同位置的经度差远小于 0.1°（约 24 秒），不影响判柱。
 *
 * 经度一律取东经正数。中国全境都在东经，无需处理西经。
 */

export interface Place {
  name: string;
  longitude: number;
}

/** 按拼音/常用顺序排列，方便在下拉框里找。 */
export const PLACES: readonly Place[] = [
  { name: "北京", longitude: 116.41 },
  { name: "上海", longitude: 121.47 },
  { name: "天津", longitude: 117.20 },
  { name: "重庆", longitude: 106.55 },
  { name: "哈尔滨", longitude: 126.53 },
  { name: "长春", longitude: 125.32 },
  { name: "沈阳", longitude: 123.43 },
  { name: "大连", longitude: 121.62 },
  { name: "呼和浩特", longitude: 111.75 },
  { name: "石家庄", longitude: 114.51 },
  { name: "太原", longitude: 112.55 },
  { name: "济南", longitude: 117.00 },
  { name: "青岛", longitude: 120.38 },
  { name: "郑州", longitude: 113.62 },
  { name: "西安", longitude: 108.95 },
  { name: "兰州", longitude: 103.83 },
  { name: "西宁", longitude: 101.78 },
  { name: "银川", longitude: 106.23 },
  { name: "乌鲁木齐", longitude: 87.62 },
  { name: "拉萨", longitude: 91.14 },
  { name: "南京", longitude: 118.78 },
  { name: "苏州", longitude: 120.58 },
  { name: "无锡", longitude: 120.30 },
  { name: "徐州", longitude: 117.18 },
  { name: "杭州", longitude: 120.15 },
  { name: "宁波", longitude: 121.55 },
  { name: "温州", longitude: 120.70 },
  { name: "合肥", longitude: 117.27 },
  { name: "福州", longitude: 119.30 },
  { name: "厦门", longitude: 118.09 },
  { name: "南昌", longitude: 115.89 },
  { name: "长沙", longitude: 112.94 },
  { name: "武汉", longitude: 114.30 },
  { name: "广州", longitude: 113.26 },
  { name: "深圳", longitude: 114.06 },
  { name: "东莞", longitude: 113.75 },
  { name: "佛山", longitude: 113.12 },
  { name: "南宁", longitude: 108.37 },
  { name: "海口", longitude: 110.20 },
  { name: "成都", longitude: 104.07 },
  { name: "绵阳", longitude: 104.68 },
  { name: "贵阳", longitude: 106.63 },
  { name: "昆明", longitude: 102.83 },
  { name: "香港", longitude: 114.17 },
  { name: "澳门", longitude: 113.55 },
  { name: "台北", longitude: 121.52 },
];

const BY_NAME = new Map(PLACES.map((p) => [p.name, p.longitude]));

/** 按城市名取经度。找不到返回 undefined —— 调用方据此跳过校正，而不是拿个默认值硬算。 */
export function longitudeOf(name: string | undefined): number | undefined {
  if (!name) return undefined;
  return BY_NAME.get(name.trim());
}

/** 供表单的下拉框使用。 */
export const PLACE_NAMES: readonly string[] = PLACES.map((p) => p.name);
