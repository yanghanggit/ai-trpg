# 内容与验收

## 1. 断桥客栈缺一件带敏捷的装备

顺位是「开一条时按敏捷现值排好的快照」；换装不回写快照，靠的是回合开始时按当前敏捷重排。想正面验证这条，需要一件带敏捷的装备——`apps/server/seeds/dark-fantasy/broken-bridge-inn.ts` 里没有。

- 要么给种子加一件（注意同时更新随附的内容说明），要么走查时临时改数据。
- 不验证的风险：这条规则只在文档里成立，没有任何用例压过。

## 2. 收尾路径

断桥客栈只声明 `submit_environment` / `notify_world`，结局由 world 裁决。所以完整走查必须真的推到 world，否则永远收不了尾。

- 验收：推完一个完整行动轮 → world 回合落账 → 局的状态从 `active` 变掉（或 world 明确判「还没到时候」）。
- 相关：`docs/stage.md`、`docs/action-order.md`。
