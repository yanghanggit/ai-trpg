import { MAX_WORLD_ACTIONS_PER_TURN } from "../../kernel/limits";
import type { GameStateSlice } from "../../kernel/types";
import { isAlive } from "../../lookup";

/**
 * world 本轮的全局观察与裁决规则。
 *
 * 舞台报告不在提示词里：它们已经写进 world memory，这一轮要读的是记忆。
 * 提示词只描述「世界此刻长什么样」与「哪些事算世界级」——后者是编排，不是工具契约。
 */
export function buildWorldTurnInput(state: GameStateSlice): string {
  const stageLines = state.world.stages
    .map((stage) => {
      const actors =
        stage.actors.length === 0
          ? "无"
          : stage.actors
              .map((actor) => `${actor.name}${isAlive(actor) ? "" : "（已死亡）"}`)
              .join("、");
      return `### ${stage.name}

${stage.profile}

${stage.environment}

角色：${actors}`;
    })
    .join("\n\n");

  return `# 世界状态

## 世界
${state.world.name}

## 舞台
${stageLines}

# 本轮任务

读取 stage memory 中的舞台通知，裁决世界级事实与跨舞台后果。
- 需要让某个舞台知道世界级变化时，使用 notify_stage 写入该舞台 memory。
- end_game 必须是本轮最后一个动作。
- 本轮没有任何世界级事实需要裁决时，直接提交空计划结束；不要为了走完提交流程而编造通知。

只读工具（look_stage）可以多次调用，不占额度；会写库的动作（notify_stage / end_game）本轮最多 ${MAX_WORLD_ACTIONS_PER_TURN} 个。
先规划再执行：需要查看时先 look_stage，然后按顺序加入通知与 end_game，最后调用 submit_world_plan；提交本身不占动作额度，但同样消耗一轮。`;
}
