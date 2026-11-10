import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { actorSignatures, appearances } from "../../db/schema";
import type { ChatMessage, ToolDefinition } from "../../llm/types";
import type { Executor } from "../apply/types";
import { GameError } from "../errors";
import type { AppearanceWornItem } from "../types";

/**
 * 外观渲染的持久化原语。
 *
 * 外观是 append-only 的：每次成功生成插入一行，旧行只写 `superseded_at`。
 * `input` 保存生成那一刻的完整输入，`text` 是最终渲染值。
 */

/**
 * 生成外观那一刻的输入快照。
 *
 * 运行时分支保存发给模型的完整 prompt 与结构化上下文；seed 分支只记录内容来源。
 */
export type AppearanceInput =
  | {
      source: "seed";
      contentKey: string;
      contentVersion: string;
      actorKey: string;
      form: string;
      /** 种子没写 appearance 时为 true，text 回退为 form。 */
      fallback: boolean;
    }
  | {
      source: "runtime";
      /** provider 未暴露模型名时为 null。 */
      model: string | null;
      prompt: {
        messages: readonly ChatMessage[];
        inputMessage: string;
        tools: readonly ToolDefinition[];
        maxRounds: number;
      };
      context: AppearanceContext;
    };

/**
 * 运行时外观的生成上下文：两种任务各自一个形状，`death` 多一份底座。
 */
export type AppearanceContext =
  | {
      task: "update";
      form: string;
      worn: readonly AppearanceWornItem[];
      contentVersion: string;
    }
  | {
      task: "death";
      form: string;
      worn: readonly AppearanceWornItem[];
      /** 刷新前的那一份外观。 */
      base: string;
      contentVersion: string;
    };

export type AppearanceWrite = {
  gameId: string;
  actorId: string;
  text: string;
  input: AppearanceInput;
  now: Date;
};

/** 写一条当前外观，并把同一签名的旧当前行标记为已取代。 */
export async function recordAppearance(
  executor: Executor,
  write: AppearanceWrite,
): Promise<string> {
  const [signature] = await executor
    .select({ id: actorSignatures.id })
    .from(actorSignatures)
    .where(and(eq(actorSignatures.actorId, write.actorId), isNull(actorSignatures.endedAt)))
    .limit(1);
  if (!signature) {
    throw new GameError("invalid_state", `actor 缺少当前签名: ${write.actorId}`);
  }

  await executor
    .update(appearances)
    .set({ supersededAt: write.now })
    .where(and(eq(appearances.signatureId, signature.id), isNull(appearances.supersededAt)));

  const id = randomUUID();
  await executor.insert(appearances).values({
    id,
    gameId: write.gameId,
    signatureId: signature.id,
    text: write.text,
    source: write.input.source,
    input: write.input,
    createdAt: write.now,
  });
  return id;
}
