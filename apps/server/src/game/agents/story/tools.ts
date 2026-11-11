import type { ToolDefinition } from "../../../llm";

/**
 * 故事整理的四个工具：先列清单，再读每个实体，再读事件流，最后提交。
 *
 * 顺序属于任务提示词（`prompt.ts`）；这里只定义每个工具的形状与它能读什么。
 */

export function buildListMemoriesTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "list_memories",
      description: "列出本局所有实体记忆，包括 world、每个 stage 与每个 actor。",
      parameters: { type: "object", properties: {} },
    },
  };
}

export function buildReadMemoryTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "read_memory",
      description: "读取一个实体的记忆；默认只读当前摘要。",
      parameters: {
        type: "object",
        properties: {
          ownerType: {
            type: "string",
            enum: ["world", "stage", "actor"],
            description: "实体类型",
          },
          name: {
            type: "string",
            description: "实体名称；取自本局实体清单",
          },
          includeArchived: {
            type: "boolean",
            description: "是否展开 compact 归档的旧消息树；默认 false",
          },
        },
        required: ["ownerType", "name"],
      },
    },
  };
}

export function buildReadEventsTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "read_events",
      description: "读取本局全部公共与私密事件流，按 sequence 排序。",
      parameters: { type: "object", properties: {} },
    },
  };
}

export function buildSubmitStoryTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "submit_story",
      description: "提交最终故事总结并结束。",
      parameters: {
        type: "object",
        properties: {
          story: {
            type: "string",
            description:
              "一段完整、连贯的故事正文，不是提纲或分析报告；叙事里不出现框架用语（场景、世界、系统、裁决、报告、工具、记忆）与编号引用。",
          },
        },
        required: ["story"],
      },
    },
  };
}
