/**
 * 表单里共用的下拉选项。
 *
 * 曾经这里还有一份十二时辰的 TIME_OPTIONS。出生时刻改成精确到分钟的输入之后，
 * 那份表就废了 —— 用户填 09:37，时柱由排盘逻辑自己落到巳时，
 * 不必先让他从十二个格子里挑一个，再把这层信息折算回时间。
 */

export interface Choice {
  value: string;
  label: string;
}

export const GENDER_OPTIONS: readonly Choice[] = [
  { value: "男", label: "男" },
  { value: "女", label: "女" },
];
