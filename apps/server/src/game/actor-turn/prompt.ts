import { ACTION_SUMMARIES } from "../actions";
import type { ActorWithStage } from "../actors";
import { refOf } from "../addressing";
import { isAlive } from "../apply/queries";
import { STAT_LABELS } from "../attributes";
import { MAX_ACTIONS_PER_TURN } from "../limits";
import {
  describeEquipmentBrief,
  describeStageAnchors,
  renderStageEnvironmentForActor,
  sealedVisitedStageRefsForActor,
} from "../plan";
import { isHandleRef } from "../reference";
import { DEFAULT_ACTOR_MAX_ROUNDS } from "../rounds";
import { visitedTeleportTargetsFor } from "../teleport";
import type { GameStateSlice } from "../types";
import { type ActorTurnContext, actorTurnContext } from "./context";

/**
 * actor 本轮的公开环境与任务说明：先给场景与状态，再给三步流程与按能力出现的提示。
 *
 * 流程（先读、再写、再提交）属于编排，写在这里而不是工具描述里：工具只说自己做什么，
 * 跨工具的先后顺序由这段提示词负责。提示词与探针共用，所以它只读 state。
 */
export function buildActorTurnInput(
  state: GameStateSlice,
  current: ActorWithStage,
  maxRounds: number = DEFAULT_ACTOR_MAX_ROUNDS,
): string {
  return renderActorTurnInput(actorTurnContext(state, current), maxRounds);
}

/**
 * 已经算好上下文时直接渲染：回合里两者都要用，不必把同一份派生算两遍。
 */
