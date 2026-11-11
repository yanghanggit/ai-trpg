import { GAMEPLAY_RULES } from "../../gameplay";
import { isHandleRef } from "../../kernel/addressing";
import type { ActorTurnContext } from "./context";

/**
 * 任务提示词里的「按能力出现的提示」：每条只管一件事，空字符串表示这轮不适用。
 *
 * 分工是硬的：**单个工具怎么用、参数与代价，写在工具描述里**（工具只在能做的时候出现在
 * 列表里，所以这类规则天然按能力出现，不需要在提示词里再抄一遍）。这里只放两件工具描述
 * 管不了的事——跨工具的先后顺序（先 inspect 再取、先 unequip 再 attack），以及本轮
 * 没有对应工具可调时的取舍（没武器也没 brawl 就说清不能攻击）。
 *
 * 一个 hint 只由 `allowed` / `targets` 决定，不看 state；需要舞台事实的写进环境段。
 * 顺序即提示词里的顺序，新加一条加进 `HINTS`，不要写回 `prompt.ts` 的模板。
 */

type Hint = (context: ActorTurnContext) => string;

/** 武器的两种攻击是平级的（单体挥击 / 横扫），提示词只列本次真的能用的那个。 */
function attackKinds(context: ActorTurnContext): readonly ("strike" | "cleave")[] {
  return (["strike", "cleave"] as const).filter((kind) => context.allowed.includes(kind));
}

const knowledgeHint: Hint = () =>
  "当问题涉及任何进入该世界的人都可能观察、询问或从公开记载中得知的固定事实，而当前舞台与记忆无法直接确认时，必须先调用 query 检索，再回答或行动；不要用常识补全，也不要把检索结果当成亲眼所见。query 只读、不占行动名额，不提供角色秘密或当前状态。";

// 只有名单里还有 `#编号` 时才提醒起名；已有名字也可以按 # 重新记录来更新称呼。
const identityHint: Hint = (context) => {
  const unknownTargets = context.targets.filter(isHandleRef);
  const base =
    "行动对象写你对它的称呼（名单里的名字）；还不知道名字、或者两个人同名时写 `#编号`。编号是系统占位，绝不能说出口。use 的 targetAnchor 只能从当前舞台的「可交互锚点」里选，不能自己写位置描述。";
  return unknownTargets.length === 0
    ? base
    : `${base}名单里还有 \`#编号\`：可以用 recognize_identity 把它记成你认得的称呼；需要改名时对同一个编号再记一次。`;
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

// 取物前通常要先看清名字：inspect 与 steal / loot 各占一次行动，所以分两回合走。
const inspectHint: Hint = (context) =>
  context.allowed.includes("inspect") &&
  (context.allowed.includes("steal") || context.allowed.includes("loot"))
    ? "不知道对方身上有什么、或者记不准物品名时，先 inspect 看清，下个回合再取。"
    : "";

// 察觉与成败都看敏捷：自己这一侧的数值在「你的状态」里，对方的敏捷只能靠试。
// 规则开关归玩法层；关掉时两件事都不再有代价，也就不必再提示。
const agilityHint: Hint = (context) => {
  if (!GAMEPLAY_RULES.agilityGovernsAwareness) {
    return "";
  }
  if (context.allowed.includes("steal")) {
    return "查看与窃取比敏捷：你比目标敏捷时两件事都不留痕迹；持平能偷到，但对方会察觉；不如对方时偷不到，查看也会被发现。";
  }
  return context.allowed.includes("inspect")
    ? "查看比敏捷：你比目标敏捷时对方不会察觉，否则对方知道你在看他的东西。"
    : "";
};

/** 顺序即提示词的顺序；空提示自然消失。 */
const HINTS: readonly Hint[] = [
  knowledgeHint,
  identityHint,
  useFlowHint,
  unarmedHint,
  inspectHint,
  agilityHint,
];

/** 把本轮适用的提示按固定顺序拼成一段；没有一条适用时返回空串。 */
export function renderHints(context: ActorTurnContext): string {
  return HINTS.map((hint) => hint(context))
    .filter((hint) => hint.length > 0)
    .join("");
}
