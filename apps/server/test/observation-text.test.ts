import { describe, expect, it } from "vitest";
import type { AddressLookup } from "../src/game/addressing";
import { MEMORY_KINDS } from "../src/game/constants";
import {
  type CommunicationObservation,
  type DamageObservation,
  damageActionText,
  type ItemObservation,
  renderAction,
  renderCommunication as renderCommunicationRaw,
  renderDamage as renderDamageRaw,
  renderEnvironmentChange,
  renderItemEvent as renderItemEventRaw,
} from "../src/game/observation-text";

const STAGE = { id: "stage-1", name: "灰烬门廊" };
const ACTOR = { id: "actor-1", name: "守烬人" };
const OTHER = { id: "actor-2", name: "提灯修士" };
const TARGET = { ...OTHER, maxHp: 12 };

/** 测试里假定观察者知道双方名字；未知名字的分支由 observation-text 的专门用例覆盖。 */
const ADDRESS: AddressLookup = (actorId) => {
  if (actorId === ACTOR.id) {
    return {
      token: "@守烬人",
      label: "守烬人（披着旧斗篷。）",
      mention: "@守烬人",
      appearance: "披着旧斗篷。",
      knownName: "@守烬人",
      isSelf: false,
    };
  }
  if (actorId === OTHER.id) {
    return {
      token: "@提灯修士",
      label: "提灯修士（灰袍下摆浸着泥水。）",
      mention: "@提灯修士",
      appearance: "灰袍下摆浸着泥水。",
      knownName: "@提灯修士",
      isSelf: false,
    };
  }
  return {
    token: "",
    label: "某个不在场者",
    mention: "某个不在场者",
    appearance: "",
    knownName: null,
    isSelf: false,
  };
};

const renderDamage = (
  ...args: [
    Parameters<typeof renderDamageRaw>[0],
    Parameters<typeof renderDamageRaw>[1],
    Parameters<typeof renderDamageRaw>[2],
  ]
) => renderDamageRaw(args[0], args[1], args[2], ADDRESS);
const renderItemEvent = (
  ...args: [
    Parameters<typeof renderItemEventRaw>[0],
    Parameters<typeof renderItemEventRaw>[1],
    Parameters<typeof renderItemEventRaw>[2],
  ]
) => renderItemEventRaw(args[0], args[1], args[2], ADDRESS);
const renderCommunication = (
  ...args: [
    Parameters<typeof renderCommunicationRaw>[0],
    Parameters<typeof renderCommunicationRaw>[1],
    Parameters<typeof renderCommunicationRaw>[2],
  ]
) => renderCommunicationRaw(args[0], args[1], args[2], ADDRESS);

const damage = (overrides: Partial<DamageObservation> = {}): DamageObservation => ({
  action: "strike",
  attacker: ACTOR,
  target: TARGET,
  damage: 3,
  remainingHp: 9,
  ...overrides,
});

describe("damageActionText", () => {
  it("句式由动作锁定：挥击的主体是挥击，肉搏是肉搏，使用的主体是使用", () => {
    expect(damageActionText("strike")).toBe("挥击");
    expect(damageActionText("strike", "断齿刀")).toBe("挥击（使用断齿刀）");
    expect(damageActionText("brawl")).toBe("肉搏");
    expect(damageActionText("use", "松脂火把")).toBe("使用松脂火把");
  });
});

/** 观察者不认识攻击者：句子只留指代，外观单独一行。 */
const UNKNOWN_ATTACKER: AddressLookup = (actorId) =>
  actorId === ACTOR.id
    ? {
        token: "#1",
        label: "外观：披着旧斗篷。",
        mention: "#1",
        appearance: "披着旧斗篷。",
        knownName: null,
        isSelf: false,
      }
    : {
        token: "@提灯修士",
        label: "提灯修士（灰袍下摆浸着泥水。）",
        mention: "@提灯修士",
        appearance: "灰袍下摆浸着泥水。",
        knownName: "@提灯修士",
        isSelf: false,
      };

