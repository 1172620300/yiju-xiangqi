# 一局象棋：维护与修改手册

更新日期：2026-08-24

这份文档用于后续继续开发、部署和排查故障。将本文件与项目目录一起交给 Codex，即可快速恢复上下文。

> 安全说明：本文不记录阿里云密码、验证码、AccessKey、OAuth 令牌或用户密码。不要把任何 CLI 配置文件提交到项目。

## 1. 当前线上环境

| 项目 | 当前值 |
| --- | --- |
| 公网地址 | <http://123.56.86.62/> |
| 协议 | HTTP；尚未配置域名和 HTTPS |
| 云平台 | 阿里云 ECS |
| 地域 | `cn-beijing` |
| 实例 ID | `i-2ze41lfdahvk2a8p4u15` |
| 操作系统 | Windows Server 2022 64 位 |
| 配置 | 2 vCPU、2 GB 内存 |
| Python | 3.13.15 64 位 |
| 服务器目录 | `C:\yiju-xiangqi` |
| Web 端口 | 80 |
| 主服务任务 | `YijuXiangqiServer` |
| 健康巡检任务 | `YijuXiangqiWatchdog`，每 5 分钟运行 |

当前使用公网 IP 和 HTTP。部分手机、微信或运营商可能拦截纯 HTTP IP 地址。若要稳定公开分享，需要购买域名、完成 ICP 备案并配置 HTTPS。

## 2. 本地项目位置

项目目录：

```text
C:\Users\ASUS\Documents\Codex\2026-08-15\ji\outputs\yiju-xiangqi
```

主要文件：

| 文件 | 作用 |
| --- | --- |
| `index.html` | 页面结构、主页、棋局、登录、好友房间和复盘区域 |
| `styles.css` | 电脑端与手机端样式、棋盘光感和响应式布局 |
| `app.js` | 棋盘绘制、交互、人机对战、好友房间、复盘和浏览器记录 |
| `rules-core.js` | 象棋基础规则逻辑 |
| `server.py` | HTTP 服务、账号、房间、Pikafish 接口和静态文件服务 |
| `engine_worker.py` | 独立执行单次 Pikafish 走棋或分析，隔离计划任务中的管道故障 |
| `yiju-users.db` | SQLite 数据库；保存账号、登录会话和好友房间 |
| `pikafish.exe` | Pikafish 象棋引擎 |
| `pikafish.nnue` | Pikafish 神经网络文件 |
| `ecs-start.ps1` | 阿里云主服务启动脚本 |
| `ecs-launch.py` | ECS 计划任务直接使用的 Python 启动器 |
| `ecs-install.ps1` | 首次安装主服务定时任务和防火墙规则 |
| `ecs-watchdog.ps1` | 引擎真实计算巡检与故障自动恢复 |

## 3. 功能和数据保存位置

### 人机对战

- 浏览器通过 `POST /api/move` 请求 Pikafish 走法。
- 实时分析通过 `POST /api/analyze` 返回 NDJSON 流。
- 服务器只有一个并发引擎槽位：`XIANGQI_ENGINE_SLOTS=1`，适合当前 2 GB ECS。
- 走棋最多等待引擎槽位 15 秒；实时分析只等待 0.2 秒，忙碌时立即放弃分析，避免分析排队阻塞走棋。
- 单次 Pikafish 走棋异常会自动再尝试一次。
- 如果 Pikafish 在走棋请求中超时，服务器会返回一条合法备用走法，`source` 为 `fallback`，避免整局中断。

### 账号和好友房间

- 用户名、加盐密码哈希、登录会话和房间保存在 `yiju-users.db`。
- 未登录仍可使用人机对战；好友房间需要登录。
- 好友房间数据保存在服务器数据库，不是只保存在内存中。

### 对局记录与复盘

- 对局记录保存在玩家浏览器的 `localStorage`。
- 存储键：`yiju_xiangqi_records_v1`。
- 每个浏览器最多保存 30 局。
- 换设备、换浏览器或清除浏览器数据后，原记录不会自动同步。

## 4. 服务器启动方式

`YijuXiangqiServer` 是 Windows 计划任务，以 `SYSTEM` 身份直接运行 Python：

```text
C:\Program Files\Python313\python.exe "C:\yiju-xiangqi\ecs-launch.py"
```

