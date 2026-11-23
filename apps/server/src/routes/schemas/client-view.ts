/**
 * 客户端读模型的线上契约：`game/client-view` 的 `ActorView` 逐个字段写成 schema。
 *
 * 形状的源在引擎（`ActorView`），这里只负责序列化与文档；两边的对应关系由
 * `satisfies z.ZodType<ActorView>` 守住——引擎加字段、改可空性，这里会编译不过，
 * 而不是等客户端拿到一个它不认识的 JSON。
 *
 * 命名（`.meta({ id })`）让 OpenAPI 把它放进 `components.schemas`，
 * 客户端因此拿到一个有名字的类型，而不是内联展开的一坨。
 */

import type { z } from "zod";
import { z as zod } from "zod";
import type { ActorLogView, ActorView, ViewerAnchor, ViewerLogEntry } from "../../game/client-view";
import type { MessageState } from "../../game/kernel/types";

const viewerItemSchema = zod.object({
  name: zod.string(),
  kind: zod.string(),
  description: zod.string(),
});

const viewerAnchorSchema = zod.object({
  key: zod.string(),
  label: zod.string(),
  description: zod.string().optional(),
  items: zod.array(viewerItemSchema),
}) satisfies z.ZodType<ViewerAnchor>;

const viewerAddressSchema = zod.object({
  actorId: zod.string(),
  signatureId: zod.string(),
  token: zod.string(),
  name: zod.string(),
  appearance: zod.string(),
  self: zod.boolean(),
  alive: zod.boolean(),
});

const viewerStageSchema = zod.object({
  id: zod.string(),
  name: zod.string(),
  environment: zod.string(),
  anchors: zod.array(viewerAnchorSchema),
  actors: zod.array(viewerAddressSchema),
  exits: zod.array(
    zod.object({
      stageId: zod.string(),
      name: zod.string(),
      ref: zod.string(),
    }),
  ),
  sealedExits: zod.array(
    zod.object({
      stageId: zod.string(),
      name: zod.string(),
    }),
  ),
});

const viewerGameSchema = zod
  .object({
    id: zod.string(),
    name: zod.string(),
    slug: zod.string(),
    status: zod.string(),
    version: zod.number(),
    contentVersion: zod.string(),
  })
  .meta({ id: "ViewerGame" });

const viewerLogEntrySchema = zod
  .object({
    sequence: zod.number(),
    kind: zod.string(),
    content: zod.string(),
    createdAt: zod.string(),
  })
  .meta({ id: "ViewerLogEntry" }) satisfies z.ZodType<ViewerLogEntry>;

/** 观看者视角：一局在某个角色眼里是什么样。 */
export const actorViewSchema = zod
  .object({
    game: viewerGameSchema,
    viewer: zod.object({
      actorId: zod.string(),
      signatureId: zod.string(),
      name: zod.string(),
      appearance: zod.string(),
      concealed: zod.boolean(),
    }),
    stage: viewerStageSchema,
    names: zod.array(
      zod.object({
        name: zod.string(),
        token: zod.string(),
        form: zod.string(),
        source: zod.enum(["content", "self"]),
        learnedAt: zod.string().nullable(),
      }),
    ),
    visitedStages: zod.array(
      zod.object({
        stageId: zod.string(),
        name: zod.string(),
      }),
    ),
  })
  .meta({ id: "ActorView" }) satisfies z.ZodType<ActorView>;

/**
 * 公共事件流的一行。
 *
 * 它进契约是给「消息历史」用的：客户端要能按字段读，而不是把 `state` 那种不透明投影
 * 拆开猜。字段与 `MessageState` 一一对应，同样由 `satisfies` 守住。
 */
export const gameMessageSchema = zod
  .object({
    id: zod.string(),
    sequence: zod.number(),
    kind: zod.string(),
    stageId: zod.string().nullable(),
    sourceActorId: zod.string().nullable(),
    targetActorId: zod.string().nullable(),
    visibility: zod.enum(["stage", "private"]),
    content: zod.string(),
    createdAt: zod.string(),
  })
  .meta({ id: "GameMessage" }) satisfies z.ZodType<MessageState>;

/** 感知日志：这个角色经历过的事，单独一个端点，不跟着投影一起发。 */
export const actorLogSchema = zod
  .object({
    owner: zod.object({
      actorId: zod.string(),
      name: zod.string(),
    }),
    entries: zod.array(viewerLogEntrySchema),
  })
  .meta({ id: "ActorLog" }) satisfies z.ZodType<ActorLogView>;
