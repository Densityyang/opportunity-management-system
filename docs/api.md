# 接口设计

## 通用约定

- 前缀：`/api/v1`；时间为 UTC ISO 8601，界面以 `Asia/Shanghai` 展示。
- 登录态：`HttpOnly`、`SameSite=Strict` 的 `oms_session` Cookie。
- 当前角色：除登录/改密外通过 `X-Role-Grant-Id` 指定。
- 状态变更：必须携带 `Idempotency-Key`，正文携带 `expectedVersion`。
- 校验：全局字段白名单并拒绝未知字段；错误为 `application/problem+json`。
- 并发：版本冲突为 `409 VERSION_CONFLICT`；非法状态为 `422 INVALID_TRANSITION`。
- 密码：登录、改密和导出复核限定为 6–12 位；新建账号和管理员重置统一使用手机号后六位，并强制首次改密。

## 认证与配置

| 方法           | 路径                                               | 说明                                                                                  |
| -------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| POST           | `/auth/login`                                      | 手机号＋密码登录                                                                      |
| GET            | `/auth/me`                                         | 当前账号和全部有效授权                                                                |
| POST           | `/auth/change-password`                            | 首次/主动修改密码                                                                     |
| POST           | `/auth/reauth`                                     | 市公司、高级市公司管理员或系统管理员导出前密码复核，返回一次性令牌                    |
| POST           | `/auth/logout`                                     | 撤销当前会话                                                                          |
| GET            | `/admin/capabilities`                              | 返回当前管理授权的可管理角色、区县范围和功能开关                                      |
| GET            | `/admin/users`                                     | 分页账号列表；支持 `search`、`role`、`districtId`、`active`，服务端强制套用层级可见域 |
| POST           | `/admin/users`                                     | 在同一事务创建账号及至少一个首批角色授权                                              |
| PATCH          | `/admin/users/{id}`                                | 系统/高级市公司管理员修改姓名或全局启停账号                                           |
| POST           | `/admin/users/{id}/reset-password`                 | 系统/高级市公司管理员重置为手机号后六位并撤销旧会话                                   |
| POST/DELETE    | `/admin/users/{id}/grants`、`/admin/grants/{id}`   | 在当前管理范围内增加/停用授权；授权变化立即影响承接覆盖                               |
| GET/PATCH      | `/admin/districts`、`/admin/districts/{id}`        | 当前范围的区县覆盖统计；仅系统管理员可启停区县                                        |
| GET/POST/PATCH | `/admin/personnel…`、`/admin/personnel-positions…` | 人员目录、职务建议模板和人工账号关联                                                  |
| POST           | `/admin/personnel/import`                          | 仅系统管理员可执行 XLSX 预检与同步                                                    |
| GET            | `/admin/personnel/imports`                         | 最近同步记录与忽略列告警                                                              |
| GET/POST/PATCH | `/admin/personnel-district-rules…`                 | 仅系统管理员维护组织关键词到区县的映射规则                                            |
| POST           | `/admin/personnel/account-batches/preview`         | 仅系统管理员按当前人员搜索结果预检批量开户，不创建账号                                |
| POST           | `/admin/personnel/account-batches/{id}/execute`    | 仅系统管理员提交后台批量任务；已有账号和异常人员跳过                                  |
| GET            | `/admin/personnel/account-batches…`                | 查询批次进度、历史和分页明细                                                          |
| POST           | `/admin/personnel/account-batches/{id}/export`     | 重新认证后导出掩码手机号及处理结果 XLSX                                               |
| GET            | `/reference/districts`                             | 启用区县下拉数据                                                                      |
| GET            | `/reference/handlers`                              | 区县经理按区县和客户类型查询有效承接人                                                |

`POST /admin/users` 必须把账号和首批授权一次提交：

```json
{
  "phone": "13800000000",
  "displayName": "示例人员",
  "grants": [
    {
      "role": "PERSONAL_HANDLER",
      "districtId": "uuid"
    }
  ]
}
```

区县角色必须携带 `districtId`，全局角色禁止携带；可用角色和可见账号均以 `/admin/capabilities` 及服务端权限策略为准，客户端隐藏字段不能替代服务端校验。`GET /admin/districts` 的 `coverage` 分别返回一线、经理、个人侧和组织侧有效人数，只读汇总 `role_grants`，没有第二个路由保存接口。

## 固定问卷

`POST /opportunities`

```json
{
  "customerType": "ORGANIZATION",
  "districtId": "uuid",
  "customerContact": "13800000000 张经理",
  "specificNeeds": ["需要办公网络、园区网络或Wi-Fi建设"],
  "attitude": "IMPORTANT",
  "oneSentenceDescription": "智慧园区咨询",
  "consentConfirmed": true
}
```

上报人电话来自登录账号，客户端不能提交或覆盖。`specificNeeds` 必须从固定菜单中选择 1–2 项，不能填写自由文本；服务端会再次校验。`PUT /opportunities/{id}/resubmit` 使用同一字段并增加 `expectedVersion`。可选录音在提交后通过 `POST /opportunities/{id}/audio` 上传 multipart 字段 `audio`。

### 人员目录同步

`POST /admin/personnel/import` 使用 multipart 字段 `file` 上传 XLSX，并接受：

