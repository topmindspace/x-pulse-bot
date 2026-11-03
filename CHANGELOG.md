# Changelog

## 3.3.1 (2026-11-03)

- **Public square layout (1:1 page and video) no longer shows any caveat wording**: the small "估算值" / "estimated" span in the header box is removed. The caveat stays in the wide / stacked sidebar and in the page footnotes. `tests/public.mjs` now asserts that the square stage has no `data-xp-caveat` and no 估 / est. at all. No data or Personal change.

## 3.3.0 (2026-11-03)

X Pulse (Public) is real: the renderer draws the topic-heat dial, and `public/` holds the data chain, the video recorder and the tests. No change to the Personal DATA schema (v3); old Personal data renders as before, every Personal path is unchanged.

- **Public mode in the shared renderer.** `DATA.mode = "public"` takes `topic{name,title{zh,en}}`, `tz`, `window`, `posts` rows (`id: null` = scaled dot), `followers.segments`, `footnotes` and `pub{N,M,cardHours,hours,cum,totals,hot,scope,caveat}`. Strict validation with `DATA.pub.…` messages. Three layouts (wide 16:9 with sidebar, square, stack), EN / 中文 switch, same effects and music as Personal. The centre board counts up with the playhead and ends on the sidebar totals. **No 「估」 / "est." in the dial, centre board or bars**: the caveat is in the sidebar (`data-xp-caveat`) and the page footnotes only.
- **Recorder hooks** `window.__XPULSE_REC` (layout, frame width) and `window.__XPULSE_API` / `__XPULSE_ME` for the 16:9 and 1:1 videos.
- **`public/`**: `config.json`, `fetch_plan.py` (≤ 25 X calls, queries archived), `ingest.py`, `calibrate_people.py` (people ratios measured on X, with a bootstrap 90% interval), `db_hot.py` (optional), `gloss.py` (hot-post translations, exit 4 if missing), `fill_public.py` (self-checks), `make_public.sh` + `video/` (deterministic 30 fps frames, offline music, ffmpeg loudnorm, 1920×1080 and 1080×1080). README in EN and 中文.
- **Data-chain fixes** found in the full review: people ratios came from tracked power users (now measured on X); retweets = all − originals − replies − quotes is clamped at 0 per hour and reported; the display time zone and the random seed (sha256 of tag and topic) are real and fixed; a slot bug in `ingest.py`; query text is archived with every plan; dot weights are scaled so the dots add up to the totals.
- **Shared-renderer fixes (also benefit Personal):** a false "24:00" in the date/time helpers for windows that end at a time other than midnight; `tzLabel()` accepts `{zh,en}`; no JSX fragments (`display: contents` wrappers); refactored name / handle / kind helpers and one `DAYS` builder. Personal output is unchanged (`mode.mjs`, `run.mjs`, `lang.mjs`, `days.mjs`, `dash.mjs` pass).
- **Tests.** `tests/public.mjs` (validation messages, EN / 中文, no 估 / est. over 5 layouts × 2 languages × 3 positions on canvas text and DOM, panel overflow and font floor, centre board = sidebar totals, hot card, recorder hook) and `tests/test_public.py` (21 tests: config, fill invariants, exit codes, clamp, determinism, people maths, aggregates-only injection, bilingual gloss); `tests/pubfix.py` builds a synthetic cache. `npm test` runs both. `tests/mode.mjs` follows the new public shape.
- Known limits: with fewer than 40 sampled posts in a stratum the p97.5 winsor does not clip; people ratios rest on 10 authors per kind (wide range, shown); a hot post whose own text contains 「估」 shows it.

## 3.2.0 (2026-11-03)

One repo, two editions, one renderer. No change to the Personal DATA schema (v3); old data without `mode` renders exactly as before.