`ecs-launch.py` 设置：

```text
XIANGQI_HOST=0.0.0.0
XIANGQI_PORT=80
XIANGQI_ENGINE_SLOTS=1
```

任务应一直处于 `Running`。端口 80 应由 `python.exe ecs-launch.py` 监听。

2026-08-24 起，HTTP 服务不再在请求线程中直接管理 Pikafish 管道。每次走棋或分析由 `engine_worker.py` 独立执行，并通过临时 NDJSON 文件返回结果；任务结束后会自动删除临时文件。这样可规避 Windows 计划任务长期运行后出现的 UCI 管道超时。

## 5. 看门狗机制

`YijuXiangqiWatchdog` 每 5 分钟执行 `ecs-watchdog.ps1`：

1. 向 `http://127.0.0.1/api/move` 发送一个深度 1 的真实计算请求。
2. 返回 `source: pikafish` 算健康；HTTP 429 或 503 表示引擎正在被玩家使用，也算健康，不允许重启。
3. 其他错误会等待 10 秒后再检查一次，只有连续两次失败才进入恢复流程。
4. 恢复时仅停止占用 80 端口的象棋 Python 进程。
5. 清理残留 Pikafish 进程并重启 `YijuXiangqiServer`。
6. 等待 12 秒，再做一次真实计算验证。

`GET /api/status` 会执行带缓存的真实引擎健康检查。健康时返回 `engine: pikafish`、`healthy: true`；检查正在进行或引擎槽位繁忙时，`healthy` 可能暂时为 `null`。最终判断仍应同时验证 `/api/move` 的 `source`。

查看任务状态：

```powershell
Get-ScheduledTask -TaskName YijuXiangqiServer,YijuXiangqiWatchdog |
  Select-Object TaskName, State

Get-ScheduledTaskInfo -TaskName YijuXiangqiWatchdog |
  Select-Object LastRunTime, LastTaskResult, NextRunTime
```

健康状态下，`LastTaskResult` 应为 `0`。

## 6. 修改后的基本检查

### JavaScript 语法

```powershell
node --check app.js
```

### Python 语法

```powershell
python -m py_compile server.py
```

### PowerShell 语法

```powershell
$errors = $null
$tokens = $null
[System.Management.Automation.Language.Parser]::ParseFile(
  (Resolve-Path .\ecs-watchdog.ps1),
  [ref]$tokens,
  [ref]$errors
) | Out-Null
$errors
```

### 浏览器缓存版本

修改 `styles.css` 或 `app.js` 后，必须在 `index.html` 中增加查询版本，否则手机可能继续使用旧文件：

```html
<link rel="stylesheet" href="styles.css?v=26">
<script src="app.js?v=39"></script>
```

当前版本是：

```text
styles.css?v=26
app.js?v=39
```

每次只增加实际修改文件的版本号。

## 7. 部署流程

### 7.1 取得阿里云 CLI 临时授权

推荐使用 OAuth，不要在脚本中保存长期 AccessKey：

```powershell
aliyun configure --mode OAuth --profile yiju-ecs --config-path <CLI_CONFIG>
```

在浏览器确认阿里云官方 `official-cli` 授权。`<CLI_CONFIG>` 必须放在项目外或临时位置，使用完删除，严禁提交到 Git。

验证实例访问权限：

```powershell
aliyun --config-path <CLI_CONFIG> --profile yiju-ecs ecs DescribeInstances `
  --RegionId cn-beijing `
  --InstanceIds '["i-2ze41lfdahvk2a8p4u15"]'
```

### 7.2 上传文件

小文件可使用 ECS `SendFile` 上传到：

```text
C:\yiju-xiangqi
```

`SendFile` 的 Base64 内容上限较小。`server.py` 等较大文件应先 Gzip，再上传为 `server.py.gz`，随后通过 `RunCommand` 在服务器解压。

至少在上传前保留数据库：

```text
C:\yiju-xiangqi\yiju-users.db
```

不要用本地空数据库覆盖线上数据库。

### 7.3 重启主服务

在服务器管理员 PowerShell 中：

