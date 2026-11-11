import type { ToolDefinition } from "../../../llm/types";
import { GameError } from "../../errors";
import { assertWorldFaceText, NAME_MARKER_PATTERN } from "../../kernel/addressing";
import type { MaterialDrop } from "../../persistence/items";

/**
 * 掉落材料的工具契约与校验：提交什么形状、什么算合法。
 *
 * 两个上限只属于掉落阶段，不是全局配额，所以留在本文件里，与工具描述同址——
 * 描述里写的数字必须和校验用的数字是同一个。
 */

/** 一具尸体一轮最多掉落的材料条数；属于掉落阶段，不是全局上限。 */
const MAX_DROP_MATERIALS = 2;

/** 单条掉落材料的数量上限；属于掉落阶段，不是全局上限。 */
const MAX_MATERIAL_COUNT = 10;

/** 掉落推理只有这一个终止工具。 */
export function buildDropMaterialsTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "drop_materials",
      description: `提交尸体留下的材料；材料留在尸体上，名称与描述不得含角色名或系统引用。`,
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            description: `材料清单，最多 ${MAX_DROP_MATERIALS} 条；没有就提交空数组`,
            items: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  description: "材料名",
                },
                description: {
                  type: "string",
                  description: "第三人称可见的描述",
                },
                count: {
                  type: "integer",
                  minimum: 1,
                  maximum: MAX_MATERIAL_COUNT,
                  description: `数量，1 到 ${MAX_MATERIAL_COUNT}，省略按 1`,
                },
              },
              required: ["name", "description"],
            },
          },
        },
        required: ["items"],
      },
    },
  };
}

/**
 * 掉落物只能是非空、不超长的材料；任一条不合法整批拒绝，不静默截断。
 *
 * 材料会成为物品状态，任何在场者都能观察到；物品名与描述因此不得含角色名与 `#` 编号。
 */
export function parseDrops(
  args: Record<string, unknown>,
  actorNames: readonly string[] = [],
): MaterialDrop[] {
  const items = args.items;
  if (!Array.isArray(items)) {
    throw new GameError("invalid_action", "drop_materials 需要 items 数组");
  }
  if (items.length > MAX_DROP_MATERIALS) {
    throw new GameError("invalid_action", `一次最多掉落 ${MAX_DROP_MATERIALS} 条材料`);
  }

  const names = new Set<string>();
  return items.map((raw) => {
    if (typeof raw !== "object" || raw === null) {
      throw new GameError("invalid_action", "每条掉落都需要 name 与 description");
    }
    const value = raw as Record<string, unknown>;
    const name = typeof value.name === "string" ? value.name.trim() : "";
    const description = typeof value.description === "string" ? value.description.trim() : "";
    const count = value.count === undefined ? 1 : value.count;

    if (name.length === 0) {
      throw new GameError("invalid_action", `材料名不能为空: ${name}`);
    }
    if (names.has(name)) {
      throw new GameError("invalid_action", `同一次掉落里材料名重复: ${name}`);
    }
    names.add(name);
    if (description.length === 0) {
      throw new GameError("invalid_action", `材料描述不能为空: ${name}`);
    }
    if (NAME_MARKER_PATTERN.test(name)) {
      throw new GameError("invalid_action", `材料名不能包含 # 标记: ${name}`);
    }
    assertWorldFaceText(name, actorNames, "材料名");
    assertWorldFaceText(description, actorNames, "材料描述");
    if (
      typeof count !== "number" ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > MAX_MATERIAL_COUNT
    ) {
      throw new GameError("invalid_action", `材料数量必须是 1 到 ${MAX_MATERIAL_COUNT} 的整数`);
    }
    return { name, description, count };
  });
}
