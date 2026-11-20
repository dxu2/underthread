/* t-onboarding P0: 快捷指南 data (what to say to the steward), zh + en. One list feeds the chips above the chat field (onboard.js ①), the examples in
   an empty steward chat (②), the bubble of setup step 4 (③) and the README table (⑤, written by hand from the same rows).
   Each group: k (id), g (group name), ex (examples; an "X" or 「X」 in one is selected after it is filled in, so you type over it), to (the role ids it
   goes to, first one on the team wins; hire = a role the crew may not have: the line then offers 「招 …」 from the hiring market; fall = who takes
   it meanwhile), see (what comes back).
   chip = the short label on the chip row (the example's first sentence fills the field). The examples are rewritten from common requests:
   no names, places, amounts, shops or health details. */
window.QGDATA = {
  zh: [
    { k: "status", g: "问进度", chip: "这张卡到哪了？", ex: ["「X」这张卡到哪了？", "今天谁在忙什么？"], to: ["manager"], see: "聊天里直接回，不开新卡" },
    { k: "daily", g: "定时 / 每天的活", chip: "每周日出下周菜单", ex: ["每周日晚上给我出下周的菜单", "每天早上 8 点给我一份晨报"], to: ["manager"], see: "开一个定时 · 卡常驻在「定时」页，每次的结果回到这张卡" },
    { k: "research", g: "搜一搜 / 调研", chip: "去小红书搜一下 X 的口碑", ex: ["去小红书搜一下 X 的口碑，给我三条要点", "帮我比较这三个城市的房租"], to: ["scout"], see: "调研卡 · 每条结论带链接和截图，回到「等你拍板」" },
    { k: "buy", g: "买东西 / 比价", chip: "看看有没有值得买的 X", ex: ["看看有没有值得买的 X", "挑好放购物车，先别下单"], to: ["buyer"], hire: "Buyer", see: "选项卡：3 个选项 + 价格历史 · 下单前一定先问你" },
    { k: "trip", g: "出行", chip: "找个清净的地方玩三天", ex: ["假期找个清净的地方玩三天", "家人来看我，排一周行程"], to: ["travel", "xingzhe"], hire: "Travel", see: "三套方案 + 预算 + 出发前清单 · 不替你订" },
    { k: "write", g: "写点东西", chip: "把这份笔记整理成一页纸", ex: ["帮我回这封邮件，语气客气点", "把这份笔记整理成一页纸"], to: ["writer"], fall: "manager", see: "草稿卡 · 你批准才算交付" },
    { k: "image", g: "出图", chip: "给 X 做张封面", ex: ["给 X 做张封面，三个方向", "把这张图改成竖版"], to: ["artist", "brush"], see: "样稿卡 · 几张图让你挑" },
    { k: "tool", g: "修工具 / 看板", chip: "写个脚本整理下载文件夹", ex: ["写个脚本把下载的文件按日期归档", "这个按钮点了没反应，是 bug 吗？"], to: ["smith"], see: "先出方案给你看，改动前留备份" },
    { k: "team", g: "加人 / 收工", chip: "我去睡了，能做的都做完", ex: ["我想招一个帮我管 X 的人", "我去睡了，能做的都做完"], to: ["hr", "thimble", "manager"], see: "面谈私信 / 第二天早上的日报" },
  ],
  en: [
    { k: "status", g: "Ask where things are", chip: "Where's this card at?", ex: ["Where's the “X” card at?", "Who's busy right now?"], to: ["manager"], see: "answered in the chat, no new card" },
    { k: "daily", g: "Schedules and dailies", chip: "Plan next week's meals on Sundays", ex: ["Every Sunday night, plan next week's meals", "A morning brief at 8 every day"], to: ["manager"], see: "a schedule · the card stays on Schedules, each run reports back to it" },
    { k: "research", g: "Look something up", chip: "Search for reviews of X", ex: ["Search Xiaohongshu for reviews of X, give me three points", "Compare rents in these three cities"], to: ["scout"], see: "a research card · every point has a link and a screenshot, then it waits on you" },
    { k: "buy", g: "Shopping", chip: "Anything worth buying for X?", ex: ["Any X worth buying?", "Put the best one in my cart, don't order"], to: ["buyer"], hire: "Buyer", see: "3 options with price history · always asks before ordering" },
    { k: "trip", g: "Trips", chip: "A quiet 3-day trip", ex: ["A quiet 3-day trip for the holiday", "Plan a week for family visiting"], to: ["travel", "xingzhe"], hire: "Travel", see: "three plans, a budget and a packing list · never books for you" },
    { k: "write", g: "Writing", chip: "Turn my notes into one page", ex: ["Reply to this email, politely", "Turn these notes into one page"], to: ["writer"], fall: "manager", see: "a draft card · it ships when you approve" },
    { k: "image", g: "Images", chip: "Three cover ideas for X", ex: ["Three cover ideas for X", "Make this image portrait"], to: ["artist", "brush"], see: "a sample card · a few images to pick from" },
    { k: "tool", g: "Tools and the dashboard", chip: "A script to tidy my downloads", ex: ["A script to file my downloads by date", "This button does nothing, is it a bug?"], to: ["smith"], see: "a plan first, a backup before any change" },
    { k: "team", g: "Hiring and wrapping up", chip: "Going to bed, finish what you can", ex: ["I want someone to handle X", "Going to bed, finish what you can"], to: ["hr", "thimble", "manager"], see: "an interview in a DM / the next morning's report" },
  ],
  /* the chip row (①): six groups, in this order; ② and ③ use the first three */
  chips: ["status", "daily", "research", "write", "image", "tool"],
  /* how to answer a card (bottom of the full list) */
  answer: {
    zh: ["驳回写原因：「太长了，以后都控制在 300 字」，这句会变成规矩", "回答问题：直接点卡上的选项", "改一点再交：「第二段换个开头」"],
    en: ["Reject with a reason: “too long, keep it under 300 words from now on” becomes a rule", "Answer a question: tap an option on the card", "Ask for a tweak: “start the second paragraph differently”"],
  },
};
