# 更新日志 / Changelog

本文件记录 dsh-open-card 每个版本的改动。发布时 `v1.2.2` 一节可直接作为 `gh release create --notes-file` 的文案来源。

---

## v1.2.2（未发布 · 待发布）

### 中文

**修复：编辑工具条会在屏幕边缘被截断，末尾按钮点不到**

- 编辑任意块时弹出的七按钮工具条（收起 / 滚动 / 外 / 复位 / 置前 / 移动 / ✕）原先按固定 `330px` 估算宽度来定位，而实际宽度会随块标签和尺寸文本增长到 460px 以上；当目标块靠近窗口右边缘或下边缘时，整条工具条会伸出视口，最右边的按钮就点不到了。现在改为**先量出工具条的真实尺寸，再把整条夹进视口内**，上下左右都留 8px 间距，无论块贴在哪条边上都能完整显示。
- 工具条在窄窗口下允许折行，并新增 `width:max-content`：修复了 `position:fixed` 只给 `left` 时宽度按「视口减去 left」收缩、越靠右越窄、越窄越折行导致夹取永远收敛不了的问题。
- 8 个缩放手柄（四角 + 四边）在块紧贴屏幕边缘时会被裁到窗口外一半，看着像「按钮超出边框」、实际也点不到；现在手柄中心点会被夹进视口内，贴边时依然可拖。

**修复：调好的输入框尺寸刷新后被打回原样**

- 之前只在插件启动时恢复一次已记住的尺寸，配一个「还有待恢复项」时才工作的 `MutationObserver`；而输入框（composer）等区域由 React 托管，刷新后首屏渲染与后续重渲染会把节点整个换掉或重写行内样式，于是「恢复一次 → React 重建 → 样式丢失」，表现为一刷新就复原。
- 现在改为**常驻**恢复：对每个记住的块挂一个只看 `style` 属性的 `MutationObserver`，节点被 React 换掉或样式被抹掉时自动补写回去；同时把 `MutationObserver` 改为无条件监听整个文档，并记录「已贴到哪个节点」，避免无意义重写与抖动。
- 补扫时机从一次改为两次（400ms / 1500ms），应对首屏挂载两次的块。

**修复：侧栏开「滚动」后滚的是整列，而不是里面的会话列表**

- 滚动模式原先只给「被点中的那一个元素」加 `overflow:auto`。点左侧栏容器时，等于在真正的滚动区外面又套了一层滚动容器，滚轮滚的是外层，看起来就是整列在平移。现在会先找块内部**真正的滚动区**（`overflow-y:auto/scroll` 且确实承担滚动），把滚动交给它；内部没有滚动区时才由块自己滚。
- `[data-rsz-scroll="1"] > *` 这条规则原先连 `flex-grow:0` 一起固定，会把 `flex:1;min-height:0` 的滚动区压成 0 高，整列内容溢出到外层。现在只固定 `flex-shrink`，滚动区能正常撑开。
- 去掉了滚动容器上的 `scrollbar-width:thin`：Chromium 一旦看到非 `auto` 的 `scrollbar-width`，会丢弃该元素上所有 `::-webkit-scrollbar` 规则，滚动条反而变回 UA 默认样式。

**修复：界面升级后已记住的尺寸静默失效**

- 持久化选择器里会拼进 CSS Module 生成的类名（形如 `bdiHEa_root`、`xRI0Kq_input`），前缀哈希随构建变化，升级一次就再也匹配不到。这类哈希类名不再写进持久化键，并给旧键留了一条「去掉哈希段再试」的回落路径。

**其他**

- 版本号推进到 `1.2.2`。

### English

**Fixed: the edit toolbar was cut off at screen edges, putting the last buttons out of reach**

