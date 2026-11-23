<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="web/brand/wordmark-on-dark@2x.png">
  <img alt="Underthread" src="web/brand/wordmark-on-light@2x.png" width="320">
</picture>

### 一个管家，一支 AI 小队，你只管点头。
#### 你只需要说：行、不行、再来一版。

[English](README.md) · **简体中文**

<img src="docs/img/crew.gif" alt="五个刺绣徽章队员排成一排，依次拿起自己的小工具" width="560">

[**5 分钟跑起来**](#5-分钟跑起来) · [**认识队员**](#认识队员) · [**和小队过一天**](#和小队过一天) · [**文档**](#文档)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Python 3.10+，只用标准库](https://img.shields.io/badge/python-3.10%2B%20%C2%B7%20stdlib%20only-informational)
![Runs on Claude Code](https://img.shields.io/badge/runs%20on-Claude%20Code-orange)

</div>

**这是什么。** Underthread 是一个跑在你自己电脑上的看板，加上一支由 [Claude Code](https://docs.claude.com/en/docs/claude-code) 驱动的小队。一个常驻的 Claude Code 会话当**管家**：你在看板里说的话，它整理成卡片，再派给对应的专员（Claude Code 子代理）。专员交回来的是草稿、计划和文件，你来批准、驳回（写一句原因），或者回答它的问题。

**给谁用。** 已经在用 Claude Code、手上同时挂着一堆小事的人：查资料、写东西、做计划、修小工具、每天要做的杂事。比起盯着一个聊天窗口，你更想每天过一遍待审队列，那就适合你。

**要花什么。** 软件本身免费（MIT）。活是 Claude Code 干的，所以**会用掉你自己 Claude 订阅的额度**，而且管家全天在线，每张卡都要消耗额度。管家会看着用量：超过 85% 只排队不派新活，到 95% 就睡到额度窗口重置。

<p align="center"><img src="docs/img/hero.gif" alt="一根针穿过 Underthread 字标，然后首页淡入" width="820"></p>

所有东西都在你自己的机器上。你不亲手发出去的东西，什么都不会出去。

> **还在早期。** 整个流程在一台机器上已经能从头跑到尾，但还有毛边。碰到问题欢迎开 issue。
>
> Underthread 是独立项目，**与 Anthropic 没有任何关联，也未获其认可或赞助**。Claude 和 Claude Code 是 Anthropic 的产品名。

---

## 认识队员

默认小队从五个人起步，缺谁再招谁。每人一枚刺绣徽章，干活的时候会拿起自己的小工具。

> **管家 = manager。** 文件、命令和 roster 里，管家的 id 是 `manager`（`manager.md`、`set-agent manager`）。其他人的 id 见第三列。

| | 谁 | Id | 做什么 |
|---|---|---|---|
| <img src="avatars/seed/ut/manager.png" width="48" alt=""> | **Steward**（管家） | `manager` | 读你发的每条消息，整理成卡片、派出去，每天给你写日报。有活的时候摇一下小铃铛。 |
| <img src="avatars/seed/ut/scout.png" width="48" alt=""> | **Scout**（研究员） | `scout` | 查资料、做对比、核事实，每条结论都带出处。放大镜不离手。 |
| <img src="avatars/seed/ut/hr.png" width="48" alt=""> | **Thimble**（HR） | `hr` | 帮你招其余的人：就你想招的岗位问你五件事（几轮就完），写好新人的角色笔记等你批准。调岗也找她。 |
| <img src="avatars/seed/ut/artist.png" width="48" alt=""> | **Brush**（设计） | `artist` | 图片、示意图和样稿，走 ChatGPT 订阅里的 Codex（见[出图](#出图codex-或不出图)）。走过留下一点颜料。 |
| <img src="avatars/seed/ut/smith.png" width="48" alt=""> | **Smith**（工具） | `smith` | 维护看板和工具，动手前先备份。没事的时候织毛线。 |

缺人？去招聘市场（29 个岗位模板）：Thimble 问你五件事，新人就上岗，Brush 还会给他缝一枚自己的补丁头像。名字、职责、语气、人数都在 `roster.json` 里。见[组建你自己的小队](#组建你自己的小队)。

---

## 5 分钟跑起来

**60 秒版**，适合已经登录好 Claude Code 的人：

```bash
git clone https://github.com/dxu2/underthread.git && cd underthread
./start
```

就这些：`./start` 会起看板、在浏览器里打开、在同一个终端里叫醒管家。在 Mac 上它还会问要不要在「应用程序」里放一个 **Underthread 图标**，以后点一下就行。然后在看板的聊天框里说一句话。只想看看？`./start --demo` 完全不需要 Claude Code。下面是同样的步骤，慢慢讲，每一步都写了你应该看到什么。

### 需要什么

| 需要 | 为什么 |
|---|---|
| macOS 或 Linux | Windows 没测过 |
| Python 3.10 以上 | 只用标准库，不用 `pip install` |
| 2023 年以后的浏览器 | 页面是 ES module + import map：Safari / iOS 16.4+、Chrome / Edge 89+、Firefox 108+ |
| [Claude Code](https://docs.claude.com/en/docs/claude-code)，登录付费的 Claude 订阅 | 每个队员都是 Claude Code 子代理，干活用的是你的订阅额度 |
| 带 **Monitor** 工具的 Claude Code 版本 | 管家靠后台 Monitor 盯着 `inbox.jsonl`。没有它，你在看板里说的话没人接 |
| 用量来源（可选，二选一） | 终端里：Claude Code 的 `statusLine` 跑 `tools/statusline.py`（Pro 或 Max 订阅）。Claude 桌面 App 里：管家调用 App 自带的用量工具。两个都没有的话，用量卡显示「未接入用量」，85% / 95% 的刹车也不会生效 |

### 步骤

**1. 下载并启动。**

```bash
git clone https://github.com/dxu2/underthread.git && cd underthread
./start
```
<!-- TODO(launch): 公开前这个地址必须能打开（2026-11-12 还是 404）。 -->

`./start` 按顺序做完准备，每一步打印一行：
- 检查 Python 3.10+（版本太旧会告诉你装哪个）、git 和 `claude` 命令；
- 在后台起看板，已经在跑就直接用。第一次运行会把 `config.example.json`、`roster.example.json`、`state.example.json` 复制成 `config.json`、`roster.json`、`state.json`；
- 给每个队员在 `.claude/agents/` 里生成一个 Claude Code 子代理（`make_agents.py`），`roster.json` 改过也会重新生成；
- 在浏览器里打开 <http://127.0.0.1:8765>；
- 问两个问题，各问一次（答案记在 `local/start.json`）：**要不要 Underthread 图标？**（默认要）；macOS 上还会问**要不要开机自动起看板？**（默认不要；答要就跑 `tools/install_service.sh`，会加一个登录项）；
- 叫醒管家：这个终端从此就是管家的窗口，别关它。已经有管家在跑的话，它会说一声，不会再开第二个。

第一次 Claude Code 会让你登录、确认信任这个文件夹。仓库自带 `.claude/settings.json`，让队员跑自己的辅助命令时不用每次问你，同时把用量喂给看板。保持原样就好；你自己要加的权限放进 `.claude/settings.local.json`（git 会忽略它，Claude Code 两个都读）。
*你应该看到：* 首页上有几张示例卡。几秒内顶栏的管家状态变成在线，聊天里出现一句问候。

**2. 说句话。** 在聊天框里打一句需求，就像给同事发消息。
*你应该看到：* 出现一张新卡，某个队员的徽章亮起来，开始干活。

**以后**点 **Underthread** 图标就行（Mac 上在「应用程序」里，可以拖进 Dock；Linux 上在应用菜单里）。它会起看板或直接用已经开着的、打开页面；管家没在跑的话，在一个自动收进 Dock 的终端窗口里叫醒它。第一次点时 macOS 会问一次「Underthread 想控制终端」，这是用来把窗口最小化的；选不允许也没关系，窗口就开着。关掉那个窗口管家就下线，再点一次图标就回来。也可以再跑一次 `./start`。

> **关于图标。** 图标是 `./start` 在你自己的 Mac 上用系统自带工具（`osacompile`、`sips`、`iconutil`）现做的，所以打开时不会被 Gatekeeper 拦。别把这个 App 拷到别的 Mac 上用，在那台 Mac 上跑一次 `./start` 就行。挪了文件夹位置的话，点图标会提示你在新位置跑一次 `./start`，它会重新做一个。`./start --app` 随时可以重做。

> **卸载。** `./start --uninstall` 一次把 Underthread 从这台电脑上拿掉：开机自启（如果开过）、正在跑的看板和管家、图标，而且只动属于这个文件夹的那些。它先列出来，问你一次（默认不做）；`./start --uninstall --dry-run` 只列不做。然后分开问两件事，默认都留着：要不要删掉整个文件夹（你的卡片、`local/`、`work/`、`uploads/` 都在里面；删之前先打一个备份 zip 到 `~/UnderthreadBackups/`），要不要删掉 Claude Code 在这个文件夹的会话记录（`~/.claude/projects/…`）。Claude Code 本身、它的设置、别的项目和 Claude 桌面 App 一概不碰。

> **只想先看看？** 跑 `./start --demo`（或者 `python3 server.py --demo`）。不用装 Claude Code，就能看到小队在干活：管家开卡，队员亮起来、记进度、交草稿；你在页面上点什么，都会收到一句预设的回复。demo 在单独的 `.demo/` 目录里跑，每次启动重建，不会读写你真实的卡片。按 Ctrl-C 退出。`PORT=8766` 换端口；`--lang zh` 或 `--lang en` 设对话语言（默认跟 `$LANG`）。

**想在 Claude 桌面 App 里跑管家？** 用 `./start --no-steward`，然后在 App 里打开这个文件夹，说 `Start the manager per manager.md`。**想一步步手动来**（`python3 server.py`、`python3 make_agents.py`、`claude "Start the manager per manager.md"`）？跟以前完全一样，见 [docs/setup-guide.md](docs/setup-guide.md)。

首页的「开工清单」会带你走完这几步，每一步做到了会自己打勾；全部打勾的第二天它自己收起（「编辑小组件」里能加回来）。在这之前，新看板会先放 5 页欢迎页，再带你认三处地方；「设置 → 通用 → 再走一遍」可以重看。

### 跟管家怎么说

说大白话就行。下面是常见的几类说法；聊天输入框上方有同一份快捷句（点一下填进输入框，你按发送才会发出），「全部说法」能看完整列表。

| 你想 | 可以这样说 | 谁接 | 你会收到 |
|---|---|---|---|
| 问进度 | 「X」这张卡到哪了？· 今天谁在忙什么？ | Steward（管家） | 聊天里直接回，不开新卡 |
| 定时 / 每天的活 | 每周日晚上给我出下周的菜单 · 每天早上 8 点给我一份晨报 | Steward（管家） | 开一个定时：卡常驻在「定时」页，每次的结果回到这张卡 |
| 搜一搜 / 调研 | 去小红书搜一下 X 的口碑，给我三条要点 · 帮我比较这三个城市的房租 | Scout（研究员） | 调研卡：每条结论带链接和截图 |
| 买东西 / 比价 | 看看有没有值得买的 X · 挑好放购物车，先别下单 | 采购（去招聘市场招） | 3 个选项 + 价格历史；下单前一定先问你 |
| 出行 | 假期找个清净的地方玩三天 · 家人来看我，排一周行程 | 行程规划（招） | 三套方案 + 预算 + 出发前清单；不替你订 |
| 写点东西 | 帮我回这封邮件，语气客气点 · 把这份笔记整理成一页纸 | Steward（招了写手之前由管家接） | 草稿卡，你批准才算交付 |
| 出图 | 给 X 做张封面，三个方向 · 把这张图改成竖版 | Brush（设计） | 样稿卡，几张图让你挑 |
| 修工具 / 看板 | 写个脚本把下载的文件按日期归档 · 这个按钮点了没反应，是 bug 吗？ | Smith（工具） | 先出方案给你看，改动前留备份 |
| 加人 / 收工 | 我想招一个帮我管 X 的人 · 我去睡了，能做的都做完 | Thimble（HR）/ Steward | 私信面谈，或第二天早上的日报 |

卡回来以后：驳回时写上原因（「太长了，以后都控制在 300 字」会变成规矩），问题直接点卡上的选项，想改一点就在评论里说（「第二段换个开头」）。

哪一步不对？看[排障](docs/troubleshooting.md)。完整安装（手机 App、推送）见 [docs/setup-guide.md](docs/setup-guide.md)（英文）。

**以后怎么升级。** 有新版时，设置 → 系统 → 更新 会提示；点「更新」，会先在一份数据副本上试跑，再换到新版并重启看板，卡片、设置和 `local/` 都原样保留。「退回」回到更新前的版本。也可以在终端跑 `python3 tools/update.py check | apply | rollback`。前提是用上面的 `git clone` 安装：下载 zip 解压的目录不能自己升级（重新 clone 一份，把 `local/` 和 `*.json` 数据文件拷过去）。

> **想改看板本身？** 先复制一份目录，在副本里跑 `PORT=8799 NO_LOOPS=1 python3 server.py`，别碰你真实的卡片。

---

## 和小队过一天

<p align="center"><img src="docs/img/hero-home.png" alt="小组件首页：团队交接、等你处理、用量、正在干活、今日完成、本周、每日" width="820"></p>

**09:10 · 张口就来。** 在聊天里打一句话。管家回你，一张新卡出现，有个队员开始干活。不用填表，不用选模板。

<p align="center"><img src="docs/img/send-to-card.gif" alt="一条聊天消息变成卡片，队员开始干活" width="720"></p>

**10:40 · 一个问题，不是一大段字。** 没人会把需要你拍板的事藏在草稿第四页。Scout 找到三个工具，想知道你更在意价格还是隐私：你看到两个按钮，Scout 推荐的那个排第一。「其他…」永远都在。

<p align="center"><img src="docs/img/ask-flow.gif" alt="点推荐选项，问题面板收起，卡片继续干活" width="720"></p>

**11:30 · 大活？** 耗时长或有风险的活，先交计划。你不点头，什么都不会动。

**14:20 · 轻松审稿。** 每次交付都保留旧版本，v1 和 v2 可以并排看改了哪里。满意就批准。

<p align="center"><img src="docs/img/approve.gif" alt="对比两版草稿，然后批准" width="720"></p>

**15:05 · 「不是这样。」** 驳回草稿，写一句原因。管家把这句话整理成给那位队员的规则提议，你确认后，他以后每次干活前都会先读。小队不会在同一个坑里摔两次。

<p align="center"><img src="docs/img/reject-rule.gif" alt="写原因驳回，出现规则提议并确认" width="720"></p>

**18:00 · 一页日报。** 管家写日报：等你处理的、今天完成的、还在做的、新采纳的规则、出了什么问题。

---

## 功能一览

- **首页自己摆。** 电脑首页是一组小组件。在「编辑小组件」里拖动排序，每个都能选 S（一个数字）、M 或 L（更多行、柱状图、最近素材 3 × 3）。你选过的尺寸就一直按你选的画。手机上在「设置 → 通用 → 手机首页」选「小组件」，同一组小组件两列排（默认仍是列表首页）。

- **手机上也能用。** 把看板加到主屏幕，就像一个 App，推送通知会避开免打扰时段。见[手机和推送](docs/phone-and-push.md)（英文）。

  <p align="center"><img src="docs/img/phone.gif" alt="手机 App：底部浮动标签栏切换、长按看名字、下拉刷新" width="300"></p>

- **一句话定时。** 「明天 9 点提醒我…」「每个工作日 9 点让 Scout 看看趋势」会变成「定时」页上的一条，有开关和一周的运行记录。
- **招聘市场。** 29 个岗位模板，每个三种性格。先让 HR 面试，或者一键雇佣。
- **⌘K，或者直接按 `/`。** 搜索所有卡片和聊天记录。
- **一个信箱。** 回复、交付和通知都在这里，可筛选。
- **邮件进管家的收件箱。** 在「设置 → 连接」里连上 Gmail（应用专用密码，存在钥匙串里），新邮件每隔几分钟汇成一条只有标题的消息，分成「要你处理 / 可起草 / 知悉」。只读：什么都不会发出或删除。Slack 随后支持。见 [Feeds](docs/feeds.md)（英文）。
- **换个样子。** Underthread 的咖啡奶油配色，或者 Ink 黑玻璃；夜间、日间或跟随系统；再叠一层质感：针脚、软皮。

  <p align="center"><img src="docs/img/textures.gif" alt="在设置里切换质感：关、针脚、软皮" width="720"></p>

- **中文或英文界面**，在设置里切换。
- **自动归档。** 完成很久的卡会挪走，看板保持轻快，搜索照样找得到。

---

## 组建你自己的小队

Underthread 不在乎你做什么工作。管家、卡片、审核、规则、看板，对任何团队都一样。改队伍的几种方式：

1. **招聘市场**（左侧栏）。选个模板点**面试**：HR 先问你几个问题，写好新人的角色笔记，你批准后入职。**直接雇**跳过面试。两种都会给新人头像、角色笔记和代理文件。没有 HR 的老队伍会看到一个**先请 HR** 按钮。
2. **命令行。** `python3 tools/new_role.py plan|apply|retire|rehire|update`。
3. **手改。** 改 `roster.json` 和 `local/roles/<id>.md`，然后跑 `python3 make_agents.py`。
4. **整队换。** 市场顶上的预设条可以一键换整支队伍：`classic`（早先的七人通用队，多一个写作、一个规划、一个协调）或 `content-zh`（中文内容创作团队）。写入前先给你看会改什么，被替换的文件都先备份。命令行是 `python3 tools/preset.py apply <name>`。

5. **内容创作者。** 「制作线」和「频道」两页（一条制作流水线，加上 B站 / YouTube / 小红书 的分平台预览）在新装时是关的。用 `content-zh` 预设、或者 `config.json` 里配了发布平台时会自动打开，也可以在 设置 → 制作线和频道 手动开。

在左栏「团队」页里还可以给队员**调岗**、让他**退休**，或者**改名**、**换头像**。

<p align="center"><img src="docs/img/market.png" alt="招聘市场：岗位卡片，每个三种性格，面试和直接雇按钮" width="720"></p>

完整说明（所有 roster 字段和一个实例）：[docs/custom-crew.md](docs/custom-crew.md)（英文）。

### 出图：Codex 或不出图

Brush、新队员的头像和几个工具都通过 `tools/image.py` 出图，后端由 `config.json` → `image.backend` 决定：

| 设置 | 用什么 |
|---|---|
| `auto`（默认） | Codex 登录了 ChatGPT 就用 Codex，否则不出图 |
| `codex` | Codex CLI（或 ChatGPT.app 里自带的），走你的 ChatGPT 订阅，从不用 API key |
| `none` | 不出图。新队员用岗位模板自带的补丁头像，其他一切照常 |

`python3 tools/image.py backend` 会告诉你现在用的是哪个、为什么。每张图都花额度，所以不会自动重试。这一版去掉了 ComfyUI；旧配置里的 `image.backend: "comfy"` 会按 `auto` 处理。

---

## 我们的承诺

1. **只出草稿。** 小队从不发布、发帖、上传、评论或往外发任何东西。这些由你来做。
2. **大事先问。** 耗时长或有风险的活先交计划，等你点头。
3. **不碰你的文件。** 队员只在 `work/<卡片 id>/` 里写新文件，不删也不覆盖你上传的东西，改代码和配置前先备份。
4. **数据留在家里。** 卡片、聊天、上传、日志、记忆都是项目目录里的文件，全部被 git 忽略。看板只监听 `127.0.0.1`。推送密钥和 token 在本机生成、权限 600，不会发给网页。用量数据从本机的 Claude Code 读取，也只留在本机。
5. **实话实说。** 每次交付都写明有几成把握、哪些没核实。

更多见 [.github/SECURITY.md](.github/SECURITY.md)（英文）。

---

## 怎么运转的

```mermaid
flowchart LR
  You((你)) -- 消息、点击 --> UI[看板<br/>电脑 + 手机]
  UI <--> SRV[server.py]
  SRV -- 新请求 --> IN[(inbox.jsonl)]
  IN -- Monitor --> MGR[管家<br/>常驻的 Claude Code 会话]
  MGR -- 派卡 --> AG[队员<br/>Claude Code 子代理]
  MGR --> SU[stateutil.py]
  AG --> SU
  SU -- 加锁写入 --> ST[(state.json)]
  ST --> SRV
```

- **一个状态文件。** 所有东西都在 `state.json`，只有 `stateutil.py` 能写，写的时候加文件锁。
- **一个收件箱。** 你在看板里的操作都追加到 `inbox.jsonl`，管家盯着它，一条条处理。
- **按 roster 生成队员。** `make_agents.py` 把 `roster.json` 里的每一项变成一个 Claude Code 子代理。
- **不用构建。** 纯 HTML、CSS、JavaScript，由只用标准库的 Python 服务器提供。

完整循环、卡片生命周期、记忆放在哪：[docs/architecture.md](docs/architecture.md)（英文）。

---

## 文档

详细文档目前只有英文版。

| | |
|---|---|
| [docs/setup-guide.md](docs/setup-guide.md) | 完整安装：配置、roster、重启、出图、工具 |
| [docs/layout.md](docs/layout.md) | 目录一览：每个文件和文件夹是什么、哪些是你自己的（英文） |
| [docs/architecture.md](docs/architecture.md) | 各部分怎么配合、卡片生命周期、记忆 |
| [docs/custom-crew.md](docs/custom-crew.md) | 增加、修改、退休队员 |
| [docs/phone-and-push.md](docs/phone-and-push.md) | 手机 App、Tailscale Serve、推送 |
| [docs/feeds.md](docs/feeds.md) | 连接 Gmail：信息流收集、收件箱里的格式、密码存在哪 |
| [docs/troubleshooting.md](docs/troubleshooting.md) | 排障和常见问题 |
| [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md) | 参与开发 |
| [.github/SECURITY.md](.github/SECURITY.md) | 安全模型和漏洞报告 |
| [CHANGELOG.md](CHANGELOG.md) | 更新记录 |

---

## 路线图

正在琢磨的想法，不是承诺：
- 一张卡依赖另一张时，队员之间直接交接。
- 在看板里直接编辑记忆，而不只是看。
- 带范围的批准：「这张卡都行」「这类改动都行」。
- 把整套东西打包成 Claude Code 插件。

不在这个仓库里的：和管家语音通话（作者自己的版本有），以及任何模型权重（whisper 等各有各的许可）。

---

## 许可

代码采用 [MIT](LICENSE)。你接入的模型、字体、声音和图片各自保留原许可。自带字体（Nunito、Cinzel）采用 SIL Open Font License 1.1，许可文本在 `web/fonts/`。Underthread 的标志、徽章头像、`templates/roles/` 下的岗位模板头像和 `web/` 下的质感贴图都是为本项目制作的，不含第三方作品，和代码一样采用 MIT。

名字和标志用来识别本项目。如果你分发改过的分支，请换一个名字。

<p align="center"><sub>一个人和一支不睡觉的小队做的。欢迎 issue 和想法。</sub></p>
