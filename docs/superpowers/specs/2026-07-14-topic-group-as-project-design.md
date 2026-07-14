# 话题群作为 Project、话题作为并行 Session

- 日期：2026-07-14
- 状态：设计待审
- 关联探活（2026-07-14 已实测，脚本已清理）：真调飞书 API 传 `chat_mode:"topic"` 建群 → `im.v1.chat.get` 返回 `chat_mode:"topic"` → bridge `getChatMode` 识别为 `topic`。建群用 `im:chat:create`（app 已有）。

## 1. 背景与目标

用户希望把飞书 IM 用成一个轻量"多会话工作台"：

- **一个飞书话题群 = 一个 Project**。
- **群内每个话题 = 一个独立、并行的 Session**（各自的 session / cwd / active-run / 队列）。
- 话题由用户在飞书客户端用右侧 `+` **原生创建**（不需要 bot 命令）。
- 整个群共用一个**项目工作区**（cwd），话题自动继承。

现有架构已支持话题群模式（`chatMode:'topic'` → scope=`chatId:threadId`，每话题独立 session/cwd/run），唯一缺口是：①`/new chat` 只能建普通群；②话题群无顶层聊天面，无法在群级 `/cd`；③话题 cwd 不会回退到群级。

## 2. 范围

**做（in）：**
- R1 `/new chat` 建话题群（`chat_mode:"topic"`）。
- R2 `/cd <path>` 在话题群里发 → 写到**群级**（chatId）工作区。
- R3 话题 scope 的 cwd 解析回退到群级（覆盖 run/命令/catalog 三个解析点）。
- R4 更新 `/new chat` **现有** welcome 文案（提示 `+` 建话题 / `/cd` 设工作区）——非新增子系统，仅改现有欢迎语（`handleNewChat` 现在就发 welcome）。
- R5 `/resume` 在**话题群的话题里**可用（当前被 `chatMode !== 'p2p'` 守卫挡掉）。

**不做（out）：**
- 两个 bot 同群（用户已决定手建群、一群一 agent）。
- `/session` 建话题命令（删除——飞书原生 `+` 建话题即可）。
- bridge 自动把普通群转话题群（直接建话题群，无需转换）。
- bot 主动建话题（不需要——用户用飞书 `+`）。
- 话题级 cwd 覆盖（YAGNI——一个项目 = 一个工作区）。
- 建群时带路径 `/new chat <name> <path>`（原 R1b，YAGNI 删除——R2 已能在任意话题 `/cd` 设群级工作区，不必建群时设；省掉 name/path 解析与边界）。

## 3. 架构与数据流

```
/new chat myproj
   └─ handleNewChat
       ├─ createTopicChat(name, inviteOpenId=senderId) → channel.createChat({
       │       chatMode: 'topic' as 'group',          // 局部 cast：TS 类型限 'group'，wrapper 运行时透传 chat_mode
       │       name, chatType: 'private',
       │       inviteUserIds: [inviteOpenId], userIdType: 'open_id'
       │     })   （复用 @larksuite/channel 包装层的 token/client/错误处理；2026-07-14 wrapper 路径探活实测
       │            createChat→getChatMode='topic' 端到端通过；inviteOpenId 沿用 createBoundChat 的 senderId 约定）
       └─ send welcome（现有欢迎语改为：提示 + 建话题 / /cd 设工作区）

用户在飞书点 + 建话题 → 在话题里发消息
   └─ intake → scope = `${chatId}:${threadId}`  （现有逻辑不变；chatId 形如 oc_xxx）
       └─ run-flow 解析 cwd（新 helper WorkspaceStore.cwdForScope(scope)）：
            若 scope 是 topic scope（oc_xxx:threadId）→ cwdFor(chatId=oc_xxx)   ← 群级项目工作区 ★新增
            否则（p2p/group 裸 chatId / comment:xxx）→ cwdFor(scope)             ← 行为不变
            仍无 → profileConfig.workspaces.default                              ← 现有兜底

/cd /another/path  （在某话题里发）
   └─ handleCd [chatMode==='topic' 分支]
       └─ workspaces.setCwd(chatId, realpath(path))   ← 写群级而非话题 scope；interrupt 当前话题 run + 清当前话题 session
```

**关键事实（探活已坐实）：**
- `@larksuite/channel` 的 `createChat` 把 `chatMode` 的 **TS 类型**限死为 `'group'`，但**运行时只透传 `chat_mode` 字段**（源码 `chat_mode: opts.chatMode ?? "group"`，无校验）；飞书接受 `"topic"`，`im.v1.chat.get` 返回 `chat_mode:"topic"`，bridge `getChatMode` 据此识别为 `topic`。本方案**经 wrapper 传 `chatMode:'topic'`**（局部 `as 'group'` cast 绕过类型限制，复用 wrapper 全部基建）——wrapper 路径探活已实测端到端通过（createChat → getChatMode 返回 `'topic'`）。
- cwd 解析现有 3 处：`src/bot/run-flow.ts:79`、`src/commands/index.ts:744 (effectiveWorkspaceCwd)`、`src/bot/session-catalog-identity.ts:20`，模式均为 `cwdFor(scope) ?? default`；本次统一改调 `cwdForScope(scope) ?? default`。
- **topic scope 精确识别**：chatId 固定为 `oc_` 前缀（飞书 chat_id 规范），话题 scope 形如 `oc_xxx:omt_yyy`。helper 用 `scope.startsWith('oc_') && scope.indexOf(':')>0` 判定，**不会误伤 `comment:xxx` 等 scope**（见 R3 边界测试）。

