# X Pulse · 24-hour replay (Grok Bot canvas template)

**English** · [中文](#中文)

## What it is

A single-file, read-only canvas page for Grok Bot that replays an X account's last 24 hours as a dial. A clock hand sweeps once around the dial; every post, reply and quote lights up at its time, sized by impressions and coloured by kind. A centre board shows avatar, name, handle, rolling impressions / engagement / post counts, follower change, and an optional "today's status" tier.

- 3 visual styles (Neuron, Galaxy, Neon wave), 3 aspect ratios (1:1, 9:16, 16:9), per-element toggles, play / pause / seek, keyboard shortcuts (Space, ← →, Shift = 1 h), pinnable tooltips with an "Open post" link.
- UI language `en` or `zh`.
- **No data is baked in.** All content comes from one `DATA` object. The file ships with a tiny made-up example (clearly labelled `EXAMPLE DATA` in the subtitle and footer) so it renders on its own.
- **Read-only, no network.** The page never calls `fetch`, `XMLHttpRequest`, `WebSocket`, or loads any URL (the avatar is drawn from embedded pixels, not an image URL). Keep it that way.

```
renderer/x-pulse-replay.tsx   the page (DATA block + renderer)
tools/build_avatar.py         profile image -> 96x96, 64-colour avatar block for DATA.avatar
tests/                        headless-Chrome smoke tests (optional)
```

Raw URL for a bot to fetch (stable, `main` branch):

```
https://raw.githubusercontent.com/topmindspace/x-pulse-bot/main/renderer/x-pulse-replay.tsx
https://raw.githubusercontent.com/topmindspace/x-pulse-bot/main/tools/build_avatar.py
```

## Using it from a Grok Bot (end to end)

A new owner only needs to connect X. The bot then does, on each run:

1. **Fetch the renderer** from the raw URL above (once; keep the text, you only ever swap the `DATA` block).
2. **Who am I.** `get_users_me` with `user.fields=public_metrics,profile_image_url` → `id`, `name`, `username`, current follower count (`public_metrics.followers_count`), avatar URL.
3. **Window.** `endISO` = now, `startISO` = now − 24 h, both with the owner's UTC offset; `tz = { label, offsetMinutes }` (label is display text, e.g. `"Beijing time (UTC+8)"`). The dial spans exactly 24 h and starts at the top (not at midnight).
4. **Posts.** `get_users_posts` for that id with `start_time` / `end_time` set to the window, `max_results=100`, `tweet.fields=created_at,public_metrics,referenced_tweets,in_reply_to_user_id`, and **follow `next_token` pagination until it is exhausted** (do not stop after the first page).
5. **Classify** each post:
   - `referenced_tweets` contains `retweeted` → pure retweet: **exclude**, only count it for `footnotes.retweetsExcluded`.
   - contains `replied_to` → `kind: "reply"`; `selfThread: true` when `in_reply_to_user_id` is the owner's own id.
   - contains `quoted` (and not `replied_to`) → `kind: "quote"`.
   - otherwise `kind: "post"`.
6. **Metrics.** `impressions` = `public_metrics.impression_count`, `likes` = `like_count`, `reposts` = `retweet_count`, `replies` = `reply_count`, `quotes` = `quote_count`. Anything the API did not return is **`null`**, never `0` and never estimated. `text` = the post text, `url` = `https://x.com/<username>/status/<id>`.
7. **Followers.** Read the bot's stored baseline `{ followers, at }` from its own memory.
   - Baseline exists: `current` = now, `baselineAt` = baseline time, `delta` = `current − baseline.followers`, `firstRun: false`.
   - No baseline yet: `delta: null`, `baselineAt: null`, `firstRun: true` (the page then says follower change appears from the next replay).
   - Then store `{ followers: current, at: now }` as the new baseline. Optionally pass `segments` (consecutive stored snapshots `[{ fromISO, toISO, delta }]`) to place follow particles on the dial more precisely.
8. **Status (optional).** `status = null` hides it. Otherwise `ratio` = today's total engagement (or impressions) ÷ median of the previous windows, `tier` from the ratio (≥1.5 → 0 on fire, 1.0–1.5 → 1 rising, 0.7–1.0 → 2 steady, 0.4–0.7 → 3 charging up, < 0.4 → 4 resting), `note` = one sentence saying how it was computed.
9. **Avatar.** `python3 tools/build_avatar.py <avatar URL> --out avatar.json` (needs Pillow), and paste the JSON into `DATA.avatar`. X's `_normal` thumbnail URL is automatically upgraded to `_400x400`. Re-use the same block on later runs unless the picture changed. `null` draws a letter placeholder.
10. **Fill DATA.** Replace only what is between `// ===== BEGIN DATA =====` and `// ===== END DATA =====` with `const DATA: Data = { ... };`, set `example: false`, `footnotes.metricsFetchedAt` = time the metrics were read.
11. **Publish.** The first time, pass the whole file to `WriteCanvas` and remember the returned `canvas_id`. Every later run overwrites **that same canvas** (same `canvas_id`, or `EditCanvas` on the DATA block) so the owner always has one page.

Bot rules: never edit anything outside the DATA block unless you are changing the renderer itself; never add network access; never invent numbers (use `null`).

## DATA schema

```ts
type Num = number | null;
interface Data {
  lang: "en" | "zh";                     // UI language
  example: boolean;                      // true = placeholder data, page says so in subtitle + footer
  account: { name: string; username: string };   // "@" prefix optional; empty strings hide the item
  avatar: { size: number; palette: string; indices: string } | null;
        // size   pixels per side (96)
        // palette base64, 3 bytes (R,G,B) per colour (<= 64 colours)
        // indices base64, size*size bytes, row-major palette indices
  window: { startISO: string; endISO: string;    // exactly 24 h apart, ISO 8601 with offset
            tz: { label: string; offsetMinutes: number } };   // display only
  posts: {
    t: string;                           // ISO time
    kind: "post" | "reply" | "quote";    // pure retweets are NOT included
    selfThread: boolean;                 // reply to own post
    text: string;
    impressions: Num; likes: Num; reposts: Num; replies: Num; quotes: Num;   // null = missing
    url: string | null;                  // only https://x.com/... or https://twitter.com/... becomes a link
  }[];
  followers: {
    current: Num;                        // followers now
    delta: Num;                          // net change since baseline, null when unknown
    baselineAt: string | null;           // ISO time of the baseline snapshot
    firstRun: boolean;                   // no baseline yet (delta must be null)
    segments?: { fromISO: string; toISO: string; delta: number }[];
  };
  status: { tier: number; ratio: Num; note: string } | null;   // tier 0..4, see step 8
  footnotes: { metricsFetchedAt: string | null; retweetsExcluded: Num; extra: string[] };
}
```

Behaviour worth knowing: posts outside the window or with an unparsable time are skipped; items with no data (no status, no baseline, no name…) are hidden instead of showing zeros; a long name shrinks and wraps onto two lines, it is never truncated; an invalid avatar falls back to the letter placeholder; an invalid window shows a clear error text instead of a broken dial.

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

Needs Node 20+, Python 3 with Pillow, and Chrome/Chromium (`CHROME_PATH` to override `/usr/bin/google-chrome`). It type-checks the renderer (strict) and renders about 25 scenarios in headless Chrome (example data, full data in both languages, zero posts, one post, all-null metrics, first run, 600 posts, very long name, emoji name, bad avatar, unsafe URLs, bad window, other time zones…), failing on any page error, any network request, or any `NaN` / `undefined` in the page text. All scenario data is synthetic. Full run takes about 8 minutes.

The code comments are in English; the page itself is bilingual (`lang`).

---

<a id="中文"></a>

# X 脉搏 · 24 小时回放（Grok Bot 画布模板）

[English](#x-pulse--24-hour-replay-grok-bot-canvas-template) · **中文**

## 这是什么

给 Grok Bot 用的单文件只读画布页面：把一个 X 账号最近 24 小时的发帖回放成一个表盘。指针转一圈，每条发帖、回复、引用在对应时刻亮起，大小看曝光、颜色看类型。中心看板显示头像、名称、ID、滚动累计的曝光 / 互动 / 条数、关注变化，以及可选的“今日状态”。

- 3 种风格（神经元、星系、霓虹声波），3 种画幅（1:1、9:16、16:9），每个元素可单独开关，播放 / 暂停 / 拖动，快捷键（空格、← →、Shift = 1 小时），浮层可点击固定并带“打开帖子”链接。
- 界面语言 `en` 或 `zh`。
- **文件里没有任何真实数据。** 所有内容都来自一个 `DATA` 对象；自带一小份虚构示例数据（副标题和页脚都会标明“示例数据”），所以能单独渲染。
- **只读、不联网。** 页面不调用 `fetch`、`XMLHttpRequest`、`WebSocket`，也不加载任何 URL（头像用内嵌像素绘制，不是图片链接）。请保持这一点。

```
renderer/x-pulse-replay.tsx   页面（DATA 数据块 + 渲染器）
tools/build_avatar.py         头像图片 -> 96x96、64 色的 DATA.avatar 数据块
tests/                        无头 Chrome 冒烟测试（可选）
```

Bot 取文件用的稳定原始链接（`main` 分支）：

```
https://raw.githubusercontent.com/topmindspace/x-pulse-bot/main/renderer/x-pulse-replay.tsx
https://raw.githubusercontent.com/topmindspace/x-pulse-bot/main/tools/build_avatar.py
```

## 在 Grok Bot 里怎么用（完整流程）

新用户只需要连接 X。之后每次运行 bot 这样做：

1. **取渲染器**：从上面的原始链接下载一次，之后只替换 `DATA` 块，其余不动。
2. **我是谁**：`get_users_me`，`user.fields=public_metrics,profile_image_url`，得到 `id`、`name`、`username`、当前粉丝数（`public_metrics.followers_count`）和头像 URL。
3. **窗口**：`endISO` = 现在，`startISO` = 现在 − 24 小时，都带上用户的时区偏移；`tz = { label, offsetMinutes }`（label 只用于显示，例如 `"北京时间 (UTC+8)"`）。表盘正好 24 小时，起点在顶部（不是 0 点）。
4. **帖子**：对该 id 调 `get_users_posts`，`start_time` / `end_time` 设为窗口，`max_results=100`，`tweet.fields=created_at,public_metrics,referenced_tweets,in_reply_to_user_id`，并且**一直翻 `next_token` 直到取完**（不能只取第一页）。
5. **分类**：
   - `referenced_tweets` 含 `retweeted` → 纯转推：**排除**，只计入 `footnotes.retweetsExcluded`。
   - 含 `replied_to` → `kind: "reply"`；当 `in_reply_to_user_id` 是自己的 id 时 `selfThread: true`。
   - 含 `quoted`（且不含 `replied_to`）→ `kind: "quote"`。
   - 其余 → `kind: "post"`。
6. **指标**：`impressions` = `public_metrics.impression_count`，`likes` = `like_count`，`reposts` = `retweet_count`，`replies` = `reply_count`，`quotes` = `quote_count`。API 没返回的一律是 **`null`**，不要写 0，也不要估算。`text` 为帖子文本，`url` 为 `https://x.com/<username>/status/<id>`。
7. **关注变化**：从 bot 自己的记忆里读已保存的基线 `{ followers, at }`。
   - 有基线：`current` = 当前粉丝数，`baselineAt` = 基线时间，`delta` = `current − baseline.followers`，`firstRun: false`。
   - 没有基线：`delta: null`、`baselineAt: null`、`firstRun: true`（页面会提示关注变化从下一次回放开始显示）。
   - 然后把 `{ followers: current, at: 现在 }` 存为新基线。可选传 `segments`（相邻已存快照 `[{ fromISO, toISO, delta }]`），让关注粒子在表盘上的位置更准。
8. **今日状态（可选）**：`status = null` 则不显示。否则 `ratio` = 今日总互动（或曝光）÷ 之前若干个窗口的中位数；`tier` 按倍数取（≥1.5 → 0 火热，1.0–1.5 → 1 上扬，0.7–1.0 → 2 在线，0.4–0.7 → 3 蓄力，<0.4 → 4 充电）；`note` 用一句话说明算法。
9. **头像**：`python3 tools/build_avatar.py <头像 URL> --out avatar.json`（需要 Pillow），把 JSON 填进 `DATA.avatar`。X 默认的 `_normal` 小图地址会自动换成 `_400x400`。头像没变就复用上次的数据块；填 `null` 则画一个首字母占位。
10. **填 DATA**：只替换 `// ===== BEGIN DATA =====` 与 `// ===== END DATA =====` 之间的内容为 `const DATA: Data = { ... };`，把 `example` 改成 `false`，`footnotes.metricsFetchedAt` 填读取指标的时间。
11. **发布**：第一次把整个文件交给 `WriteCanvas`，记住返回的 `canvas_id`；以后每次都覆盖**同一个画布**（同一个 `canvas_id`，或用 `EditCanvas` 只改 DATA 块），用户始终只有一个页面。

Bot 守则：除非在改渲染器本身，否则不要改 DATA 块以外的任何内容；不要加任何网络访问；不要编造数字（缺失就写 `null`）。

## DATA 结构

字段与上面 English 部分的 TypeScript 定义一致。要点：

- `lang`：`"en"` 或 `"zh"`；`example`：`true` 表示占位数据，页面会标明。
- `account`：`name`、`username`（`@` 可有可无；空字符串则不显示）。
- `avatar`：`{ size, palette, indices }` 或 `null`。`palette` 是 base64 调色板（每色 3 字节 RGB，不超过 64 色），`indices` 是 base64 的 `size*size` 个调色板索引（按行）。
- `window`：`startISO`、`endISO`（正好相隔 24 小时，ISO 8601 带时区偏移），`tz` 只用于显示。
- `posts[]`：`t`、`kind`（`post` / `reply` / `quote`，不含纯转推）、`selfThread`、`text`、`impressions` / `likes` / `reposts` / `replies` / `quotes`（数字或 `null` = 缺失）、`url`（只有 `https://x.com/…` 或 `https://twitter.com/…` 会变成链接，其余忽略）。
- `followers`：`current`、`delta`、`baselineAt`、`firstRun`、可选 `segments`。
- `status`：`{ tier 0..4, ratio, note }` 或 `null`。
- `footnotes`：`metricsFetchedAt`、`retweetsExcluded`、`extra[]`。

注意：窗口外或时间无法解析的帖子会被跳过；没有数据的项（没有状态、没有基线、没有名称等）直接隐藏，不显示 0；名称过长会缩小并折成两行，不会截断；头像数据无效时回退为首字母占位；窗口无效时显示明确的错误文字。

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

需要 Node 20+、带 Pillow 的 Python 3、Chrome / Chromium（用 `CHROME_PATH` 覆盖默认的 `/usr/bin/google-chrome`）。会对渲染器做严格类型检查，并在无头 Chrome 里渲染约 25 个场景（示例数据、中英文完整数据、零帖子、单帖子、指标全缺失、首次运行、600 条帖子、超长名称、emoji 名称、坏头像、不安全链接、坏窗口、其他时区等），出现页面错误、网络请求或页面文字里的 `NaN` / `undefined` 都算失败。所有场景数据均为虚构。完整运行约 8 分钟。

代码注释为英文；页面本身通过 `lang` 支持中英文。
