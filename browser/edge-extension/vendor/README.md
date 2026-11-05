# Pinned browser extraction compatibility layer

Source: https://github.com/alchaincyf/huashu-chrome

Commit: `84d5ee40532ca586650d3d5f78f3952d3061cd06`; package version `1.3.0`; MIT, copyright 2026 花叔 (alchaincyf). Original license is retained alongside these files.

The unchanged Git blob SHA-256 of `redact.js` is `7bd9ecaa2ee3565679fb530ae28cedfda8b575609a162530f70ea44bb49e4a69`; the original license blob is `eb13193ce28f85e82685676675ecf3454d4f19a7730c0940c47205c69a8a3cd1`. These identities use upstream Git blob bytes, independent of checkout line-ending conversion.

`redact.js` is unchanged. `content.js` is an Axis compatibility adaptation: only ping, snapshot, read_text, locate, describeRefs, click, type, select and scroll messages from the same extension are accepted; selectors, semantic find and submit are disabled. Snapshot form values and page-declared tools are omitted. Click retry is disabled. Sensitive clicks and field typing require human takeover.

The original content script contains additional helpers that are inaccessible through this restricted entry point. The Axis background transport exposes neither arbitrary JavaScript evaluation nor a generic upstream command passthrough. Updating the pinned files requires reviewing the adaptation and rerunning stale-reference, credential and action-boundary tests.

Location preflight and typing share the same secret-field check. A password field is marked sensitive before the background worker can enter its possibly-issued phase; the actual typing guard remains in place.