describe("damage observations", () => {
  it("未知名字时不把外观当称呼，外观另起一行", () => {
    const content = renderDamageRaw(STAGE, damage(), "actor-3", UNKNOWN_ATTACKER).content;
    expect(content).toBe("# 战斗\n#1对@提灯修士挥击，造成3点伤害。\n\n#1 外观：披着旧斗篷。");
    expect(content.split("\n")[1]).not.toContain("披着旧斗篷");

    // 受害者视角同理：只标注攻击者的外观。
    const victim = renderDamageRaw(STAGE, damage(), TARGET.id, UNKNOWN_ATTACKER).content;
    expect(victim).toContain("#1对你挥击");
    expect(victim).toContain("#1 外观：披着旧斗篷。");
  });

  it("只有受害者视角带剩余生命", () => {
    const victim = renderDamage(STAGE, damage(), TARGET.id);
    const bystander = renderDamage(STAGE, damage(), "actor-3");

    expect(victim.content).toBe("# 你被攻击\n@守烬人对你挥击，造成3点伤害；你剩余 HP 9/12。");
    expect(victim.metadata).toEqual({
      kind: MEMORY_KINDS.actionObservation,
      stageId: STAGE.id,
      attackerActorId: ACTOR.id,
    });

    expect(bystander.content).toBe("# 战斗\n@守烬人对@提灯修士挥击，造成3点伤害。");
    expect(bystander.content).not.toContain("9/12");
    expect(bystander.metadata).toEqual({
      kind: MEMORY_KINDS.actionObservation,
      stageId: STAGE.id,
      attackerActorId: ACTOR.id,
      targetActorId: TARGET.id,
    });
  });

  it("挥击带上武器仍写作挥击，并区分倒下", () => {
    const armed = { action: "strike" as const, itemName: "断齿刀" };
    expect(renderDamage(STAGE, damage(armed), TARGET.id).content).toBe(
      "# 你被攻击\n@守烬人对你挥击（使用断齿刀），造成3点伤害；你剩余 HP 9/12。",
    );
    expect(
      renderDamage(STAGE, damage({ ...armed, damage: 12, remainingHp: 0 }), TARGET.id).content,
    ).toBe("# 你被攻击\n@守烬人对你挥击（使用断齿刀），造成12点伤害；你倒下了。");
    expect(renderDamage(STAGE, damage({ damage: 12, remainingHp: 0 }), "actor-3").content).toBe(
      "# 战斗\n@守烬人对@提灯修士挥击，造成12点伤害；@提灯修士倒下了。",
    );
  });

  it("肉搏与挥击共用战斗标题，但措词各自锁定", () => {
    const brawl = damage({ action: "brawl" });
    expect(renderDamage(STAGE, brawl, TARGET.id).content).toBe(
      "# 你被攻击\n@守烬人对你肉搏，造成3点伤害；你剩余 HP 9/12。",
    );
    expect(renderDamage(STAGE, brawl, "actor-3").content).toBe(
      "# 战斗\n@守烬人对@提灯修士肉搏，造成3点伤害。",
    );
  });

  it("使用道具造成伤害时写作使用，不冒充挥击", () => {
    const using = damage({ action: "use", itemName: "松脂火把", damage: 13, remainingHp: 0 });
    expect(renderDamage(STAGE, using, TARGET.id).content).toBe(
      "# 你被使用道具\n@守烬人对你使用松脂火把，造成13点伤害；你倒下了。",
    );
    expect(renderDamage(STAGE, using, "actor-3").content).toBe(
      "# 场景动态\n@守烬人对@提灯修士使用松脂火把，造成13点伤害；@提灯修士倒下了。",
    );
  });
});

