# 接口设计

## 通用约定

- 前缀：`/api/v1`；时间为 UTC ISO 8601，界面以 `Asia/Shanghai` 展示。
- 登录态：`HttpOnly`、`SameSite=Strict` 的 `oms_session` Cookie。
- 当前角色：除登录/改密外通过 `X-Role-Grant-Id` 指定。
- 状态变更：必须携带 `Idempotency-Key`，正文携带 `expectedVersion`。
- 校验：全局字段白名单并拒绝未知字段；错误为 `application/problem+json`。
- 并发：版本冲突为 `409 VERSION_CONFLICT`；非法状态为 `422 INVALID_TRANSITION`。

## 认证与配置

| 方法           | 路径                                              | 说明                                 |
| -------------- | ------------------------------------------------- | ------------------------------------ |
| POST           | `/auth/login`                                     | 手机号＋密码登录                     |
| GET            | `/auth/me`                                        | 当前账号和全部有效授权               |
| POST           | `/auth/change-password`                           | 首次/主动修改密码                    |
| POST           | `/auth/reauth`                                    | 市公司导出前密码复核，返回一次性令牌 |
| POST           | `/auth/logout`                                    | 撤销当前会话                         |
| GET/POST/PATCH | `/admin/users…`                                   | 账号创建、启停、重置密码             |
| POST/DELETE    | `/admin/users/{id}/grants`、`/admin/grants/{id}`  | 授权创建/停用                        |
| GET/PATCH      | `/admin/districts…`                               | 区县列表/启停                        |
| GET/POST       | `/admin/routing`、`/admin/districts/{id}/routing` | 默认路由读取/保存                    |
| GET            | `/reference/districts`                            | 启用区县下拉数据                     |
| GET            | `/reference/handlers`                             | 区县经理改派候选人                   |

## 固定问卷

`POST /opportunities`

```json
{
  "customerType": "ORGANIZATION",
  "districtId": "uuid",
  "customerContact": "13800000000 张经理",
  "specificNeed": "需要咨询智慧园区方案",
  "attitude": "IMPORTANT",
  "oneSentenceDescription": "智慧园区咨询",
  "consentConfirmed": true
}
```

上报人电话来自登录账号，客户端不能提交或覆盖。`PUT /opportunities/{id}/resubmit` 使用同一字段并增加 `expectedVersion`。可选录音在提交后通过 `POST /opportunities/{id}/audio` 上传 multipart 字段 `audio`。

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
| POST | `/opportunities/{id}/reviews/first/approve` | 无                          |
| POST | `/opportunities/{id}/reviews/first/return`  | `reason`                    |
| POST | `/opportunities/{id}/assignments/reassign`  | `handlerGrantId`, `reason`  |
| POST | `/opportunities/{id}/pause`                 | `nextProcessingAt`          |
| POST | `/opportunities/{id}/resume`                | 无                          |
| POST | `/opportunities/{id}/results/failure`       | `failureReason`             |
| POST | `/opportunities/{id}/reviews/final/approve` | 无                          |
| POST | `/opportunities/{id}/reviews/final/return`  | `reason`                    |

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
