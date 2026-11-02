# X Pulse · daily replay (Grok Bot canvas template)

**English** · [中文](#中文)

## What it is

A single-file, read-only canvas page for Grok Bot that replays one calendar day (or up to 7 days) of an X account as a dial. The dial is a local day, 00:00 at the top; a clock hand sweeps once around it, and every post, reply and quote lights up at its time, sized by impressions and coloured by kind. The centre board shows engagement as the headline number, the post / reply / quote counts, impressions, followers and follower change, plus a **live status word** that follows the intensity of the playhead's last hour.

- Default window: **yesterday**, local 00:00 to 24:00 in the owner's time zone (title "Yesterday's replay" / 「昨日回放」). With several days a compact date chip row switches the dial to a day and restarts playback; the most recent day is selected first.
- 3 visual styles (Neuron, Galaxy, Neon wave), 3 aspect ratios (1:1, 9:16, 16:9), per-element toggles, play / pause / seek, keyboard shortcuts (Space, ← →, Shift = 1 h, L = language), pinnable tooltips with an "Open post" link.
- **Bilingual UI (EN / 中文).** The page starts in `DATA.lang` (the owner's Grok Bot language; missing or unknown means English) and a small `EN | 中文` switch in the toolbar (or the `L` key) changes every UI string live: labels, tooltips, settings groups, music names, status texts, footnotes, axis labels, legend, empty and missing states. The viewer's choice is remembered in `localStorage` (only while `DATA.lang` is unchanged; every storage failure is ignored). Post texts are never translated.
- Shockwave hierarchy and optional generated background music (see below).
- **No data is baked in.** All content comes from one `DATA` object. The file ships with a tiny made-up example (clearly labelled `EXAMPLE DATA`) so it renders on its own.
- **Read-only, no network.** The page never calls `fetch`, `XMLHttpRequest`, `WebSocket`, or loads any URL (the avatar is drawn from embedded pixels). Keep it that way.

```
renderer/x-pulse-replay.tsx   the page (DATA block + renderer)
dist/x-pulse-replay.min.tsx   the same renderer, minified (what a bot actually writes)
tools/build.py                renderer -> dist min (tools/minify, TypeScript 5 compiler API), --typecheck
tools/fill_data.py            raw X API data -> final page file (std lib + zoneinfo)
tools/build_avatar.py         profile image -> small palette avatar block for DATA.avatar
tests/                        headless-Chrome tests (optional): run.mjs, lang.mjs, days.mjs, dash.mjs, page.mjs; test_fill_data.py
```

Raw URL for a bot to fetch (stable, `main` branch):

```
https://raw.githubusercontent.com/topmindspace/x-pulse-bot/main/renderer/x-pulse-replay.tsx
https://raw.githubusercontent.com/topmindspace/x-pulse-bot/main/dist/x-pulse-replay.min.tsx
https://raw.githubusercontent.com/topmindspace/x-pulse-bot/main/tools/fill_data.py
https://raw.githubusercontent.com/topmindspace/x-pulse-bot/main/tools/build_avatar.py
```

## Centre dashboard and live status (v3)

**Hierarchy.** Primary: **engagement** (likes + reposts + replies + quotes, rolling up to the playhead) as the largest number, with its label above it, then the **post / reply / quote counts** in the kind colours. Secondary: **impressions** and **followers**, tertiary: **follower change**. Each item still follows its own show / hide toggle; if engagement is hidden the next enabled metric becomes the headline, and rows that are off collapse so the rest re-centre. Sizes and positions are tuned for 1:1, 9:16 and 16:9, in both languages (long rows shrink to fit, never clip).

**Live status word.** At the top of the centre circle, a word shows how intense the playhead's time window is *right now*. Five levels, positive wording only:

| level | English | 中文 |
| --- | --- | --- |
| 0 | Calm | 静候 |
| 1 | Warming up | 升温 |
| 2 | Active | 活跃 |
| 3 | On fire | 火热 |
| 4 | Erupting | 爆发 |

How it is computed: every post adds a weight of 1 to 3 (1, plus how its engagement and its impressions compare with this day's median), decaying with a 20-minute time constant, so the score is "recent hits" over roughly the last hour. The five cut points are quantiles of this day's own timeline (40 / 65 / 85 / 95 %) with absolute floors, so a sparse day does not "erupt" and a busy day is still graded against itself. The shown level uses smoothing, hysteresis (a level is left only after the score is 35% below its entry cut), a minimum dwell time and a short cross-fade, so it does not flicker. A scrub or a day switch snaps to the right level at once. Each level has its own micro-animation on the word (breathing glow, stronger pulse, a shimmer sweep, a beat, and at "Erupting" a tiny shake), five pips under the word show the level, the avatar aura changes with it, and the centre disc carries a very faint aurora and inner ripples that scale with the level (kept low so the numbers stay readable). With `prefers-reduced-motion` the shimmer, ripples, shake and drifting aurora are off.

**Day rating (footer under the dial).** The existing day-level `DATA.days[].status` (tier 0..4 against the account's own baseline) is kept but uses different words so nothing is said twice: Standout day / Rising day / Steady day / Building day / Recharge day (高光日 / 上扬日 / 稳定日 / 蓄力日 / 充电日). It appears only when the day has a `status`. The "Status" display toggle controls both the live word and the day line.

## Visuals and music (v2)

**Shockwave hierarchy.** Ordinary posts get one small, crisp ring. The top ~6% by impressions (and engagement) are "notable": a flash and two sharp rings. The top ~1.2% (1 to 5 posts, never fixed thresholds) are "major": a white-hot flash, a four-ring shockwave with a bright leading edge and a chromatic split, flying sparks, and a short dial shake. Tiers are relative to the day's own data. Budgets keep it legible: at most 40 small rings, 8 notable and 4 major shockwaves at once (newest first), and busy hours dim the ordinary glow instead of washing out. New followers fly in as comets and burst on the avatar ring. Works in all three styles.

**Background music (off until clicked).** The toolbar has a **🎵 Music** toggle (outside the stage, so screen recordings of the stage stay silent), three styles (Pulse, Piano, Classical) and a volume slider. Everything is generated with Web Audio: no audio files, no network, nothing copyrighted. Every lit dot plays a soft note on a 100 BPM sixteenth-note grid in A minor pentatonic (pitch and loudness follow engagement, at most 2 notes per slot); notable posts add a bell, major shockwaves a bell chord plus a low swell; each new follower chimes when it arrives; a quiet bed (pulse and bass / chords / pad and arpeggio) gets denser with the posting activity of the current hour; the end of the turn plays a closing chord. It follows play, pause, scrub and speed (a scrub or seek is silent), starts only after a click (browser autoplay rule), and goes through a compressor, a limiter and a soft clipper. If `AudioContext` is unavailable the toggle disables itself and nothing else changes. No new `DATA` fields.

## Using it from a Grok Bot (end to end)

A new owner only needs to connect X. The bot then does, on each run (since 3.1.0 steps 5 to 10 are done by `tools/fill_data.py`, see above; the list stays as the reference for what the script does):

1. **Fetch the renderer** from the raw URL above (once; keep the text, you only ever swap the `DATA` block).
2. **Who am I.** `get_users_me` with `user.fields=public_metrics,profile_image_url,...` → `id`, `name`, `username`, current follower count, avatar URL. Read the owner's IANA time zone (for example from the bot's memory or settings) into `tz.iana`; if it is unknown, ask once, do not guess a fixed offset.
3. **Days.** Default: `days = [yesterday]`. Yesterday is the calendar day before today **in the owner's zone**: local 00:00 to the next local 00:00. For a multi-day replay use up to 7 consecutive days, oldest first. Compute the instants with `zoneinfo` (Python) / `Intl` and never with `± 24 h`: on DST days a day is 23 or 25 hours long, and the renderer maps the dial to the real length. Pass `date: "YYYY-MM-DD"` only, the renderer derives the real start and end itself.
4. **Posts.** `get_users_posts` for that id with `start_time` / `end_time` set to the day's instants (UTC ISO), `max_results=100`, `tweet.fields=created_at,public_metrics,referenced_tweets,in_reply_to_user_id`, and **follow `next_token` pagination until it is exhausted**. Fetch each day once; completed past days never change much, so a bot that replays 7 days should keep the compact posts of earlier days in its own memory and only fetch the new day (see the X quota note below).
5. **Classify** each post: `referenced_tweets` contains `retweeted` → pure retweet: **exclude** (count them for `footnotes.retweetsExcluded`); `replied_to` → reply (flag +4 when `in_reply_to_user_id` is the owner's own id); `quoted` (and not `replied_to`) → quote; otherwise post.
6. **Metrics.** `impressions` = `public_metrics.impression_count`, then `like_count`, `retweet_count`, `reply_count`, `quote_count`. Anything the API did not return is **`null`**, never `0` and never estimated.
7. **Followers.** Read the bot's stored baseline `{ followers, at }`. Baseline exists: `current` = now, `delta` = `current − baseline.followers`, `baselineAt` = baseline time, `firstRun: false`. No baseline: `delta: null`, `baselineAt: null`, `firstRun: true`. Then store the new baseline. Optional `segments` place follow particles more precisely. Follower data belongs to the most recent day; older days may set `current: null`.
8. **Status (optional, per day).** `status = null` hides the day-rating footer. Otherwise `ratio` = that day's total engagement (or impressions) ÷ median of the previous days, `tier` from the ratio (≥1.5 → 0 standout, 1.0–1.5 → 1 rising, 0.7–1.0 → 2 steady, 0.4–0.7 → 3 building, < 0.4 → 4 recharge), `note` = one sentence, or `{ en, zh }`. (The live status word does not need any DATA.)
9. **Avatar.** `python3 tools/build_avatar.py <avatar URL> --out avatar.json` (needs Pillow), paste the JSON into `DATA.avatar`. Re-use the block on later runs. `null` draws a letter placeholder.
10. **Fill DATA.** Replace only what is between `// ===== BEGIN DATA =====` and `// ===== END DATA =====` with `const DATA: Data = { ... };`, set `example: false`, `lang` = the owner's Grok Bot language (`"en"` / `"zh"`; anything else becomes English), `footnotes.metricsFetchedAt` = the time the metrics were read (this decides which day is labelled "Yesterday").
11. **Publish.** The first time, pass the whole file to `WriteCanvas` and remember the `canvas_id`. Every later run overwrites **that same canvas** so the owner always has one page.

Bot rules: never edit anything outside the DATA block unless you are changing the renderer itself; never add network access; never invent numbers (use `null`).

## DATA schema (v3)

```ts
type Num = number | null;
type Note = string | { en?: string; zh?: string };
interface Data {
  lang: "en" | "zh";          // initial UI language; missing / unknown => "en"; the viewer can switch on the page
  example: boolean;           // true = placeholder data, page says so
  account: { name: string; username: string };   // "@" optional; empty strings hide the item
  avatar: { size: number; palette: string; indices: string } | null;
  tz: {
    iana: string;             // REQUIRED, e.g. "Asia/Shanghai", "America/New_York", "Asia/Kolkata", "Asia/Kathmandu"
    label?: string;           // display name only (default: the iana id)
    // legacy fallback when iana is missing: offsetMinutes?: number (fixed offset, no DST)
  };
  days: {                     // 1..7 entries, oldest first; the LAST one is selected on load
    date: string;             // "YYYY-MM-DD", the local calendar day
    posts: (number | string | null)[][];   // compact rows, see below; retweets are NOT included
    followers: { current: Num; delta: Num; baselineAt: string | null; firstRun: boolean;
                 segments?: { fromISO: string; toISO: string; delta: number }[] };
    status: { tier: number; ratio: Num; note: Note } | null;   // day rating, tier 0..4, see step 8
  }[];
  footnotes: { metricsFetchedAt: string | null; retweetsExcluded: Num; extra: Note[] };
}
```

**Compact post row** (one array per post):

```
[ t, flags, impressions, likes, reposts, replies, quotes, id, snippet ]
```

| index | field | meaning |
| --- | --- | --- |
| 0 | `t` | unix seconds; or **seconds since the start of that local day** (any number below 1e8, the shortest form); or an ISO string |
| 1 | `flags` | `kind` + 4 when it is a reply to the owner's own post; kind: 0 post, 1 reply, 2 quote |
| 2–6 | metrics | numbers, or `null` = missing (never estimated) |
| 7 | `id` | tweet id as a string of digits, or `null`; the link is `https://x.com/i/status/<id>` (only built from digits) |
| 8 | `snippet` | short text for the hover card, about 20 characters, or `null`; cut to 40 characters on grapheme boundaries if longer |

Posts do not need their full text: the renderer shows the snippet only, and tolerates a missing one. Rows outside the day, or with an unparsable `t`, are skipped. The old object form `{ t, kind, selfThread, text, impressions, likes, reposts, replies, quotes, url }` and the old v2 single-window DATA (`window`, `posts`, `followers`, `status` at the top level) still render, as one day.

`status.note` and `footnotes.extra[]` may be a plain string or `{ en, zh }`. A plain note in `status.note` is shown only while the page language matches it (CJK text counts as Chinese, anything else as English); an `{ en, zh }` object shows the current language and nothing if that language is missing; plain strings in `extra` are always shown.

**Size.** Measured with 7 days × 300 posts: 165 KB as unix-time rows with 18-digit ids and 20-character snippets; 154 KB with relative seconds; 121 KB (relative seconds, snippets, no ids); 119 KB (ids, no snippets); 85 KB (relative seconds only). The renderer itself is about 140 KB, and Grok Bot's canvas write limit was seen near 213 KB for the whole file, so a 7-day page with 300 posts every day does not fit. Keep each day to the posts that matter (for example the top 100 by engagement, plus a count in `footnotes.extra`), or send fewer days. Rendering stays at 60 fps with 7 days × 300 posts, and with 600 posts on one day.

Behaviour worth knowing: items with no data (no status, no baseline, no name…) are hidden instead of showing zeros; a long name shrinks and wraps, it is never truncated; an invalid avatar falls back to the letter placeholder; an unknown `tz.iana`, a missing `tz`, or a bad `date` shows a clear error text instead of a broken dial.

## Worldwide notes

- **Time zone.** Day boundaries and every displayed time come from `tz.iana` through `Intl.DateTimeFormat`, so DST (23 h and 25 h days, the dial then spans the real length and ticks sit on real local hours; a skipped midnight such as America/Sao_Paulo 2018-11-04 starts the day at 01:00), half-hour and 45-minute offsets (Asia/Kolkata, Asia/Kathmandu, Australia/Lord_Howe) and extreme offsets (+14, −12) work. Posts are bucketed by the local day. The fill script can use Python `zoneinfo`: `datetime(y, m, d, tzinfo=ZoneInfo(iana))` for the start, the next date's midnight for the end.
- **Language.** UI languages are `en` and `zh` only. Post snippets are shown as written; very long ones are cut by grapheme, so emoji and CJK are never split.
- **X API quota.** The bot's X access is metered per user (about 1000 calls per day, 30 per minute): fetch the owner's posts once per day (paging with `next_token`), do not poll, and keep earlier days' compact rows in the bot's own memory instead of fetching them again.
- **Accessibility.** With `prefers-reduced-motion: reduce` playback does not start by itself, dial shake, finale flash and the status shimmer / ripples are off. Music is always off until clicked. The toolbar buttons are real buttons (keyboard focusable), the dial and the progress slider carry labels, and the main numbers use light text on the dark stage (dimmer colours are only for secondary labels).

## Building the page with `fill_data.py` (v3.1)

Since 3.1.0 the bot no longer builds `DATA` by hand. Steps 5 to 10 of the flow below (classify, metrics, followers, status, DATA, size budget) are done by one script that uses only the Python standard library and `zoneinfo`:

```
python3 tools/fill_data.py input.json --out page.tsx [--min dist/x-pulse-replay.min.tsx] [--max-bytes 205000]
```

`dist/x-pulse-replay.min.tsx` is the renderer with comments and indentation removed (identifiers untouched, `BEGIN DATA` / `END DATA` markers kept), about 68 % of the source size; build it with `python3 tools/build.py` (add `--typecheck` to type-check the minified output too). `page.tsx` is the final file: pass its content inline to `WriteCanvas` (or `EditCanvas` on the existing canvas).

**Input JSON** (what the bot saves after fetching):

```
{
  "lang": "zh",                                  // "en" | "zh" (initial UI language; the viewer can switch)
  "account": { "name": "…", "username": "…" },
  "avatar": { "size": 64, "palette": "…", "indices": "…" } | null,   // tools/build_avatar.py output
  "tz": { "iana": "Asia/Shanghai", "label": "Beijing" },            // IANA zone of the owner; label optional
  "days_requested": 1,                           // 1..7 local calendar days ending YESTERDAY (today is never included)
  "me_id": "1937489637389533186",
  "raw_posts": [ { "id", "created_at", "text", "referenced_tweets", "in_reply_to_user_id", "public_metrics" }, … ],
  "followers_snapshots": [ { "at": "2026-11-01T12:37:00+08:00", "count": 3586 }, … ],
  "metricsFetchedAt": "2026-11-02T21:16:00+08:00",
  "status_history": [ { "date": "2026-10-30", "engagement": 812 }, … ]   // optional
}
```

Optional keys: `now` (default: system clock), `raw_posts_from` (earliest instant `raw_posts` really covers, so earlier days can feed the status baseline), `snapshot_max_gap_hours` (36), `snapshot_tolerance_minutes` (30), `max_bytes`, `example`.

What it does, and what it will not do:

- **Days.** Local calendar days in `tz.iana` (DST days of 23 / 25 hours, `+05:30` / `+05:45` zones). Posts outside the requested days are ignored; a day with no posts is kept as an empty day.
- **Classification.** Pure retweets are dropped and counted in `footnotes.retweetsExcluded`; `replied_to` is a reply (self-thread when it answers the owner), else `quoted` is a quote, else a post.
- **Rows.** `[t, flags, impressions, likes, reposts, replies, quotes, id, snippet]` with `t` = seconds since the local day start, snippets cut to 20 graphemes (leading @mentions and URLs removed), one row per line. A metric the API did not return is `null`, never 0, never estimated.
- **Follower change** only when the snapshots bracket the day: one at or before 00:00 (or up to 30 minutes after) and one at or after 24:00 (or up to 30 minutes before), each within 36 hours of the boundary. `baselineAt` records which snapshot was used. Otherwise `delta` is `null` and the page shows its localized "no data" text. Nothing is invented.
- **Day status** (rating footer) only with at least 3 earlier days of engagement to compare with (`status_history`, other requested days, or `raw_posts_from`); otherwise `null` and the footer is hidden. The live centre status word needs no data.
- **Size budget.** If the page would pass `max_bytes` (default 205,000 bytes; the canvas write limit is about 213 KB), it keeps the top-N posts of every day by engagement + impressions and says how many were left out in `footnotes.extra` (EN and ZH). It never trims silently. The JSON summary printed on stdout lists bytes, per-day counts, `retweets_dropped`, `cap_per_day` and `omitted`.
- Exit code 2 for bad input, 3 when even zero posts do not fit.

Limits: the minifier keeps every name (no renaming), so the page is about 94 KB before data; 7 days at 300 posts per day is the practical ceiling for one page. X API read quota (30 per minute, 1,000 per day, 25 posts per `get_users_posts` page) applies to fetching.

## Avatar helper

```
pip install pillow
python3 tools/build_avatar.py https://pbs.twimg.com/profile_images/.../abc_normal.jpg --out avatar.json
python3 tools/build_avatar.py ./me.png --size 96 --colors 64
```

Prints (or writes) `{"size":96,"palette":"…","indices":"…"}` (about 12 KB). Paste it as `DATA.avatar`.

## Tests (optional)

```
cd tests && npm install && npm test
```

Needs Node 20+, Python 3 with Pillow, and Chrome / Chromium (`CHROME_PATH` to override `/usr/bin/google-chrome`). `npm test` builds a sample avatar, type-checks the renderer (strict) and type-checks the minified output too, runs the `fill_data.py` unit tests (day boundaries, DST, +05:45, empty day, missing impressions, cap note, follower bracketing, status baseline) and then runs four scripts in headless Chrome:

- `run.mjs` (about 8 minutes): about 25 scenarios (example data, full data in both languages, zero / one / 600 posts, all-null metrics, first run, very long and emoji names, bad avatar, unsafe URLs, bad window, other time zones…), each also switching every music style, scrubbing, pausing and changing speed, then rendering the music offline; fails on any page error, network request or `NaN` / `undefined` in the page.
- `lang.mjs`: language seeding (`en`, `zh`, missing, unknown, `zh-CN`), switching by button and `L`, no leftover other-language words in the page or on the canvas, notes, `localStorage` rules (including a denied or corrupt store), layout at 1:1, 9:16, 16:9 and 390 px wide, screenshots in `tests/out/lang/`.
- `days.mjs`: day boundaries for 15 zone / date cases (DST 23 h / 25 h, +05:30, +05:45, +14, −12, a 30-minute DST shift, a skipped midnight), tick counts, local-day bucketing around midnight and the repeated hour, chips and day switching at three widths, relative-time rows, legacy data, error messages, grapheme cutting, size numbers and frame rate for 7 days × 300 posts.
- `dash.mjs`: live status at calm / busy / peak moments in both languages and all three ratios, level changes during real playback, centre-dashboard screenshots in `tests/out/dash/`.

`node page.mjs page.tsx [outdir] [lang]` renders any finished page file (for example the output of `fill_data.py`) in headless Chrome, fails on page errors, network requests or `NaN` / `undefined`, and saves start / middle / end screenshots.

All scenario data is synthetic.

The code comments are in English; the page itself is bilingual.

---

<a id="中文"></a>

# X 脉搏 · 每日回放（Grok Bot 画布模板）

[English](#x-pulse--daily-replay-grok-bot-canvas-template) · **中文**

## 这是什么

给 Grok Bot 用的单文件只读画布页面：把一个 X 账号的一个自然日（或最多 7 天）回放成一个表盘。表盘是用户当地的一整天，0 点在顶部；指针转一圈，每条发帖、回帖、引用在对应时刻亮起，大小看曝光、颜色看类型。中心看板以互动数为主角，并显示发帖 / 回帖 / 引用条数、曝光、粉丝、关注变化，再加一个跟随播放头最近一小时强度实时变化的**状态词**。

- 默认窗口：**昨天**，即用户所在时区的当地 0 点到 24 点（标题「昨日回放」/ "Yesterday's replay"）。有多天时会出现紧凑的日期按钮行，点击切换表盘到那一天并重新播放，默认选中最近一天。
- 3 种风格（神经元、星系、霓虹声波），3 种画幅（1:1、9:16、16:9），每个元素可单独开关，播放 / 暂停 / 拖动，快捷键（空格、← →、Shift = 1 小时、L = 语言），浮层可点击固定并带“打开帖子”链接。
- **界面中英双语（EN / 中文）。** 页面以 `DATA.lang`（用户 Grok Bot 的语言；缺失或无法识别时为英文）起步，工具栏里有紧凑的 `EN | 中文` 切换（或按 `L` 键），所有界面文字即时切换：标签、浮层、设置分组、音乐名称、状态文字、脚注、坐标轴、图例、空数据和缺失提示。观看者的选择记在 `localStorage`（仅在 `DATA.lang` 不变时沿用；存储失败一律忽略）。帖子文本不翻译。
- 冲击波分级与可选的程序生成背景音乐（见下）。
- **文件里没有任何真实数据。** 所有内容都来自一个 `DATA` 对象；自带一小份虚构示例（会标明“示例数据”），所以能单独渲染。
- **只读、不联网。** 页面不调用 `fetch`、`XMLHttpRequest`、`WebSocket`，也不加载任何 URL（头像用内嵌像素绘制）。请保持这一点。

```
renderer/x-pulse-replay.tsx   页面（DATA 数据块 + 渲染器）
dist/x-pulse-replay.min.tsx   同一个渲染器的压缩版（bot 实际写入的内容）
tools/build.py                渲染器 -> dist 压缩版（tools/minify，TypeScript 5 编译器 API），--typecheck
tools/fill_data.py            X API 原始数据 -> 最终页面文件（仅标准库 + zoneinfo）
tools/build_avatar.py         头像图片 -> DATA.avatar 用的小调色板头像块
tests/                        无头 Chrome 测试（可选）：run.mjs、lang.mjs、days.mjs、dash.mjs、page.mjs；test_fill_data.py
```

Bot 取文件用的稳定原始链接（`main` 分支）：

```
https://raw.githubusercontent.com/topmindspace/x-pulse-bot/main/renderer/x-pulse-replay.tsx
https://raw.githubusercontent.com/topmindspace/x-pulse-bot/main/dist/x-pulse-replay.min.tsx
https://raw.githubusercontent.com/topmindspace/x-pulse-bot/main/tools/fill_data.py
https://raw.githubusercontent.com/topmindspace/x-pulse-bot/main/tools/build_avatar.py
```

## 中心看板与实时状态（v3）

**层级。** 主角是**互动**（赞 + 转发 + 回复 + 引用，累计到播放头），数字最大、标签在其上方；其次是按类型着色的**发帖 / 回帖 / 引用条数**；再次是**曝光**和**粉丝**，最后是**关注变化**。每一项仍受各自的显示开关控制：互动关掉时下一个已开启的指标升为主角，关掉的行会收起，其余内容自动重新居中。字号和位置针对 1:1、9:16、16:9 和中英文都做了调整（过长的行会缩小以适应，不会被裁切）。

**实时状态词。** 中心圆顶部的词表示播放头所在时间窗口*此刻*有多热，共五级，只用正向措辞：

| 级别 | 中文 | English |
| --- | --- | --- |
| 0 | 静候 | Calm |
| 1 | 升温 | Warming up |
| 2 | 活跃 | Active |
| 3 | 火热 | On fire |
| 4 | 爆发 | Erupting |

算法：每条帖子贡献 1 到 3 的权重（1，加上它的互动和曝光相对当天中位数的高低），按 20 分钟时间常数衰减，所以得分就是“最近约一小时的爆款”。五级的分界点取自当天自己的时间线分位数（40 / 65 / 85 / 95 %）并设绝对下限，因此内容稀少的一天不会“爆发”，繁忙的一天也只和自己比。显示的级别带平滑、迟滞（得分比进入该级的分界低 35% 才会降级）、最短停留时间和短暂的淡入淡出，不会闪烁；拖动或切换日期时立即跳到正确级别。每一级在词上有各自的微动效（呼吸光晕、更强的脉冲、扫光、心跳节拍，“爆发”还有轻微抖动），词下方有 5 个小圆点表示级别，头像光环随之变化，中心圆底有极淡的极光和内圈涟漪随级别增强（保持很淡，数字依然清楚）。开启系统“减少动态效果”时，扫光、涟漪、抖动和漂移的极光都会关闭。

**当日评级（表盘下方的页脚）。** 原有的按天 `DATA.days[].status`（对照账号自身基线的 tier 0..4）保留，但用不同的词，避免同一个意思说两遍：高光日 / 上扬日 / 稳定日 / 蓄力日 / 充电日（Standout day / Rising day / Steady day / Building day / Recharge day）。只有当天有 `status` 时才显示。“状态”显示开关同时控制实时状态词和这一行。

## 视觉与音乐（v2）

**冲击波分级。** 普通帖子只有一圈小而锐利的涟漪；曝光（及互动）排名前约 6% 为“显著”：一次闪光加两圈锐利的环；前约 1.2%（1 到 5 条，不用固定阈值）为“重磅”：白热闪光、四层带亮色前沿和色散分离的冲击波、飞散火花，以及表盘轻微震动。分级完全相对当天的数据。为避免糊成一片设有预算：同时最多 40 个小涟漪、8 个显著和 4 个重磅冲击波（新的优先），繁忙时段会压低普通光晕的亮度而不是叠成一片白。新增关注以彗星拖尾飞入，到头像环处迸发。三种风格都适用。

**背景音乐（点击后才开）。** 工具栏有 **🎵 音乐** 开关（在舞台之外，所以只录舞台的录屏仍是无声的），三种风格（律动、钢琴、古典）和音量滑块。全部用 Web Audio 现场生成：没有音频文件、不联网、没有版权音乐。每个亮起的光点在 100 BPM 十六分音符网格上弹一个轻柔音符（A 小调五声音阶，音高和力度跟随互动，每格最多 2 个音）；显著帖子加一声钟音，重磅冲击波加钟音和弦与低频下沉；每个新增关注到达时有一声风铃；安静的底层（律动与低音 / 和弦与铺底 / 琶音）随当前小时的发帖活跃度变密；转满一圈时奏一个收尾和弦。音乐跟随播放、暂停、拖动和倍速（拖动或跳转时静音），只在点击后启动（浏览器自动播放限制），并经过压缩器、限幅器和软削波，不会爆音。如果环境没有 `AudioContext`，开关会自动禁用，其余功能不受影响。不新增任何 `DATA` 字段。

## 在 Grok Bot 里怎么用（完整流程）

新用户只需要连接 X。之后每次运行 bot 这样做（3.1.0 起第 5 到 10 步由 `tools/fill_data.py` 完成，见上；这个列表保留，用来说明脚本做了什么）：

1. **取渲染器**：从上面的原始链接下载一次，之后只替换 `DATA` 块，其余不动。
2. **我是谁**：`get_users_me`，`user.fields=public_metrics,profile_image_url,…`，得到 `id`、`name`、`username`、当前粉丝数和头像 URL。把用户的 IANA 时区（例如来自 bot 的记忆或设置）填进 `tz.iana`；不知道就问一次，不要猜一个固定偏移。
3. **日期**：默认 `days = [昨天]`。昨天是**用户所在时区**里今天的前一个自然日：当地 0 点到下一个当地 0 点。多天回放最多取 7 个连续日，旧的在前。时刻用 `zoneinfo`（Python）/ `Intl` 计算，不要用 `± 24 小时`：遇到夏令时，一天可能是 23 或 25 小时，渲染器会按真实长度铺满表盘。只需传 `date: "YYYY-MM-DD"`，起止时刻由渲染器自己推算。
4. **帖子**：对该 id 调 `get_users_posts`，`start_time` / `end_time` 设为当天起止的 UTC ISO 时刻，`max_results=100`，`tweet.fields=created_at,public_metrics,referenced_tweets,in_reply_to_user_id`，并且**一直翻 `next_token` 直到取完**。每一天只取一次；已过去的日子基本不再变化，所以回放 7 天的 bot 应把更早几天的紧凑数据存在自己的记忆里，只取新增的一天（见下面的 X 配额）。
5. **分类**：`referenced_tweets` 含 `retweeted` → 纯转推：**排除**（只计入 `footnotes.retweetsExcluded`）；含 `replied_to` → 回帖（`in_reply_to_user_id` 是自己的 id 时 flags 加 4）；含 `quoted`（且不含 `replied_to`）→ 引用；其余为发帖。
6. **指标**：`impressions` = `public_metrics.impression_count`，再依次是 `like_count`、`retweet_count`、`reply_count`、`quote_count`。API 没返回的一律是 **`null`**，不要写 0，也不要估算。
7. **关注变化**：读 bot 已保存的基线 `{ followers, at }`。有基线：`current` = 当前粉丝数，`delta` = `current − baseline.followers`，`baselineAt` = 基线时间，`firstRun: false`；没有基线：`delta: null`、`baselineAt: null`、`firstRun: true`；然后保存新基线。可选 `segments` 让关注粒子位置更准。关注数据属于最近一天，更早的日子可以把 `current` 设为 `null`。
8. **当日评级（可选，按天）**：`status = null` 则不显示页脚评级。否则 `ratio` = 当天总互动（或曝光）÷ 之前几天的中位数；`tier` 按倍数取（≥1.5 → 0 高光，1.0–1.5 → 1 上扬，0.7–1.0 → 2 稳定，0.4–0.7 → 3 蓄力，<0.4 → 4 充电）；`note` 用一句话说明，或写成 `{ en, zh }`。（实时状态词不需要任何 DATA。）
9. **头像**：`python3 tools/build_avatar.py <头像 URL> --out avatar.json`（需要 Pillow），把 JSON 填进 `DATA.avatar`，之后复用同一个块；填 `null` 则画首字母占位。
10. **填 DATA**：只替换 `// ===== BEGIN DATA =====` 与 `// ===== END DATA =====` 之间的内容为 `const DATA: Data = { ... };`，`example` 设为 `false`，`lang` = 用户 Grok Bot 的语言（`"en"` / `"zh"`，其他值按英文处理），`footnotes.metricsFetchedAt` 填读取指标的时间（它决定哪一天标成“昨日”）。
11. **发布**：第一次把整个文件交给 `WriteCanvas`，记住返回的 `canvas_id`；以后每次都覆盖**同一个画布**，用户始终只有一个页面。

Bot 守则：除非在改渲染器本身，否则不要改 DATA 块以外的任何内容；不要加任何网络访问；不要编造数字（缺失就写 `null`）。

## DATA 结构（v3）

字段与上面 English 部分的 TypeScript 定义一致。要点：

- `lang`：`"en"` 或 `"zh"`，是初始界面语言（缺失或无法识别 => 英文），观看者可在页面上切换；`example`：`true` 表示占位数据。
- `account`：`name`、`username`（`@` 可有可无；空字符串则不显示）。`avatar`：`{ size, palette, indices }` 或 `null`。
- `tz`：`iana` **必填**（如 `"Asia/Shanghai"`、`"America/New_York"`、`"Asia/Kolkata"`、`"Asia/Kathmandu"`），`label` 仅作显示名。缺少 `iana` 时旧写法 `offsetMinutes`（固定偏移，无夏令时）作为兜底。
- `days[]`：1 到 7 项，旧的在前，加载时选中**最后一项**。每项有 `date`（`"YYYY-MM-DD"`，当地自然日）、`posts`（紧凑数组，见下，不含纯转推）、`followers`（`current`、`delta`、`baselineAt`、`firstRun`、可选 `segments`）、`status`（`{ tier 0..4, ratio, note }` 或 `null`，当日评级）。
- `footnotes`：`metricsFetchedAt`、`retweetsExcluded`、`extra[]`。

**紧凑帖子行**（每条帖子一个数组）：

```
[ t, flags, impressions, likes, reposts, replies, quotes, id, snippet ]
```

| 下标 | 字段 | 含义 |
| --- | --- | --- |
| 0 | `t` | unix 秒；或**当天当地 0 点起的秒数**（任何小于 1e8 的数，最短写法）；或 ISO 字符串 |
| 1 | `flags` | `kind`，如果是回复自己的帖子再加 4；kind：0 发帖，1 回帖，2 引用 |
| 2–6 | 指标 | 数字，或 `null` = 缺失（绝不估算） |
| 7 | `id` | 推文 id（纯数字字符串）或 `null`；链接为 `https://x.com/i/status/<id>`（只用数字拼接） |
| 8 | `snippet` | 浮层里的短文本，约 20 个字符，或 `null`；超过 40 个字符时按字素边界截断 |

帖子不需要完整文本：渲染器只显示片段，缺失也没问题。窗口外或 `t` 无法解析的行会被跳过。旧的对象写法 `{ t, kind, selfThread, text, impressions, likes, reposts, replies, quotes, url }` 和旧 v2 单窗口 DATA（顶层的 `window`、`posts`、`followers`、`status`）仍可渲染，按一天处理。

`status.note` 和 `footnotes.extra[]` 可以是普通字符串或 `{ en, zh }`。`status.note` 里的普通字符串只在页面语言与其匹配时显示（含汉字算中文，其余算英文）；`{ en, zh }` 对象显示当前语言的那一句，缺少该语言就不显示；`extra` 里的普通字符串始终显示。

**体积。** 实测 7 天 × 每天 300 条：unix 时间 + 18 位 id + 20 字符片段为 165 KB；用相对秒数为 154 KB；相对秒数 + 片段、不带 id 为 121 KB；带 id、不带片段为 119 KB；只有相对秒数为 85 KB。渲染器本身约 140 KB，而 Grok Bot 画布整个文件的写入上限曾见约 213 KB，所以每天 300 条的 7 天页面放不下。请让每天只保留重要的帖子（例如互动最高的前 100 条，总数写进 `footnotes.extra`），或减少天数。7 天 × 300 条以及单日 600 条时仍可保持 60 帧。

注意：没有数据的项（没有状态、没有基线、没有名称等）直接隐藏，不显示 0；名称过长会缩小并折行，不会截断；头像数据无效时回退为首字母占位；`tz.iana` 未知、缺少 `tz` 或 `date` 无效时显示明确的错误文字，而不是一个坏掉的表盘。

## 全球使用说明

- **时区。** 日界线和所有显示的时间都由 `tz.iana` 经 `Intl.DateTimeFormat` 得出，所以夏令时（23 小时和 25 小时的日子，表盘按真实长度铺满，刻度落在真实的当地整点；像 America/Sao_Paulo 2018-11-04 这种午夜被跳过的日子，从 01:00 起算）、半小时和 45 分钟偏移（Asia/Kolkata、Asia/Kathmandu、Australia/Lord_Howe）以及极端偏移（+14、−12）都能正确处理。帖子按当地日期归档。填数据的脚本可以用 Python `zoneinfo`：起点是 `datetime(y, m, d, tzinfo=ZoneInfo(iana))`，终点是下一天的当地 0 点。
- **语言。** 界面语言只有 `en` 和 `zh`。帖子片段按原文显示；过长的按字素截断，emoji 和汉字不会被劈开。
- **X API 配额。** bot 的 X 访问按用户计量（约每天 1000 次、每分钟 30 次）：每天只取一次用户的帖子（用 `next_token` 翻页），不要轮询，更早几天的紧凑数据存在 bot 自己的记忆里，不再重复获取。
- **无障碍。** 开启 `prefers-reduced-motion: reduce` 时不会自动播放，表盘震动、结尾闪光、状态扫光和涟漪都会关闭。音乐始终要点击后才开。工具栏按钮都是真正的按钮（可用键盘聚焦），表盘和进度条带有标签，主要数字在深色舞台上用浅色文字（较暗的颜色只用于次要标签）。

## 用 `fill_data.py` 生成页面（v3.1）

3.1.0 起 bot 不再手工拼 `DATA`。下面流程里的第 5 到 10 步（分类、指标、关注变化、评级、DATA、体积预算）由一个只用 Python 标准库和 `zoneinfo` 的脚本完成：

```
python3 tools/fill_data.py input.json --out page.tsx [--min dist/x-pulse-replay.min.tsx] [--max-bytes 205000]
```

`dist/x-pulse-replay.min.tsx` 是去掉注释和缩进的渲染器（标识符不改名，保留 `BEGIN DATA` / `END DATA` 标记），体积约为源文件的 68 %；用 `python3 tools/build.py` 生成（加 `--typecheck` 会同时对压缩后的文件做类型检查）。`page.tsx` 就是最终文件：把内容原样交给 `WriteCanvas`（或对已有画布用 `EditCanvas`）。

**输入 JSON**（bot 取完数据后保存）：

```
{
  "lang": "zh",                                  // "en" | "zh"（页面初始语言，观看者可切换）
  "account": { "name": "…", "username": "…" },
  "avatar": { "size": 64, "palette": "…", "indices": "…" } | null,   // tools/build_avatar.py 的输出
  "tz": { "iana": "Asia/Shanghai", "label": "北京" },               // 用户的 IANA 时区；label 可选
  "days_requested": 1,                           // 1..7 个自然日，截止到昨天（不含今天）
  "me_id": "1937489637389533186",
  "raw_posts": [ { "id", "created_at", "text", "referenced_tweets", "in_reply_to_user_id", "public_metrics" }, … ],
  "followers_snapshots": [ { "at": "2026-11-01T12:37:00+08:00", "count": 3586 }, … ],
  "metricsFetchedAt": "2026-11-02T21:16:00+08:00",
  "status_history": [ { "date": "2026-10-30", "engagement": 812 }, … ]   // 可选
}
```

可选键：`now`（默认系统时钟）、`raw_posts_from`（`raw_posts` 实际覆盖的最早时刻，更早的日子可用于评级基线）、`snapshot_max_gap_hours`（36）、`snapshot_tolerance_minutes`（30）、`max_bytes`、`example`。

它做什么，不做什么：

- **日期**：按 `tz.iana` 的当地自然日（夏令时 23 / 25 小时、`+05:30` / `+05:45` 时区都支持）。请求日之外的帖子忽略；没有帖子的日子保留为空日。
- **分类**：纯转推丢弃并计入 `footnotes.retweetsExcluded`；含 `replied_to` 为回帖（回复自己时标记续写），否则含 `quoted` 为引用，其余为发帖。
- **数据行**：`[t, flags, 曝光, 赞, 转发, 回复, 引用, id, 摘要]`，`t` 为距当地 0 点的秒数，摘要最多 20 个字素（去掉开头的 @ 和链接），每行一条。API 没返回的指标是 `null`，不写 0，不估算。
- **关注变化**只在快照前后包住这一天时才给出：一个在 0 点或之前（或 0 点后 30 分钟内），一个在 24 点或之后（或 24 点前 30 分钟内），且各离边界不超过 36 小时。`baselineAt` 记录用了哪个快照；否则 `delta` 为 `null`，页面显示本地化的“无数据”文字。不会编造。
- **当日评级**（页脚）至少要有 3 天更早的互动数据做对比（`status_history`、其他请求日或 `raw_posts_from`），否则为 `null`，页脚不显示。中心的实时状态词不需要任何数据。
- **体积预算**：页面超过 `max_bytes`（默认 205,000 字节；画布写入上限约 213 KB）时，按“互动 + 曝光”每天保留前 N 条，并在 `footnotes.extra`（中英）写明省略了多少条，绝不悄悄裁剪。标准输出的 JSON 摘要含字节数、每天条数、`retweets_dropped`、`cap_per_day`、`omitted`。
- 退出码：2 输入有误，3 连 0 条帖子也放不下。

限制：压缩器不改名，所以不含数据时页面约 94 KB；一页的实际上限约为 7 天 × 每天 300 条。取数时仍受 X API 读取配额限制（每分钟 30 次、每天 1,000 次、`get_users_posts` 每页 25 条）。

## 头像工具

```
pip install pillow
python3 tools/build_avatar.py https://pbs.twimg.com/profile_images/.../abc_normal.jpg --out avatar.json
python3 tools/build_avatar.py ./me.png --size 96 --colors 64
```

输出 `{"size":96,"palette":"…","indices":"…"}`（约 12 KB），填进 `DATA.avatar` 即可。

## 测试（可选）

```
cd tests && npm install && npm test
```

需要 Node 20+、带 Pillow 的 Python 3、Chrome / Chromium（用 `CHROME_PATH` 覆盖默认的 `/usr/bin/google-chrome`）。`npm test` 会生成示例头像、对渲染器做严格类型检查，同时检查压缩后的文件，运行 `fill_data.py` 的单元测试（日界线、夏令时、+05:45、空日、缺失曝光、裁剪说明、关注快照包围规则、评级基线），再在无头 Chrome 里运行四个脚本：

- `run.mjs`（约 8 分钟）：约 25 个场景（示例数据、中英文完整数据、零 / 一 / 600 条帖子、指标全缺失、首次运行、超长和 emoji 名称、坏头像、不安全链接、坏窗口、其他时区等），每个场景还会切换所有音乐风格、拖动、暂停、变速并离线渲染音乐；出现页面错误、网络请求或页面里的 `NaN` / `undefined` 都算失败。
- `lang.mjs`：语言初始化（`en`、`zh`、缺失、未知、`zh-CN`）、按钮和 `L` 键切换、页面和画布上没有另一种语言的残留词、备注、`localStorage` 规则（包括被拒绝或损坏的存储）、1:1、9:16、16:9 和 390 px 宽下的布局，截图在 `tests/out/lang/`。
- `days.mjs`：15 个时区 / 日期的日界线（夏令时 23 / 25 小时、+05:30、+05:45、+14、−12、30 分钟夏令时偏移、被跳过的午夜）、刻度数量、午夜前后和重复小时的当地日归档、三种宽度下的日期按钮与切换、相对时间行、旧数据、错误提示、字素截断，以及 7 天 × 300 条的体积和帧率。
- `dash.mjs`：中英文、三种画幅下静候 / 繁忙 / 峰值时刻的实时状态、真实播放中的级别变化，以及中心看板截图（`tests/out/dash/`）。

`node page.mjs page.tsx [输出目录] [语言]` 会在无头 Chrome 里渲染任何成品页面文件（例如 `fill_data.py` 的输出），出现页面错误、网络请求或 `NaN` / `undefined` 即失败，并保存开头 / 中段 / 结尾截图。

所有场景数据均为虚构。

代码注释为英文；页面本身是中英双语。
