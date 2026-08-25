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

服务启动时会自动读取项目根目录下的 `.env`。先复制 `.env.example`：

```powershell
Copy-Item .env.example .env
```

管理员口令不写入仓库。运行 `pnpm admin:hash`，按提示输入至少 8 个字符的口令，然后把输出值填写到 `.env` 的 `ADMIN_PASSWORD_HASH`：

```dotenv
PORT=3000
DATA_DIR=data
ADMIN_PASSWORD_HASH=生成的值
ACCESS_USERNAME=shrq
ACCESS_PASSWORD=设置一个仅供现场人员使用的访问口令
```

`.env` 已被 Git 忽略。操作系统中已设置的同名环境变量优先于 `.env`。`ACCESS_USERNAME` 可省略，默认用户名为 `shrq`；`ACCESS_PASSWORD` 必须配置，否则服务会拒绝启动。浏览器首次访问时会显示原生 HTTP 登录框，验证后页面、静态资源和全部接口才可访问。

管理员口令与站点访问口令相互独立。未配置管理员口令时，正常录入、历史和结果功能可用，清空接口会明确返回“管理员口令尚未配置”。不要给服务端机密配置添加 `VITE_` 前缀，因为该前缀用于暴露前端构建变量。

HTTP Basic Auth 本身不加密口令，只应在受信任的局域网内使用；如果服务会经过不受信任的网络，请在前方配置 HTTPS 反向代理。

### 部署到子路径

如果站点通过 `/vote-tallying/` 等子路径访问，在构建前配置：

```dotenv
TALLY_BASE_PATH=/vote-tallying/
```

Vite 会据此生成静态资源、API 和实时事件连接地址，服务端也会直接挂载到同一子路径。反向代理应保留该前缀，例如外部的 `/vote-tallying/api/results/union` 仍转发为服务端的 `/vote-tallying/api/results/union`。未配置时默认使用域名根路径 `/`。

## 验证

```powershell
pnpm typecheck
pnpm test
pnpm build
```

数据库结构在 `src/server/schema.ts` 中定义，版本化 SQL 位于 `drizzle/`。服务启动时只执行已提交的迁移。