## 4. 需求（每条带 三件：完成条件 + 边界 + 风险分级）

### R1 — `/new chat` 创建话题群
- **完成条件**（机器可验）：
  - 新增 `createTopicChat(name, inviteOpenId)`：调 `channel.createChat({ chatMode: 'topic' as 'group', name, chatType: 'private', inviteUserIds: [inviteOpenId], userIdType: 'open_id' })`（经 `@larksuite/channel` wrapper，局部 cast 传 `chat_mode:"topic"`）；`handleNewChat` 传入 `inviteOpenId = ctx.msg.senderId`（沿用现有 `createBoundChat` 约定，确保发起者进群）；
  - 单元测试：mock `channel.createChat`，断言被调用、`chatMode === 'topic'`、且 `inviteUserIds` 含传入的 `inviteOpenId`；
  - 集成验证（真实 API，非 mock）：`/new chat <name>` 建群后 `channel.getChatMode(newChatId) === 'topic'`；
  - `grep -n "chat_mode.*topic"` 命中 `createTopicChat` 实现处。
  - 前置权限：app 需 `im:chat:create`（探活已确认 app 有；细粒度即可，**不要**申请完整 `im:chat`，见 memory `feishu-app-granular-scopes-only`）。
- **边界**（同字段 anti-Goodhart，针对 `chat_mode`/群类型这个结果字段）：
  - 集成验证的 `getChatMode==='topic'` **必须打真实飞书 API**——不接受"建普通群 + mock getChatMode 返回 topic"来凑过完成条件；
  - `createTopicChat` 必须显式传 `chatMode:'topic'`（grep 可见），不得靠默认 `'group'` 或省略字段碰巧命中。
- **其他边界**（行为字段，非 anti-Goodhart）：不改裸 `/new`（重置 session）语义；`/new chat` 不再建普通群（未来需要另开参数，不在本次）；建群失败（权限/网络）走现有错误提示路径，不静默。
- **风险分级：high** — 改公共命令行为 + 外部 API + 直连 raw SDK 绕过 `@larksuite/channel` 类型限制。

### R2 — 话题群 `/cd` 写群级工作区
- **完成条件**：
  - 在话题群某话题发 `/cd <abs_path>` 后，`workspaces.cwdFor(chatId) === realpath(path)`（chatId，**非** topic scope）；
  - 单元测试覆盖 `handleCd` 在 `chatMode==='topic'` 时以 chatId 调 `setCwd`；
  - 回复文案明确"已设为本群所有话题共用的工作区"。
- **边界**：
  - 普通群 / p2p 的 `/cd` 行为不变（仍按 scope）；
  - 非法/过宽路径仍被 `resolveWorkingDirectory` 拒绝（不绕过现有安全检查）；
  - `/cd` 仍 interrupt 当前 scope 的 run + 清当前话题 session（与现有 /cd 语义一致，仅作用于发起的话题）。
- **风险分级：medium** — 仅 topic 分支改 `/cd`，但 `/cd` 是 admin 命令且影响 run。

### R3 — 话题 cwd 回退群级（3 个解析点）
- **完成条件**：
  - 新增 `WorkspaceStore.cwdForScope(scope)`：topic scope（`oc_xxx:threadId`）→ 返回 `cwdFor(chatId)`；其余 scope（裸 chatId / `comment:xxx`）→ 返回 `cwdFor(scope)`；都无则返回 `undefined`（由调用方 `?? default`）。
  - `run-flow.ts:79`、`commands/index.ts effectiveWorkspaceCwd`、`session-catalog-identity.ts:20` 三处的 `cwdFor(scope)` 改为 `cwdForScope(scope)`；
  - 单元测试：① topic scope + 群级有 cwd → 返回群级；② topic scope + 群级无 → 返回 undefined（再由调用方回退 default）；③ 裸 chatId（无冒号）→ 等同旧 `cwdFor`；④ **`comment:xxx` scope → 不被当成 topic scope**（返回 `cwdFor('comment:xxx')` 即 undefined，不 split、不误读群级）；
  - 端到端：群 `/cd` 后，新话题里跑任务，agent 进程 cwd = 群级 cwd（日志 `session fresh cwd=...` 印证）。
- **边界**（同字段 anti-Goodhart，针对 cwd 解析结果字段）：
  - topic scope 判定**只认 `oc_` 前缀 + 冒号**——`comment:xxx`、未来任何非 `oc_` 冒号 scope 都不得误判为 topic scope（测试④守住）；
  - 非 topic scope（裸 chatId / comment）解析结果与旧逻辑逐字节相同（行为不变）；
  - **不保留 per-topic cwd 层**——与 §2「话题级 cwd 覆盖 = YAGNI 不做」一致；话题 scope 不读 `cwdFor(scope)` 自身，直接走群级。（若将来要 per-topic，另开 spec，不改本次 helper 契约。）
