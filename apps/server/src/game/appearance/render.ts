import type { MemoryTarget } from "../bypass";
import { renderWithMemory } from "../bypass";
import { buildSubmitAppearanceTool, parseAppearance } from "./prompt";
import type { AppearanceOptions } from "./types";

/** 一次推论的产出：文本，或没生成时的原因。 */
export type RenderedAppearance = {
  appearance: string | null;
  reason?: string;
};

/**
 * 生成：借当事人的记忆跑一次推理，返回提交的外观文本；没提交或 loop 失败时带上原因。
 *
 * 只做协议适配：终止工具与产出校验归外观，推理轮次与记忆借用归旁路核。
 * 产出走本模块的 `parseAppearance`：输入由调用方给，守卫不跟着调用方走。
 */
export async function renderAppearance(
  target: MemoryTarget,
  input: { inputMessage: string; maxRounds: number },
  options: AppearanceOptions,
): Promise<RenderedAppearance> {
  const rendered = await renderWithMemory<string>(
    target,
    {
      inputMessage: input.inputMessage,
      maxRounds: input.maxRounds,
      tool: buildSubmitAppearanceTool(),
      parse: (args) => parseAppearance(args, target.actorNames),
      label: "外观",
    },
    options,
  );
  return {
    appearance: rendered.value,
    ...(rendered.reason ? { reason: rendered.reason } : {}),
  };
}
