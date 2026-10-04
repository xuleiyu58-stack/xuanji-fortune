"use client";

import BirthInput from "./BirthInput";
import { LOCKED_SECTION_COUNT } from "@/lib/reading";
import { MEMBER_PLANS, formatPrice } from "@/lib/pricing";

/**
 * 出生信息表单 —— 首页和「改生辰重测」共用同一份。
 *
 * 为什么必须共用：这个表单里有阳历/农历两套字段、省市区三级联动、
 * 时辰不详的复选框。各写一套的话，下次加一个字段只会改到其中一处，
 * 另一处就悄悄少一个输入框 —— 而少的那处通常正是用户已经在看的那个页面。
 *
 * 关于 formId：结果页那个编辑面板在 <form> **外面**（它和命盘、解读并列，
 * 不在同一个表单流里），靠原生 `form` 属性把按钮和表单关联起来。
 * 关联之后浏览器仍然会跑 `required` 校验 —— 否则用户把日期删空再点，
 * 请求会带着空日期发出去，然后收到一句"信息不完整"，而问题明明就在眼前。
 */
export interface BirthFormProps {
  /** 草稿值。与已提交的值分开 —— 见 FortuneForm 里 draft 的说明 */
  value: Record<string, string>;
  onChange: (name: string, value: string) => void;
  onSubmit: () => void;
  loading: boolean;
  /** 已在编辑既有结果时，按钮下方不再重复说明"会消耗一次" */
  editing?: boolean;
  /** 已有权益：按钮说的是「开始解读」，下面不再放试读说明 */
  unlocked: boolean;
  member: boolean;
  /** 结果页那支有可见的标题，不需要重复表述 */
  heading?: string;
  /** 传了就渲染首页那支的大按钮，并用它关联表单 */
  formId?: string;
  onOpenPayment: () => void;
  onCancel?: () => void;
}

export default function BirthForm({
  value,
  onChange,
  onSubmit,
  loading,
  editing = false,
  unlocked,
  member,
  heading,
  formId,
  onOpenPayment,
  onCancel,
}: BirthFormProps) {
  return (
    <>
      {heading && (
        <p className="text-gold-300 text-sm mb-1" style={{ fontFamily: "'Noto Serif SC', serif" }}>
          {heading}
        </p>
      )}

      <BirthInput value={value} onChange={onChange} />

      {/* formId 存在时，提交按钮在调用方那边（首页的大按钮），这里不重复渲染。
          结果页的编辑面板没有这个属性，所以按钮就在这儿。 */}
      {!formId && (
        <div className="flex flex-col sm:flex-row gap-3 pt-1">
          <button type="submit" disabled={loading} className="btn-primary flex-1">
            {loading ? (
              <span className="flex items-center justify-center gap-3">
                <span className="mystic-loader !w-5 !h-5" />
                天机推演中...
              </span>
            ) : unlocked ? (
              "开始解读"
            ) : (
              "免费试读"
            )}
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} className="btn-mystic">
              取消
            </button>
          )}
        </div>
      )}

      {/* 已经在编辑一份结果时，用户是主动回来改的，不必再解释一遍规则 ——
          他刚刚才读过那段说明。 */}
      {!unlocked && !editing && (
        <p className="text-center text-paper-100/55 text-xs leading-relaxed">
          可以先免费看「命局总评」一节，其余 {LOCKED_SECTION_COUNT} 节需激活后查看 ·{" "}
          <button
            type="button"
            onClick={onOpenPayment}
            className="text-gold-400/60 hover:text-gold-300 underline transition-colors"
          >
            输入激活码
          </button>
          <br />
          <span className="text-paper-100/55">
            开通会员 ¥{formatPrice(MEMBER_PLANS[0].price)}/月，无限次解读
          </span>
        </p>
      )}
      {editing && !unlocked && (
        <p className="text-center text-paper-100/55 text-xs leading-relaxed">
          重新解读会消耗一次免费试读额度。
        </p>
      )}
      {member && (
        <p className="text-center text-paper-100/55 text-xs">会员权益生效中，本次不消耗次数</p>
      )}
    </>
  );
}
