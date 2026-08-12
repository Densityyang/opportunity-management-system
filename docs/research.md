# 开源与技术调研结论

调研目标是复用成熟的基础能力，同时避免为了一个固定问卷和八状态流程引入整套 CRM 的许可、数据模型和升级负担。

## 未直接复用整套 CRM

- [Frappe Framework](https://github.com/frappe/frappe) 与 [ERPNext](https://github.com/frappe/erpnext) 使用 GPL/AGPL 系列许可，完整二次开发会扩大许可与运维边界。
- [EspoCRM](https://github.com/espocrm/espocrm) 和 [SuiteCRM](https://github.com/SuiteCRM/SuiteCRM) 是成熟 CRM，但核心为 AGPL，且销售阶段、客户主数据和扩展机制明显大于本项目固定流程。
- [Twenty](https://github.com/twentyhq/twenty) 的代码和商业能力边界需要逐目录核对；其通用 CRM 模型同样不能直接满足“系统管理员不可读正文”和成功结果单字段约束。

结论：不 fork 或复制上述 CRM；只使用宽松许可的框架/库，自建小型领域模型。依赖许可证应在后续提交前生成清单并复核。

## 采用的可复用组件

- [NestJS](https://github.com/nestjs/nest)：模块化 HTTP/worker 边界和依赖注入。
- [Prisma ORM 7](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/introduction)：显式 PostgreSQL driver adapter、自定义生成目录和迁移。
- [XState](https://github.com/statelyai/xstate)：可执行状态机，防止控制器散落状态判断。
- [CASL](https://github.com/stalniy/casl) 曾作为候选；首版使用集中式领域访问服务，避免简单 RBAC 掩盖“当前分派、同区县、成功终态”等记录级条件。
- [pg-boss](https://github.com/timgit/pg-boss)：使用 PostgreSQL `SKIP LOCKED` 的延迟任务；仍以业务轮次/版本复查实现端到端幂等。
- [ExcelJS](https://github.com/exceljs/exceljs)：流式 XLSX，不在服务器留导出副本。
- [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) 与 `getUserMedia`：浏览器原始录音。麦克风能力依赖安全上下文；本项目不实现识别。

## 存储结论

音频上限仅 5 MB，当前部署为单机 Compose。首版用独立密钥加密的私有文件卷和适配器接口，避免新增对象存储服务。未来多节点部署可把适配器换成企业批准的对象存储，API 权限和数据库元数据不变。

## 隐私边界

按[《中华人民共和国个人信息保护法》](https://www.miit.gov.cn/zwgk/zcwj/flfg/art/2022/art_04a0f1fb5df244e39688fd5372623a8d.html)的最小必要、明确告知同意、安全保存与到期处置原则设计。正式上线前仍须由实际运营主体补齐处理者名称、联系方式、保存期限和权利请求渠道；软件设计不构成法律意见。

## 排除项

定位增强和语音识别均不在本次代码中。原因和未来重新立项的准入条件见 ADR 0004。

## 地图定位研究（仅研究，不在本次 PR 实现）

- 浏览器定位与地图服务是两层能力：`navigator.geolocation` 需要 HTTPS 安全上下文和用户明确授权；地图服务的逆地理编码、行政区匹配和地图渲染仍需要供应商的 Key。
- 高德官方文档要求先注册开放平台开发者并创建 Web 服务 API Key；JS API 还要求申请 Web（JS API）Key 和安全密钥。生产环境应把安全密钥放在服务端代理，不放入浏览器源码。
- 百度官方 FAQ 同样要求在 API 控制台申请 AK，并按浏览器端/服务端选择正确类型；这不是无需注册的公开匿名接口。
- 因此本系统未来若采用高德/百度/腾讯等商业地图 SDK，需要先完成平台注册、实名认证（以平台当前要求为准）、创建应用、配置域名白名单/配额和密钥保管，再实现“定位→逆地理编码→区县候选→用户确认”。本 PR 保持区县下拉选择，未开启 `geolocation` 权限，也未接入任何地图 SDK。
