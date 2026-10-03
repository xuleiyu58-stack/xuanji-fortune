/**
 * 对外联系方式。
 *
 * 集中一处，因为付款后「找谁拿激活码」和页脚「联系客服」必须是同一个答案 ——
 * 散在两个文件里，改了一个忘了另一个，用户就会拿着过期邮箱来找你。
 */

export const CONTACT_EMAIL = "2994279260@qq.com";

/** 界面上的称呼。邮箱是 QQ 邮箱，写出来比只给一串地址更容易被信任。 */
export const CONTACT_LABEL = "站长邮箱";

/** mailto 链接，供页脚与法律页使用。 */
export const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`;
