# X Pulse (Public) · reserved

**English** · [中文](#中文)

This folder is **reserved** for the data tools of the public edition of X Pulse: topic-wide heat over the last 24 hours, drawn with the same renderer as the Personal edition (`renderer/x-pulse-replay.tsx`, selected by `DATA.mode = "public"`).

- **Status: reserved / draft.** Nothing here yet; the data tools and the public DATA format will be added later by the bot that maintains the Public edition. Renderer 3.2.0 only validates the minimal shape `{ mode: "public", lang, topic: { name }, footnotes?: { extra? } }` and shows a placeholder (see the main [README](../README.md), section "Reserved: `mode: "public"`").
- **Estimated numbers.** The public edition works with estimated numbers. Rule: the visual areas (dial, centre board, bar charts) never carry the character 「估」 or the word "estimate"; the caveat goes only into the side / footnote explanation text.
- **Do not move Personal files here.** The Personal paths in the repo root (`renderer/`, `dist/`, `tools/fill_data.py`, `tools/build_avatar.py`, `tools/build.py`) are downloaded by bots that already imported the template and must stay where they are. The shared renderer stays in `renderer/`; public-only data scripts go in this folder.

---

<a id="中文"></a>

# X Pulse (Public) 公共版 · 预留

[English](#x-pulse-public--reserved) · **中文**

这个文件夹**预留**给 X Pulse 公共版的数据工具：某个话题圈最近 24 小时的全网热度，用和个人版相同的渲染器（`renderer/x-pulse-replay.tsx`，通过 `DATA.mode = "public"` 切换）绘制。

- **状态：预留 / 草案。** 目前这里是空的；数据工具和公共版的 DATA 格式以后由维护公共版的 bot 补上。渲染器 3.2.0 只校验最小结构 `{ mode: "public", lang, topic: { name }, footnotes?: { extra? } }` 并显示占位提示（见主 [README](../README.md) 的「预留：`mode: "public"`」一节）。
- **估算数据。** 公共版使用估算数据。规则：可视化区域（表盘、中心看板、柱图）上不出现「估」字或 "estimate"；估算口径的说明只写在侧栏 / 脚注文字里。
- **不要把个人版文件挪到这里。** 仓库根目录下个人版的路径（`renderer/`、`dist/`、`tools/fill_data.py`、`tools/build_avatar.py`、`tools/build.py`）会被已导入模板的 bot 下载，必须原地不动。共用渲染器留在 `renderer/`，公共版独有的数据脚本放进本文件夹。