```powershell
Stop-ScheduledTask -TaskName YijuXiangqiServer -ErrorAction SilentlyContinue

$listener = Get-NetTCPConnection -LocalPort 80 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1

if ($listener) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
  if ($process.CommandLine -match 'server\.py') {
    Stop-Process -Id $listener.OwningProcess -Force
  }
}

Start-ScheduledTask -TaskName YijuXiangqiServer
Start-Sleep -Seconds 12
```

只停止命令行中包含 `server.py` 且占用 80 端口的进程，避免误杀服务器上的其他 Python 程序。

## 8. 线上验证

### 状态接口

```powershell
Invoke-RestMethod http://123.56.86.62/api/status
```

预期：

```json
{"engine":"pikafish"}
```

### 真实走棋

```powershell
$body = @{
  fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/P8/2P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 1'
  legalMoves = @(@{ uci = 'a6a5' })
  depth = 1
} | ConvertTo-Json -Depth 4 -Compress

Invoke-RestMethod `
  -Uri 'http://123.56.86.62/api/move' `
  -Method Post `
  -ContentType 'application/json' `
  -Body $body `
  -TimeoutSec 30
```

预期：

```json
{"move":"a6a5","source":"pikafish"}
```

如果 `source` 是 `fallback`，网页仍可继续对局，但 Pikafish 不健康，应检查看门狗任务。

完成部署后至少验证：

- 首页返回 HTTP 200。
- `/api/status` 返回 HTTP 200。
- 连续 3～5 次 `/api/move` 都返回 `source: pikafish`。
- `/api/analyze` 返回 HTTP 200，并包含最终的 `"done": true`。
- 电脑端和手机端各实际走一回合。
- 好友房间可以创建、加入和同步走法。

## 9. 常见故障

### 网页完全打不开

检查顺序：

1. ECS 实例是否为 `Running`。
2. `YijuXiangqiServer` 是否为 `Running`。
3. 80 端口是否有监听进程。
4. 阿里云安全组是否允许 TCP 80。
5. Windows 防火墙规则 `Yiju Xiangqi Web` 是否存在。

### 网页能打开，但人机对战失败

典型原因是 Python 服务还在，但 Pikafish 子进程超时。检查真实走棋接口，不要只看 `/api/status`。

2026-08-21 曾发现旧看门狗会把多人使用时的 HTTP 503“引擎繁忙”误判为故障并重启服务。现已修复：429/503 不触发重启，且其他错误必须连续出现两次。

现在的保护措施：

- `/api/move` 自动返回合法备用走法，避免前端报错。
- 看门狗最多约 5 分钟发现问题并重启主服务。

### 显示 `Failed to fetch` 或“连接服务器失败”

检查浏览器访问地址是否为：

```text
http://123.56.86.62/
```

当前没有 HTTPS，访问 `https://123.56.86.62/` 会失败。还要检查手机浏览器是否拦截纯 HTTP 地址。

### 显示旧界面或旧功能

- 先确认 `index.html` 中资源版本号已增加。
- 电脑按 `Ctrl+F5`。
- 手机关闭页面后重新打开，必要时清除该站点缓存。

### 阿里云 CLI 提示令牌过期

重新执行 OAuth 配置。不要创建或粘贴长期 AccessKey。若 Codex 无法写入用户目录下的 `.aliyun`，使用临时 `--config-path`，完成维护后删除该文件。

### ECS 内存不足

当前服务器只有 2 GB 内存，Windows Server 本身占用较高。保持：

- `XIANGQI_ENGINE_SLOTS=1`
- 不同时启动多个服务器副本
- Pikafish 默认单线程

如果访问量明显增加，应升级内存，优先升到 4 GB。

## 10. 回滚

2026-08-21 部署前的服务端备份位于：

```text
C:\yiju-xiangqi\server.py.bak-20260821
C:\yiju-xiangqi\server.py.bak-20260821-stability
```

2026-08-24 完整部署前备份位于：

```text
C:\yiju-xiangqi\backup-20260824-063522
```

同日排查过程中还保留了若干 `server.py.bak-20260824-*` 单文件备份。

回滚前先确认备份存在，再停止主任务、替换 `server.py`、重新启动任务并执行真实走棋验证。

不要回滚或覆盖：

```text
yiju-users.db
```

它包含线上账号、会话和房间数据。

## 11. 后续优先事项

