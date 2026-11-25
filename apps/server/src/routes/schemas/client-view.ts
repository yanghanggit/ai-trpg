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

import { z } from "zod";
import type { ActorLogView, ActorView, ViewerAnchor, ViewerLogEntry } from "../../game/client-view";
import type { MessageState } from "../../game/kernel/types";

const viewerItemSchema = z.object({
  name: z.string(),
  kind: z.string(),
  kindLabel: z.string(),
  description: z.string(),
});

const viewerStatSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    value: z.number(),
  })
  .meta({ id: "ViewerStat" });

const viewerAnchorSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string().optional(),
  items: z.array(viewerItemSchema),
}) satisfies z.ZodType<ViewerAnchor>;

const viewerAddressSchema = z.object({
  actorId: z.string(),
  signatureId: z.string(),
  token: z.string(),
  name: z.string(),
  appearance: z.string(),
  self: z.boolean(),
  alive: z.boolean(),
});

const viewerStageSchema = z.object({
  id: z.string(),
  name: z.string(),
  environment: z.string(),
  anchors: z.array(viewerAnchorSchema),
  actors: z.array(viewerAddressSchema),
  exits: z.array(
    z.object({
      stageId: z.string(),
      name: z.string(),
      ref: z.string(),
    }),
  ),
  sealedExits: z.array(
    z.object({
      stageId: z.string(),
      name: z.string(),
    }),
  ),
});

const viewerGameSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    status: z.string(),
    version: z.number(),
    contentVersion: z.string(),
  })
  .meta({ id: "ViewerGame" });

const viewerLogEntrySchema = z
  .object({
    sequence: z.number(),
    kind: z.string(),
    content: z.string(),
    createdAt: z.string(),
  })
  .meta({ id: "ViewerLogEntry" }) satisfies z.ZodType<ViewerLogEntry>;

/** 观看者视角：一局在某个角色眼里是什么样。 */
export const actorViewSchema = z
  .object({
    game: viewerGameSchema,
    viewer: z.object({
      actorId: z.string(),
      signatureId: z.string(),
      name: z.string(),
      appearance: z.string(),
      concealed: z.boolean(),
      hp: z.number(),
      stats: z.array(viewerStatSchema),
      items: z.array(viewerItemSchema),
    }),
    stage: viewerStageSchema,
    names: z.array(
      z.object({
        name: z.string(),
        token: z.string(),
        form: z.string(),
        source: z.enum(["content", "self"]),
        learnedAt: z.string().nullable(),
      }),
    ),
    visitedStages: z.array(
      z.object({
        stageId: z.string(),
        name: z.string(),
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
export const gameMessageSchema = z
  .object({
    id: z.string(),
    sequence: z.number(),
    kind: z.string(),
    stageId: z.string().nullable(),
    sourceActorId: z.string().nullable(),
    targetActorId: z.string().nullable(),
    visibility: z.enum(["stage", "private"]),
    content: z.string(),
    createdAt: z.string(),
  })
  .meta({ id: "GameMessage" }) satisfies z.ZodType<MessageState>;

/** 感知日志：这个角色经历过的事，单独一个端点，不跟着投影一起发。 */
export const actorLogSchema = z
  .object({
    owner: z.object({
      actorId: z.string(),
      name: z.string(),
    }),
    entries: z.array(viewerLogEntrySchema),
  })
  .meta({ id: "ActorLog" }) satisfies z.ZodType<ActorLogView>;
