# FLOQ EXTENSION — MACBOOK DIAGNOSTIC REPORT
**Date:** April 4, 2026
**Machine:** Yancy's MacBook Air
**Audited by:** Claude Code

---

## EXTENSION COPIES FOUND

| # | Path | Version | Git? | Built? |
|---|------|---------|------|--------|
| 1 | `/Users/yancygarcia/Desktop/floq-extension/` | 1.8.0 (source) | Yes — `main` branch, commit `6baa43c`, clean, matches `origin/main` | Yes — `.output/chrome-mv3/` exists, v1.8.0 |
| 2 | `/Users/yancygarcia/Desktop/floq-chrome-mv3/` | 1.8.0 (deployed copy) | No — flat copy of build output | N/A — IS the build |
| 3 | `/Users/yancygarcia/Desktop/floq-extension-v1.0.1-local/` | 1.0.1 | No | N/A — ancient stale copy |
| 4 | `/Users/yancygarcia/oper8er-extension/` | 1.0.0 | No | N/A — original Oper8er, obsolete |

## WHAT CHROME IS LOADING

| Chrome Profile | Extension ID | Loaded From | Version |
|---------------|-------------|-------------|---------|
| **Profile 2** (VinSolutions) | `nccggedlifgciocoedfoolghcjhpaaij` | `/Users/yancygarcia/Desktop/floq-chrome-mv3` | **1.8.0** |
| Profile 6 | `opjpehgcbamakdfkpamddpoipahccidg` | `/Users/yancygarcia/oper8er-extension` | 1.0.0 (obsolete) |

**Chrome Profile 2 is loading the correct v1.8.0 build.** The stale version problem from earlier sessions is resolved.

## GIT STATE

- **Branch:** `main`
- **HEAD:** `6baa43c` — "v1.8.0: Draggable pill — user positions it anywhere, saved to storage"
- **Local changes:** None (clean working tree)
- **Remote sync:** Matches `origin/main` exactly
- **Note:** The prompt references `d3074f4` as latest commit — that's an OLD commit from much earlier. Current HEAD is `6baa43c`, which is 12 commits ahead of `d3074f4`.

**Recent commit history:**
```
6baa43c v1.8.0: Draggable pill
5dd5b78 v1.8.0: Move pill and sidebar from right to left side
61f57f8 v1.8.0: Fix mic — continuous listening until manual stop
7a92c00 v1.7.9: Fix 413 on Context Reply — compress screenshots
0d8aa38 v1.7.8: Flush sidebar right edge, robust dashboard scan
```

## SOURCE VS BUILD COMPARISON

| Check | Result |
|-------|--------|
| `.output/chrome-mv3/content.js` matches `floq-chrome-mv3/content.js` | **IDENTICAL** |
| `.output/chrome-mv3/manifest.json` matches `floq-chrome-mv3/manifest.json` | **IDENTICAL** |
| `.output/chrome-mv3/background.js` matches `floq-chrome-mv3/background.js` | **IDENTICAL** |
| Build output version | 1.8.0 |
| Source version (`wxt.config.ts`) | 1.8.0 |

**Build is current. No stale output.**

## CSP STATUS

| File | Inline Scripts? | onclick Attributes? | Status |
|------|----------------|---------------------|--------|
| `options/index.html` (source) | No — uses `<script type="module" src="./options.js">` | No | **CLEAN** |
| `options.html` (built) | No — uses `<script type="module" crossorigin src="/chunks/options-BS_FTqjh.js">` | No | **CLEAN** |
| `onboarding.html` (built) | No onclick attributes | No | **CLEAN** |

**No CSP violations.**

## CONTENT.TS AUDIT

