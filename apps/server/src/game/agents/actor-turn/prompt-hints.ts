import { isHandleRef } from "../../kernel/addressing";
import type { ActorTurnContext } from "./context";

/**
 * 任务提示词里的「按能力出现的提示」：每条只管一件事，空字符串表示这轮不适用。
 *
 * 一个 hint 只由 `allowed` / `targets` 决定，不看 state——需要场景事实的写进环境段，
 * 这里只写「这个能力怎么用、和别的动作怎么排」。顺序即提示词里的顺序：能力说明在前、
 * 动作细则在后，新加一条加进 `HINTS`，不要写回 `prompt.ts` 的模板。
 */

type Hint = (context: ActorTurnContext) => string;

/** 武器的两种攻击是平级的（单体挥击 / 横扫），提示词只列本次真的能用的那个。 */
function attackKinds(context: ActorTurnContext): readonly ("strike" | "cleave")[] {
  return (["strike", "cleave"] as const).filter((kind) => context.allowed.includes(kind));
}

// 背包清单不是免费读取：名单里只有穿戴摘要，要看全得花一次行动。花费写在这里，
// 是否被察觉写在 agilityHint，两处各管一件事，不重复同一句规则。
const toolHint: Hint = (context) =>
  context.allowed.includes("inspect")
    ? "名单里只列了同场景他人已穿戴的装备；要看全，用 get_self 看自己，用 inspect 看别人随身带的全部物品——它是一次动作，会占掉本轮行动名额。"
    : "要看自己的完整信息用 get_self。";

const knowledgeHint: Hint = () =>
  "当问题涉及任何进入该世界的人都可能观察、询问或从公开记载中得知的固定事实，而当前场景与记忆无法直接确认时，必须先调用 query 检索，再回答或行动；不要用常识补全，也不要把检索结果当成亲眼所见。query 只读、不占行动，不提供角色秘密或当前状态。";

// 只有名单里还有 `#编号` 时才提醒起名；已有名字也可以按 # 重新记录来更新称呼。
const identityHint: Hint = (context) => {
  const unknownTargets = context.targets.filter(isHandleRef);
  const base =
    "行动对象写你对它的称呼（名单里的名字）；还不知道名字、或者两个人同名时写 `#编号`。编号是系统占位，绝不能说出口。use 的 targetAnchor 只能从当前场景的「可交互锚点」里选，不能自己写位置描述。";
  return unknownTargets.length === 0
    ? base
    : `${base}名单里还有 \`#编号\`：可以用 recognize_identity 把它记成你认得的称呼；需要改名时对同一个编号再记一次（不占行动名额）。`;
};

// 已穿戴物品不能 use 是动作自身的约束；用哪个动作替代属于流程，放在任务提示词。
const useFlowHint: Hint = (context) => {
  if (!context.allowed.includes("use")) {
    return "";
  }
  const kinds = attackKinds(context);
  const alternatives = [
    ...(kinds.length > 0 ? [`武器用 ${kinds.join(" 或 ")}`] : []),
    ...(context.allowed.includes("unequip")
      ? [kinds.length > 0 ? "其余先 unequip" : "先 unequip"]
      : []),
  ];
  return `已穿戴的物品不能用 use${alternatives.length > 0 ? `；${alternatives.join("；")}` : ""}。`;
};

const callHint: Hint = (context) =>
  context.allowed.includes("call")
    ? "传音不会自动暴露你是谁；想让对方知道，就把自称写进 message。"
    : "";

// 攻击是能力面：引擎不自动授予 brawl，没武器时能用什么完全由角色固有声明决定。
// 这里只把“现在到底有没有出手方式”说清楚，避免模型反复尝试没有的动作。
const unarmedHint: Hint = (context) => {
  if (attackKinds(context).length > 0) {
    return "";
  }
  return context.allowed.includes("brawl")
    ? "当前没有能出手的武器：近战只能用 brawl（身体攻击，不吃武器数值）。"
    : "当前既没有能出手的武器，也没有 brawl：本轮无法发起攻击。";
};

// 偷与搜刮按对象分工，尸体不是窃取目标；这句只在本回合真能用其中一条时出现。
const lootHint: Hint = (context) => {
  if (!context.allowed.includes("loot")) {
    return "";
  }
  return context.allowed.includes("steal")
    ? "活人用 steal（私密，拿不走穿戴中的物品）；尸体用 loot 搜刮（公开，装备与材料都能拿，不点名就是全部）。"
    : "尸体用 loot 搜刮：装备、材料与背包里的东西都能拿，不点名就是全部，在场的人都看得见。";
};

// 取物前通常要先看清名字：inspect 与 steal / loot 各占一次行动，所以分两回合走。
const inspectHint: Hint = (context) =>
  context.allowed.includes("inspect") &&
  (context.allowed.includes("steal") || context.allowed.includes("loot"))
    ? "不知道对方身上有什么、或者记不准物品名时，先 inspect 看清，下个回合再取。"
    : "";

// 察觉与成败都看敏捷：自己这一侧的数值在「你的状态」里，对方的敏捷只能靠试。
const agilityHint: Hint = (context) => {
  if (context.allowed.includes("steal")) {
    return "查看与窃取比敏捷：你比目标敏捷时两件事都不留痕迹；持平能偷到，但对方会察觉；不如对方时偷不到，查看也会被发现。";
  }
  return context.allowed.includes("inspect")
    ? "查看比敏捷：你比目标敏捷时对方不会察觉，否则对方知道你在看他的东西。"
    : "";
};

const readOnlyHint: Hint = () =>
  `look_stage 只能看本场景；get_visited_stages 可以回看你走过的场景；recall_route 顺着场景连接回一条路线，结论会进你的认知（地名写错时会记成「无法寻路」）。`;

/** 顺序即提示词的顺序；空提示自然消失。 */
const HINTS: readonly Hint[] = [
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
];

/** 把本轮适用的提示按固定顺序拼成一段；没有一条适用时返回空串。 */
export function renderHints(context: ActorTurnContext): string {
  return HINTS.map((hint) => hint(context))
    .filter((hint) => hint.length > 0)
    .join("");
}
