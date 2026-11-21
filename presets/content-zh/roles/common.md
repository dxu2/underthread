# Common notes (every role reads this)

## About the user
- Makes videos and posts for B站, YouTube and 小红书. Writes mostly in Chinese; English versions get translated later.
- Main quest (主线) = the current big production. Side quests (支线) = steady updates so followers see regular posts; speed over polish.
- Call the user by the name `python3 stateutil.py owner` prints (from `config.json` `owner.display_name`); while it prints `(unset…)`, just say 你 / you. Your own persona notes in `local/` win.

## House style
- Conclusion first. The first line of any draft says what it is and what decision is needed.
- One block per platform for publishable copy:
  - **B站**: title ≤ 40 chars, description, tags, pinned comment.
  - **YouTube**: title, description with chapters, tags. Chinese, plus an English title if asked.
  - **小红书**: title ≤ 20 chars, body with line breaks and emoji used sparingly, 5–10 hashtags, cover text.
- No clickbait the video does not deliver on.

## Files
- Your workspace for an item: `work/<item-id>/`. Files the user dropped in: `uploads/`.
- Attach files to an item with `--attach work/<item-id>/<file>`. The dashboard shows images inline.

## 交付和协作
- 要用户拿主意的事，用带选项的提问（`--ask '问题 :: A | B* | C'` 或 `stateutil.py ask`），不要只写在草稿正文里：埋在草稿里的问题会被漏看。你的推荐在选项末尾加 `*`，一题最多一个。
- 前后对比只放一张图：左右并排，标 before / after。分开的图要来回翻。
- 工作量按 agent 的实际耗时估：做几分钟 + 要审几轮。不写人工的小时 / 天（会大一个数量级）。
- 在浏览器里做的活：把关键画面截图贴到卡上（PNG，字要看得清）。调研和比价每个推荐至少一张。光给链接，用户得自己再点一遍。
- 碰到登录框、二维码、两步验证或人机验证：停下，把对话框放大截清楚贴到卡上并 @ 用户。绝不输入密码。二维码页不要刷新（会换码，用户得重扫）。
- 用浏览器时 `set-agent --tool chrome`，用完 `--tool ""` 清掉。同一时间只一个角色用浏览器，只用自己开的标签页，按网址打开。两个角色抢一个浏览器会互相点乱。
- 在待审核的卡上回完用户的评论，把卡放回 review（评论会把卡翻成 doing，没人放回就从首页消失）。评论已经回答了你的某个提问，就把那题关掉（`stateutil.py ask-close`）。
- 提新规则前过三道门槛：以后还会碰到、不写会再犯、不是某张卡的实现细节。工具的坑写进工具文档，代码约定写成代码注释。

## Confirmed rules
<!-- 你确认过的长期规则会由管家以 lesson 的形式追加在这里，每条一行，带日期。例：
- 前后对比只放一张并排图，标注 before / after。 (YYYY-MM-DD)
-->
