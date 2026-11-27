import { z } from "zod";
import type { GameStageMap } from "../../game-ops/play";

/**
 * 舞台在场名单：只回答「这个人此刻在哪个舞台」。
 *
 * 两层都用 id 定位、名字只给人看——名字会重（同名角色分处两地、同名舞台在两份剧本里），
 * 编排按名字找舞台就会悄悄推错一个。这也是 stage-map 从「舞台名 → 角色名」改成
 * 明细列表的原因：按名的字典结构没法表达「两个同名的舞台」。
 */
export const gameStageMapSchema = z
  .object({
    stages: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        actors: z.array(z.object({ id: z.string(), name: z.string() })),
      }),
    ),
  })
  .describe(
    "按舞台列出此刻在场的人。" +
      "舞台与 actor 都带 id：名字会重，定位一律按 id；名字只用来显示。" +
      "名单读的是「现在」：移动在 actor 回合里就落账，所以推完一个人再读，就得到他移动之后的舞台。",
  )
  .meta({ id: "GameStageMap" }) satisfies z.ZodType<GameStageMap>;
