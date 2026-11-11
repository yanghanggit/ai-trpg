import { describe, expect, it } from "vitest";
import { ACTION_SUMMARIES } from "../src/game/actions";
import { STAT_LABELS } from "../src/game/kernel/attributes";
import { MECHANISM_TERMS, renderMechanismTerms } from "../src/game/mechanism-terms";

/**
 * 机制词汇表是「题材包络」的唯一实现：语义审查注入它、确定性测试对照它。
 * 这里守两件事——派生源没漏，注入文本始终分组完整。
 */
describe("mechanism terms", () => {
  it("covers every action name and label", () => {
    for (const [kind, label] of Object.entries(ACTION_SUMMARIES)) {
      expect(MECHANISM_TERMS).toContain(kind);
      expect(MECHANISM_TERMS).toContain(label);
    }
  });

  it("covers every stat name and label", () => {
    for (const [key, label] of Object.entries(STAT_LABELS)) {
      expect(MECHANISM_TERMS).toContain(key);
      expect(MECHANISM_TERMS).toContain(label);
    }
  });

  it("carries the terms whose wording looks genre-bound", () => {
    // 这几条没有从类型派生：它们是动作或寻址规则的短称，词面带题材味但指机制。
    for (const term of ["窃取", "搜刮", "挥击", "横扫", "传音", "真名", "禁传"]) {
      expect(MECHANISM_TERMS).toContain(term);
    }
  });

  it("renders grouped lists with no empty entries", () => {
    const rendered = renderMechanismTerms();

    expect(rendered.split("\n")).toHaveLength(4);
    expect(rendered).toContain("动作名（工具标识符）：");
    expect(rendered).toContain("动作的中文标签：");
    expect(rendered).toContain("属性名：");
    expect(rendered).toContain("机制术语：");
    expect(rendered).not.toMatch(/[：/]\s*[、/]/);
  });
});
