/**
 * 形态（form）是签名上唯一的稳定描述，也是系统提示词与外观推理的输入。
 *
 * 住在 `appearance/` 是因为它同时定义外观的兜底：没有显式外观时，形态就是可见的样子。
 *
 * 统一写法：`种族:描述`，例如 `人类:整体形态…`。方括号是 Markdown 的链接引用定义语法，
 * 导出成 .md 时会被判成未使用的引用，所以种族不加括号。
 * 种族是整体形态（具体种族由内容层定义），描述里应包含能锁定身份的标记部位。
 */
const FORM_PATTERN = /^[^:[\]\r\n]+:\S[^\r\n]*$/;

/** 组装统一的形态写法；所有形态都从这里生成，避免格式散落。 */
export function formatForm(race: string, description: string): string {
  return `${race}:${description}`;
}

/**
 * 验证给定的字符串是否符合形态的格式要求。
 */
export function isValidForm(value: string): boolean {
  return FORM_PATTERN.test(value);
}

/**
 * 当前可见外观：优先用显式的 appearance；省略时回退到形态。
 */
export function resolveAppearance(signature: { form: string; appearance?: string }): string {
  const appearance = signature.appearance?.trim();
  return appearance && appearance.length > 0 ? appearance : signature.form;
}
