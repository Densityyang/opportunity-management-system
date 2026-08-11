# 数据模型

## 关键实体

| 实体                                          | 用途                        | 关键约束                                      |
| --------------------------------------------- | --------------------------- | --------------------------------------------- |
| `users` / `password_credentials` / `sessions` | 账号、密码和服务端会话      | 手机号盲索引唯一；初始密码强制修改            |
| `role_grants`                                 | 一人多角色、多区县授权      | 活跃授权按用户、角色、区县唯一                |
| `districts` / `district_routing`              | 区县字典与三类默认负责人    | 每个区县最多一套路由                          |
| `opportunities`                               | 当前问卷快照与工作流状态    | 乐观版本 `version`；正文密文                  |
| `opportunity_revisions`                       | 一线每次提交的不可覆盖快照  | 商机＋修订号唯一；JSON 中仍只存密文           |
| `assignments`                                 | 承接历史                    | 每个商机最多一条活跃分派                      |
| `handling_results`                            | 成功或失败结果              | 成功只含名称；成功与失败字段互斥              |
| `workflow_events`                             | 追加式节点历史              | 记录前后状态、操作人授权和加密说明            |
| `sla_rounds`                                  | 独立初审/终审计时轮次       | 商机＋类型＋轮次号唯一                        |
| `notifications`                               | 站内通知                    | 可限定到具体角色授权                          |
| `audio_records`                               | 加密音频元数据              | 每商机最多一个；最大 5 MB / 30.5 秒数据库约束 |
| `idempotency_records`                         | 重复请求响应缓存            | 作用域＋键唯一，24h 到期                      |
| `outbox_events`                               | 可靠异步事件                | 由 worker 锁定认领                            |
| `reauth_tokens` / `export_audits`             | 一次性导出授权与审计        | 5 分钟、只能消费一次                          |
| `access_audits`                               | 市公司详情/音频敏感访问审计 | 与正文独立保留                                |
| `retention_candidates`                        | 到期数据人工清理队列        | 主数据不自动删除                              |

`handling_results` 明确不存在产品、金额、预计签约时间、收入、毛利、奖励等列，也没有可绕过校验的通用成功结果 JSON 字段。