1. 购买域名并完成 ICP 备案。
2. 配置 HTTPS，解决部分手机和微信拦截 HTTP IP 的问题。
3. 若用户量增加，将 ECS 内存升级到 4 GB，并重新评估引擎并发数。
4. 若希望跨设备复盘，将浏览器本地对局记录迁移到账号数据库。

## 12. 交接给 Codex 的推荐提示

以后可以直接这样说：

```text
请先完整阅读 outputs/yiju-xiangqi/MAINTENANCE.md，
然后检查当前线上状态，再修改我提出的功能。
保留 yiju-users.db，不要使用长期 AccessKey，
部署后必须验证状态接口、真实落子、实时分析和手机端。
```

## 13. 2026-09-06 引擎恢复与进程清理修复

- 线上 `/api/status` 返回 `healthy: false`，真实落子返回 `source: fallback`。
- 云助手 PowerShell 和 Bat 诊断均以 `3221225794`（`0xC0000142`）失败。重启 ECS 后诊断恢复，待系统启动稳定后真实落子恢复。尚未确认系统初始化失败的唯一根因。
- 修复 `server.py` 的 `cleanup_engine_job`：Windows 取消/超时清理时使用 `taskkill /PID <worker> /T /F` 结束工作进程及其引擎子进程，并等待退出后删除任务文件；避免只杀工作进程而遗留引擎。
- 线上修改前备份：`C:\yiju-xiangqi\server.py.bak-20260906-cleanup`。数据库未修改。
- 验证通过：服务器 Python 编译、父子进程清理回归、看门狗脚本执行、连续五次真实落子 `source: pikafish`、分析流 `done: true`、状态 `healthy: true`、首页 HTTP 200。本次未执行手机或好友房间界面回归。

## 14. 2026-09-08 棋盘下方胜率与复盘操作

- 胜率改为棋盘下方单条红/和/黑分布及简短百分比；人机模式隐藏原分析卡片，暂停分析移入设置，推荐走法保留在操作区。
- 开局、上一步、下一步、结尾及复盘进度移到棋盘下方；非复盘模式隐藏。
- 修改并发布 `index.html`、`styles.css`，样式版本为 `styles.css?v=27`，JavaScript 仍为 `app.js?v=39`。
- 线上备份：`C:\yiju-xiangqi\backup-20260908-board-layout`。没有重启服务或改动数据库。
- 浏览器回归使用隔离测试记录和模拟分析数据，390px 与 1440px 均验证布局、胜率更新、暂停、复盘按钮、模式切换和无横向溢出。线上确认新版 HTML、资源版本及皮卡鱼健康状态。

## 15. 2026-09-08 手机精简与胜率状态

- 思考强度、我方执子移入设置，并提示更换执子会重新开局；手机人机对手卡压缩为上一手信息。
- 胜率条新增计算中、完成、暂停、等待对手、未连接、忙碌、连接失败和分析中断状态；过期/无效结果隐藏百分比及旧色段，错误时可点击重新分析。
- 合并人机/复盘分析流读取逻辑，处理服务端 error、无末尾换行、未完成流及 45 秒超时；取消旧请求并防止旧响应覆盖当前状态。
- 当前资源版本：styles.css?v=28、app.js?v=40。
- 备份：C:\yiju-xiangqi\backup-20260908-compact-status。未更改服务器代码或数据库。
- 390px / 1440px 浏览器回归通过：设置、暂停、成功、503、断网、流内错误、流中断、重试、复盘跳转。

## 16. 2026-09-08 落子优先与分析退让

- 首页使用 `/api/status?cached=1`，只读缓存和引擎存在状态，不运行健康计算；隐藏棋局不启动胜率分析。
- 服务器用等待/执行中的落子计数阻止新分析抢占引擎；正在分析时收到落子请求，返回 interrupted 信号并清理工作进程，让出槽位。
- 前端仅对引擎忙碌或分析退让自动重试，延迟 1.5 / 3 / 6 秒，最多三次；返回主页、切换局面、暂停或对手回合取消过期重试。
- app.js?v=41，styles.css?v=28。备份：C:\yiju-xiangqi\backup-20260908-move-priority。
- 本地回归验证：分析中插入落子、一秒内退让、落子期间阻止新分析、超时计数和槽位释放、首页零分析、自动重试和导航取消。
- 线上并发验证通过：深度 22 分析返回 interrupted，插入的落子返回 source: pikafish（本机含网络约 13.78 秒）；随后连续三次落子正常，健康状态 healthy: true。实际响应时间仍受网络、引擎启动和其他落子请求影响。

