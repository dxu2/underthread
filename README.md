# Underthread · 暗线

[English](README.en.md)

一个给个人自媒体创作者用的 **AI agent 团队看板**。一个常驻的「管家」会话（Claude Code）接你的指令、拆成卡片、派给几位专员（研究、编剧、导演、美术、运营、工匠），专员只交**草稿**，你在本地看板上批准、驳回或评论。发布永远由你自己来。

> 状态：第一版，框架可以跑通。语音通话 / 会议、像素露台办公室和舞台背景这几块依赖私有素材，没有放进这个仓库。

## 截图

> （占位：用示例数据截的看板首页）
>
> （占位：卡片详情页：草稿、把握度、时间线、批准 / 驳回）
>
> （占位：手机端）

## 它能做什么

- **本地看板**（`server.py` + `web/`）：卡片看板、详情页、版本对比、日程、通知、手机端（可以加到主屏幕）、Web Push 推送。
- **状态只走一个入口**（`stateutil.py`）：卡片、对话、日志、规则提议都存在本地 `state.json`，有文件锁。
- **角色可配置**（`roster.json` + `make_agents.py`）：改名字、职能、性格，一条命令生成 Claude Code 子 agent 文件。
- **规则会成长**：你驳回时写的原因，管家会整理成规则提议，你确认后写进 `roles/*.md` 的 `## Confirmed rules`。
- **可选**：用 ComfyUI 出图（`tools/comfy.py`，走 SSH 隧道连你自己的 GPU 机器）；用 whisper.cpp 给语音备忘转文字（`tools/transcribe.py`）。

## 上手

需要：macOS 或 Linux、Python 3.10+（只用标准库）、[Claude Code](https://docs.claude.com/en/docs/claude-code)。导演角色要用 ffmpeg 的话另装。

```bash
git clone https://github.com/dxu2/underthread.git && cd underthread

# 1. 第一次启动会自动从 *.example.json 复制出 config.json / roster.json / state.json
python3 server.py              # 打开 http://127.0.0.1:8765

# 2. 改 roster.json（角色名字、职能、性格），然后生成 agent 文件
python3 make_agents.py         # 写到 .claude/agents/，并刷新 manager.md 里的派单表

# 3. 可选：让团队免确认地跑 stateutil 等命令
cp claude-settings.example.json .claude/settings.json

# 4. 另开一个终端，启动管家
claude "Start the manager per manager.md"
```

详细说明见 [SETUP-GUIDE.md](SETUP-GUIDE.md)。改界面时先在副本里试：`PORT=8799 NO_LOOPS=1 python3 server.py`，不要碰真实的 `state.json`。

## 示例角色

`roster.example.json` 里是一套**中性的占位角色**：阿管（管家）、阿侦（研究）、阿笔（编剧）、阿镜（导演）、阿绘（美术）、阿播（运营）、阿匠（工匠）。名字、性格、对你的称呼都可以随便改。这个仓库**不包含任何商业游戏或动漫的角色**，也请不要把别人的角色形象、立绘提交进来。

## 不包含的东西

| 不包含 | 说明 |
|---|---|
| 你的数据 | `config.json`、`roster.json`、`state.json`、`inbox.jsonl`、`uploads/`、`work/`、`logs/`、`avatars/` 都在 `.gitignore` 里 |
| 推送密钥 | `vapid.json` 第一次用推送时在本机自动生成，权限 600，**永远不要提交** |
| 模型 | whisper 模型、ComfyUI 模型、LoRA 等都不附带。请自己下载，并遵守它们各自的许可协议 |
| 声音 | 不附带任何声音样本或克隆声音。语音模块之后单独发布；只用你自己的声音或你有权使用的声音 |
| 美术素材 | 角色立绘、像素办公室素材不附带。界面在没有这些图时会自动退回纯文字 / 头像 |

## 原则

- **只出草稿**：agent 从不在 B站 / YouTube / 小红书 或任何外部服务上发布、评论、上传。
- **改动先出计划**：大活先交计划，你批准后才动手。
- **备份**：改文件前留 `.bak-<tag>`（已在 `.gitignore` 里用 `*.bak*` 排除）。

## 许可

代码使用 [MIT](LICENSE)。MIT 只覆盖本仓库的代码；你接入的模型、字体、声音和图片各自遵守原来的许可。
