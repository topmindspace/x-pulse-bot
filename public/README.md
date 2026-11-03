# X Pulse (Public) · topic heat, last 24 hours

**English** · [中文](#中文)

A ready-to-use template for a Grok Bot that shows **how hot a topic is on X over the last 24 hours**: an interactive dial page (Grok canvas) plus a 16:9 and a 1:1 video with the generative music. It uses the same renderer as the Personal edition (`../renderer/x-pulse-replay.tsx`, `DATA.mode = "public"`), so the dial, effects, music, EN / 中文 switch and shortcuts are the same.

| | Personal (`mode: "personal"`) | Public (`mode: "public"`) |
| --- | --- | --- |
| subject | your own account, 1 to 7 calendar days | a topic (keyword sets), the last 24 hours, window end = a full hour |
| data | every post of the account with its measured numbers | X **hourly counts** + a few **samples**, scaled; people are scaled with a measured ratio |
| dial | one dot per post | **1 dot = N posts** (N is a round number, 600 to 900 dots) sampled from real posts; up to 8 real **hot posts** you can open |
| comets | follower change | active posters (1 comet = M people) |
| centre board | engagement, posts, impressions, followers | views, posts / replies / quotes, engagement, reposts, posters, commenters; ends on the sidebar totals |
| status word | density of the playhead's last hour | the hour's rank by post volume (5 levels) |
| caveat | none needed, missing stays missing | **estimated numbers**: the caveat is written only in the wide / stacked sidebar and the page footnotes (the square layout and video carry none); the dial, centre board and bars never carry 「估」 / "est." |
| videos | no | `make_public.sh` |

## Flow (what the Bot does, at most 25 X calls)

```
1. topic + keyword sets            edit config.json  (topic.name / title, sets[], display_tz)
2. python3 fetch_plan.py           -> cache/plan_<TAG>.json : every X call with its exact query (archived with the result)
3. run the plan with the x MCP tools (write_to_file = true; never read results into the chat)
     A counts  (get_posts_counts_recent, hourly: per set x all / orig / reply / quote)
     B samples (search_posts_all, 25 posts per stratum)   C second slot only where ingest says NEED_SLOT2   D hot candidates
4. python3 ingest.py --tag <TAG> c.en.all=<file> s.en.orig.1=<file> h.1=<file> ...   -> cache/*_<TAG>.json (safe to repeat)
5. (optional) python3 db_hot.py --tag <TAG>                      freeze hot candidates from a local database
6. bash make_public.sh --tag <TAG> --ver v1 [--lang zh|en] [--outdir DIR]
       fill_public.py  -> out/data_<TAG>.json, out/page_<TAG>.tsx (the page for WriteCanvas), out/summary_<TAG>.json
       gloss.py        -> exit 4 if a hot post lacks its translation: write it into cache/gloss.json (zh for English posts, en for Chinese ones), re-run
       video/*         -> <DIR>/X-Pulse-Public_<topic>_<date>_<ver>_{16x9,1x1}.mp4 (+ _data.json, _summary.json)
```

The page file `out/page_<TAG>.tsx` is the renderer with only its DATA block replaced: pass it to `WriteCanvas` (the first time; later runs overwrite the same canvas). The bot never edits anything outside the DATA block.

### Method (what is measured, what is scaled)

- **Post counts**: X counts API per hour, mutually exclusive kinds (originals `-is:retweet -is:reply -is:quote`, replies, quotes). **Reposts = all − originals − replies − quotes** per hour (clamped at 0; a clamp is reported in `summary.warnings`).
- **Views and engagement**: stratified samples (set × kind): winsorised (p97.5) sample mean × the stratum's post count; the range is p95-trimmed to untrimmed. Views are very heavy-tailed, so the range is not a statistical confidence interval.
- **People**: posters = (originals + quotes) / posts-per-poster; commenters = replies / replies-per-commenter. The ratios are **measured on X** (`calibrate_people.py`, `calibration.json`: posts per person = 1 / mean(1 / n_i) over authors of random posts, bootstrap 90% interval). Current values: 2.0 posts per poster (1.37 to 3.55), 2.7 replies per commenter (1.66 to 5.78), 10 authors per kind, so the people numbers carry wide ranges; the sidebar shows them.
- **Injected data** is aggregates (hourly series, cumulative people curves, totals with ranges), scaled sample dots (values come from real sampled posts, no author, no text) and at most 8 real hot posts (with id, handle, text, public numbers). Nothing else.
- **Fixed seed** = sha256(tag | topic), so a rebuild of the same cache gives the same page.

### Files

| file | what it does |
| --- | --- |
| `config.json` | topic, keyword sets (one per language, mutually exclusive), display time zone, budget, injection limits, hot-post rules, people source |
| `common.py` | config validation, query builder, helpers |
| `fetch_plan.py` | the call plan (≤ `budget.max_calls`, default 25) with archived queries |
| `ingest.py` | raw X results → `cache/` (counts, samples, hot candidates); prints sample sizes, standard errors, `NEED_SLOT2` |
| `calibrate_people.py` | measures the people ratios (about 20 count calls, one-off) → `calibration.json` |
| `db_hot.py` | optional: freeze hot candidates from a local SQLite database |
| `gloss.py` | translations for hot posts (zh ↔ en) in `cache/gloss.json`; exit 4 if missing |
| `fill_public.py` | cache → DATA → page file + summary; self-checks (exit 3) |
| `make_public.sh` | one command: fill → gloss → bundle → record 16:9 + 1:1 → offline music → mp4 |
| `video/` | headless recorder (puppeteer-core + esbuild + ffmpeg); needs `npm install` in `video/` (or the repo's `tests/node_modules`) |
| `cache/`, `out/` | working folders (git-ignored; they hold real third-party post text) |

Exit codes: `fill_public.py` 0 ok, 2 cache / config incomplete, 3 self-check failed, 4 gloss missing; `make_public.sh` additionally 5 environment missing, and 3 if the recorder finds 「估」 / "est." in the dial, centre board or bars.

### Caveats to state when you report

1. People ratios rest on 10 authors per kind: the posters / commenters numbers are the least certain (ranges are shown).
2. Views are a scaled sample mean of a heavy-tailed variable; the range is wide.
3. Dots are scaled sample dots, not individual posts (only the hot posts are real and clickable).
4. A hot post whose own text contains 「估」 will show it (it is a real post, not our wording).
5. Square (1:1) videos carry no caveat wording at all (no sidebar, no "est." anywhere in the frame); say the caveats in your reply or post text.

### Tests

`cd ../tests && npm install && npm test` runs, among others: `test_public.py` (config validation, fill invariants, exit codes, clamp, determinism, people maths, aggregates-only injection), `public.mjs` (validation messages, EN / 中文, no 估 / est. in canvas text and DOM outside `[data-xp-caveat]`, three layouts, panel overflow and font floor, centre board = sidebar totals, hot card, recorder hook).

### Bot template (Public)

Name **X Pulse (Public)**. One line: "Give me a topic and I draw how hot it is on X over the last 24 hours: an interactive dial plus 16:9 and 1:1 videos with music." The working instructions and the reply format are in the maintainer's `public-bot-draft.md` (not part of this repo).

---

<a id="中文"></a>

# X Pulse (Public) 公共版 · 话题最近 24 小时热度

[English](#x-pulse-public--topic-heat-last-24-hours) · **中文**

可直接使用的 Grok Bot 模板：给一个话题，画出它在 X 上最近 24 小时有多热：一张可交互的表盘页面（Grok 画布），外加 16:9 和 1:1 两条带配乐的视频。和个人版共用同一个渲染器（`../renderer/x-pulse-replay.tsx`，`DATA.mode = "public"`），所以表盘、特效、音乐、中英文切换和快捷键都一样。

| | 个人版（`mode: "personal"`） | 公共版（`mode: "public"`） |
| --- | --- | --- |
| 对象 | 你自己的账号，1 到 7 个自然日 | 一个话题（关键词组），最近 24 小时，窗口结束在整点 |
| 数据 | 账号每条帖和实测数字 | X **逐小时计数** + 少量**抽样**折算；人数按实测比值折算 |
| 表盘 | 一帖一点 | **1 点 = N 帖**（N 取好读的整数，600 到 900 个点），数值来自真实抽样帖；最多 8 条可点开的真实**热帖** |
| 彗星 | 粉丝变化 | 活跃发帖人（1 颗 = M 人） |
| 中心看板 | 互动、发帖、曝光、粉丝 | 浏览、原创/评论/引用、互动、转推、发帖人、评论人；转完一圈等于侧栏合计 |
| 状态词 | 最近一小时的密度 | 该小时的帖量排名（5 档） |
| 口径说明 | 不需要，缺失就缺失 | **估算值**：说明只写在横版 / 堆叠版侧栏和页面脚注（方版画面和视频里没有），表盘、中心看板、柱图上不出现「估」/ "est." |
| 视频 | 无 | `make_public.sh` |

## 流程（Bot 做什么，最多 25 次 X 调用）

```
1. 话题 + 关键词组                 改 config.json（topic.name / title、sets[]、display_tz）
2. python3 fetch_plan.py           -> cache/plan_<TAG>.json：每次 X 调用及其完整查询（随结果一起归档）
3. 用 x MCP 工具执行计划（write_to_file = true；结果不要读进对话）
     A 计数（get_posts_counts_recent，逐小时：每词集 × 全部/原创/评论/引用）
     B 抽样（search_posts_all，每层 25 帖）  C 仅对 ingest 提示 NEED_SLOT2 的层补第二槽  D 热帖候选
4. python3 ingest.py --tag <TAG> c.en.all=<文件> s.en.orig.1=<文件> h.1=<文件> ...   -> cache/*_<TAG>.json（可重复执行）
5.（可选）python3 db_hot.py --tag <TAG>                     从本地库冻结热帖候选
6. bash make_public.sh --tag <TAG> --ver v1 [--lang zh|en] [--outdir 目录]
       fill_public.py  -> out/data_<TAG>.json、out/page_<TAG>.tsx（交给 WriteCanvas 的页面）、out/summary_<TAG>.json
       gloss.py        -> 热帖缺译文时 exit 4：把译文写进 cache/gloss.json（英文帖补 zh，中文帖补 en）后重跑
       video/*         -> <目录>/X-Pulse-Public_<话题>_<日期>_<版本>_{16x9,1x1}.mp4（+ _data.json、_summary.json）
```

`out/page_<TAG>.tsx` 就是只替换了 DATA 块的渲染器：第一次交给 `WriteCanvas`，之后覆盖同一张画布。DATA 块以外的内容 Bot 不改。

### 口径（哪些是实测，哪些是折算）

- **帖量**：X 计数接口逐小时，互斥分类（原创 `-is:retweet -is:reply -is:quote`、评论、引用）。**转推 = 全部 − 原创 − 评论 − 引用**（逐小时，负数按 0，发生时写进 `summary.warnings`）。
- **浏览与互动**：分层抽样（词集 × 类型）：截尾（p97.5）样本均值 × 该层帖量；区间为 p95 截尾到不截尾。浏览极重尾，这个区间不是统计置信区间。
- **人数**：发帖人 =（原创 + 引用）÷ 人均发帖数；评论人 = 评论 ÷ 人均评论数。比值**在 X 上实测**（`calibrate_people.py`、`calibration.json`：人均帖数 = 1 / mean(1 / n_i)，n_i 为随机抽中帖的作者的帖数，自助法 90% 区间）。当前值：人均发帖 2.0（1.37 到 3.55），人均评论 2.7（1.66 到 5.78），每类只有 10 位作者，所以人数区间很宽，侧栏会写出来。
- **注入的数据**只有聚合结果（逐小时序列、人数累计曲线、带区间的合计）、折算样本点（数值来自真实抽样帖，不带作者和文字）和最多 8 条真实热帖（id、账号、正文、公开数字）。
- **固定随机种子** = sha256(TAG | 话题)，同一份缓存重建结果一致。

### 文件

| 文件 | 作用 |
| --- | --- |
| `config.json` | 话题、关键词组（每种语言一组、互斥）、显示时区、预算、注入上限、热帖规则、人数来源 |
| `common.py` | 配置校验、查询生成、通用函数 |
| `fetch_plan.py` | 调用计划（不超过 `budget.max_calls`，默认 25），查询归档 |
| `ingest.py` | X 原始结果 → `cache/`（计数、样本、热帖候选）；打印样本量、标准误、`NEED_SLOT2` |
| `calibrate_people.py` | 实测人数比值（约 20 次计数调用，一次性）→ `calibration.json` |
| `db_hot.py` | 可选：从本地 SQLite 冻结热帖候选 |
| `gloss.py` | 热帖译文（中 ↔ 英）写入 `cache/gloss.json`，缺失 exit 4 |
| `fill_public.py` | 缓存 → DATA → 页面文件 + 汇总；自检（失败 exit 3） |
| `make_public.sh` | 一条命令：填数 → 译文 → 打包 → 录 16:9 + 1:1 → 离线配乐 → mp4 |
| `video/` | 无头录制（puppeteer-core + esbuild + ffmpeg）；需在 `video/` 里 `npm install`（或沿用仓库的 `tests/node_modules`） |
| `cache/`、`out/` | 工作目录（已 git 忽略；里面有第三方真实帖子文字） |

退出码：`fill_public.py` 0 正常、2 缓存或配置不全、3 自检失败、4 缺译文；`make_public.sh` 另有 5 环境缺失，录制发现表盘、中心看板或柱图里有「估」/ "est." 时也是 3。

### 汇报时要说明的几点

1. 人数比值只基于每类 10 位作者：发帖人 / 评论人是最不确定的数（区间已显示）。
2. 浏览是重尾变量的样本均值折算，区间很宽。
3. 点是折算的样本点，不是逐条帖（只有热帖是真实、可点开的）。
4. 热帖正文里若自带「估」字，会照原样显示（那是真实帖子，不是我们的措辞）。
5. 方版（1:1）视频画面里完全没有口径字样（没有侧栏，也没有「估」/ "est."）；口径请写在回复或发帖文字里。

### 测试

`cd ../tests && npm install && npm test`，其中包括：`test_public.py`（配置校验、填数不变量、退出码、负数截断、确定性、人数计算、只注入聚合）和 `public.mjs`（校验错误提示、中英文、画布文字和 `[data-xp-caveat]` 之外的 DOM 里没有「估」/ est.、三种版式、面板不溢出和字号下限、中心看板 = 侧栏合计、热帖卡、录制接口）。

### Bot 模板（公共版）

名称 **X Pulse (Public)**。一句话：「给我一个话题，我画出它在 X 上最近 24 小时有多热：可交互表盘，外加 16:9 和 1:1 带配乐的视频。」工作说明和回复格式见维护者的 `public-bot-draft.md`（不在本仓库里）。
