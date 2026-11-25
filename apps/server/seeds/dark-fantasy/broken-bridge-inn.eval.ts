import type { RagEvalSet } from "../../src/rag/types";

/**
 * 断桥客栈的知识库检索评测集。
 *
 * 与 `broken-bridge-inn.knowledge.ts` 同目录维护：改文案时一起改用例。
 * 每条知识至少有一个正例覆盖（`pnpm rag:eval` 会检查），`expect` 必须是该条目的唯一片段。
 */
export const BROKEN_BRIDGE_INN_EVAL: RagEvalSet = {
  positive: [
    {
      question: "断桥客栈在哪里",
      keywords: "断桥客栈 河谷 桥北",
      expect: "桥北最后一间还开着门的客栈",
    },
    {
      question: "断桥客栈的炉厅夜里能待吗",
      keywords: "断桥客栈 炉厅 火 天亮",
      expect: "整夜烧着火",
    },
    {
      question: "断桥客栈楼上还能住人吗",
      keywords: "断桥客栈 楼上 客房",
      expect: "楼上客房已经封死",
    },
    {
      question: "断桥为什么叫断桥",
      keywords: "断桥 石墩 桥面",
      expect: "中间一段桥面",
    },
    {
      question: "断桥塌了以后怎么过河",
      keywords: "断桥 过河 山路 浅滩",
      expect: "绕两天的山路",
    },
    {
      question: "河谷的雨季在什么时候",
      keywords: "河谷 雨季 秋末",
      expect: "雨季在秋末",
    },
    {
      question: "断桥往北是哪里",
      keywords: "断桥 往北 灰墙镇",
      expect: "往北走两天",
    },
    {
      question: "黑疖病时客栈做什么",
      keywords: "黑疖病 客栈 尸体",
      expect: "替他们烧过尸体",
    },
    {
      question: "断桥之后盐价为什么涨了",
      keywords: "盐 河谷 断桥",
      expect: "盐价涨了",
    },
  ],
  negative: [
    { question: "温娜为什么锯断桥桩", keywords: "温娜 桥桩 锯断" },
    { question: "戈特的骡子在哪里", keywords: "戈特 骡子 南岸" },
    { question: "披斗篷的旅人在等谁", keywords: "旅人 等 谁" },
    { question: "柜台下的陶罐里装的是什么", keywords: "柜台 陶罐" },
    { question: "炉厅里现在坐着几个人", keywords: "炉厅 现在 几个人" },
    { question: "账本最后一页写着谁的名字", keywords: "账本 最后一页 名字" },
  ],
};
