import type { RagEvalSet } from "../../src/rag/types";

/**
 * 枯钟修道院的知识库检索评测集。
 *
 * 与 `bell-monastery.knowledge.ts` 同目录维护：改文案时一起改用例，改剧本时一起加用例。
 * 每条知识至少要有一个正例覆盖（`pnpm rag:eval` 会检查），`expect` 必须是该条目的唯一片段。
 */
export const BELL_MONASTERY_EVAL: RagEvalSet = {
  positive: [
    { question: "修道院为什么叫枯钟", keywords: "枯钟 得名 铜钟", expect: "得名“枯钟”" },
    {
      question: "黑疖病是怎么传染的",
      keywords: "黑疖病 传播",
      expect: "通过咳嗽、伤口和接触尸体传播",
    },
    {
      question: "瘟疫期间的尸体怎么处理",
      keywords: "瘟疫 尸体 撒石灰",
      expect: "修士在墓园地面撒石灰",
    },
    {
      question: "墓园里那些木牌是做什么的",
      keywords: "木牌 日期 无名",
      expect: "用刻着日期和“无名”的木牌记录死者",
    },
    { question: "墓园的土能挖多深", keywords: "墓园 泥土 浅", expect: "挖到一臂深" },
    { question: "乱葬坑是怎么来的", keywords: "乱葬坑 四十多天", expect: "四十多天里挖出来的" },
    {
      question: "地窖以前是做什么用的",
      keywords: "地窖 酒窖 储粮",
      expect: "原本是修道院的酒窖与储粮间",
    },
    { question: "地窖里的粮食去哪了", keywords: "地窖 储粮 鼠群", expect: "储粮与酒被鼠群吃空" },
    {
      question: "焚尸房在什么位置",
      keywords: "焚尸房 焚烧尸体",
      expect: "是修道院焚烧尸体的地方",
    },
    {
      question: "铁闸门为什么被封死",
      keywords: "铁闸门 封死 院长",
      expect: "院长下令把门封死",
    },
    { question: "铁闸门上刻着什么", keywords: "铁闸门 钟形纹", expect: "刻着修道院的钟形纹" },
    {
      question: "修道院各个区域怎么连的",
      keywords: "墓园 中庭 石阶",
      expect: "修道院以墓园为中庭",
    },
    { question: "修道院是用什么建的", keywords: "修道院 灰石 石墙", expect: "外围是一圈石墙" },
    { question: "墓园当年是做什么用的", keywords: "墓园 下葬", expect: "墓园是修道院主要的下葬处" },
    {
      question: "瘟疫期间死者用棺材下葬吗",
      keywords: "棺材 粗麻布 木牌",
      expect: "不给死者用棺材",
    },
  ],
  negative: [
    { question: "修道院一共有多少修士", keywords: "修士 人数" },
    { question: "院长叫什么名字", keywords: "院长 名字" },
    { question: "地窖里有多少只老鼠", keywords: "地窖 老鼠 数量" },
    { question: "修道院是哪一年建的", keywords: "建院 年份" },
  ],
};
