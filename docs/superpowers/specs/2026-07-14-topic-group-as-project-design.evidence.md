# 证据包 — 话题群作为 Project（spec 评审）

- 对应 spec：`2026-07-14-topic-group-as-project-design.md`
- 评审日期：2026-07-14
- 交叉审锚：codex（两轮，verbatim 结论见 (c)）

## (a) Per-requirement verdict

口径：`满足` 仅当 完成条件机器可验 + 同字段边界存在 + low/high 风险分级齐全（三件）。high-risk 且 verdict=满足 标注 codex 复核结果。

| §ref | verbatim 要点 | artifact | verdict | 风险 | codex |
|---|---|---|---|---|---|
| R1 建话题群 | `createTopicChat(name, inviteOpenId)` 直连 raw SDK 传 `chat_mode:"topic"` + `user_id_list`；真实 API 验 `getChatMode==='topic'`；边界要求真实 API、不得 mock 凑 | §4 R1 / §3 | 满足 | high | ADEQUATE ✅ |
| R1b 建群带 path | 末尾 `/`或`~` 开头 token=path、rest=name；非法 path **建群前**拒绝不留孤儿 | §4 R1b | 满足 | low | RESOLVED ✅ |
| R2 话题群 /cd 写群级 | topic 模式 setCwd(chatId)；interrupt+清当前话题 session；普通群行为不变 | §4 R2 | 满足 | medium | 未单独否（重置 session 决策已并入） |
| R3 话题 cwd 回退群级 | `cwdForScope`：topic scope(`oc_:`)→群级，否则旧逻辑；测试④ `comment:xxx` 不误判；不保留 per-topic 层 | §4 R3 / §3 | 满足 | high | ADEQUATE ✅ |
| R4 更新现有 welcome | 改 `handleNewChat` 现有文案两条提示；不新增发送路径 | §4 R4 | 满足 | low | — |

## (b) 未覆盖扫描

| §ref | 未覆盖项 | 性质 |
|---|---|---|
| — | （空）codex 两轮所列问题（矛盾/歧义/YAGNI/三件/comment: 误判/inviteOpenId）均已修复并经 codex round-2 确认 RESOLVED 或 inline 修复 | — |

## (c) 交叉审（codex）

- **codex 状态**：available（两轮均成功）。
- **round-1 结论（verbatim 摘要）**：R1、R3 均 **INADEQUATE**（边界非同字段 / 不能阻止失败模式；R3 colon 启发式误伤 `comment:xxx`）；另列 6 类问题（R1b 待决矛盾、/cd 重置待决矛盾、per-topic 留口与 YAGNI 矛盾、R1"等效"无边界、R1b 路径解析/时机歧义、R1 单测层级不清）。三件：5 条齐全，无缺。
- **round-2 结论（续上一轮，verbatim 摘要）**：**6 处全部 RESOLVED**；**R1 → ADEQUATE**（机器可验 yes / 同字段边界 yes / 阻止失败 yes）；**R3 → ADEQUATE**（同上三项 yes，`comment:xxx` 误分类无反例）。新发现 1 项：`createTopicChat` 漏 `inviteOpenId`（会建 bot 独占群，发起者不可见）→ **已 inline 修复**（§3 + R1 带 `user_id_list:[senderId]`，沿用现有 `createBoundChat` 约定）。
- **cross-model 补充**：无（round-2 无新增未决项；inviteOpenId 为加法修复，不削弱 R1 边界，verdict 仍 ADEQUATE）。

## 状态
- **blocker / major：清零**（R1/R3 high-risk 经 codex 复核 ADEQUATE；所有 finding 已解决）。
- 仅剩 advisory：无。
- **交付 codesop spec-gate 人审。**