describe("item observations", () => {
  const steal: ItemObservation = {
    actor: ACTOR,
    itemName: "旧钥匙",
    event: "steal",
    target: OTHER,
  };
  const give: ItemObservation = { actor: ACTOR, itemName: "旧钥匙", event: "give", target: OTHER };
  const pickup: ItemObservation = { actor: ACTOR, itemName: "旧钥匙", event: "pickup" };

  it("私密事件只给当事人视角", () => {
    const view = renderItemEvent(STAGE, steal, OTHER.id);
    expect(view.content).toBe("# 你被窃取\n@守烬人从你身上取走了旧钥匙。");
    expect(view.metadata).toEqual({
      kind: MEMORY_KINDS.actionObservation,
      stageId: STAGE.id,
      itemName: "旧钥匙",
    });
  });

  it("给予事件分当事人与旁观两版", () => {
    expect(renderItemEvent(STAGE, give, OTHER.id).content).toBe(
      "# 你收到物品\n@守烬人把旧钥匙交给了你。",
    );
    const bystander = renderItemEvent(STAGE, give, "actor-3");
    expect(bystander.content).toBe("# 场景动态\n@守烬人把旧钥匙交给了@提灯修士。");
    expect(bystander.metadata.targetActorId).toBe(OTHER.id);
  });

  it("拾取没有目标，也不带当事人视角", () => {
    const view = renderItemEvent(STAGE, pickup, "actor-3");
    expect(view.content).toBe("# 场景动态\n@守烬人拾取了旧钥匙。");
    expect(view.metadata.targetActorId).toBeUndefined();
  });

  it("使用事件覆盖对人与对场景两种视角", () => {
    const onActor: ItemObservation = {
      actor: ACTOR,
      itemName: "火把",
      event: "use",
      target: OTHER,
    };
    expect(renderItemEvent(STAGE, onActor, OTHER.id).content).toBe(
      "# 你被使用道具\n@守烬人对你使用了火把。",
    );
    expect(renderItemEvent(STAGE, onActor, "actor-3").content).toBe(
      "# 场景动态\n@守烬人对@提灯修士使用了火把。",
    );

    const onStage: ItemObservation = {
      actor: ACTOR,
      itemName: "火把",
      event: "use",
      targetStageName: "灰烬门廊",
      targetAnchor: "东墙",
    };
    const view = renderItemEvent(STAGE, onStage, "actor-3");
    expect(view.content).toBe("# 场景动态\n@守烬人在灰烬门廊的东墙使用了火把。");
    expect(view.metadata).toMatchObject({ targetStageName: "灰烬门廊", targetAnchor: "东墙" });
    expect(view.metadata.targetActorId).toBeUndefined();
  });
});

describe("communication observations", () => {
  const message = "别出声。";

  it("耳语只有对方视角，且标为私密", () => {
    const whisper: CommunicationObservation = {
      source: ACTOR,
      message,
      kind: "whisper",
      target: OTHER,
    };
    const view = renderCommunication(STAGE, whisper, OTHER.id);
    expect(view.content).toBe("# 你听见\n@守烬人对你耳语（场景：灰烬门廊）：别出声。");
    expect(view.metadata).toMatchObject({ visibility: "private", targetActorId: OTHER.id });
  });

  it("公开说话区分受话者与旁观者", () => {
    const say: CommunicationObservation = { source: ACTOR, message, kind: "say", target: OTHER };
    expect(renderCommunication(STAGE, say, OTHER.id).content).toBe(
      "# 你听见\n@守烬人对你说（场景：灰烬门廊）：别出声。",
    );
    expect(renderCommunication(STAGE, say, "actor-3").content).toBe(
      "# 你听见\n@守烬人对@提灯修士说（场景：灰烬门廊）：别出声。",
    );
    expect(renderCommunication(STAGE, say, "actor-3").metadata).toMatchObject({
      visibility: "stage",
      sourceActorId: ACTOR.id,
      targetActorId: OTHER.id,
    });
  });

  it("公开宣告没有目标", () => {
    const view = renderCommunication(
      STAGE,
      { source: ACTOR, message: "都别动。", kind: "announce" },
      "actor-3",
    );
    expect(view.content).toBe("# 你听见\n@守烬人公开说（场景：灰烬门廊）：都别动。");
    expect(view.metadata).not.toHaveProperty("targetActorId");
  });
});

describe("plain observations", () => {
  it("环境与行动观察只换 kind", () => {
    expect(renderEnvironmentChange("# 环境变化\n有人进入。", STAGE.id).metadata).toEqual({
      kind: MEMORY_KINDS.environmentObservation,
      stageId: STAGE.id,
    });
    expect(renderAction("# 场景动态\n有人离开。", STAGE.id).metadata).toEqual({
      kind: MEMORY_KINDS.actionObservation,
      stageId: STAGE.id,
    });
  });
});
