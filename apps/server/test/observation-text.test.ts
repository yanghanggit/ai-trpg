import { describe, expect, it } from "vitest";
import { MEMORY_KINDS } from "../src/game/constants";
import {
  type CommunicationObservation,
  type DamageObservation,
  damageActionText,
  type ItemObservation,
  renderAction,
  renderCommunication,
  renderDamage,
  renderEnvironment,
  renderItemEvent,
} from "../src/game/observation-text";

const STAGE = { id: "stage-1", name: "灰烬门廊" };
const ACTOR = { id: "actor-1", name: "守烬人" };
const OTHER = { id: "actor-2", name: "提灯修士" };
const TARGET = { ...OTHER, maxHp: 12 };

const damage = (overrides: Partial<DamageObservation> = {}): DamageObservation => ({
  action: "attack",
  attacker: ACTOR,
  target: TARGET,
  damage: 3,
  remainingHp: 9,
  ...overrides,
});

describe("damageActionText", () => {
  it("句式由动作锁定：攻击的主体是攻击，使用的主体是使用", () => {
    expect(damageActionText("attack")).toBe("攻击");
    expect(damageActionText("attack", "断齿刀")).toBe("攻击（使用断齿刀）");
    expect(damageActionText("use", "松脂火把")).toBe("使用松脂火把");
  });
});

describe("damage observations", () => {
  it("只有受害者视角带剩余生命", () => {
    const victim = renderDamage(STAGE, damage(), TARGET.id);
    const bystander = renderDamage(STAGE, damage(), "actor-3");

    expect(victim.content).toBe("# 你被攻击\n守烬人对你攻击，造成3点伤害；你剩余 HP 9/12。");
    expect(victim.metadata).toEqual({
      kind: MEMORY_KINDS.actionObservation,
      stageId: STAGE.id,
      attackerActorId: ACTOR.id,
    });

    expect(bystander.content).toBe("# 战斗\n守烬人对提灯修士攻击，造成3点伤害。");
    expect(bystander.content).not.toContain("9/12");
    expect(bystander.metadata).toEqual({
      kind: MEMORY_KINDS.actionObservation,
      stageId: STAGE.id,
      attackerActorId: ACTOR.id,
      targetActorId: TARGET.id,
    });
  });

  it("攻击带上武器仍写作攻击，并区分倒下", () => {
    const armed = { action: "attack" as const, itemName: "断齿刀" };
    expect(renderDamage(STAGE, damage(armed), TARGET.id).content).toBe(
      "# 你被攻击\n守烬人对你攻击（使用断齿刀），造成3点伤害；你剩余 HP 9/12。",
    );
    expect(
      renderDamage(STAGE, damage({ ...armed, damage: 12, remainingHp: 0 }), TARGET.id).content,
    ).toBe("# 你被攻击\n守烬人对你攻击（使用断齿刀），造成12点伤害；你倒下了。");
    expect(renderDamage(STAGE, damage({ damage: 12, remainingHp: 0 }), "actor-3").content).toBe(
      "# 战斗\n守烬人对提灯修士攻击，造成12点伤害；提灯修士倒下了。",
    );
  });

  it("使用道具造成伤害时写作使用，不冒充攻击", () => {
    const using = damage({ action: "use", itemName: "松脂火把", damage: 13, remainingHp: 0 });
    expect(renderDamage(STAGE, using, TARGET.id).content).toBe(
      "# 你被使用道具\n守烬人对你使用松脂火把，造成13点伤害；你倒下了。",
    );
    expect(renderDamage(STAGE, using, "actor-3").content).toBe(
      "# 场景动态\n守烬人对提灯修士使用松脂火把，造成13点伤害；提灯修士倒下了。",
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
    expect(view.content).toBe("# 你被窃取\n守烬人从你身上取走了旧钥匙。");
    expect(view.metadata).toEqual({
      kind: MEMORY_KINDS.actionObservation,
      stageId: STAGE.id,
      itemName: "旧钥匙",
    });
  });

  it("给予事件分当事人与旁观两版", () => {
    expect(renderItemEvent(STAGE, give, OTHER.id).content).toBe(
      "# 你收到物品\n守烬人把旧钥匙交给了你。",
    );
    const bystander = renderItemEvent(STAGE, give, "actor-3");
    expect(bystander.content).toBe("# 场景动态\n守烬人把旧钥匙交给了提灯修士。");
    expect(bystander.metadata.targetActorId).toBe(OTHER.id);
  });

  it("拾取没有目标，也不带当事人视角", () => {
    const view = renderItemEvent(STAGE, pickup, "actor-3");
    expect(view.content).toBe("# 场景动态\n守烬人拾取了旧钥匙。");
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
      "# 你被使用道具\n守烬人对你使用了火把。",
    );
    expect(renderItemEvent(STAGE, onActor, "actor-3").content).toBe(
      "# 场景动态\n守烬人对提灯修士使用了火把。",
    );

    const onStage: ItemObservation = {
      actor: ACTOR,
      itemName: "火把",
      event: "use",
      targetStageName: "灰烬门廊",
      targetDetail: "东墙",
    };
    const view = renderItemEvent(STAGE, onStage, "actor-3");
    expect(view.content).toBe("# 场景动态\n守烬人在灰烬门廊的东墙使用了火把。");
    expect(view.metadata).toMatchObject({ targetStageName: "灰烬门廊", targetDetail: "东墙" });
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
    expect(view.content).toBe("# 你听见\n守烬人对你耳语（场景：灰烬门廊）：别出声。");
    expect(view.metadata).toMatchObject({ visibility: "private", targetActorId: OTHER.id });
  });

  it("公开说话区分受话者与旁观者", () => {
    const say: CommunicationObservation = { source: ACTOR, message, kind: "say", target: OTHER };
    expect(renderCommunication(STAGE, say, OTHER.id).content).toBe(
      "# 你听见\n守烬人对你说（场景：灰烬门廊）：别出声。",
    );
    expect(renderCommunication(STAGE, say, "actor-3").content).toBe(
      "# 你听见\n守烬人对提灯修士说（场景：灰烬门廊）：别出声。",
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
    expect(view.content).toBe("# 你听见\n守烬人公开说（场景：灰烬门廊）：都别动。");
    expect(view.metadata).not.toHaveProperty("targetActorId");
  });
});

describe("plain observations", () => {
  it("环境与行动观察只换 kind", () => {
    expect(renderEnvironment("# 环境变化\n有人进入。", STAGE.id).metadata).toEqual({
      kind: MEMORY_KINDS.environmentObservation,
      stageId: STAGE.id,
    });
    expect(renderAction("# 场景动态\n有人离开。", STAGE.id).metadata).toEqual({
      kind: MEMORY_KINDS.actionObservation,
      stageId: STAGE.id,
    });
  });
});
