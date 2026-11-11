import type { ToolDefinition } from "../../../llm/types";
import { GameError } from "../../errors";
import type { StageAction, StageActionKind } from "../../kernel/types";
import type { StageTurnContext } from "./context";
import type { StagePlanSession } from "./plan-session";
import {
  buildAddAnchorTool,
  buildNotifyWorldTool,
  buildOpenPassageTool,
  buildRemoveAnchorTool,
  buildSubmitEnvironmentTool,
  buildUpdateAnchorTool,
  parseAddAnchor,
  parseEnvironment,
  parseOpenPassage,
  parseRemoveAnchor,
  parseUpdateAnchor,
  parseWorldNotification,
} from "./tools";

/**
 * 一个仲裁动作的两个接口：给模型看的工具形状，与把参数写进本轮计划的那一步。
 *
 * 与 actor 侧同样的理由：一张表而不是两张平行表，`Record<StageActionKind, …>`
 * 保证新增仲裁动作时不会漏掉一半。工具形状按本场景此刻的可供性生成。
 *
 * 工具契约（形状与 parser）在 `./tools`：它是模型看到的那一面，与这里的装配分开。
 */
export type StageActionToolkit = {
  build: (context: StageTurnContext) => ToolDefinition;
  apply: (session: StagePlanSession, args: Record<string, unknown>) => string;
  /** 能力有、但此刻无处可用时不出现（例如通道全都开着）。 */
  available?: (context: StageTurnContext) => boolean;
};

/** 解析器返回宽类型；按 kind 收窄，写错分支在编译期就暴露。 */
function narrow<Kind extends StageActionKind>(
  action: StageAction,
  kind: Kind,
): Extract<StageAction, { kind: Kind }> {
  if (action.kind !== kind) {
    throw new GameError("invalid_state", `解析结果不是 ${kind}`);
  }
  return action as Extract<StageAction, { kind: Kind }>;
}

export const STAGE_ACTION_TOOLKITS: Record<StageActionKind, StageActionToolkit> = {
  submit_environment: {
    build: () => buildSubmitEnvironmentTool(),
    apply: (session, args) => {
      const environment = parseEnvironment(args);
      if (environment === undefined) {
        throw new GameError("invalid_action", "submit_environment 需要非空 environment");
      }
      session.setEnvironment(environment);
      return "environment 已加入本轮计划";
    },
  },
  notify_world: {
    build: () => buildNotifyWorldTool(),
    apply: (session, args) => {
      session.addNotification(parseWorldNotification(args));
      return "通知已加入本轮计划";
    },
  },
  open_passage: {
    build: (context) => buildOpenPassageTool(context.sealed),
    available: (context) => context.sealed.length > 0,
    apply: (session, args) => {
      session.addPassage(narrow(parseOpenPassage(args), "open_passage").targetStageName);
      return "通道开启已加入本轮计划";
    },
  },
  add_anchor: {
    build: () => buildAddAnchorTool(),
    apply: (session, args) => {
      session.addAnchor(narrow(parseAddAnchor(args), "add_anchor"));
      return "锚点已加入本轮计划";
    },
  },
  remove_anchor: {
    build: (context) => buildRemoveAnchorTool(context.anchorLabels),
    apply: (session, args) => {
      session.addAnchor(narrow(parseRemoveAnchor(args), "remove_anchor"));
      return "锚点移除已加入本轮计划";
    },
  },
  update_anchor: {
    build: (context) => buildUpdateAnchorTool(context.anchorLabels),
    apply: (session, args) => {
      session.addAnchor(narrow(parseUpdateAnchor(args), "update_anchor"));
      return "锚点更新已加入本轮计划";
    },
  },
};
