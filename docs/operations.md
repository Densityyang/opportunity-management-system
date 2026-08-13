# Docker Compose 运维说明

## 服务与持久化

- `postgres`：唯一关系数据库，卷 `postgres_data`。
- `migrate`：API 镜像的一次性 `prisma migrate deploy`。
- `api`：HTTP 3000，仅在 Compose 网络内暴露。
- `worker`：Outbox、pg-boss、SLA、恢复和清理。
- `web`：Nginx 80，对宿主机映射 `8080`。
- `audio_data`：API 与 worker 共享的加密音频卷。

## 首次初始化

在 `.env` 写入独立随机密钥后：

```powershell
docker compose config
docker compose up --build -d
docker compose run --rm api pnpm --filter @oms/api prisma:seed
docker compose ps
```

引导管理员初始密码为其手机号后六位，首次登录后必须修改；后续新建账号和管理员重置密码也遵循同一规则。

不得把 `docker compose config` 的完整输出粘贴到工单或 PR，因为它可能包含展开后的秘密。

## 健康与日志

```powershell
Invoke-RestMethod http://localhost:8080/api/v1/health
docker compose ps
docker compose logs --tail 200 api worker
```

日志中不得记录请求正文、Cookie、再验证令牌、加密密钥或导出的完整联系方式。

## 备份

以下命令留到验证阶段执行，并将路径替换为明确的受控备份目录：

```powershell
$backupDir = Resolve-Path 'D:\oms-backups'
docker compose exec -T postgres pg_dump -U $env:POSTGRES_USER -d $env:POSTGRES_DB -Fc > (Join-Path $backupDir 'oms.dump')
docker run --rm -v opportunity-management-system_audio_data:/source:ro -v "${backupDir}:/backup" alpine tar -czf /backup/audio-encrypted.tgz -C /source .
```

数据库、加密音频和三类加密/HMAC 密钥必须作为同一恢复点管理，但密钥应存于独立密钥系统，不能与备份包放在一起。

## 恢复演练

只在隔离 Compose 项目名和明确新卷中演练，先验证目标，禁止覆盖当前卷：

1. 新建隔离目录和隔离 `.env`，设置不同的 `COMPOSE_PROJECT_NAME`。
2. 启动空 PostgreSQL，使用 `pg_restore --clean --if-exists` 恢复 dump。
3. 将加密音频包解压到隔离音频卷。
4. 使用原加密密钥启动 API；检查迁移、抽样正文、音频和 worker 积压。
5. 记录恢复点目标和恢复时间，随后按审批销毁隔离数据。

## 更新顺序

1. 备份数据库和音频卷。
2. 阅读迁移 SQL，确认只包含预期变更。
3. `docker compose build`。
4. `docker compose run --rm migrate`。
5. 滚动重启 API、worker、web，并检查健康/Outbox 积压。

本地首版没有自动回滚数据库迁移；需要以恢复演练确认的备份作为回退手段。
