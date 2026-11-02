# Changelog

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
