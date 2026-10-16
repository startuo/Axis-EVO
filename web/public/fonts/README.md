# Self-hosted fonts

These open fonts reproduce the public reference Storybook's type stack.
Chinese text falls back to the platform's Microsoft YaHei / PingFang SC
or SimSun / Songti SC fonts. No proprietary Anthropic fonts are included.

| Font | Local file | Source |
| --- | --- | --- |
| Inter | inter-latin-variable.woff2 | https://cdn.jsdelivr.net/fontsource/fonts/inter:vf@latest/latin-wght-normal.woff2 |
| Newsreader | newsreader-latin-variable.woff2 | https://cdn.jsdelivr.net/fontsource/fonts/newsreader:vf@latest/latin-wght-normal.woff2 |
| JetBrains Mono | jetbrains-mono-latin-variable.woff2 | https://cdn.jsdelivr.net/fontsource/fonts/jetbrains-mono:vf@latest/latin-wght-normal.woff2 |

The checked-in bytes are pinned by `manifest.json`; this application never
requests these source URLs at runtime. SIL OFL 1.1 licenses accompany each font.