| Check | Result | Line(s) |
|-------|--------|---------|
| `currentTier` hardcoded to `'group'`? | **YES** — `currentTier = 'group'` | 95, 98 |
| `isFeatureUnlocked` always returns true? | **YES** — `return true` | 101-102 |
| `bodyText.length` guard present? | **NO** — removed in v1.7.6 | N/A |
| Gate cards (GATE_COACH etc.)? | **NO** — removed | N/A |
| `isFloor` checks? | **NO** — removed | N/A |
| `getSettingsHTML()` locked or unlocked? | **UNLOCKED** — all radio buttons visible | ~970 |
| SPA observer for FB/IG? | **YES** — watches for `[role="main"]` etc. | 214-223 |
| Scanning scoped to Customer Dashboard? | **YES** — `getDashboardScopedText()` slices after "Customer Dashboard" marker | 251-258 |
| Pill draggable? | **YES** — mousedown/mousemove/mouseup, position saved to storage | 308-375 |
| Sidebar position? | **LEFT** — `left:'0', top:'0'` | 609-616 |
| pushContent direction? | **marginLeft: 320px** | 784-791 |
| Mic continuous listening? | **YES** — `onend` auto-restarts if `isListening` is true | 490-521 |
| Image compression for Context? | **YES** — `compressImage()` at 800px, 0.7 quality | 564-580 |
| 413 error handling? | **YES** — friendly message in content.ts and background.ts | 729, 734 |
| Service worker reconnect? | **YES** — `safeSend()` pings first, shows reconnect banner | 106-126 |

## NODE/NPM ENVIRONMENT

| Item | Value |
|------|-------|
| Node | v24.14.0 |
| npm | 11.9.0 |
| WXT | 0.20.20 |
| Build output exists? | YES |

## BUGS FOUND

1. **Comment says "right" but sidebar is left** — Line 1 says "All platforms: sidebar on RIGHT, never left" but sidebar is now on the LEFT for VinSolutions. Cosmetic/misleading comment only, not functional.

2. **Three stale extension copies on disk** — `floq-extension-v1.0.1-local` (v1.0.1), `oper8er-extension` (v1.0.0), and an obsolete oper8er in Profile 6. These waste disk space and could cause confusion.

3. **Version stuck at 1.8.0 across 3 different commits** — Commits `6baa43c`, `5dd5b78`, and `61f57f8` all claim to be v1.8.0 in wxt.config.ts. Version should have been bumped for each. Chrome may cache and not reload if it sees the same version number.

4. **Sidebar width inconsistency** — `getSidebarWidth()` returns `320px` for VinSolutions (line 304), host is set to `320px` (line 612), but `pushContent` uses `marginLeft: '320px'` (line 788). All consistent now, but the width changed from 300 to 320 without the version changing.

5. **`allFrames: true` still set** (line 45) — The content script runs in all frames. The `window !== window.top` guard at line 187 prevents sidebar injection in child frames, but the code from lines 1-186 (platform detection, function definitions, scanning functions, AddNote receiver) still executes in every iframe. The AddNote receiver (lines 69-88) intentionally runs in iframes, but the scanning function definitions (129-184) are dead code in child frames since they're only called from the scanning block after line 236 (which is after the top-frame guard).

6. **No `d3074f4` commit in history** — The audit prompt references this commit as "latest on GitHub main" but it's from a much earlier state. Current HEAD is `6baa43c`, 12+ commits ahead.

## ROOT CAUSE

**The extension is working correctly on this MacBook.** The earlier issues (stale build, wrong Chrome load path, isUIFrame race, wrong customer scan) have all been resolved in commits v1.7.5 through v1.8.0. Chrome Profile 2 loads from `/Desktop/floq-chrome-mv3/` which contains the latest v1.8.0 build with draggable pill, left-side sidebar, continuous mic, image compression, dashboard-scoped scanning, and all tier gates removed. Source, build output, and Chrome's loaded copy are all in sync at commit `6baa43c`. No CSP violations. No stale code.

The only remaining issues are cosmetic: stale copies on disk, a misleading comment in line 1, and the version number not being bumped between the last 3 commits.

## WHAT NEEDS TO HAPPEN

```bash
# 1. Clean up stale extension copies
rm -rf /Users/yancygarcia/Desktop/floq-extension-v1.0.1-local
rm -rf /Users/yancygarcia/oper8er-extension

# 2. Remove obsolete oper8er extension from Chrome Profile 6
# Go to chrome://extensions in Profile 6 and remove the oper8er extension

# 3. Bump version to 1.8.1 to force Chrome reload
# Edit wxt.config.ts: version: '1.8.1'

# 4. Fix misleading comment at line 1 of content.ts
# Change "sidebar on RIGHT" to "sidebar on LEFT for VinSolutions"

# 5. Rebuild and deploy
# npx wxt build
# cp -R .output/chrome-mv3/* ../floq-chrome-mv3/

# 6. Reload in Chrome
# chrome://extensions → reload Floq → Cmd+Shift+R on VinSolutions
```

**DO NOT RUN THESE. Report only.**
