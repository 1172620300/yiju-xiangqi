# 一局象棋

支持人机对战、好友房间、自定义棋盘和本机对局复盘的中国象棋网站。引擎使用 Pikafish。

## 本次归档状态（2026-09-09）

此仓库来自维护过程中保存的最新本地项目副本。归档时阿里云实例因 `InstanceExpired` 停机，不能重新导出或逐项核对线上目录。

- 包含已测试的棋盘反转功能（`app.js?v=45`、`styles.css?v=31`）；该功能的线上发布尚未完成。
- 包含此前部署的自定义棋盘、控制对方、编辑当前局面、分析限时与落子优先改动。
- 不包含线上账号数据库、登录会话、日志或云平台凭证；这不是用户数据备份。

## 本地运行

在 Windows 上安装 Python 3.12 或更高版本，然后在项目目录运行：

```powershell
python server.py
```

打开 `http://127.0.0.1:8765/`。首次运行会在本地创建 SQLite 数据库。

仓库附带当前使用的 Windows Pikafish 可执行文件和 NNUE 权重。若不适用于你的机器，请从 Pikafish 官方项目获取适配版本，并替换对应文件。

## 功能

- 人机对战、思考强度、胜率估算与推荐走法。
- 自定义摆棋：放置、移动、移除、撤销、先行方选择及局面校验。
- 自定义对局中手动控制双方，以及从当前局面继续摆棋。
- 棋盘反转：只改变显示方向，支持对战、摆棋和复盘。
- 本机记录、悔棋及自定义初始局面复盘。
- 账号和好友房间；记录保存在浏览器，账号及房间保存在服务器 SQLite。

## 部署

当前部署方案为阿里云 Windows ECS。`ecs-launch.py` 是服务启动器，`ecs-watchdog.ps1` 是健康巡检脚本，详情见 [MAINTENANCE.md](MAINTENANCE.md)。

服务器恢复后再发布最新前端；部署时保留服务器 `yiju-users.db`，不要用本地数据库覆盖。

## 文件

- `index.html`、`styles.css`、`app.js`：网页与交互。
- `server.py`：HTTP、账号、房间和引擎调度。
- `engine_worker.py`：独立引擎计算进程。
- `rules-core.js`：重复局面规则。
- `ecs-*.ps1`、`ecs-launch.py`：ECS 部署与维护。
- `pikafish.exe`、`pikafish.nnue`：当前 Windows 引擎与评估网络。

## 第三方文件

Pikafish 官方项目及源码：<https://github.com/official-pikafish/Pikafish>。
引擎附带许可见 [PIKAFISH-GPL-3.0.txt](PIKAFISH-GPL-3.0.txt)，网络权重许可见 [PIKAFISH-NNUE-LICENSE.md](PIKAFISH-NNUE-LICENSE.md)。这些文件不代表网站自有代码采用同一许可。
