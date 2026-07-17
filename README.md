# 🗳️ 投票系统后端 API

本仓库为投票系统的后端服务，使用 **Express + SQLite** 构建。

## 部署

本服务部署在 **Railway** 平台：

1. 访问 [railway.app](https://railway.app)
2. 用 GitHub 登录
3. 点击 **New Project** → **Deploy from GitHub repo**
4. 选择仓库 1shaobowen1/voting-backend
5. Railway 会自动检测 Node.js 并部署

## API 地址

部署成功后，Railway 会提供形如：
https://voting-backend.railway.app

## 本地运行

\\\ash
npm install
npm start
\\\

服务启动在 http://localhost:3001

## API 列表

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /health | 健康检查 |
| POST | /api/login | 登录 |
| GET | /api/votes | 获取投票列表 |
| GET | /api/votes/:id | 获取投票详情 |
| POST | /api/votes | 创建投票 |
| GET | /api/votes/:id/check | 检查投票状态 |
| POST | /api/votes/:id/vote | 提交投票 |
| GET | /api/votes/:id/results | 获取投票结果 |
| GET | /api/qrcode/:voteId | 生成投票二维码 |