export function renderActorTurnInput(
  context: ActorTurnContext,
  maxRounds: number = DEFAULT_ACTOR_MAX_ROUNDS,
): string {
  const { state, current } = context;
  const { actor, stage } = current;
  const { allowed, others, address } = context;
  // 去过、但现在封着的出口：记忆里的一道门。它不能走，只是认得出来。
  const remembered = sealedVisitedStageRefsForActor(state, current);
  const actionList = allowed.map((kind) => `${kind}（${ACTION_SUMMARIES[kind]}）`).join("、");
  // 已穿戴物品不能 use 是动作自身的约束；用哪个动作替代属于流程，放在任务提示词。
  // 武器的两种攻击是平级的（单体挥击 / 横扫），提示词只列本次真的能用的那个。
  const weaponAttackKinds = (["strike", "cleave"] as const).filter((kind) =>
    allowed.includes(kind),
  );
  const useAlternatives = [
    ...(weaponAttackKinds.length > 0 ? [`武器用 ${weaponAttackKinds.join(" 或 ")}`] : []),
    ...(allowed.includes("unequip")
      ? [weaponAttackKinds.length > 0 ? "其余先 unequip" : "先 unequip"]
      : []),
  ];
  const useFlowHint = allowed.includes("use")
    ? `已穿戴的物品不能用 use${useAlternatives.length > 0 ? `；${useAlternatives.join("；")}` : ""}。`
    : "";
  const callHint = allowed.includes("call")
    ? "传音不会自动暴露你是谁；想让对方知道，就把自称写进 message。"
    : "";
  // 攻击是能力面：引擎不自动授予 brawl，没武器时能用什么完全由角色固有声明决定。
  // 这里只把“现在到底有没有出手方式”说清楚，避免模型反复尝试没有的动作。
  // 偷与搜刮按对象分工，尸体不是窃取目标；这句只在本回合真能用其中一条时出现。
  const lootHint =
    allowed.includes("steal") && allowed.includes("loot")
      ? "活人用 steal（私密，拿不走穿戴中的物品）；尸体用 loot 搜刮（公开，装备与材料都能拿，不点名就是全部）。"
      : allowed.includes("loot")
        ? "尸体用 loot 搜刮：装备、材料与背包里的东西都能拿，不点名就是全部，在场的人都看得见。"
        : "";
  const unarmedHint =
    weaponAttackKinds.length > 0
      ? ""
      : allowed.includes("brawl")
        ? "当前没有能出手的武器：近战只能用 brawl（身体攻击，不吃武器数值）。"
        : "当前既没有能出手的武器，也没有 brawl：本轮无法发起攻击。";
  // 背包清单不是免费读取：名单里只有穿戴摘要，要看全得花一次行动。花费写在这里，
  // 是否被察觉写在 agilityHint，两处各管一件事，不重复同一句规则。
  const canInspect = allowed.includes("inspect");
  const toolHint = canInspect
    ? "名单里只列了同场景他人已穿戴的装备；要看全，用 get_self 看自己，用 inspect 看别人随身带的全部物品——它是一次动作，会占掉本轮行动名额。"
    : "要看自己的完整信息用 get_self。";
  // 取物前通常要先看清名字：inspect 与 steal / loot 各占一次行动，所以分两回合走。
  const inspectHint =
    canInspect && (allowed.includes("steal") || allowed.includes("loot"))
      ? "不知道对方身上有什么、或者记不准物品名时，先 inspect 看清，下个回合再取。"
      : "";
  // 察觉与成败都看敏捷：自己这一侧的数值在「你的状态」里，对方的敏捷只能靠试。
  const agilityHint = allowed.includes("steal")
    ? "查看与窃取比敏捷：你比目标敏捷时两件事都不留痕迹；持平能偷到，但对方会察觉；不如对方时偷不到，查看也会被发现。"
    : canInspect
      ? "查看比敏捷：你比目标敏捷时对方不会察觉，否则对方知道你在看他的东西。"
      : "";
  const readOnlyList = [
    "look_stage",
    "get_self",
    "get_visited_stages",
    "recall_route",
    "query",
    "recognize_identity",
  ].join("、");
  const readOnlyHint =
    "look_stage 只能看本场景；get_visited_stages 可以回看你走过的场景；recall_route 顺着场景连接回一条路线，结论会进你的认知（地名写错时会记成「无法寻路」）。";
  const actorLines =
    others.length === 0
      ? "无"
      : others
          .map((other) => {
            const worn = describeEquipmentBrief(other);
            const dead = isAlive(other) ? "" : "（已死亡）";
            return `${refOf(address(other.id))}${dead}${worn.length === 0 ? "" : `｜${worn}`}`;
          })
          .join("\n");
  const targetLines = context.targets.length === 0 ? "无" : context.targets.join("、");
  const moveLines = context.stageRefs.length === 0 ? "无" : context.stageRefs.join("、");
  const teleportTargets = visitedTeleportTargetsFor(state, actor, stage);
  const teleportLines =
    teleportTargets.length === 0 ? "无" : teleportTargets.map((item) => item.name).join("、");
  const knowledgeHint =
    "当问题涉及任何进入该世界的人都可能观察、询问或从公开记载中得知的固定事实，而当前场景与记忆无法直接确认时，必须先调用 query 检索，再回答或行动；不要用常识补全，也不要把检索结果当成亲眼所见。query 只读、不占行动，不提供角色秘密或当前状态。";
  // 只有名单里还有 `#编号` 时才提醒起名；已有名字也可以按 # 重新记录来更新称呼。
  const unknownTargets = context.targets.filter(isHandleRef);
  const identityHint =
    "行动对象写你对它的称呼（名单里的名字）；还不知道名字、或者两个人同名时写 `#编号`。编号是系统占位，绝不能说出口。use 的 targetAnchor 只能从当前场景的「可交互锚点」里选，不能自己写位置描述。" +
    (unknownTargets.length === 0
      ? ""
      : "名单里还有 `#编号`：可以用 recognize_identity 把它记成你认得的称呼；需要改名时对同一个编号再记一次（不占行动名额）。");
  // 顺序即提示词的顺序：能力说明在前，细则在后，空提示自然消失。
  const hints = [
    toolHint,
    knowledgeHint,
    identityHint,
    useFlowHint,
    callHint,
    unarmedHint,
    lootHint,
    inspectHint,
    agilityHint,
    readOnlyHint,
  ]
    .filter((hint) => hint.length > 0)
    .join("");

  return `# 当前环境

## 场景
${stage.name}
${renderStageEnvironmentForActor(state, current)}

## 你的状态
${actor.name}（你的引用：${context.selfHandle}）| HP ${actor.hp}/${actor.stats.maxHp} | ${STAT_LABELS.strength} ${actor.stats.strength} | ${STAT_LABELS.agility} ${actor.stats.agility}

## 同场景角色
${actorLines}

## 可交互锚点
${describeStageAnchors(stage.anchors)}

## 可作用对象
${targetLines}

## 可移动至
${moveLines}${
  remembered.length === 0
    ? ""
    : `\n\n## 记得封着的出口（认得出，但过不去）
${remembered.join("、")}`
}
${
  actor.actions.includes("teleport")
    ? `
## 可传送（写对真名即可；下列是去过的、未禁传的）
${teleportLines}`
    : ""
}

# 本轮任务

本轮只有一件事要做：决定并提交 ${MAX_ACTIONS_PER_TURN} 个行动。流程分三步：

1. 读：${readOnlyList}。都是只读的，一次回复里能问完就问完，不需要为每项信息单独占一轮。本回合的推理预算是 ${maxRounds} 轮，因此写和提交要把最后几轮留出来。
2. 写：${actionList}。一次回复只提交 ${MAX_ACTIONS_PER_TURN} 个行动——说话、移动、动手都算。动作工具只把动作暂存进计划，不会落账。
3. 提交：submit_plan。必须与那一个动作工具放在同一次回复里调用；只调动作不提交，这一轮就什么都没发生。

${hints}`;
}
