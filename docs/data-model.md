# 数据模型

## 关键实体

| 实体                                              | 用途                               | 关键约束                                              |
| ------------------------------------------------- | ---------------------------------- | ----------------------------------------------------- |
| `users` / `password_credentials` / `sessions`     | 账号、密码和服务端会话             | 手机号盲索引唯一；初始密码强制修改                    |
| `role_grants`                                     | 一人多角色、多区县授权及承接候选池 | 活跃授权按用户、角色、区县唯一；区县角色必填区县      |
| `districts`                                       | 区县字典、启停和展示顺序           | 当前 21 个业务区县按 `sort_order` 固定排序            |
| `personnel`                                       | 可在线同步的人员目录               | 人员编码唯一；手机号密文＋盲索引；区分完整表/简表来源 |
| `personnel_positions` / `position_role_templates` | 职务字典和多角色建议模板           | 职务编码、名称唯一；模板只给出建议，不直接授权        |
| `personnel_imports`                               | 人员同步审计与计数                 | 记录来源、模式、行数、告警及操作人                    |
| `opportunities`                                   | 当前问卷快照与工作流状态           | 乐观版本 `version`；正文密文                          |
| `opportunity_revisions`                           | 一线每次提交的不可覆盖快照         | 商机＋修订号唯一；JSON 中仍只存密文                   |
| `assignments`                                     | 承接历史                           | 每个商机最多一条活跃分派                              |
| `handling_results`                                | 成功或失败结果                     | 成功只含名称；成功与失败字段互斥                      |
| `workflow_events`                                 | 追加式节点历史                     | 记录前后状态、操作人授权和加密说明                    |
| `sla_rounds`                                      | 独立初审/终审计时轮次              | 商机＋类型＋轮次号唯一                                |
| `notifications`                                   | 站内通知                           | 可限定到具体角色授权                                  |
| `audio_records`                                   | 加密音频元数据                     | 每商机最多一个；最大 5 MB / 30.5 秒数据库约束         |
| `idempotency_records`                             | 重复请求响应缓存                   | 作用域＋键唯一，24h 到期                              |
| `outbox_events`                                   | 可靠异步事件                       | 由 worker 锁定认领                                    |
| `reauth_tokens` / `export_audits`                 | 一次性导出授权与审计               | 5 分钟、只能消费一次                                  |
| `access_audits`                                   | 市公司详情/音频敏感访问审计        | 与正文独立保留                                        |
| `retention_candidates`                            | 到期数据人工清理队列               | 主数据不自动删除                                      |

`handling_results` 明确不存在产品、金额、预计签约时间、收入、毛利、奖励等列，也没有可绕过校验的通用成功结果 JSON 字段。

## 授权与承接的不变量

- `FIELD_REPORTER`、`DISTRICT_MANAGER`、`PERSONAL_HANDLER`、`ORGANIZATION_HANDLER` 必须绑定区县；`MUNICIPAL`、`SENIOR_MUNICIPAL_ADMIN`、`SYSTEM_ADMIN` 必须是全局授权。
- `role_grants` 同时驱动账号权限、区县覆盖统计和初审承接候选池，数据库中不再存在 `district_routing`，因此不会出现两处配置不一致。
- `assignments.handler_grant_id` 保留具体历史承接授权；每个商机至多一条活跃分派，改派只结束旧记录，不覆盖历史。
- 当前业务区县依次为：金牛、成华、青羊、锦江、武侯、高新南、高新西、东部新区、大邑、简阳、金堂、新都、温江、郫都、彭州、崇州、新津、邛崃、蒲江、青白江、都江堰。历史区县保留在库中但停用且不出现在业务下拉框。

## 人员来源合并规则

`personnel.source_profile` 取 `FULL_DIRECTORY` 或 `CONTACT_ONLY`。完整表写入组织、职务及允许的用工管理字段；联系人简表只写姓名和联系电话。简表用手机号匹配到完整目录人员时，不清空其完整资料，也不把来源降级；`SNAPSHOT` 仅作用于本次识别到的同来源数据，避免一类文件误停用另一类人员。
