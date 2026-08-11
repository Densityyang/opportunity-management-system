# 架构与核心算法

## 1. 架构边界

系统采用模块化单体，HTTP API 与异步 worker 使用同一业务代码和同一 PostgreSQL 数据库，避免在首版引入分布式事务。Web 仅通过 `/api/v1` 访问后端；音频只能经鉴权接口读取，Nginx 不暴露存储卷。

```mermaid
flowchart LR
  B["手机微信/浏览器或桌面浏览器"] --> N["Nginx + React Web"]
  N --> A["NestJS API"]
  A --> P[("PostgreSQL 18")]
  A --> V[("私有加密音频卷")]
  A --> O["事务 Outbox"]
  O --> W["后台 Worker + pg-boss"]
  W --> P
  W --> V
```

模块职责：

- `auth`：手机号＋密码、服务端会话、首次强制改密、一次性导出再验证令牌。
- `admin`：账号、多角色/多区县授权、区县启停、默认承接路由、留存清理确认。
- `opportunities`：固定问卷、密文快照、可见范围、列表、详情、时间线。
- `workflow`：状态机、审批/处理动作、分派、并发版本、幂等、SLA 轮次、通知和 Outbox。
- `audio`：类型/魔数/大小/时长校验、独立密钥加密、鉴权播放、90 天清理。
- `municipal`：成功商机库、访问审计、流式导出。
- `worker`：Outbox 投递、半程提醒、超时标记、暂缓恢复和到期清理。

## 2. 状态机

```mermaid
stateDiagram-v2
  [*] --> PENDING_FIRST_REVIEW: 一线上报
  PENDING_FIRST_REVIEW --> RETURNED_TO_REPORTER: 区县经理退回
  RETURNED_TO_REPORTER --> PENDING_FIRST_REVIEW: 修改并重新提交
  PENDING_FIRST_REVIEW --> HANDLING: 初审通过并自动分派
  HANDLING --> PAUSED: 暂缓并指定下次时间
  PAUSED --> HANDLING: 提前或到期恢复
  HANDLING --> PENDING_FINAL_REVIEW: 填报成功或失败
  RETURNED_TO_HANDLER --> PENDING_FINAL_REVIEW: 修订结果后重报
  PENDING_FINAL_REVIEW --> RETURNED_TO_HANDLER: 区县经理退回
  PENDING_FINAL_REVIEW --> CLOSED_SUCCESS: 成功结果终审通过
  PENDING_FINAL_REVIEW --> CLOSED_FAILURE: 失败结果终审通过
```

`REASSIGN` 是 `HANDLING` 或 `PAUSED` 内部迁移：状态不变，但当前分派失效、新分派生效，版本号和审计事件均递增。

## 3. 统一状态迁移算法

所有审批、处理结果、暂缓、恢复和改派调用 `WorkflowService.execute()`：

1. 强制读取 `Idempotency-Key`，组成 `用户＋当前授权＋商机＋事件` 作用域并计算请求体 SHA-256。
2. 命中同键同请求时返回原响应；同键不同请求返回 `409 IDEMPOTENCY_KEY_REUSED`。
3. 开启数据库事务，对商机执行 `SELECT … FOR UPDATE`。
4. 再次检查幂等记录，避免并发请求在第一次查询后同时进入。
5. 检查 `expectedVersion`；不一致返回 `409 VERSION_CONFLICT`。
6. 根据当前授权检查角色、区县和当前承接关系；系统管理员没有正文读取或流转权限。
7. 使用 XState 状态机计算下一状态；非法边返回 `422 INVALID_TRANSITION`。
8. 校验事件载荷并更新分派、处理结果、SLA、通知、留存候选和 Outbox。
9. 追加不可变 `workflow_events`，更新状态并将版本加一。
10. 在同一事务写入幂等响应，提交后返回新状态和版本。

这使重复点击、网络重试和两个审批人同时操作都得到确定结果，不依赖前端按钮防抖保证正确性。

## 4. 自动路由算法

键为 `(districtId, customerType)`：

- 初审通过时读取该区县唯一 `district_routing`。
- `PERSONAL` 选 `personalHandlerGrantId`；`ORGANIZATION` 选 `organizationHandlerGrantId`。
- 目标授权必须启用、账号必须有效、角色与客户类型匹配且属于同一区县，否则拒绝初审通过。
- 区县经理可在处理中改派到同区县、同分侧的其他有效授权，且必须填写原因。
- 旧分派立即失效；旧承接人随后失去正文读取权，但历史节点保留。

## 5. SLA 算法

- 初审：每次提交或重报建立独立 `FIRST_REVIEW` 轮次；开始后 12h 提醒、24h 超时。
- 终审：每次承接人提交或重报结果建立独立 `FINAL_REVIEW` 轮次；24h 提醒、48h 超时。
- 审批通过或退回会结束当前轮次；退回后的重新提交创建新轮次，历史轮次不覆盖。
- Outbox 事件投递两个带 `slaRoundId` 的延迟任务。执行时重新检查轮次仍为 `ACTIVE`、时间已到且未处理；重复任务只会无操作返回。
- 超时只标记并通知，不锁死业务动作。

## 6. 暂缓恢复算法

承接人只能为未来一年内的时间创建暂缓。事务写入 `pausedUntil` 和带 `(opportunityId, expectedVersion)` 的 Outbox 事件。worker 到期后再次锁行，仅当状态仍是 `PAUSED`、版本仍匹配且时间已到时恢复；提前恢复、改派或其他版本变化会使旧任务自动失效。暂缓不进入终审，可重复发生。

## 7. 成功/失败结果不变量

- `SUCCESS` 只允许非空、去首尾空格、最多 200 字的 `successOpportunityName`。
- 请求 DTO 白名单和 `forbidNonWhitelisted` 拒绝金额、日期、产品、成功说明等额外字段。
- 数据库没有上述旧字段，并用检查约束保证成功名与失败原因互斥。
- 终审退回后可覆盖结果；终审通过进入终态后不能再修改。

## 8. Outbox 与 worker

业务事务只写 `outbox_events`。worker 使用 `FOR UPDATE SKIP LOCKED` 分批认领，向 pg-boss 投递具有 `singletonKey` 的延迟任务，成功后标记 `processedAt`；失败则增加次数、记录截断后的错误并推迟 30 秒。任务处理器仍以业务表状态为最终幂等条件。

## 9. PII 与检索

- 电话、联系方式、具体需求、说明、退回/改派/失败原因和成功商机名称使用 AES-256-GCM；每个值生成独立 96 位 IV 和认证标签。
- 手机号与联系方式用 HMAC-SHA-256 盲索引做精确查找。
- 成功商机名称生成规范化二元字符 HMAC 数组并使用 PostgreSQL GIN，支持不泄露明文的至少两字包含检索。
- API、数据库日志和 Outbox 不写原始坐标（本版本无定位）或明文正文。

## 10. 导出算法

1. 市公司用户输入当前密码，服务端生成 5 分钟、一次性、只存哈希的再验证令牌。
2. 导出先原子消费令牌，再按筛选预估行数；超过 50,000 行拒绝。
3. ExcelJS streaming writer 每批读取 500 行并直接写 HTTP 响应，不在服务器保存 XLSX 副本。
4. 以 `= + - @` 开头的字符串前置单引号，阻断公式注入。
5. 记录操作者、筛选、开始/结束时间、行数和成功状态；音频永不嵌入导出。