- **Editions.** The repo now holds **X Pulse (Personal)**, measured data from your own account (this bot, released), and **X Pulse (Public)**, topic-wide heat (coming, maintained separately, estimated numbers). README and changelog say so, EN first, then 中文.
- **`DATA.mode`** `"personal" | "public"`, default `"personal"` when missing (case / space tolerant; any other value shows an error text). `tools/fill_data.py` now writes `mode: "personal"`.
- **Public = reserved / draft.** Validation accepts `{ mode: "public", lang, topic: { name }, footnotes?: { extra? } }` (a blank `topic.name` is an error). The page shows the title and a placeholder instead of a dial and never crashes on it; the real public format comes later. Rule: public visual areas (dial, centre board, bar charts) never show 「估」 / "estimate"; caveats only in footnote text.
- **Corner title by mode.** Personal: `X Pulse · Personal · @handle · <day label>` (Yesterday's replay / Daily replay / Replay of <date>; 「昨日回放」/「每日回放」/「<date> 回放」; the handle is skipped when empty). It replaces the old `X 脉搏 · …` / `X Pulse · …` title and is the same string in both languages except the day label. Public: `X Pulse · Public · <topic name>`.
- `account`, `footnotes` and `avatar` are read defensively (a missing personal `account` shows "DATA.account is missing" instead of throwing).
- **Layout.** New `public/` folder (README only) reserved for the public edition's data tools. Every Personal path is unchanged: `renderer/x-pulse-replay.tsx`, `dist/x-pulse-replay.min.tsx`, `tools/fill_data.py`, `tools/build_avatar.py`, `tools/build.py`.
- Tests: new `tests/mode.mjs` (titles for both modes and languages, reserved public shape, error texts, no 「估」 / "estimate" in the public page); `test_fill_data.py` checks `mode`. `npm test` runs `mode.mjs`.

## 3.1.0 (2026-11-02)

No change to the DATA schema (v3). Build and data tooling, one renderer fix.

- **`tools/build.py` + `tools/minify/`** produce `dist/x-pulse-replay.min.tsx` (about 94 KB instead of 139 KB; 32 KB gzip). The minifier uses the TypeScript 5 compiler API, removes comments and indentation, joins lines only where that is safe, renames nothing, keeps the `BEGIN DATA` / `END DATA` markers, prepends a one-line `// X Pulse renderer <version> (minified …)` header, and self-checks that the token stream is unchanged. `--typecheck` type-checks the minified file as well.
- **`tools/fill_data.py`** (Python standard library + `zoneinfo`): raw X API posts + follower snapshots -> final page file. Local calendar days (yesterday back N days), DST and 45-minute zones, pure retweets dropped and counted, compact rows (one per line, snippets of at most 20 graphemes, `null` for missing metrics), follower delta only when snapshots bracket the day (else `null`), day status only with a baseline of at least 3 earlier days, and a size budget that keeps the top-N posts per day and states how many were omitted in the footnotes (EN and ZH). Prints a JSON summary. See the README for the input JSON.
- `tests/test_fill_data.py` (14 tests), `tests/page.mjs` (render any finished page and screenshot it), `npm test` also type-checks the minified output and runs the Python tests.
- **Fix:** a metrics fetch time after the day's end (for example the next morning) was shown as "24:00" in the footnote; `fmtIso` now formats the real local instant.

## 3.0.0 (2026-11-02)

Breaking DATA change (v2 DATA still renders as one day).

- **Calendar-day replay.** The dial is a local day, 00:00 to 24:00 in the owner's time zone; default is yesterday (title "Yesterday's replay" / 「昨日回放」). `DATA.days[]` holds 1 to 7 days (date, posts, followers, status); account, avatar, tz and footnotes are shared. A compact date chip row switches the day and restarts playback; the last day is selected first.
- **Worldwide time.** `DATA.tz.iana` with `Intl`: DST days of 23 or 25 hours map to the real length, ticks sit on real local hours, half-hour and 45-minute offsets, +14 / −12, skipped midnights. Posts are bucketed by local day.
- **Slim data.** Compact post rows `[t, flags, impressions, likes, reposts, replies, quotes, id, snippet]`, `t` may be seconds since local day start, snippets are cut to 40 graphemes, the renderer tolerates missing text.
- **Bilingual UI.** `EN | 中文` toggle in the toolbar (shortcut `L`), seeded from `DATA.lang` (missing / unknown => en), remembered in `localStorage`; every UI string, tooltip, status note, footnote, axis label, legend and empty / missing state switches live. `status.note` and `footnotes.extra[]` may be `{ en, zh }`.
- **Centre dashboard redesign.** Engagement is the headline number, followed by the post / reply / quote counts, then impressions and followers, then follower change; layout re-centres when items are hidden; tuned for 1:1, 9:16, 16:9 in both languages.
- **Live status word** with five levels (Calm / Warming up / Active / On fire / Erupting; 静候 / 升温 / 活跃 / 火热 / 爆发) driven by the intensity of the playhead's last hour, with smoothing, hysteresis and a cross-fade, level pips, a per-level animation of the word and avatar aura, and a faint animated aurora and ripples in the centre disc. The day rating keeps its meaning but now reads Standout / Rising / Steady / Building / Recharge day so words are not repeated.
- `prefers-reduced-motion`: no autoplay, no shake, finale flash, shimmer or ripples. Music stays off until clicked.
- Tests: new `lang.mjs`, `days.mjs`, `dash.mjs`; README (EN, then ZH) rewritten with the v3 schema, compact encoding, size numbers, worldwide and accessibility notes.

## 2.0.0 (2026-11-02)

Visual assessment of 1.0 (real 341-post day and the example data, all three styles): every post used the same three wide, dim, overlapping rings plus a soft disc, so dense hours (about 40 posts per hour) turned into a ring forest with blown-out additive glow, while the biggest posts looked almost like the smallest ones (same ring recipe, a slightly larger radius, no flash). Follower particles in Neuron were plain dots with no arrival feedback.

Changes:
- Tiered shockwaves relative to the day's data (ordinary / notable / major), thin sharp rings with a bright leading edge, chromatic split, light bloom, sparks, dial shake for major posts.
- Budgets (40 small rings, 8 notable, 4 major at once), density-aware alpha in busy hours, fade by age, clamped additive glow, short life for ordinary rings.
- Follower particles: tapered comet trails in all styles and an arrival burst at the avatar ring.
- Optional generated background music (Web Audio, off until clicked): Pulse / Piano / Classical, volume, limiter; follows play, pause, scrub and speed.
- Tests: each scenario also exercises the music toggle, all styles, scrub / pause / speed, and renders the music offline (no clipping, no NaN).
- No change to the DATA schema.

## 1.0.0

First public release.
