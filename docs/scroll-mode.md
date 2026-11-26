# 滚动模式：为什么滚的是整列，以及怎么修的

> 对应版本：v1.2.2　·　适用代码：`client.js` 的「滚动模式」相关函数
> 本文记录一次真实问题的排查过程与结论，方便以后改这块代码时不再踩同样的坑。

## 现象

在左侧栏这类**容器**上开「滚动」后，滚轮滚动的是整个侧栏（整列一起上下平移），而不是里面的会话列表。面板被挤到 0 高、内容溢出到外层的情况也会出现。

## 结论先说

三个问题**叠加**，缺一个都不会有完整症状：

1. **滚动加错了对象。** 滚动模式原先只给「被点中的那一个元素」加 `overflow:auto`。点中的如果是侧栏容器，等于在真正的滚动区外面又套了一层滚动容器 —— 滚轮滚的是外层，看着就是整列平移。
2. **`flex-grow:0` 压死了内部的滚动区。** 规则 `[data-rsz-scroll="1"] > *{flex-shrink:0;flex-grow:0}` 一律固定子元素的伸缩性，而 DSH 的侧栏滚动区是 `.regionArea{flex:1;min-height:0}` → `.list{flex:1;min-height:0;overflow-y:auto}` 这种「靠 flex 吃剩余高度」的结构，`flex-grow:0` 会让它塌成 0 高。
3. **`scrollbar-width:thin` 把滚动条皮肤弄丢了。** Chromium 一旦在某元素上看到非 `auto` 的 `scrollbar-width`，就会丢弃该元素上**所有** `::-webkit-scrollbar` 规则。DSH 的主题正是用 `::-webkit-scrollbar` 画滚动条的，这一行等于把我们自己的滚动条打回 UA 默认样式。

另外两个隐藏问题也一并修了：

4. `naturals` 里的自然尺寸只采样一次，若首次采到 `0`（元素当时还没布局）就永远不刷新，导致「缩到 50% 以下自动开滚动」的判定永久失效。
5. 持久化选择器里拼进了 CSS Module 的哈希类名（`bdiHEa_root`、`xRI0Kq_input`），哈希前缀随每次构建变化 —— 升级一次，之前记住的尺寸就静默失配。

## 修法

### 1. 把滚动交给真正的滚动区

新增四个判断函数：

| 函数 | 作用 |
| --- | --- |
| `isScrollPort(node)` | 这个元素自己是不是滚动容器：`overflow-y` 为 `auto` / `scroll`，且不是 `display:inline` |
| `findInnerScrollPort(el)` | 在 `el` 内部（最多前 400 个后代）找真正的滚动区：必须是滚动容器、有高度，并且**确实在承担滚动**（已溢出，或靠 flex 吃剩余空间） |
| `scrollHostOf(el)` | 决定滚动该落在谁身上：自己就是滚动容器就用自己，否则用内部找到的那个，都没有才用自己 |
| `hasScrollMode(el)` | 「这块现在是否处于滚动模式」——自己带标记，或它的滚动宿主带标记 |

`applyScrollMode(el, on)` 现在会先解析宿主：宿主不是自己时，把 `data-rsz-scroll="1"` 挂到宿主上，并且**不**在块本身再套一层 `overflow`。

> 只认「确实在承担滚动」是为了避开页面上到处存在的 `overflow:hidden` 装饰盒 —— 见 `overflow` 就当滚动区会误伤。

### 2. `> *` 只固定 `flex-shrink`

```css
[data-rsz-scroll="1"] > *{flex-shrink:0 !important}
```

子元素不再被压扁（`flex-shrink:0`），但 `flex-grow` 交还给框架，滚动区能正常撑开。

### 3. 去掉 `scrollbar-width:thin`

让 DSH 主题的 `::-webkit-scrollbar` 皮肤继续生效。

### 4. `naturals` 允许重采样

采样为 0 时下一轮重新量；量到非 0 才写入。

### 5. 哈希类名不进持久化键

`isHashedClass(name)` 识别「5～8 位大小写混合前缀 + `_` + 语义名」这种 CSS Module 生成名，`classToken` 遇到就跳过；`resolveSelector` 首次匹配失败时会把选择器里的哈希段整体剥掉再试一次，所以**旧版本存下的键仍能继续用**。

## 验证

真机点选时调试信息不好读（UIA 对 DSH 页面暴露的节点有限），所以做了一个复刻 DSH 侧栏真实层级的仿真页来跑确定性验证：

```
.root{display:flex;flex-direction:column;height:320px}
 ├ .top{flex:none;height:40px}
 └ .regionArea{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
    └ .list{flex:1;min-height:0;overflow-y:auto}   ← 30 条会话
```

结果：

| 场景 | 结果 |
| --- | --- |
| 对 `.root` 开滚动 | 落到 `.list`，`listMarked: true` |
| 对 `.regionArea` 开滚动 | 落到 `.list` |
| 对 `.list` 自己开滚动 | 保持 `.list` |
| 对内部没有滚动区的普通高卡片 | 自己滚（行为不变） |
| 布局回归 | 开滚动前后 `regionH` / `listH` 都是 260，未被压 0 |
| 哈希处理 | `isHashedClass('bdiHEa_root')` → true、`'scrollArea'` / `'rsz-orb'` → false |

## 与原分析文档的出入

问题最早由一份外部排查文档（针对 v1.2.0 / 1321 行版本）提出，核对后有几处需要更正，记在这里避免误导后来的维护者：

| 原说法 | 实际情况 |
| --- | --- |
| 依赖 `[data-sidebar-scrollport]` 标记定位滚动区 | 该属性在当前 DSH 版本中**完全不存在**（全仓 grep 0 命中）；真实滚动区是 `WorkspaceBrowser.module.css` 里的 `.list{flex:1;min-height:0;overflow-y:auto}` |
| 框架用 `display:none` 把滚动条藏起来了 | 不成立。框架用 `::-webkit-scrollbar` 皮肤（`packages/client/ui-theme/src/styles/scrollbar.css`），从未隐藏滚动条；是**我们**的 `scrollbar-width:thin` 让皮肤失效 |
| 需要在滚动容器上「恢复」滚动条可见性 | 不需要；去掉 `scrollbar-width` 即可 |
| `> *` 规则同时固定 `flex-shrink` 和 `flex-grow` 会压死滚动区 | 属实，这是最关键的一处 |

## 相关代码位置

- 滚动宿主解析：`client.js` 的 `isScrollPort` / `findInnerScrollPort` / `scrollHostOf` / `hasScrollMode` / `applyScrollMode`
- 持久化：`client.js` 的 `classToken` / `isHashedClass` / `resolveSelector` / `stripHashedClasses`
- CSS：`[data-rsz-scroll="1"]` 相关规则
- 变更记录：[CHANGELOG.md](../CHANGELOG.md) 的 v1.2.2 节
