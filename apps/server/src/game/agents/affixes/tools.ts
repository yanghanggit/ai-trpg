import type { ToolDefinition } from "../../../llm/types";
import { MAX_AFFIX_WITNESSES } from "../../kernel/limits";

export function buildAffixTools(
  targetNames: readonly string[],
  affixNames: readonly string[],
  anchorLabels: readonly string[],
): {
  damageTarget: ToolDefinition;
  recordWitness: ToolDefinition;
  submitAffix: ToolDefinition;
} {
  return {
    damageTarget: {
      type: "function",
      function: {
        name: "damage_target",
        description:
          "对场景中的一个角色追加词缀伤害；amount 是本次追加值，不是最终总伤害，也不要重复静态结算。",
        parameters: {
          type: "object",
          properties: {
            affixName: {
              type: "string",
              enum: [...affixNames],
              description: "是哪条词缀产生的追加",
            },
            targetActorHandle: {
              type: "string",
              enum: [...targetNames],
              description: "追加伤害的目标角色",
            },
            amount: {
              type: "integer",
              minimum: 1,
              description: "补充伤害数值",
            },
            reason: {
              type: "string",
              description: "判定依据：目标身上支撑本次追加的特征",
            },
          },
          required: ["affixName", "targetActorHandle", "amount"],
        },
      },
    },
    recordWitness: {
      type: "function",
      function: {
        name: "record_witness",
        description: `把词缀造成的可见后果写进场景；不扣血、不改数值，最多 ${MAX_AFFIX_WITNESSES} 条。`,
        parameters: {
          type: "object",
          properties: {
            affixName: {
              type: "string",
              enum: [...affixNames],
              description: "是哪条词缀产生的见证",
            },
            targetActorHandle: {
              type: "string",
              enum: [...targetNames],
              description: "产生可见后果的目标角色",
            },
            ...(anchorLabels.length > 0
              ? {
                  targetAnchor: {
                    type: "string",
                    enum: [...anchorLabels],
                    description: "产生可见后果的锚点（与 targetActorHandle 二选一）",
                  },
                }
              : {}),
            visibility: {
              type: "string",
              enum: ["stage", "target"],
              description: "可见范围：stage 全场景，target 只有当事人",
            },
            template: {
              type: "string",
              description:
                "只允许 {source}/{target}/{anchor}/{item} 占位；不得写名字或编号；第三人称可见事实",
            },
          },
          required: ["affixName", "template"],
        },
      },
    },
    submitAffix: {
      type: "function",
      function: {
        name: "submit_affix",
        description: "结束本轮词缀任务。",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
  };
}
