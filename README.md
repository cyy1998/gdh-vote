# 工代会选举计票助手

局域网内单机部署的选票录入与实时计票应用。浏览器界面使用 React，服务器使用 Hono，数据保存在服务器本地 SQLite 文件中。

## 开发运行

要求 Node.js 24 和 pnpm 10.33.0。

```powershell
pnpm install
pnpm dev
```

开发界面默认位于 `http://localhost:5173`，Hono 接口位于 `http://localhost:3000`。

## 生产运行

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

服务监听所有网卡的 3000 端口。SQLite 文件默认位于 `data/election-tallying.db`，可通过 `DATA_DIR` 指定服务器本地磁盘上的其他目录；不要把该目录放到网络共享盘。

管理员口令不写入仓库。运行 `pnpm admin:hash`，按提示输入至少 8 个字符的口令，然后在启动服务前设置输出的 `ADMIN_PASSWORD_HASH` 环境变量：

```powershell
$env:ADMIN_PASSWORD_HASH='生成的值'
pnpm start
```

未配置时，正常录入、历史和结果功能可用，清空接口会明确返回“管理员口令尚未配置”。

## 验证

```powershell
pnpm typecheck
pnpm test
pnpm build
```

数据库结构在 `src/server/schema.ts` 中定义，版本化 SQL 位于 `drizzle/`。服务启动时只执行已提交的迁移。
