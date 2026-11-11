import type { RagEvalSet } from "../../src/rag/types";

/**
 * 鸦葬岗的知识库检索评测集。
 *
 * 与 `crow-grave.knowledge.ts` 同目录维护：改文案时一起改用例，改剧本时一起加用例。
 * 每条知识至少要有一个正例覆盖（`pnpm rag:eval` 会检查），`expect` 必须是该条目的唯一片段。
 */
export const CROW_GRAVE_EVAL: RagEvalSet = {
  positive: [
    {
      question: "鸦葬岗是什么地方",
      keywords: "鸦葬岗 灰墙镇 乱葬岗",
      expect: "黑疖病最盛时留下的乱葬岗",
    },
    {
      question: "鸦葬岗的坟有什么特点",
      keywords: "鸦葬岗 坟 木牌",
      expect: "木牌比墓碑多",
    },
    {
      question: "鸦葬岗西侧的锁石是做什么的",
      keywords: "鸦葬岗 锁石 铁钉",
      expect: "收尸人用铁钉把石窖封死",
    },
    {
      question: "守夜塔的钥匙在谁手里",
      keywords: "守夜塔 塔门 钥匙",
      expect: "钥匙由收尸人保管",
    },
    {
      question: "鸦葬岗坡上的新坟是谁的",
      keywords: "鸦葬岗 新坟 瘟疫",
      expect: "没有名字的新坟",
    },
    {
      question: "瘟疫时收尸人怎么处理死者",
      keywords: "瘟疫 收尸人 石窖",
      expect: "雇收尸人把死者拖到鸦葬岗",
    },
    {
      question: "收尸人的骨牌是做什么的",
      keywords: "收尸人 尸车 骨牌",
      expect: "每收一具就划一道",
      access: ["收尸人"],
    },
    {
      question: "收尸人为什么不打开石窖",
      keywords: "收尸人 封窖 疫气",
      expect: "打开石窖会把疫气放出来",
    },
    {
      question: "黑疖病是怎么传染的",
      keywords: "黑疖病 传播",
      expect: "通过咳嗽、伤口和接触尸体传播",
    },
    {
      question: "瘟疫时村镇怎么处理死者",
      keywords: "瘟疫 死者 鸦葬岗",
      expect: "换一车石灰",
    },
    {
      question: "瘟疫时烧石灰有用吗",
      keywords: "瘟疫 石灰 坟坑",
      expect: "石灰只让死人烂得更慢",
    },
    {
      question: "鸦猎是做什么的",
      keywords: "鸦猎 猎人 团伙",
      expect: "杀红了眼、停不下来",
    },
    {
      question: "鸦猎追什么",
      keywords: "鸦猎 名单 钩刃",
      expect: "只追自己的名单",
    },
    {
      question: "鸦猎名单上的名字被划掉意味着什么",
      keywords: "鸦猎 名单 划掉 名字",
      expect: "划掉一个名字",
    },
    {
      question: "守夜塔是做什么用的",
      keywords: "守夜塔 望楼 烽火",
      expect: "用来望疫烟、点烽火",
    },
    {
      question: "守夜塔的塔顶有什么",
      keywords: "守夜塔 火盆 火绳",
      expect: "火绳从梁上垂下来",
    },
    {
      question: "骨炭窑收骨头做什么",
      keywords: "骨炭窑 骨头 骨炭",
      expect: "骨炭能滤水、压疫气",
    },
  ],
  negative: [
    { question: "收尸人卡尔为什么疯", keywords: "卡尔 疯 原因" },
    { question: "封尸窖里有什么", keywords: "封尸窖 窖底" },
    { question: "新坟里埋的是谁", keywords: "新坟 埋 谁" },
    { question: "鸦葬岗一共有多少具尸体", keywords: "鸦葬岗 尸体 数量" },
    { question: "收尸人卡尔现在在哪里", keywords: "卡尔 现在 位置" },
  ],
};
