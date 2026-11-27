# Third-Party Open Source Notices & Upstream Credits

> **Non-Affiliation & Trademark Disclaimer**
>
> **Obsidian Prism is an independent open-source project and is not affiliated with or endorsed by Google LLC.**
> "Antigravity" and "Google" are trademarks or product names of Google LLC, referenced solely for descriptive compatibility purposes ("Optical UI & Motion Suite for Antigravity").

---

## 0. Project License & Downstream Attribution Summary

**Obsidian Prism** (`https://github.com/RMvdesi/obsidian-prism`, Copyright (C) 2026 RMvdesi) as a combined work and all original modules authored for this repository are licensed under the **GNU General Public License v3.0 (`GPL-3.0-only`)**, subject to the attribution preservation and non-endorsement conditions in [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).

Any derivative work or modified redistribution MUST remain open-source under **GPL-3.0** and preserve full attribution to **RMvdesi / Obsidian Prism** as well as the upstream notices below.

---

## 1. Absorbed & Unified Core Upstream Projects (MIT License — GPL-3.0 Compatible)

**Obsidian Prism** unifies, refactors, and builds upon components from the following MIT-licensed open-source repositories. Under the terms of the MIT License (which is upward-compatible with GPL-3.0), their original copyright notices and permission statements are preserved in full below:

### 1.1 `0DNANCY/agy-claude-style`
- **Repository**: <https://github.com/0DNANCY/agy-claude-style>
- **Copyright**: `Copyright (c) 2026 0DNANCY`
- **Original License**: MIT License
- **Scope in Obsidian Prism**: Optical UI theme foundation, 4-tier spring choreography base, WebGL2 horizon glow & character matrix ripple field, pixel mascot rig foundation, and zero-dependency bundle compiler.

### 1.2 `ATtacK030130/antigrative-dashboard` (`v0.9.1`)
- **Repository**: <https://github.com/ATtacK030130/antigrative-dashboard>
- **Upstream Baseline**: `v0.9.1`
- **Copyright**: `Copyright (c) 2026 AG Pulse contributors`
- **Original License**: MIT License (compatible with `GPL-3.0-only`)
- **Scope in Obsidian Prism**: Absorbed and adapted in `vendor/pulse-dashboard/` (`compat/` and `sidecars/panel/`) for live token throughput (TPS / TTFT), cache hit rate telemetry, context window estimation, dual-window (`5h` / weekly) model quota collection & linear depletion forecasting, main session vs. Swarm/subagent token attribution, CDP process-lineage multi-instance discovery, isolated sidecar telemetry storage, and smart coexistence yielding.

### 1.3 `LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider`
- **Repository**: <https://github.com/LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider>
- **Copyright**: `Copyright (c) 2026 月上寒 (LLYSH-HANNARI)`
- **Original License**: MIT License (compatible with `GPL-3.0-only`)
- **Scope in Obsidian Prism**: Absorbed in `vendor/effort-slider/` for interactive reasoning effort slider inside the model selector menu, enhanced with smart coexistence yielding and 120ms MutationObserver throttling.

### 1.4 `yiheng8023/antigravity-chinese` (`v3.3.63`)
- **Repository**: <https://github.com/yiheng8023/antigravity-chinese>
- **Upstream Baseline**: `v3.3.63` (Author: `yiheng8023`)
- **Copyright**: `Copyright (c) 2026 Antigravity Chinese Localization Contributors`
- **Original License**: MIT License (compatible with `GPL-3.0-only`)
- **Scope in Obsidian Prism**: Upstream `zh-CN` dictionary source (`vendor/host-i18n/zh-CN.json`) and DOM translation matching pattern reference; re-architected cleanly in `vendor/host-i18n/host-i18n-runtime.js` (Zero-ASAR pure CDP Channel 4 on-demand localization) and `vendor/host-i18n/swarm-i18n-runtime.js` + `vendor/host-i18n/swarm-zh-CN.json` (zero-Ch1-byte Swarm OOPIF `plugin://swarm--swarm_board-*` on-demand localization), featuring universal 4-layer auto-yield (explicitly yielding to `yiheng8023` `__AGY_SWARM_I18N__` / `[data-agy-i18n]`, `Antigravity-Hans`, `3169657175`, `renkeshui`, `Zero-Touch`, and generic localization markers), ping-pong conflict circuit breaker, and `WeakMap`-backed lossless `destroy()`.

---

## 2. Upstream Design Inspiration & Component Credits

Obsidian Prism acknowledges the UI/UX concepts and interaction patterns established by the following upstream open-source projects:

### 2.1 `Nwflower/dsh-claude-style`
- **Repository**: <https://github.com/Nwflower/dsh-claude-style>
- **Contribution**: Studio-style minimalist typography, clean composer framing, and warm editorial surface aesthetics.

### 2.2 `Microqian2th/dsh-codex-effort-slider`
- **Repository**: <https://github.com/Microqian2th/dsh-codex-effort-slider>
- **Contribution**: Starfield energy track, hysteresis detent snapping, and continuous damped motion curves for reasoning effort controls.

### 2.3 `mobius/dsh-performance-slider`
- **Repository**: <https://github.com/mobius/dsh-performance-slider>
- **Contribution**: Interactive performance tier slider concepts and responsive visual feedback patterns.

### 2.4 `claudenoshujin/claude-web` (by `lulu`)
- **Repository**: <https://github.com/claudenoshujin/claude-web>
- **Contribution**: *Mascot Pile & Micro-Ecology Interaction Inspiration* (clean-room independent implementation in Obsidian Prism; zero source code copied).

### 2.5 `wp3171216237/dsh-TUI` (`assets/deepy`, also shipped via `Nwflower/dsh-claude-style`)
- **Repository**: <https://github.com/wp3171216237/dsh-TUI>
- **Copyright**: `Copyright (c) 2026 chimney (@wp3171216237)`
- **Original License**: MIT License (compatible with `GPL-3.0-only`)
- **Contribution**: Visual silhouette, cobalt-blue + white-belly palette, and water-spout animation concept of the **Deepy** DeepSeek pixel whale mascot, adapted cleanly into this repository's `16×10` zero-outline `PX=3` Clawd pixel grammar inside `dual-mascot-rig.js` alongside the original silver-white GPT Dragon (`dragon`, inspired by the community white-dragon motif with zero copied artwork).

---

## 3. Preserved Upstream MIT License Text

```text
MIT License

Copyright (c) 2026 0DNANCY (agy-claude-style)
Copyright (c) 2026 AG Pulse contributors (antigrative-dashboard)
Copyright (c) 2026 月上寒 / LLYSH-HANNARI (antigravity-Codex-Claude-effort-slider)
Copyright (c) 2026 Antigravity Chinese Localization Contributors (yiheng8023/antigravity-chinese)
Copyright (c) 2026 chimney / @wp3171216237 (dsh-TUI / Deepy mascot reference)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