| 字段                        | 类型/默认值                   | 说明                                                                 |
| --------------------------- | ----------------------------- | -------------------------------------------------------------------- |
| `mode`                      | `UPSERT`（默认）或 `SNAPSHOT` | 快照只停用同一来源类型中缺失的人员；账号和角色须人工复核，不自动停用 |
| `dryRun`                    | `false`                       | `true` 时只返回计数、来源识别和告警，不写业务表                      |
| `createAccounts`            | `false`                       | 为普通目录中具有有效手机号的人员建号；每个账号密码取该手机号后六位   |
| `provisionSystemAdminCount` | `0`，最大 20                  | 仅联系人简表有效，把前 N 个有效联系人开通为系统管理员                |
| `provisionSystemAdminPhone` | 完整手机号                    | 仅联系人简表有效，且手机号必须存在于本次文件中                       |

服务端自动识别完整人员表（含“人员编码、人员姓名”）和联系人简表（含“姓名、联系电话”）。完整表映射姓名、个人/工作手机、组织层级、岗位、任职状态及合作企业等账号管理白名单字段；身份证、银行卡、家庭联系方式、附件及未知列不会落库。联系人简表以手机号盲索引生成稳定内部编码，并可按文件有效行顺序开通管理账号。

所有新账号（包括人员同步、人工关联和管理员直接创建）初始密码均为手机号后六位并强制首次改密；管理员重置密码也恢复为该规则。前 N 个有效联系人和指定表内手机号均获得系统管理员授权，同一联系人重复命中时只保留一条授权。既有账号同步只关联人员并补充缺失角色，不自动重置密码。`GET /admin/personnel`、`GET /admin/personnel/imports` 和 `/admin/personnel-positions` 用于在线查看、审计和配置；职务模板返回 `recommendedRoles`，但不会自动改变授权。

### 人员批量开户

`POST /admin/personnel/account-batches/preview` 的正文仅接受可选 `search`，语义与人员目录现有关键词搜索一致，并跨越全部分页结果。预检按来源计算目标区县：联系人简表固定归金牛，完整人员表使用启用的组织映射规则；龙泉驿规则优先于天府新区。预检明细会区分已有账号、停用、无手机号、未映射和歧义人员。

确认后由 worker 分批处理。每名合格人员单独事务创建账号，并只授予 `FIELD_REPORTER` 与目标 `districtId`；手机号已存在其他账号、人员在预检后发生变化或目标区县停用时重新复核并跳过。批次状态为 `QUEUED`、`RUNNING`、`COMPLETED` 或 `PARTIAL`，重复提交幂等。导出必须通过 `/auth/reauth`，文件不包含明文密码或完整手机号。

## 查询

| 方法      | 路径                           | 说明                       |
| --------- | ------------------------------ | -------------------------- |
| GET       | `/opportunities`               | 按当前角色自动限定数据范围 |
| GET       | `/opportunities/{id}`          | 鉴权详情                   |
| GET       | `/opportunities/{id}/timeline` | 追加式流转记录             |
| GET       | `/opportunities/{id}/audio`    | 鉴权解密播放且记录访问审计 |
| GET/PATCH | `/notifications…`              | 站内通知读取与已读         |

## 工作流动作

| 方法 | 路径                                        | 载荷除 `expectedVersion` 外 |
| ---- | ------------------------------------------- | --------------------------- |
| POST | `/opportunities/{id}/reviews/first/approve` | `handlerGrantId`            |
| POST | `/opportunities/{id}/reviews/first/return`  | `reason`                    |
| POST | `/opportunities/{id}/assignments/reassign`  | `handlerGrantId`, `reason`  |
| POST | `/opportunities/{id}/pause`                 | `nextProcessingAt`          |
| POST | `/opportunities/{id}/resume`                | 无                          |
| POST | `/opportunities/{id}/results/failure`       | `failureReason`             |
| POST | `/opportunities/{id}/reviews/final/approve` | 无                          |
| POST | `/opportunities/{id}/reviews/final/return`  | `reason`                    |

初审通过示例：

```json
{
  "expectedVersion": 3,
  "handlerGrantId": "uuid"
}
```

`handlerGrantId` 必须来自当前区县经理对 `/reference/handlers?districtId=…&customerType=…` 的查询结果；服务端仍会在状态迁移事务中再次验证账号、授权、区县和个人/组织分侧。

成功结果的完整请求只有：

```http
POST /api/v1/opportunities/{id}/results/success
Idempotency-Key: <uuid>
X-Role-Grant-Id: <grant uuid>
Content-Type: application/json
```

```json
{
  "expectedVersion": 7,
  "successOpportunityName": "XX公司DICT智慧园区建设项目"
}
```

`successOpportunityName` 去首尾空格后必填，最多 200 字；任何其他字段都返回 400。

## 市公司

| 方法 | 路径                           | 说明                         |
| ---- | ------------------------------ | ---------------------------- |
| GET  | `/municipal/successes`         | 全市成功商机检索/筛选        |
| GET  | `/municipal/successes/{id}`    | 只读正文、时间线和音频元数据 |
| POST | `/municipal/exports/successes` | 当前筛选成功库 XLSX          |
| POST | `/municipal/exports/workflow`  | 全状态节点明细 XLSX          |

导出请求头必须有 `X-Reauth-Token`。令牌消费后即失效；音频不进入 XLSX，不生成永久下载地址。

完整 schema、枚举和 `additionalProperties: false` 见 `openapi.yaml`。
