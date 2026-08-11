# 商机随手报

面向一线上报、区县承接、个人侧/组织侧分类处理、市公司成功商机复盘的 Web 管理系统。本仓库是私有项目代码，不包含从 AGPL CRM 复制的实现。

当前编码范围已经冻结：

- 固定上报问卷，不增加客户名称、金额、产品、预计日期等奖励或经营字段。
- 成功结果只填写“成功商机名称”，界面提示“请填写公司DICT系统项目名称”。
- 保留最长 30 秒、5 MB 的可选原始录音；不进行语音识别或转写。
- 区县通过人工下拉选择；不包含浏览器定位、地图 SDK、经纬度或逆地理编码。

## 技术结构

- `apps/web`：React 19、Refine、Ant Design 5、Vite 的响应式中文前端。
- `apps/api`：NestJS 11、Prisma 7、PostgreSQL 18 的模块化单体 API 与后台 worker。
- `packages/contracts`：前后端共享的稳定枚举、提示文案和响应类型。
- `docs`：架构、算法、接口、权限、验收、开源调研和运维说明。
- `docker-compose.yml`：PostgreSQL、迁移、API、worker、Nginx Web 五个本地服务。

## 本地启动（后续测试阶段执行）

> 本轮仅完成编码，以下命令尚未在本工作区执行，不应视为已验证结果。

1. 安装 Node.js 24 LTS、pnpm 10、Docker Desktop。
2. 复制 `.env.example` 为 `.env`，分别生成三个独立的 32 字节 Base64 密钥并修改初始管理员密码。
3. 启动与初始化：

```powershell
docker compose up --build -d
docker compose run --rm api pnpm --filter @oms/api prisma:seed
```

4. 打开 `http://localhost:8080`；API 文档为 `http://localhost:8080/api/docs`。
5. 使用引导管理员登录并立即修改密码，然后按顺序创建账号、添加角色、配置每个启用区县的三类路由。

## 必须配置的安全值

- `PII_ENCRYPTION_KEY_BASE64`：正文和电话号码 AES-256-GCM 加密。
- `AUDIO_ENCRYPTION_KEY_BASE64`：音频卷 AES-256-GCM 加密，必须与 PII 密钥不同。
- `BLIND_INDEX_KEY_BASE64`：手机号、联系方式和成功商机名称检索盲索引。
- `SESSION_PEPPER`：会话及二次验证令牌哈希增强值。

密钥遗失会导致对应密文无法恢复。正式环境须由密钥管理系统提供，不要写入 Git、镜像或日志。

## 文档入口

- [架构与核心算法](docs/architecture.md)
- [数据模型](docs/data-model.md)
- [接口设计](docs/api.md)
- [OpenAPI 合同](docs/openapi.yaml)
- [授权矩阵](docs/authorization-matrix.md)
- [验收设计](docs/acceptance.md)
- [Docker Compose 运维](docs/operations.md)
- [开源与技术调研](docs/research.md)
- [暂不实现定位与语音识别的 ADR](docs/adr/0004-deferred-location-and-asr.md)

## 当前交付边界

代码、迁移和文档已放入工作区；依赖安装、Prisma 生成、格式化、静态检查、测试、Docker 启动、数据库迁移实跑、Git 初始化/提交、GitHub 推送和 PR 创建均按用户要求留到后续阶段。