## 17. 2026-09-09 自定义棋盘

- 首页新增“自定义棋盘”，人机对战设置内也可从当前局面进入摆棋。
- 可放置红黑全部棋种、移动/移除、撤销摆放（最多 50 次）、清空、恢复标准开局；可选先行方和我方执子。
- 启动前校验数量、将帅、九宫、士象及兵卒位置、将帅照面、后行方被将军和无合法走法。校验是局面约束，不证明局面一定能由标准开局历史到达。
- 自定义对局“重开此局”保留自定义起点；记录新增 initialBoard/initialTurn，悔棋和黑方先行复盘正确，旧记录仍默认标准开局。
- 更新 index.html、app.js、styles.css。版本：app.js?v=42、styles.css?v=29。
- 线上备份：C:\yiju-xiangqi\backup-20260909-custom-board。未更改服务器代码或数据库。
- 验证：390px、1440px 全流程与 320px 布局；放置/校验/取消/撤销/落子/悔棋/刷新后复盘/旧记录回归通过。线上黑方先行残局返回 source: pikafish，并验证初始局面保存及复盘。
- 本次交付副本：C:\Users\ASUS\Documents\Codex\2026-09-06\zhe-g\outputs\yiju-xiangqi；原维护目录同步保存最新前端和维护文档。

## 18. 2026-09-09 自定义局面分析超时处理

- 分析搜索增加 `movetime 5000`，达到深度目标或约 5 秒搜索预算即返回结果；有限时结果返回 limited 标记，前端显示“分析完成 · 限时估算”。搜索时间不包含引擎启动及网络传输。
- 前端收到 done 后主动关闭分析流，避免已完成后仍等待连接结束。
- 线上复测发现偶发引擎早期响应超时；尚未输出结果且 12 秒内失败时重启分析引擎重试一次。已有输出或较晚失败不隐藏、不重复计算。日志标签 analysis-start-retry。
- 线上两种自定义局面验证通过：复杂多子局面约 7.03 秒返回限时结果，五子残局约 1.76 秒完成。验证启动重试、部分结果失败不被掩盖，以及完成信号后不等待 EOF。
- 更新 engine_worker.py、app.js、index.html；app.js?v=43，styles.css?v=29。
- 备份 C:\yiju-xiangqi\backup-20260909-analysis-time。未修改数据库。尚未拿到用户超时的具体局面，不能认定所有自定义局面均已穷尽验证。

## 19. 2026-09-09 自定义对局控制对方与编辑当前局面

- 自定义对局棋盘下方增加“控制对方”开关和“编辑当前棋盘”按钮。
- 接管期间双方按轮次手动落子，暂停皮卡鱼自动落子；支持双方分析/推荐，悔棋按单步撤回。关闭后，若轮到对方则恢复自动计算。
- 接管时取消在途落子请求并使旧响应失效，避免正在思考的皮卡鱼之后意外落子。
- 编辑当前棋盘保留局面和先行方；取消保留原对局，确认开始则建立新的自定义初始局面。非首页编辑保留手动控制选项。
- 更新 app.js?v=44、styles.css?v=30；备份 C:\yiju-xiangqi\backup-20260909-opponent-control。
- 手机/电脑回归通过：双方手动落子、单步悔棋、当前局面编辑与取消、思考中接管、交回皮卡鱼、普通模式入口隔离。线上资源版本验证通过。

## 20. 2026-09-09 棋盘反转与 GitHub 归档

- 新增棋盘上方“反转棋盘”，红黑对换视角；执子、局面、轮次及记录保持不变。
- 对战点击、选中提示、摆棋放置、复盘及动画切换适配反转；手机和电脑回归通过。
- 最新前端版本 app.js?v=45、styles.css?v=31。
- 发布命令 t-bj06wjxkuch19mo 因 InstanceNotRunning 被中止，服务器状态 Stopped，启动返回 InstanceExpired。反转功能尚不能确认线上生效。
- GitHub 归档使用维护中的最新本地副本；不包含数据库、会话、日志、凭证；因停机未能重新核对线上全量文件。
- 私有仓库：https://github.com/1172620300/yiju-xiangqi 。