- **风险分级：high** — 跨 3 个模块，含 run 路径 cwd；改错会让所有话题跑错目录或误伤 comment scope。

### R4 — 更新 `/new chat` 现有 welcome 文案
- **完成条件**：`handleNewChat` 现有 welcome 文案改为包含两条提示：①"点 `+` 建话题开始会话"；②"在本群任意话题 `/cd <path>` 设置项目工作区"。单元测试断言新文案字符串被传入现有发送路径（`channel.send` 的 markdown）——而非仅 `grep` 命中（避免命中注释/死代码的假通过）。
- **边界**：welcome 发送失败不阻塞建群（沿用现有 swallow 行为）；不引入新消息类型/新发送路径，仅改文案。
- **风险分级：low** — 仅字符串改动。

### R5 — `/resume` 在话题群的话题里可用
- **完成条件**：
  - 在话题群的话题里（`chatMode === 'topic'`）发 `/resume` → **不再**被"群聊中不展示历史会话详情"挡掉，走现有 listing 路径：列出当前项目 cwd（群级 cwd）下的历史 session，resumeCard 发到该话题；
  - `/resume use <nonce>` 在该话题能恢复——nonce 绑定该话题 scope，`consumeResumeCandidate` 通过；
  - 单元测试：`handleResume` 在 `chatMode==='topic'` 时不早退、进入 listing 分支；`applyResume` 在 topic scope 下成功恢复。
- **边界**（同字段 anti-Goodhart，针对"哪些 chatMode 放行 /resume"这个结果字段）：
  - 普通群（`chatMode==='group'`）**仍保持现状挡掉**（行为不变，回"群聊中不展示"）——本次只放开 topic；
  - 裸 p2p 的 `/resume` 行为不变；
  - scope/identity 校验不变（`commandSessionCatalogIdentity` 已支持 topic：`scopeId=话题 scope`、policy 传 `threadId`）——不绕过现有 resume 候选校验。
- **风险分级：medium** — 改 `/resume` 守卫（会话命令），但 topic 分支复用现成 listing/apply + scope 机制已支持 topic。
- **advisory（非阻塞）**：话题里 `/resume` 列的是项目 cwd 下所有 session（可能含其他话题跑过的），但 nonce 绑当前话题 → 只能在当前话题恢复。单用户场景可接受。

## 5. 领域语言增量（Domain Language Delta）
- **Project** = 一个飞书话题群。
- **Session** = 群内一个话题（独立并行会话，scope=`chatId:threadId`）。
- **项目工作区 / project workspace** = 群级 cwd（chatId 维度，群内所有话题共用）。
- **主 Session** = 群顶层（无 threadId）消息流；话题群里实际很少用，话题是主要交互单元。

## 6. 决策记录
- **R1b 删除（YAGNI）**：原"建群带路径设工作区"，因 R2 已能在任意话题 `/cd` 设群级工作区，不必建群时设；省掉 name/path 解析与边界。曾进 MVP 又移除。
- **`/cd` 重置当前话题 session = 是**：与现有 `/cd` 语义一致，interrupt 发起话题的 run + 清其 session；其他话题下次 run 自然用新群级 cwd。（此前曾标"待决"，已定，写入 R2 边界。）
- **不保留 per-topic cwd 层**：与 §2「话题级 cwd 覆盖 = YAGNI」一致，R3 helper 不读 topic scope 自身 cwd。（codex 指出原"留口"与 YAGNI 矛盾，已移除。）
- **探活遗留已清理**（2026-07-14）：临时群 `oc_7150521e8839e2f74ce2f3866642bd9c` 已解散（开通细粒度 `im:chat:delete` 后）；4 个一次性探活脚本已删除。

## 7. 验证策略
- 单元：
  - `createTopicChat` 经 wrapper 传 `chatMode:'topic'`（mock `channel.createChat`，断言 `chatMode` + `inviteUserIds`）；
  - `handleCd` 在 `chatMode==='topic'` 时以 chatId 调 `setCwd`、interrupt + 清当前话题 session；
  - `cwdForScope` 回退链：topic scope→群级、裸 chatId→旧逻辑、**`comment:xxx` 不误判**；
  - `handleResume` 在 `chatMode==='topic'` 不早退、进入 listing；`chatMode==='group'` 仍早退回"群聊中不展示"。
- 集成（真实 API，非 mock）：`/new chat <name>` 后 `channel.getChatMode(newChatId)==='topic'`。
- 端到端（用户在真实飞书跑）：`/new chat myproj /code/myproj` → 点 + 建话题 → `/status` 见 topic + cwd → 在话题里发任务，确认 agent 在 `/code/myproj` 工作；另建一话题确认继承同一 cwd；在话题里 `/resume` 能列出+恢复历史 session。
- 回归：普通群 `/cd`、裸 `/new`（重置）、**普通群 `/resume`（仍挡）**、云文档评论（`comment:` scope）不受影响。