- The seven-button toolbar (collapse / scroll / parent / reset / raise / move / close) that appears while editing a block used a hard-coded `330px` width when clamping itself into the viewport, while its real width grows past 460px with the block label and size readout. With a block near the right or bottom edge, the whole toolbar ran off-screen and its last buttons could not be clicked. It now **measures its own size first and clamps the whole bar inside the viewport** with an 8px margin, so it stays fully visible whichever edge the block hugs.
- The toolbar may wrap on narrow windows, and gained `width:max-content`: this fixes `position:fixed` elements that only set `left`, whose width shrinks as they move right, wrapping more and more so clamping never converged.
- The eight resize handles (four corners and four edges) were half clipped outside the window when a block touched the screen edge, which looked like "buttons outside the border" and made them unclickable. Their centres are now clamped into the viewport so they stay draggable at the edges.

**Fixed: resized composer reverted to its original size after a reload**

- Resize restore used to run once at plugin start, backed by a `MutationObserver` that only worked while a pending set was non-empty. The composer is owned by React, so the first render after a reload, and any later re-render, replaces the node or rewrites its inline style: restore once, React rebuilds, the style is gone — which looks like "it reverts on every refresh".
- Restore is now **resident**: every remembered block gets a `MutationObserver` filtered to the `style` attribute that writes the size back whenever React replaces the node or wipes the style. The document observer now runs unconditionally, and the engine tracks which node a record is applied to so it never fights with itself.
- Two follow-up scans (400ms and 1500ms) cover blocks that mount twice on first paint.

**Fixed: scroll mode on the sidebar scrolled the whole column instead of the session list inside it**

- Scroll mode used to add `overflow:auto` to the single clicked element. Clicking the sidebar container wrapped the real scroll region in a second scroll container, so the wheel scrolled the outer one and the whole column appeared to shift. It now resolves the **real scroll region inside the block** (`overflow-y:auto/scroll` and actually scrolling) and hands scrolling to that; only when there is none does the block scroll itself.
- The `[data-rsz-scroll="1"] > *` rule also pinned `flex-grow:0`, which crushed `flex:1;min-height:0` regions to zero height and pushed the content out to the outer layer. It now pins only `flex-shrink`.
- Dropped `scrollbar-width:thin` on the scroll container: once Chromium sees a non-`auto` `scrollbar-width` it discards every `::-webkit-scrollbar` rule on that element, leaving the UA default bar.

**Fixed: remembered sizes silently stopped applying after a UI upgrade**

- The persisted selector could include CSS Module class names (`bdiHEa_root`, `xRI0Kq_input`), whose hashed prefix changes on every build — one upgrade and it never matches again. Hashed class names are no longer written into storage keys, and existing keys get a fallback that retries after stripping the hashed segments.

**Other**

- Version bumped to `1.2.2`.

## v1.2.1

- 补上 `package.json` 的 `repository` / `homepage` / `bugs` 字段 —— 插件目录靠 `repository` 判断 npm 包是否属于本仓库，缺了会导致市场卡片拿不到新版本号。 / Added `repository`, `homepage`, `bugs` to `package.json`: plugin directories use `repository` to link an npm package to its repo, and without it the market card never picks up a new version.

## v1.2.0

- 悬浮球改为一枚大圆，点击朝屏幕里侧逐颗弹出功能钮，45ms 错峰回弹，闲置 2.4 秒或点别处自动收回，可拖动记忆位置。 / The launcher became a single orb: click to pop the action buttons out towards the screen interior with a 45ms stagger, auto-collapse after 2.4s idle or on outside click, and drag to move.
- 收起态与点选钮换成透明底插画，插件图标同步替换。 / Transparent artwork for the orb and pick button, plus a new plugin icon.
- 修复一条规则漏写闭合括号导致后续 13 条 CSS 规则失效（表现为大圆渲染成圆角方块、展开时小圆不隐藏）。 / Fixed a missing closing brace that swallowed the following 13 CSS rules (the orb rendered as a squircle and the fan buttons never hid).

## v1.1.0

- 自最小化悬浮球、点击展开、左右方向自适应、平滑弹出动画。 / Self-minimising orb launcher with click-to-expand, edge-aware direction and a springy pop animation.

## v1.0.0

- 首个版本：点选任意界面块，拖八个手柄改长宽，可收起、滚动内容、平移、置前、复位与清除，尺寸与会话一起记住。 / First release: pick any UI block, drag its eight handles to resize, collapse it, scroll its content, move it, raise it, reset or clear, with sizes remembered.
