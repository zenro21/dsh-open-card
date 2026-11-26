# Scroll mode: why the whole column scrolled, and how it was fixed

> Applies to v1.2.2 · Functions described here live in `client.js` ("scroll mode" section)
> This note records one real investigation end to end, so the same traps are not stepped on again.

## Symptom

Turning on **Scroll** for a *container* such as the left sidebar made the wheel scroll the entire sidebar — the whole column shifted up and down — instead of the session list inside it. Panels could also be pushed to zero height, with content overflowing to the outer layer.

## Summary

Three defects were **stacked**; the full symptom needs all of them:

1. **Scrolling was attached to the wrong element.** Scroll mode used to add `overflow:auto` to the single clicked element. Clicking a sidebar container wrapped the real scroll region in a second scroll container, so the wheel drove the outer one and the column appeared to shift.
2. **`flex-grow:0` crushed the inner scroll region.** The rule `[data-rsz-scroll="1"] > *{flex-shrink:0;flex-grow:0}` pinned the flexibility of every direct child, while the DSH sidebar scrolls through `.regionArea{flex:1;min-height:0}` → `.list{flex:1;min-height:0;overflow-y:auto}`, which relies on flex to take the remaining height. `flex-grow:0` collapsed it to zero.
3. **`scrollbar-width:thin` threw away the scrollbar skin.** Once Chromium sees a non-`auto` `scrollbar-width` on an element, it discards **every** `::-webkit-scrollbar` rule on that element. The DSH theme draws its scrollbars exactly that way, so the line reverted our own scrollbars to the UA default.

Two more latent defects were fixed along the way:

4. Natural sizes in `naturals` were sampled once; if the first sample was `0` (element not laid out yet) it never refreshed, permanently disabling the "auto-enable scroll below 50%" test.
5. Persisted selectors included CSS Module hashed class names (`bdiHEa_root`, `xRI0Kq_input`) whose prefix changes on every build — one upgrade and remembered sizes silently stopped matching.

## The fix

### 1. Hand scrolling to the real scroll region

Four predicates were added:

| Function | Purpose |
| --- | --- |
| `isScrollPort(node)` | Is this element itself a scroll container: `overflow-y` is `auto` / `scroll`, and it is not `display:inline` |
| `findInnerScrollPort(el)` | Find the real scroll region inside `el` (first 400 descendants): must be a scroll port, have height, and **actually carry scrolling** (already overflowing, or flexing into remaining space) |
| `scrollHostOf(el)` | Decide who scrolls: itself if it is a scroll port, otherwise the inner one found, otherwise itself |
| `hasScrollMode(el)` | Whether this block is in scroll mode now — its own attribute or the host's |

`applyScrollMode(el, on)` now resolves the host first: when the host is not the element itself, it puts `data-rsz-scroll="1"` on the host and does **not** add another `overflow` layer on the block.

> Requiring "actually carrying scrolling" avoids the `overflow:hidden` decorative boxes scattered across the page — treating any `overflow` as a scroll region would hit them.

### 2. `> *` pins only `flex-shrink`

```css
[data-rsz-scroll="1"] > *{flex-shrink:0 !important}
```

Children are no longer squeezed (`flex-shrink:0`), while `flex-grow` returns to the framework so scroll regions can expand properly.

### 3. Drop `scrollbar-width:thin`

This keeps the DSH theme's `::-webkit-scrollbar` skin in effect.

### 4. `naturals` may re-sample

A `0` sample is re-measured on the next pass; only non-zero values are stored.

### 5. Hashed class names stay out of storage keys

`isHashedClass(name)` recognises the CSS Module shape "5–8 mixed-case characters + `_` + semantic name"; `classToken` skips those. When `resolveSelector` fails to match, it strips the hashed segments from the selector and tries once more — so **keys written by older versions keep working**.

## Verification

Debugging on the live DSH page is awkward (UIA exposes only part of the node tree), so a simulation page reproducing the exact sidebar hierarchy was used for deterministic checks:

```
.root{display:flex;flex-direction:column;height:320px}
 ├ .top{flex:none;height:40px}
 └ .regionArea{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
    └ .list{flex:1;min-height:0;overflow-y:auto}   ← 30 sessions
```

Results:

| Scenario | Result |
| --- | --- |
| Scroll enabled on `.root` | Lands on `.list`, `listMarked: true` |
| Scroll enabled on `.regionArea` | Lands on `.list` |
| Scroll enabled on `.list` itself | Stays `.list` |
| Ordinary tall card with no inner scroll region | Scrolls itself (unchanged) |
| Layout regression | `regionH` / `listH` both 260 before and after; nothing crushed to 0 |
| Hashed names | `isHashedClass('bdiHEa_root')` → true, `'scrollArea'` / `'rsz-orb'` → false |

## Differences from the original analysis

The issue was first raised by an external analysis document written against v1.2.0 (the 1321-line build). A few of its points needed correcting; recorded here so later maintainers are not misled:

| Claim in the document | What is actually true |
| --- | --- |
| Locate the scroll region via a `[data-sidebar-scrollport]` marker | That attribute does **not exist** in the current DSH version (0 grep hits repo-wide); the real scroll region is `.list{flex:1;min-height:0;overflow-y:auto}` in `WorkspaceBrowser.module.css` |
| The framework hides scrollbars with `display:none` | Not the case. The framework skins scrollbars through `::-webkit-scrollbar` (`packages/client/ui-theme/src/styles/scrollbar.css`); **our** `scrollbar-width:thin` was what disabled the skin |
| Scrollbar visibility must be "restored" on the scroll container | Not needed; removing `scrollbar-width` is enough |
| The `> *` rule pinning both `flex-shrink` and `flex-grow` crushes scroll regions | Correct — this was the most important defect |

## Where the code lives

- Scroll host resolution: `isScrollPort` / `findInnerScrollPort` / `scrollHostOf` / `hasScrollMode` / `applyScrollMode` in `client.js`
- Persistence: `classToken` / `isHashedClass` / `resolveSelector` / `stripHashedClasses` in `client.js`
- CSS: the `[data-rsz-scroll="1"]` rules
- Change record: the v1.2.2 section of [CHANGELOG.md](../CHANGELOG.md)
