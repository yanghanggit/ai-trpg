import type { RagEvalSet } from "../../src/rag/types";

/**
 * 灰炉墓园的知识库检索评测集。
 *
 * 与 `crow-bell.knowledge.ts` 同目录维护：改文案时一起改用例，改剧本时一起加用例。
 * 每条知识至少要有一个正例覆盖（`pnpm rag:eval` 会检查），`expect` 必须是该条目的唯一片段。
 */
export const CROW_BELL_EVAL: RagEvalSet = {
  positive: [
    {
      question: "灰炉墓园是做什么用的",
      keywords: "灰炉墓园 铸钟匠 猎手",
      expect: "铸钟匠与猎手共用",
    },
    { question: "墓园中央有什么", keywords: "墓园 中央 空钟架", expect: "空钟架" },
    {
      question: "墓园北侧的门通向哪里",
      keywords: "墓园 北侧 木门 钟楼",
      expect: "锁着的木门",
    },
    {
      question: "墓园西侧的石壁有什么痕迹",
      keywords: "墓园 西侧 石壁 灰泥",
      expect: "灰泥抹过的缝",
    },
    {
      question: "铸钟场的钟声有什么用",
      keywords: "铸钟场 钟声 报时",
      expect: "报时、报丧和驱赶瘟疫",
    },
    {
      question: "铸钟时往模子里放什么",
      keywords: "铸钟 模子 骨灰",
      expect: "骨灰、黏土和蜡",
    },
    { question: "铸坏的钟怎么处理", keywords: "铸坏 钟 废井", expect: "推进废井" },
    { question: "安魂钟响过吗", keywords: "安魂钟 响", expect: "它铸成后从没响过" },
    {
      question: "钟舌坏了能换吗",
      keywords: "钟舌 换 配",
      expect: "一截钟舌能配好几口钟",
    },
    {
      question: "黑疖病是怎么传染的",
      keywords: "黑疖病 传播",
      expect: "通过咳嗽、伤口和接触尸体传播",
    },
    {
      question: "瘟疫时村镇怎么处理死者",
      keywords: "瘟疫 死者 灰炉墓园",
      expect: "换一口小钟",
    },
    {
      question: "瘟疫时的钟声有用吗",
      keywords: "瘟疫 钟声 驱疫",
      expect: "钟声只让死人走得更快",
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
      question: "钟楼的门平时开着吗",
      keywords: "钟楼 门 锁",
      expect: "门锁着",
    },
    {
      question: "钟楼的钟绳是什么样的",
      keywords: "钟楼 钟绳 黑蜡",
      expect: "绳头结着黑蜡",
    },
  ],
  negative: [
    { question: "灰炉铸钟场一共有多少匠人", keywords: "铸钟场 匠人 人数" },
    { question: "钟父的妻子叫什么名字", keywords: "钟父 妻子 名字" },
    { question: "钟井里到底有什么", keywords: "钟井 井底" },
    { question: "鸦猎的名单上写着谁", keywords: "鸦猎 名单 名字" },
    { question: "安魂钟是哪一年铸的", keywords: "安魂钟 年份" },
  ],
};
