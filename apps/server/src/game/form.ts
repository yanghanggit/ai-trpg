/**
 * 形态（form）是签名上唯一的稳定描述，也是系统提示词与外观推理的输入。
 *
 * 统一写法：`[种族]:描述`，例如 `[种族名]:整体形态…`。
 * 种族是整体形态（具体种族由内容层定义），描述里应包含能锁定身份的标记部位。
 */
export const FORM_PATTERN = /^\[[^\]\r\n]+\]:\S[^\r\n]*$/;

/** 组装统一的形态写法；所有形态都从这里生成，避免格式散落。 */
export function formatForm(race: string, description: string): string {
  return `[${race}]:${description}`;
}

export function isValidForm(value: string): boolean {
  return FORM_PATTERN.test(value);
}

/**
 * 当前可见外观：优先用显式的 appearance（衣着、伤势等）；省略时回退到形态。
 */
export function resolveAppearance(signature: { form: string; appearance?: string }): string {
  const appearance = signature.appearance?.trim();
  return appearance && appearance.length > 0 ? appearance : signature.form;
}
