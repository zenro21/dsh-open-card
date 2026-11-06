/**
 * dsh-open-card — 拖拽边框调整任意界面块的长宽（Client 半）。
 *
 * 加载走 dsh.client bundle 格式：__ModuleLoader__.load 的 id 必须等于 loader
 * entry 名（包名 dsh-open-card），否则报 "loaded without registering dsh-open-card"。
 *
 * 设计要点：
 * - 只注册一个 `shell.overlay` 条目（frame 级浮层、默认 click-through），
 *   不替换 root、不往 body 追加第二个应用，卸载时全部撤掉。
 * - 尺寸改写只动「被选中的那个元素」的内联样式，并先快照原值以便复位；
 *   选择器写进 localStorage，刷新后自动恢复。
 * - 选中项由用户点选，不靠读别的插件的 DOM 结构猜位置。
 */
window.__ModuleLoader__.load({
  id: 'dsh-open-card',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    const STORAGE_KEY = 'dsh-open-card.sizes.v1'
    const DOCK_KEY = 'dsh-open-card.dock.v1'
    /** 改名前（dsh-resizer）的旧键：只读兜底，升级后老配置不丢。 */
    const LEGACY_STORAGE_KEY = 'dsh-resizer.sizes.v1'
    const LEGACY_DOCK_KEY = 'dsh-resizer.dock.v1'
    const MIN_SIZE = 48
    const MAX_SIZE = 6000
    /** 本插件自己的节点都带这个属性，点选与命中测试一律跳过它们。 */
    const OWN_SEL = '[data-rsz]'
    /** 写内联样式时先快照这些属性，复位时逐个还原。 */
    const STYLE_PROPS = [
      'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
      'transform', 'z-index', 'position',
      /* 收起态用得到，复位时要一并还原。 */
      'overflow', 'padding-top', 'padding-bottom', 'margin-top', 'margin-bottom', 'border-width', 'display',
    ]
    /** 收起后保留的高度：0 等于完全让出位置，但仍然可以选中/展开。 */
    const COLLAPSED_HEIGHT = 0
    /**
     * 收缩超过这个比例就自动切成「滚动模式」：块的外框变小、内容保持原尺寸，
     * 多出来的部分用滚动查看，而不是被压扁或直接截掉。用户原话是「收缩超过 50%」。
     */
    const SCROLL_RATIO = 0.5
    const SCROLL_ATTR = 'data-rsz-scroll'
    const DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

    /* 按钮图标：全部 viewBox 0 0 1024 1024、单色（fill 用 currentColor），
       这样在深色胶囊、品牌色高亮、hover 三种状态下都自动跟随文字颜色，
       不需要为每个状态再准备一套图。 */
    const ICONS = {
      /* 用户给的 1 号图：垃圾桶 = 清除所有记住的尺寸。 */
      trash: ['M896 166.4h-192C697.6 121.6 663.466667 85.333333 618.666667 85.333333H405.333333c-44.8 0-78.933333 36.266667-83.2 81.066667H128c-23.466667 0-42.666667 19.2-42.666667 42.666667s19.2 42.666667 42.666667 42.666666h768c23.466667 0 42.666667-19.2 42.666667-42.666666s-19.2-42.666667-42.666667-42.666667zM192 878.933333c0 32 25.6 59.733333 57.6 59.733334h503.466667c32 0 78.933333-27.733333 78.933333-59.733334V298.666667H192v580.266666z m168.533333-371.2c-17.066667-17.066667-17.066667-42.666667 0-59.733333s42.666667-17.066667 59.733334 0l89.6 89.6 89.6-89.6c17.066667-17.066667 42.666667-17.066667 59.733333 0s17.066667 42.666667 0 59.733333L571.733333 597.333333l89.6 89.6c17.066667 17.066667 17.066667 42.666667 0 59.733334-8.533333 8.533333-19.2 12.8-29.866666 12.8s-21.333333-4.266667-29.866667-12.8L512 657.066667 422.4 746.666667c-8.533333 8.533333-19.2 12.8-29.866667 12.8s-21.333333-4.266667-29.866666-12.8c-17.066667-17.066667-17.066667-42.666667 0-59.733334l89.6-89.6-91.733334-89.6z'],
      /* 用户给的 2 号图：列表 + 播放三角 = 收起 / 展开。 */
      list: ['M985.6 51.2h-947.2a38.4 38.4 0 0 0 0 76.8h947.2a38.4 38.4 0 0 0 0-76.8z m-460.8 281.6h-486.4a38.4 38.4 0 0 0 0 76.8h486.4a38.4 38.4 0 0 0 0-76.8z m0 281.6h-486.4a38.4 38.4 0 0 0 0 76.8h486.4a38.4 38.4 0 0 0 0-76.8z m460.8 281.6h-947.2a38.4 38.4 0 0 0 0 76.8h947.2a38.4 38.4 0 0 0 0-76.8z m18.2016-406.8864l-275.5584-137.7792a25.6 25.6 0 0 0-37.0432 22.8864v275.5584a25.6 25.6 0 0 0 37.0432 22.8864l275.5584-137.7792a25.6 25.6 0 0 0 0-45.7728z'],
      /* 用户给的 3 号图（虚线边框 + 笔）= 边框调整。原来里面是深灰 + 品牌蓝 + 10% 底，
         这里统一成单色、去掉那层 10% 实心底（它只是原图用来压背景的）。
         手型那张只做插件图标 icon.svg，不进按钮。 */
      frame: [
        "M887.815673 583.473895l-32.915462-32.915461 37.424429 37.424428z m47.795053-42.384292l3.607174 2.70538z",
        "M1009.55779 411.682241a31.562771 31.562771 0 0 0-5.861658-5.861657l-28.406494-28.406494-63.576439-65.380026a64.929129 64.929129 0 0 0-90.179346 0l-45.089673 45.089673a9.468831 9.468831 0 0 0 0 2.70538 13.076005 13.076005 0 0 0 0 15.781386s9.017935 9.919728 21.192147 22.093939c36.071738 36.973532 106.411628 106.411628 106.411628 106.411629l35.169945 35.169945 3.607174 2.254483a14.428695 14.428695 0 0 0 8.567038 0 17.584972 17.584972 0 0 0 13.526901-5.861657l41.933396-45.089673a31.562771 31.562771 0 0 0 5.861658-7.665245 63.125542 63.125542 0 0 0-3.156277-71.241683z m-34.268152 45.089673a18.035869 18.035869 0 0 1-4.508967 6.763451l-23.44663 24.79932-119.93853-119.036736 24.79932-25.250217a19.839456 19.839456 0 0 1 13.977799-5.861658 21.643043 21.643043 0 0 1 13.977798 5.861658l90.179346 90.179346a19.388559 19.388559 0 0 1 3.607174 22.544836z",
        "M707.907878 979.361224m22.544836 0l270.087141 0q22.544836 0 22.544837 22.544836l0-0.450896q0 22.544836-22.544837 22.544836l-270.087141 0q-22.544836 0-22.544836-22.544836l0 0.450896q0-22.544836 22.544836-22.544836Z",
        "M895.03002 590.688243l-3.156277-4.508968-37.424428-37.424428-45.089673-45.089673-51.402227-51.402227-27.955598-27.955597a15.781386 15.781386 0 0 0-7.665244-1.803587 18.937663 18.937663 0 0 0-13.526902 5.41076L632.157227 505.919658l-45.089673 45.089673-111.371492 114.527769-47.795054 50.049537L325.547451 820.645575a30.210081 30.210081 0 0 0-9.017935 21.643043V991.986332a32.013668 32.013668 0 0 0 24.79932 30.660978H496.888208a31.562771 31.562771 0 0 0 22.995733-9.919728L541.977881 991.986332l351.699449-378.753253a17.134076 17.134076 0 0 0 1.35269-22.544836z m-403.552573 388.222084H361.619189V847.699379l65.830923-67.63451 48.24595-49.59864 174.947931-180.358692 45.089673-45.089673 26.15201-27.053804 26.602907 26.602907 96.041004 96.041004z",
        "M754.350241 603.313351l-290.828391 311.56964h-37.875325v-41.031602l295.788254-303.904396 32.915462 33.366358zM891.873743 586.179275l-37.424428-37.424428 32.915461 32.915461zM939.2179 543.344086l-3.607174-2.254483z",
        "M886.462982 8.580565a27.504701 27.504701 0 0 0-6.312554-3.156277A45.089673 45.089673 0 0 0 857.605592 0.013527H23.446642a22.544836 22.544836 0 0 0-22.544837 22.544836v953.195687a48.24595 48.24595 0 0 0 48.24595 48.24595h209.66698a378.753253 378.753253 0 0 1-4.959864-45.089673h-207.412496V45.1032H857.605592a3.156277 3.156277 0 0 1 3.156277 3.156277v180.358692h6.312554a135.269019 135.269019 0 0 1 19.388559 0 154.657578 154.657578 0 0 1 20.74125 4.959864v-184.867659a49.59864 49.59864 0 0 0-20.74125-40.129809z",
        "M1023.084692 115.44309v216.43043l-45.089673-45.089673V127.166405L907.204232 78.018661l-20.74125-14.428695-25.701113-18.486766a22.09394 22.09394 0 0 1-9.468831-22.544837 20.74125 20.74125 0 0 1 3.607173-8.567037 22.544836 22.544836 0 0 1 25.250217-9.017935 27.504701 27.504701 0 0 1 6.312554 3.156277l127.152878 90.179346a23.897527 23.897527 0 0 1 9.468832 17.134076z",
        "M458.561986 65.393553h-12.625108a22.544836 22.544836 0 0 0-16.232283 21.643043v90.179346a22.544836 22.544836 0 1 0 45.089673 0v-90.179346a22.544836 22.544836 0 0 0-16.232282-21.643043zM451.798535 250.712109a22.544836 22.544836 0 0 0-22.544836 22.544836v90.179346a22.995733 22.995733 0 0 0 22.544836 22.544837 22.544836 22.544836 0 0 0 22.544837-22.544837v-90.179346a22.544836 22.544836 0 0 0-22.544837-22.544836z m0 185.769452a22.544836 22.544836 0 0 0-22.544836 22.544837v71.69258a22.544836 22.544836 0 0 0 22.544836 22.544836h13.526902a20.290353 20.290353 0 0 0 6.763451-15.781385v-72.143477a22.995733 22.995733 0 0 0-20.290353-28.857391zM101.000879 509.075935H45.991478a20.74125 20.74125 0 0 0-11.272418 4.508967 22.995733 22.995733 0 0 0 0 35.169945 20.74125 20.74125 0 0 0 11.723315 4.508967h54.558504a22.995733 22.995733 0 0 0 22.544837-22.544836 22.544836 22.544836 0 0 0-22.544837-21.643043z m185.769453 0h-90.179346a22.544836 22.544836 0 1 0 0 45.089673h90.179346a22.544836 22.544836 0 0 0 22.544836-22.544837 22.544836 22.544836 0 0 0-22.544836-22.995733z",
        "M475.245165 531.169874a22.544836 22.544836 0 0 1-22.544836 22.544837H381.458645a22.544836 22.544836 0 1 1 0-45.089673H451.798535a22.544836 22.544836 0 0 1 23.44663 22.544836z",
      ],
      /* 工具条剩下六枚按钮的图标，取自 Bootstrap Icons（MIT，16×16 网格）：
         scroll 滚动 / parent 往上一级 / reset 复位 / front 置前 / move 移动 / close 关闭。 */
      scroll: ['M11.5 15a.5.5 0 0 0 .5-.5V2.707l3.146 3.147a.5.5 0 0 0 .708-.708l-4-4a.5.5 0 0 0-.708 0l-4 4a.5.5 0 1 0 .708.708L11 2.707V14.5a.5.5 0 0 0 .5.5m-7-14a.5.5 0 0 1 .5.5v11.793l3.146-3.147a.5.5 0 0 1 .708.708l-4 4a.5.5 0 0 1-.708 0l-4-4a.5.5 0 0 1 .708-.708L4 13.293V1.5a.5.5 0 0 1 .5-.5'],
      parent: ['M6 3.5A1.5 1.5 0 0 1 7.5 2h1A1.5 1.5 0 0 1 10 3.5v1A1.5 1.5 0 0 1 8.5 6v1H14a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0V8h-5v.5a.5.5 0 0 1-1 0V8h-5v.5a.5.5 0 0 1-1 0v-1A.5.5 0 0 1 2 7h5.5V6A1.5 1.5 0 0 1 6 4.5zM8.5 5a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5zM0 11.5A1.5 1.5 0 0 1 1.5 10h1A1.5 1.5 0 0 1 4 11.5v1A1.5 1.5 0 0 1 2.5 14h-1A1.5 1.5 0 0 1 0 12.5zm1.5-.5a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zm4.5.5A1.5 1.5 0 0 1 7.5 10h1a1.5 1.5 0 0 1 1.5 1.5v1A1.5 1.5 0 0 1 8.5 14h-1A1.5 1.5 0 0 1 6 12.5zm1.5-.5a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zm4.5.5a1.5 1.5 0 0 1 1.5-1.5h1a1.5 1.5 0 0 1 1.5 1.5v1a1.5 1.5 0 0 1-1.5 1.5h-1a1.5 1.5 0 0 1-1.5-1.5zm1.5-.5a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5z'],
      reset: [
        'M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2z',
        'M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466',
      ],
      front: ['M0 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2H2a2 2 0 0 1-2-2zm5 10v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2v5a2 2 0 0 1-2 2z'],
      move: ['M7.646.146a.5.5 0 0 1 .708 0l2 2a.5.5 0 0 1-.708.708L8.5 1.707V5.5a.5.5 0 0 1-1 0V1.707L6.354 2.854a.5.5 0 1 1-.708-.708zM8 10a.5.5 0 0 1 .5.5v3.793l1.146-1.147a.5.5 0 0 1 .708.708l-2 2a.5.5 0 0 1-.708 0l-2-2a.5.5 0 0 1 .708-.708L7.5 14.293V10.5A.5.5 0 0 1 8 10M.146 8.354a.5.5 0 0 1 0-.708l2-2a.5.5 0 1 1 .708.708L1.707 7.5H5.5a.5.5 0 0 1 0 1H1.707l1.147 1.146a.5.5 0 0 1-.708.708zM10 8a.5.5 0 0 1 .5-.5h3.793l-1.147-1.146a.5.5 0 0 1 .708-.708l2 2a.5.5 0 0 1 0 .708l-2 2a.5.5 0 0 1-.708-.708L14.293 8.5H10.5A.5.5 0 0 1 10 8'],
      close: ['M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z'],
    }

    /* Bootstrap Icons 是 16×16 网格，用户给的三张是 1024×1024，viewBox 要分开算。 */
    const ICON_VIEW = { scroll: 16, parent: 16, reset: 16, front: 16, move: 16, close: 16 }
    /* 带镂空的图形必须 evenodd，否则中间的孔会被填实。 */
    const ICON_EVENODD = { parent: true, move: true, front: true }

    /** 单色 SVG 图标。size 默认 16；不传 name 时渲染 null，方便按条件隐藏。 */
    function Icon(props) {
      const paths = ICONS[props.name]
      if (!paths) return null
      const size = props.size || 16
      return h('svg', {
        className: 'rsz-ico',
        viewBox: '0 0 ' + (ICON_VIEW[props.name] || 1024) + ' ' + (ICON_VIEW[props.name] || 1024),
        width: size,
        height: size,
        fill: 'currentColor',
        'aria-hidden': 'true',
        focusable: 'false',
      }, paths.map((d, i) => h('path', {
        key: i,
        d: d,
        fillRule: ICON_EVENODD[props.name] ? 'evenodd' : undefined,
      })))
    }

    const CSS = [
      /* 整层 portal 到 body 之后再抬起 z-index：shell.overlay 自带 z-index:20 会
         形成层叠上下文，留在里面永远压不过鲸鱼挂件一类的 high-z 浮层。 */
      '.rsz-layer{position:fixed;inset:0;z-index:2147483000;pointer-events:none}',
      '.rsz-layer > *{pointer-events:auto}',
      /* 悬浮球必须自带实心底色：主题里的 bg-layer token 是半透明的，
         在半透明面板/壁纸上会「隐形」，用户就以为插件没生效。 */
      '.rsz-dock{position:fixed;right:18px;bottom:22px;z-index:2147483500;display:flex;align-items:center;gap:4px;',
      'padding:4px 5px;border-radius:999px;pointer-events:auto;',
      /* width:max-content 是关键：拖到右边缘时 position:fixed + left 的
         收缩适应会把胶囊挤成一条窄带，提示文字竖着断行。 */
      'width:max-content;max-width:calc(100vw - 12px);',
      'background:#191c22;border:1px solid rgba(255,255,255,.18);box-shadow:0 8px 24px rgba(0,0,0,.45);',
      'font:12px/1.2 system-ui,"Segoe UI","Microsoft YaHei",sans-serif;color:#e6e6e6}',
      '.rsz-grip{cursor:grab;padding:0 2px;opacity:.55;font-size:13px;line-height:1;user-select:none;',
      'touch-action:none;color:var(--dsw-alias-label-secondary,#b9bcc4)}',
      '.rsz-grip:hover{opacity:1}',
      '.rsz-dock[data-dragging="1"],.rsz-dock[data-dragging="1"] .rsz-grip{cursor:grabbing}',
      '.rsz-btn{appearance:none;border:1px solid rgba(255,255,255,.16);',
      'background:#2a2f3a;color:inherit;border-radius:999px;',
      'padding:0;height:32px;min-width:32px;display:inline-flex;align-items:center;justify-content:center;',
      'cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25);transition:border-color .12s ease,background .12s ease,transform .12s ease}',
      '.rsz-btn:hover{border-color:var(--dsw-alias-brand-primary,#2b6cf6);transform:translateY(-1px)}',
      '.rsz-btn[data-on="1"]{background:var(--dsw-alias-brand-primary,#2b6cf6);border-color:transparent;color:#fff}',
      '.rsz-act[data-on="1"]{background:var(--dsw-alias-brand-primary,#2b6cf6);color:#fff}',
      /* 图标统一走 currentColor，高亮/悬停时自动跟着文字变白，不用另配色。 */
      '.rsz-ico{display:block;flex:none}',
      '.rsz-btn .rsz-ico{pointer-events:none}',
      '.rsz-aux{opacity:0;pointer-events:none;transition:opacity .12s ease}',
      '.rsz-dock:hover .rsz-aux{opacity:1;pointer-events:auto}',
      '.rsz-hint{max-width:230px;padding:7px 10px;border-radius:9px;background:#22262e;',
      'border:1px solid rgba(255,255,255,.16);box-shadow:0 6px 20px rgba(0,0,0,.25);',
      'color:#b9bcc4;line-height:1.5;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}',
      '.rsz-shield{position:fixed;inset:0;z-index:2147483400;cursor:crosshair;background:transparent}',
      '.rsz-outline{position:fixed;z-index:2147483450;pointer-events:none;box-sizing:border-box;',
      'outline:2px solid var(--dsw-alias-brand-primary,#2b6cf6);outline-offset:-2px;background:rgba(43,108,246,.10);border-radius:3px}',
      '.rsz-box{position:fixed;z-index:2147483600;pointer-events:none;box-sizing:border-box;',
      'outline:1.5px solid var(--dsw-alias-brand-primary,#2b6cf6);outline-offset:-1.5px;border-radius:3px}',
      '.rsz-handle{position:absolute;pointer-events:auto;box-sizing:border-box;background:var(--dsw-alias-brand-primary,#2b6cf6);',
      'border:1px solid rgba(255,255,255,.85);border-radius:3px;box-shadow:0 1px 4px rgba(0,0,0,.35);z-index:2}',
      '.rsz-handle[data-dir="nw"]{left:-5px;top:-5px;width:11px;height:11px;cursor:nwse-resize}',
      '.rsz-handle[data-dir="n"]{left:50%;margin-left:-6px;top:-5px;width:12px;height:10px;cursor:ns-resize}',
      '.rsz-handle[data-dir="ne"]{right:-5px;top:-5px;width:11px;height:11px;cursor:nesw-resize}',
      '.rsz-handle[data-dir="e"]{right:-5px;top:50%;margin-top:-6px;width:10px;height:12px;cursor:ew-resize}',
      '.rsz-handle[data-dir="se"]{right:-5px;bottom:-5px;width:11px;height:11px;cursor:nwse-resize}',
      '.rsz-handle[data-dir="s"]{left:50%;margin-left:-6px;bottom:-5px;width:12px;height:10px;cursor:ns-resize}',
      '.rsz-handle[data-dir="sw"]{left:-5px;bottom:-5px;width:11px;height:11px;cursor:nesw-resize}',
      '.rsz-handle[data-dir="w"]{left:-5px;top:50%;margin-top:-6px;width:10px;height:12px;cursor:ew-resize}',
      '.rsz-bar{position:fixed;z-index:2147483700;display:flex;align-items:center;gap:4px;padding:4px 5px;border-radius:9px;',
      'background:#191c22;border:1px solid rgba(255,255,255,.16);',
      'box-shadow:0 8px 24px rgba(0,0,0,.32);font:12px/1.2 system-ui,"Segoe UI","Microsoft YaHei",sans-serif;',
      'color:#e6e6e6;white-space:nowrap}',
      '.rsz-size{padding:0 6px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#b9bcc4)}',
      '.rsz-act{appearance:none;border:none;background:transparent;color:inherit;border-radius:6px;padding:4px 7px;',
      'font:inherit;cursor:pointer;transition:background .12s ease;display:inline-flex;align-items:center;gap:4px}',
      '.rsz-act:hover{background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.10))}',
      /* 纯图标按钮（关闭）：去掉文字后左右内边距收窄，视觉上才不会比别的按钮胖。 */
      '.rsz-act-icon{padding:4px 6px;opacity:.75}',
      '.rsz-act-icon:hover{opacity:1}',
      '.rsz-tag{max-width:180px;overflow:hidden;text-overflow:ellipsis;padding:0 4px;color:var(--dsw-alias-brand-primary,#6f9bff)}',
      /* 可滚动模式：块被压小后不再把内容压扁，而是保留原尺寸并让内容自己滚。
         用属性选择器而不是改子元素的内联样式，退出时只要摘掉属性就完全还原。 */
      '[data-rsz-scroll="1"]{overflow:auto !important;overscroll-behavior:contain !important;',
      'scrollbar-width:thin}',
      '[data-rsz-scroll="1"] > *{flex-shrink:0 !important;flex-grow:0 !important}',
      '[data-rsz-scroll="1"]::-webkit-scrollbar{width:8px;height:8px}',
      '[data-rsz-scroll="1"]::-webkit-scrollbar-thumb{background:rgba(255,255,255,.22);border-radius:4px}',
    ].join('')

    /* ---------------------------------------------------------------- 工具 */

    function clamp(n) {
      return Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(n)))
    }

    function readStore() {
      try {
        /* 先读新键；没有就回落到旧键，让从 dsh-resizer 升级来的用户保留原有尺寸。 */
        const raw = window.localStorage.getItem(STORAGE_KEY) || window.localStorage.getItem(LEGACY_STORAGE_KEY)
        if (!raw) return {}
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
      } catch (err) {
        return {}
      }
    }

    function writeStore(map) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
        /* 迁移完成后清掉旧键，避免两套数据各记一半。 */
        window.localStorage.removeItem(LEGACY_STORAGE_KEY)
      } catch (err) {
        /* 隐私模式下 localStorage 不可写：本次会话仍然照常调整，只是记不住。 */
      }
    }

    function classToken(el) {
      const raw = el.getAttribute && el.getAttribute('class')
      if (!raw) return ''
      const first = raw.trim().split(/\s+/)[0]
      return first && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(first) ? '.' + first : ''
    }

    /**
     * 生成用于持久化的选择器：优先锚定到最近的 `data-slot` / id 容器，
     * 再往下补 tag+class+:nth-of-type，既能 querySelector 找回，又不会写成
     * 一长串全部依赖 CSS module 哈希的路径。
     */
    function selectorFor(el) {
      const chain = []
      let node = el
      let anchor = null
      let depth = 0
      while (node && node.nodeType === 1 && depth < 40) {
        chain.unshift(node)
        const slot = node.getAttribute && node.getAttribute('data-slot')
        const id = node.id
        if (id) { anchor = '#' + (window.CSS && window.CSS.escape ? window.CSS.escape(id) : id); break }
        if (slot) { anchor = '[data-slot="' + slot + '"]'; break }
        if (node === document.documentElement) { anchor = 'html'; break }
        node = node.parentElement
        depth += 1
      }
      if (!anchor) anchor = 'html'
      const rest = []
      const startIndex = chain.findIndex((n) => {
        if (anchor.charAt(0) === '#') return '#' + n.id === anchor
        if (anchor.charAt(0) === '[') return '[data-slot="' + n.getAttribute('data-slot') + '"]' === anchor
        return n === document.documentElement
      })
      for (let i = Math.max(0, startIndex) + 1; i < chain.length; i += 1) {
        const n = chain[i]
        let seg = n.tagName.toLowerCase() + classToken(n)
        const parent = n.parentElement
        if (parent) {
          const same = Array.prototype.filter.call(parent.children, (c) => c.tagName === n.tagName)
          if (same.length > 1) seg += ':nth-of-type(' + (same.indexOf(n) + 1) + ')'
        }
        rest.push(seg)
      }
      const sel = rest.length > 0 ? anchor + ' > ' + rest.join(' > ') : anchor
      if (chain.length === 0) return ''
      /* 同一选择器可能命中多个节点（列表项），用 DOM 顺序补一个唯一后缀。 */
      try {
        const hits = document.querySelectorAll(sel)
        if (hits.length > 1) {
          const idx = Array.prototype.indexOf.call(hits, el)
          if (idx >= 0) return sel + '::nth(' + idx + ')'
        }
      } catch (err) {
        /* 选择器非法时直接返回，交给调用方兜底 */
      }
      return sel
    }

    function stripIndex(sel) {
      const at = sel.indexOf('::nth(')
      return at < 0 ? sel : sel.slice(0, at)
    }

    function resolveSelector(sel) {
      if (!sel) return null
      const plain = stripIndex(sel)
      try {
        const hits = document.querySelectorAll(plain)
        if (hits.length === 0) return null
        if (sel !== plain) {
          const m = /::nth\((\d+)\)$/.exec(sel)
          const idx = m ? Number(m[1]) : 0
          return hits[idx] || hits[0]
        }
        return hits[0]
      } catch (err) {
        return null
      }
    }

    function describe(el) {
      const slot = el.getAttribute && el.getAttribute('data-slot')
      if (slot) return slot
      if (el.id) return '#' + el.id
      const cls = classToken(el)
      return el.tagName.toLowerCase() + cls
    }

    function makeSnapshot(el) {
      const snap = {}
      for (const prop of STYLE_PROPS) {
        snap[prop] = [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]
      }
      return snap
    }

    function restoreSnapshot(el, snap) {
      for (const prop of STYLE_PROPS) {
        const entry = snap[prop]
        if (!entry) continue
        if (entry[0]) el.style.setProperty(prop, entry[0], entry[1] || '')
        else el.style.removeProperty(prop)
      }
    }

    function clearOwnProps(el) {
      for (const prop of STYLE_PROPS) el.style.removeProperty(prop)
    }

    /* ------------------------------------------------------------ 引擎 */

    function createEngine() {
      let state = {
        picking: false,
        editing: false,
        rect: null,
        hover: null,
        size: null,
        label: '',
        collapsed: false,
        collapsedTotal: 0,
        scrolling: false,
      }
      let selEl = null
      let selKey = ''
      let sizes = readStore()
      const snapshots = new WeakMap()
      /** 收起前的 height/max-height/min-height，展开时按原样还回去。 */
      const preCollapse = new WeakMap()
      /** 元素被改之前的自然尺寸，用来判断「缩到 50% 以下」，并给滚动模式当内容基准。 */
      const naturals = new WeakMap()
      const listeners = new Set()

      const emit = () => {
        for (const fn of Array.from(listeners)) {
          try { fn() } catch (err) { /* 单个订阅者出错不影响其它 */ }
        }
      }
      const setState = (patch) => {
        state = Object.assign({}, state, patch)
        emit()
      }

      function ensureSnapshot(el) {
        if (!snapshots.has(el)) snapshots.set(el, makeSnapshot(el))
        /* 记下没被改之前的自然尺寸，收缩比例以它为基准。 */
        if (!naturals.has(el)) {
          naturals.set(el, { w: el.offsetWidth || 0, h: el.offsetHeight || 0 })
        }
      }

      /**
       * 滚动模式：外框按新尺寸裁掉，内容保持原来的自然大小，多出来的部分上下滑动查看。
       * 只挂一个 data 属性，退出时摘掉即可完全还原，不碰子元素的内联样式。
       */
      function applyScrollMode(el, on) {
        if (!el) return
        if (on) el.setAttribute(SCROLL_ATTR, '1')
        else el.removeAttribute(SCROLL_ATTR)
      }

      /**
       * 是否该进滚动模式：尺寸缩到自然尺寸的一半以下，内容留在原大小才不至于被压扁。
       * 用户在工具条上手动开关过就听用户的（rec.s）。
       */
      function shouldScroll(el, w, h) {
        const nat = naturals.get(el)
        if (!nat) return false
        const tw = typeof w === 'number' ? w : null
        const th = typeof h === 'number' ? h : null
        const shrinkW = tw !== null && nat.w > 0 && tw / nat.w < SCROLL_RATIO
        const shrinkH = th !== null && nat.h > 0 && th / nat.h < SCROLL_RATIO
        return shrinkW || shrinkH
      }

      function applySize(el, w, h, rec) {
        if (!el) return
        ensureSnapshot(el)
        if (typeof w === 'number') {
          el.style.setProperty('width', w + 'px', 'important')
          el.style.setProperty('max-width', 'none', 'important')
          el.style.setProperty('min-width', '0px', 'important')
        }
        if (typeof h === 'number') {
          el.style.setProperty('height', h + 'px', 'important')
          el.style.setProperty('max-height', 'none', 'important')
          el.style.setProperty('min-height', '0px', 'important')
        }
        /* 手动开关优先，否则按「缩到 50% 以下」自动判定。 */
        const manual = rec ? rec.s : undefined
        if (manual === true) applyScrollMode(el, true)
        else if (manual === false) applyScrollMode(el, false)
        else applyScrollMode(el, shouldScroll(el, w, h))
      }

      function applyMove(el, x, y) {
        if (!el) return
        ensureSnapshot(el)
        if (x === 0 && y === 0) el.style.removeProperty('transform')
        else el.style.setProperty('transform', 'translate(' + x + 'px,' + y + 'px)', 'important')
      }

      /** 全部展开：收起后元素高度为 0，点不到它本身，用这个出口统一恢复。 */
      function expandAll() {
        let n = 0
        for (const key of Object.keys(sizes)) {
          const rec = sizes[key]
          if (!rec || rec.c !== true) continue
          const el = resolveSelector(key)
          if (el) applyCollapse(el, false)
          delete rec.c
          n += 1
        }
        if (n > 0) writeStore(sizes)
        if (selEl && state.collapsed) setState({ collapsed: false })
        if (n > 0) sync()
        refreshTotals()
        return n
      }

      function collapsedCount() {
        return Object.keys(sizes).filter((key) => sizes[key] && sizes[key].c === true).length
      }

      /** 收起总数进 state，UI 才能亮出「还有 N 个收起」的入口。 */
      function refreshTotals() {
        const n = collapsedCount()
        if (state.collapsedTotal !== n) setState({ collapsedTotal: n })
      }

      /**
       * 收起：把块压成一条 0 高度的横带，让出它占的位置。
       * 只是改内联样式，随时能一键展开；比「隐藏」稳妥——块还在，其它
       * 依赖它的布局不会塌。
       */
      function applyCollapse(el, on) {
        if (!el) return
        ensureSnapshot(el)
        if (!on) {
          for (const prop of ['overflow', 'padding-top', 'padding-bottom', 'margin-top', 'margin-bottom', 'border-width']) {
            el.style.removeProperty(prop)
          }
          /* 收起来时压掉的高度必须还原，否则元素一直是 0 高，
             下一步拖边框就会拿 0 当基准 → 「上下缩不回去」的 bug。 */
          const saved = preCollapse.get(el)
          if (saved) {
            for (const prop of ['height', 'max-height', 'min-height']) {
              const entry = saved[prop]
              if (entry && entry[0]) el.style.setProperty(prop, entry[0], entry[1] || '')
              else el.style.removeProperty(prop)
            }
            preCollapse.delete(el)
          } else {
            for (const prop of ['height', 'max-height', 'min-height']) el.style.removeProperty(prop)
          }
          return
        }
        const before = {}
        for (const prop of ['height', 'max-height', 'min-height']) {
          before[prop] = [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]
        }
        preCollapse.set(el, before)
        el.style.setProperty('height', COLLAPSED_HEIGHT + 'px', 'important')
        el.style.setProperty('max-height', COLLAPSED_HEIGHT + 'px', 'important')
        el.style.setProperty('min-height', '0px', 'important')
        el.style.setProperty('overflow', 'hidden', 'important')
        el.style.setProperty('padding-top', '0px', 'important')
        el.style.setProperty('padding-bottom', '0px', 'important')
        el.style.setProperty('margin-top', '0px', 'important')
        el.style.setProperty('margin-bottom', '0px', 'important')
        el.style.setProperty('border-width', '0px', 'important')
      }

      /** 上溯一层：点选常落在最内层的 span/文本节点上，用这个按钮换成整块容器。 */
      function selectParent() {
        if (!selEl) return
        let node = selEl.parentElement
        while (node && (node.closest(OWN_SEL) || node === document.body || node === document.documentElement)) {
          node = node.parentElement
        }
        if (!node) return
        select(node)
      }

      function sync() {
        if (!selEl || !selEl.isConnected) {
          if (selEl && !selEl.isConnected) {
            selEl = null
            setState({ editing: false, rect: null, size: null, label: '', collapsed: false })
          }
          return
        }
        const r = selEl.getBoundingClientRect()
        setState({
          rect: { top: r.top, left: r.left, width: r.width, height: r.height },
          size: { w: Math.round(r.width), h: Math.round(r.height) },
        })
      }

      function persist() {
        if (!selEl || !selKey) return
        const r = selEl.getBoundingClientRect()
        const prev = sizes[selKey] || {}
        const rec = {
          w: Math.round(r.width),
          h: Math.round(r.height),
          x: typeof prev.x === 'number' ? prev.x : 0,
          y: typeof prev.y === 'number' ? prev.y : 0,
          z: prev.z === true,
        }
        if (prev.c === true) rec.c = true
        /* 手动滚动开关要跟着记录走，否则拖一次尺寸就被自动判定覆盖掉。 */
        if (prev.s === true || prev.s === false) rec.s = prev.s
        sizes[selKey] = rec
        writeStore(sizes)
      }

      function select(el) {
        if (!el || el.nodeType !== 1) return
        if (el.closest && el.closest(OWN_SEL)) return
        if (el === document.body || el === document.documentElement) return
        selEl = el
        selKey = selectorFor(el)
        const rec = sizes[selKey] || {}
        setState({
          picking: false,
          editing: true,
          hover: null,
          label: describe(el),
          collapsed: rec.c === true,
          scrolling: el.getAttribute(SCROLL_ATTR) === '1',
        })
        sync()
        watchSelection()
      }

      function clearSelection() {
        selEl = null
        selKey = ''
        setState({ editing: false, rect: null, size: null, hover: null, label: '', collapsed: false })
      }

      /** 收起 / 展开当前选中的块。 */
      function toggleCollapse() {
        if (!selEl) return
        const next = !state.collapsed
        applyCollapse(selEl, next)
        if (selKey) {
          const rec = sizes[selKey] || {}
          if (next) rec.c = true
          else delete rec.c
          sizes[selKey] = rec
          writeStore(sizes)
        }
        setState({ collapsed: next })
        sync()
        refreshTotals()
      }

      /** 手动开关滚动模式；记进 rec.s，之后自动判断就不再覆盖用户的选择。 */
      function toggleScroll() {
        if (!selEl) return
        const on = selEl.getAttribute(SCROLL_ATTR) !== '1'
        applyScrollMode(selEl, on)
        if (selKey) {
          const rec = sizes[selKey] || {}
          rec.s = on
          sizes[selKey] = rec
          writeStore(sizes)
        }
        setState({ scrolling: on })
      }

      function startResize(dir, ev) {
        if (!selEl) return
        ev.preventDefault()
        ev.stopPropagation()
        const target = selEl
        /* 收起状态下拖边框 = 想改大小，先把收起撤掉，再按真实尺寸算基准。 */
        if (state.collapsed) {
          applyCollapse(target, false)
          if (selKey) {
            const rec = sizes[selKey] || {}
            delete rec.c
            sizes[selKey] = rec
            writeStore(sizes)
          }
          setState({ collapsed: false })
        }
        const startX = ev.clientX
        const startY = ev.clientY
        const r0 = target.getBoundingClientRect()
        ensureSnapshot(target)
        /* 基准尺寸必须是「能看见的真实尺寸」：元素被压成 0 高时拿 0 当基准，
           往下拖永远算不出正数，表现就是「上下拖不动」。这时回退到自然尺寸。 */
        const nat = naturals.get(target)
        let w0 = r0.width
        let h0 = r0.height
        if (h0 < 8) h0 = nat && nat.h > 8 ? nat.h : 120
        if (w0 < 8) w0 = nat && nat.w > 8 ? nat.w : 160
        let w = w0
        let hgt = h0
        let frame = 0
        const flush = () => {
          frame = 0
          applySize(target, w, hgt, sizes[selKey])
          sync()
        }
        const onMove = (e) => {
          const dx = e.clientX - startX
          const dy = e.clientY - startY
          let nw = w0
          let nh = h0
          if (dir.indexOf('e') >= 0) nw = w0 + dx
          if (dir.indexOf('w') >= 0) nw = w0 - dx
          if (dir.indexOf('s') >= 0) nh = h0 + dy
          if (dir.indexOf('n') >= 0) nh = h0 - dy
          w = clamp(nw)
          hgt = clamp(nh)
          if (!frame) frame = window.requestAnimationFrame(flush)
        }
        const onUp = () => {
          window.removeEventListener('pointermove', onMove, true)
          window.removeEventListener('pointerup', onUp, true)
          if (frame) {
            window.cancelAnimationFrame(frame)
            frame = 0
          }
          applySize(target, w, hgt, sizes[selKey])
          sync()
          persist()
          setState({ scrolling: target.getAttribute(SCROLL_ATTR) === '1' })
        }
        window.addEventListener('pointermove', onMove, true)
        window.addEventListener('pointerup', onUp, true)
      }

      function startMove(ev) {
        if (!selEl) return
        ev.preventDefault()
        ev.stopPropagation()
        const target = selEl
        const startX = ev.clientX
        const startY = ev.clientY
        const base = sizes[selKey] || {}
        const ox = typeof base.x === 'number' ? base.x : 0
        const oy = typeof base.y === 'number' ? base.y : 0
        ensureSnapshot(target)
        let x = ox
        let y = oy
        let frame = 0
        const flush = () => {
          frame = 0
          applyMove(target, x, y)
          sync()
        }
        const onMove = (e) => {
          x = ox + (e.clientX - startX)
          y = oy + (e.clientY - startY)
          if (!frame) frame = window.requestAnimationFrame(flush)
        }
        const onUp = () => {
          window.removeEventListener('pointermove', onMove, true)
          window.removeEventListener('pointerup', onUp, true)
          if (frame) {
            window.cancelAnimationFrame(frame)
            frame = 0
          }
          applyMove(target, x, y)
          if (selKey) {
            const rec = sizes[selKey] || { w: Math.round(target.getBoundingClientRect().width), h: Math.round(target.getBoundingClientRect().height) }
            rec.x = Math.round(x)
            rec.y = Math.round(y)
            sizes[selKey] = rec
            writeStore(sizes)
          }
          sync()
        }
        window.addEventListener('pointermove', onMove, true)
        window.addEventListener('pointerup', onUp, true)
      }

      function raise() {
        if (!selEl) return
        ensureSnapshot(selEl)
        const computed = window.getComputedStyle(selEl)
        if (computed.position === 'static') selEl.style.setProperty('position', 'relative', 'important')
        selEl.style.setProperty('z-index', '9999', 'important')
        if (selKey) {
          const rec = sizes[selKey] || {}
          rec.z = true
          sizes[selKey] = rec
          writeStore(sizes)
        }
      }

      function resetCurrent() {
        if (!selEl) return
        applyCollapse(selEl, false)
        applyScrollMode(selEl, false)
        const snap = snapshots.get(selEl)
        if (snap) restoreSnapshot(selEl, snap)
        else clearOwnProps(selEl)
        snapshots.delete(selEl)
        preCollapse.delete(selEl)
        naturals.delete(selEl)
        if (selKey) {
          delete sizes[selKey]
          writeStore(sizes)
        }
        setState({ collapsed: false, scrolling: false })
        sync()
      }

      function clearAll() {
        const touched = new Set()
        for (const key of Object.keys(sizes)) {
          const el = resolveSelector(key)
          if (el) touched.add(el)
        }
        if (selEl) touched.add(selEl)
        touched.forEach((el) => {
          applyCollapse(el, false)
          applyScrollMode(el, false)
          const snap = snapshots.get(el)
          if (snap) restoreSnapshot(el, snap)
          else clearOwnProps(el)
          snapshots.delete(el)
          naturals.delete(el)
        })
        sizes = {}
        writeStore(sizes)
        setState({ collapsed: false, scrolling: false })
        if (selEl) sync()
        refreshTotals()
      }

      /* 恢复：元素可能晚于插件挂载（面板懒加载），用 childList 观察补齐。 */
      let pending = new Set()
      let restoreTimer = 0
      function scanRestore() {
        if (pending.size === 0) return
        const done = []
        pending.forEach((key) => {
          const el = resolveSelector(key)
          if (!el) return
          const rec = sizes[key]
          if (!rec) { done.push(key); return }
          if (typeof rec.w === 'number' && typeof rec.h === 'number') applySize(el, rec.w, rec.h)
          /* 恢复时 sizes[selKey] 不一定是这个 key，手动的滚动开关要单独补一次。 */
          if (rec.s === true) applyScrollMode(el, true)
          else if (rec.s === false) applyScrollMode(el, false)
          if ((rec.x || rec.y) && (rec.x !== 0 || rec.y !== 0)) applyMove(el, rec.x || 0, rec.y || 0)
          if (rec.c === true) applyCollapse(el, true)
          if (rec.z) {
            const computed = window.getComputedStyle(el)
            if (computed.position === 'static') el.style.setProperty('position', 'relative', 'important')
            el.style.setProperty('z-index', '9999', 'important')
          }
          done.push(key)
        })
        done.forEach((key) => pending.delete(key))
      }
      function scheduleRestore() {
        if (restoreTimer) return
        restoreTimer = window.setTimeout(() => {
          restoreTimer = 0
          scanRestore()
          refreshTotals()
        }, 350)
      }

      const observer = new MutationObserver(() => {
        if (pending.size > 0) scheduleRestore()
      })

      /* 命中测试：跳过本插件节点与根节点。 */
      function targetAt(x, y) {
        const nodes = document.elementsFromPoint(x, y)
        for (const node of nodes) {
          if (!(node instanceof Element)) continue
          if (node.closest(OWN_SEL)) continue
          if (node === document.documentElement || node === document.body) continue
          return node
        }
        return null
      }

      let hoverFrame = 0
      function trackHover(x, y) {
        if (hoverFrame) return
        hoverFrame = window.requestAnimationFrame(() => {
          hoverFrame = 0
          const el = targetAt(x, y)
          if (!el) return
          const r = el.getBoundingClientRect()
          setState({
            hover: { top: r.top, left: r.left, width: r.width, height: r.height, label: describe(el) },
          })
        })
      }

      function enterPick() {
        clearSelection()
        setState({ picking: true, hover: null })
      }

      function exitPick() {
        setState({ picking: false, hover: null })
      }

      function toggleDock() {
        if (state.picking) exitPick()
        else enterPick()
      }

      function onKeyDown(ev) {
        if (ev.key === 'Escape') {
          if (state.picking) { exitPick(); return }
          if (state.editing) { clearSelection(); return }
        }
        if (ev.altKey && !ev.ctrlKey && !ev.metaKey && (ev.key === 'r' || ev.key === 'R')) {
          /* Alt+R：进入/退出点选模式；输入框里也允许，靠 alt 区分。 */
          ev.preventDefault()
          if (state.picking) exitPick()
          else enterPick()
        }
      }

      function onViewportChange() {
        if (state.editing) sync()
        if (state.picking && state.hover) setState({ hover: null })
      }

      let resizeObserver = null
      function watchSelection() {
        if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null }
        if (!selEl || typeof window.ResizeObserver !== 'function') return
        resizeObserver = new window.ResizeObserver(() => { if (state.editing) sync() })
        resizeObserver.observe(selEl)
      }

      function start() {
        pending = new Set(Object.keys(sizes))
        scanRestore()
        refreshTotals()
        if (pending.size > 0) observer.observe(document.body, { childList: true, subtree: true })
        window.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('resize', onViewportChange, true)
        window.addEventListener('scroll', onViewportChange, true)
        /* 面板懒加载：只有当还有没恢复的条目时才继续观察。 */
        window.setTimeout(() => {
          if (pending.size > 0) scheduleRestore()
        }, 800)
      }

      function dispose() {
        window.removeEventListener('keydown', onKeyDown, true)
        window.removeEventListener('resize', onViewportChange, true)
        window.removeEventListener('scroll', onViewportChange, true)
        observer.disconnect()
        if (resizeObserver) resizeObserver.disconnect()
        if (restoreTimer) window.clearTimeout(restoreTimer)
        if (hoverFrame) window.cancelAnimationFrame(hoverFrame)
        listeners.clear()
      }

      const api = {
        start,
        dispose,
        getSnapshot: () => state,
        subscribe: (fn) => {
          listeners.add(fn)
          return () => { listeners.delete(fn) }
        },
        toggleDock,
        enterPick,
        exitPick,
        select,
        clearSelection,
        startResize,
        startMove,
        raise,
        resetCurrent,
        toggleCollapse,
        toggleScroll,
        selectParent,
        expandAll,
        collapsedCount,
        clearAll,
        targetAt,
        trackHover,
        onSelectAt: (x, y) => {
          const el = targetAt(x, y)
          if (el) select(el)
        },
        watchSelection,
        storedCount: () => Object.keys(sizes).length,
      }
      /* 选中状态变化后让 ResizeObserver 跟上新元素。 */
      api.clearSelection = () => { clearSelection(); watchSelection() }
      api.resetCurrent = () => { resetCurrent(); watchSelection() }
      return api
    }

    /* -------------------------------------------------------------- UI */

    function useSnapshot(api) {
      const subscribe = React.useCallback((cb) => api.subscribe(cb), [api])
      const get = React.useCallback(() => api.getSnapshot(), [api])
      if (typeof React.useSyncExternalStore === 'function') {
        return React.useSyncExternalStore(subscribe, get, get)
      }
      const [snap, setSnap] = React.useState(get)
      React.useEffect(() => api.subscribe(() => setSnap(get())), [api, get])
      return snap
    }

    function readDockPos() {
      try {
        const raw = window.localStorage.getItem(DOCK_KEY) || window.localStorage.getItem(LEGACY_DOCK_KEY)
        if (!raw) return null
        const p = JSON.parse(raw)
        if (p && typeof p.x === 'number' && typeof p.y === 'number') return p
        return null
      } catch (err) {
        return null
      }
    }

    function writeDockPos(pos) {
      try {
        if (pos) window.localStorage.setItem(DOCK_KEY, JSON.stringify(pos))
        else window.localStorage.removeItem(DOCK_KEY)
        window.localStorage.removeItem(LEGACY_DOCK_KEY)
      } catch (err) {
        /* 记不住就本次会话有效 */
      }
    }

    function ResizerUI(props) {
      const api = props.api
      const snap = useSnapshot(api)
      /* 悬浮球的落点：默认右下角，用户拖过就记住。 */
      const [dockPos, setDockPos] = React.useState(readDockPos)

      const startDockDrag = React.useCallback((ev) => {
        if (ev.button !== 0) return
        ev.preventDefault()
        ev.stopPropagation()
        const el = ev.currentTarget.closest('.rsz-dock')
        if (!el) return
        const r0 = el.getBoundingClientRect()
        const dx0 = ev.clientX - r0.left
        const dy0 = ev.clientY - r0.top
        if (el.setAttribute) el.setAttribute('data-dragging', '1')
        const onMove = (e) => {
          const w = el.offsetWidth || r0.width
          const hgt = el.offsetHeight || r0.height
          const nx = Math.max(4, Math.min(window.innerWidth - w - 4, e.clientX - dx0))
          const ny = Math.max(4, Math.min(window.innerHeight - hgt - 4, e.clientY - dy0))
          setDockPos({ x: Math.round(nx), y: Math.round(ny) })
        }
        const onUp = () => {
          window.removeEventListener('pointermove', onMove, true)
          window.removeEventListener('pointerup', onUp, true)
          if (el.removeAttribute) el.removeAttribute('data-dragging')
          setDockPos((cur) => {
            writeDockPos(cur)
            return cur
          })
        }
        window.addEventListener('pointermove', onMove, true)
        window.addEventListener('pointerup', onUp, true)
      }, [])

      const dockStyle = dockPos
        ? { left: dockPos.x, top: dockPos.y, right: 'auto', bottom: 'auto' }
        : null
      /* 记住的落点可能超出当前视口（窗口变小、提示语变长把胶囊撑宽），
         所以渲染后按真实尺寸夹一次；提示出现/消失、按钮增减都会重算。
         夹紧后写回 state 而不是直接改 el.style——直接改会被下一次 React
         渲染的 style 覆盖掉，位置又跑回视口外。 */
      const dockRef = React.useRef(null)
      React.useEffect(() => {
        if (!dockPos) return undefined
        const el = dockRef.current
        if (!el) return undefined
        const fix = () => {
          const w = el.offsetWidth
          const h = el.offsetHeight
          if (!w || !h) return
          const nx = Math.max(4, Math.min(Math.max(4, window.innerWidth - w - 4), dockPos.x))
          const ny = Math.max(4, Math.min(Math.max(4, window.innerHeight - h - 4), dockPos.y))
          if (Math.abs(nx - dockPos.x) < 1 && Math.abs(ny - dockPos.y) < 1) return
          const next = { x: Math.round(nx), y: Math.round(ny) }
          writeDockPos(next)
          setDockPos(next)
        }
        fix()
        let ro = null
        if (typeof ResizeObserver === 'function') {
          ro = new ResizeObserver(fix)
          ro.observe(el)
        }
        window.addEventListener('resize', fix)
        return () => {
          if (ro) ro.disconnect()
          window.removeEventListener('resize', fix)
        }
      }, [dockPos, snap.picking, snap.editing, snap.collapsedTotal])
      const actions = [
        h('button', {
          key: 'toggle-collapse',
          type: 'button',
          className: 'rsz-act',
          'data-on': snap.collapsed ? '1' : undefined,
          title: snap.collapsed ? '展开这个块，恢复原来的高度' : '收起这个块：压成一条，让出它挡住的区域',
          onClick: () => api.toggleCollapse(),
        }, h(Icon, { name: 'list', size: 14 }), h('span', null, snap.collapsed ? '展开' : '收起')),
        h('button', {
          key: 'scroll',
          type: 'button',
          className: 'rsz-act',
          'data-on': snap.scrolling ? '1' : undefined,
          title: snap.scrolling
            ? '内容滚动：块缩小后内容保持原大小，可上下滚动查看（点击关闭）'
            : '内容滚动：块缩小后内容保持原大小，不被压扁或截断',
          onClick: () => api.toggleScroll(),
        }, h(Icon, { name: 'scroll', size: 14 }), h('span', null, '滚动')),
        h('button', {
          key: 'parent',
          type: 'button',
          className: 'rsz-act',
          title: '往上一级：选中包含这一小块的外层容器',
          onClick: () => api.selectParent(),
        }, h(Icon, { name: 'parent', size: 14 }), h('span', null, '外')),
        h('button', {
          key: 'reset',
          type: 'button',
          className: 'rsz-act',
          title: '复位这个块的尺寸与位置',
          onClick: () => api.resetCurrent(),
        }, h(Icon, { name: 'reset', size: 14 }), h('span', null, '复位')),
        h('button', {
          key: 'raise',
          type: 'button',
          className: 'rsz-act',
          title: '把这个块提到最前，避免被别的面板盖住',
          onClick: () => api.raise(),
        }, h(Icon, { name: 'front', size: 14 }), h('span', null, '置前')),
        h('button', {
          key: 'move',
          type: 'button',
          className: 'rsz-act',
          style: { cursor: 'move' },
          title: '按住拖动：整体平移这个块',
          onPointerDown: (ev) => api.startMove(ev),
        }, h(Icon, { name: 'move', size: 14 }), h('span', null, '移动')),
        h('button', {
          key: 'close',
          type: 'button',
          className: 'rsz-act rsz-act-icon',
          title: '取消选中（Esc）',
          onClick: () => api.clearSelection(),
        }, h(Icon, { name: 'close', size: 13 })),
      ]

      const children = []

      if (snap.picking && snap.hover) {
        children.push(h('div', {
          key: 'hover',
          className: 'rsz-outline',
          style: {
            top: snap.hover.top,
            left: snap.hover.left,
            width: snap.hover.width,
            height: snap.hover.height,
          },
        }))
      }

      if (snap.editing && snap.rect) {
        const box = snap.rect
        children.push(h('div', {
          key: 'box',
          'data-rsz': 'box',
          className: 'rsz-box',
          style: { top: box.top, left: box.left, width: box.width, height: box.height },
        }, DIRS.map((dir) => h('div', {
          key: dir,
          'data-rsz': 'handle',
          'data-dir': dir,
          className: 'rsz-handle',
          onPointerDown: (ev) => api.startResize(dir, ev),
        }))))
        const barTop = box.top >= 46 ? box.top - 40 : box.top + box.height + 8
        const barLeft = Math.max(8, Math.min(box.left, window.innerWidth - 330))
        children.push(h('div', {
          key: 'bar',
          'data-rsz': 'bar',
          className: 'rsz-bar',
          style: { top: barTop, left: barLeft },
        },
        h('span', { className: 'rsz-tag', title: snap.label }, snap.label || '已选中'),
        h('span', { className: 'rsz-size' }, (snap.size ? snap.size.w + ' × ' + snap.size.h : '—')),
        actions))
      }

      if (snap.picking) {
        children.push(h('div', {
          key: 'shield',
          'data-rsz': 'shield',
          className: 'rsz-shield',
          onPointerMove: (ev) => api.trackHover(ev.clientX, ev.clientY),
          onPointerDown: (ev) => api.onSelectAt(ev.clientX, ev.clientY),
        }))
      }

      children.push(h('div', {
        key: 'dock',
        'data-rsz': 'dock',
        ref: dockRef,
        className: 'rsz-dock',
        style: dockStyle || undefined,
      },
        h('span', {
          key: 'grip',
          className: 'rsz-grip',
          title: '按住拖动：把悬浮球挪到不遮挡的位置',
          onPointerDown: startDockDrag,
        }, '⠿'),
        snap.picking || snap.editing
          ? h('div', { className: 'rsz-hint' },
            snap.picking
              ? '点一下要调整的块；Esc 退出'
              : '拖动边角改长宽 · Esc 取消')
          : null,
        h('button', {
          key: 'clear',
          type: 'button',
          className: 'rsz-btn rsz-aux',
          title: '清除所有已记住的尺寸',
          onClick: () => { api.clearAll() },
        }, h(Icon, { name: 'trash', size: 15 })),
        snap.collapsedTotal > 0
          ? h('button', {
            key: 'expand-all',
            type: 'button',
            className: 'rsz-btn',
            title: '把' + snap.collapsedTotal + ' 个收起的块全部展开，恢复原样',
            onClick: () => { api.expandAll() },
          }, h(Icon, { name: 'list', size: 15 }))
          : null,
        h('button', {
          key: 'toggle',
          type: 'button',
          className: 'rsz-btn',
          'data-on': snap.picking ? '1' : undefined,
          title: '边框调整：点选任意块后拖边框改长宽（Alt+R）',
          onClick: () => api.toggleDock(),
        }, h(Icon, { name: 'frame', size: 16 }))))

      /* portal 到 body：脱离 shell.overlay 的 z-index:20 层叠上下文，
         否则被鲸鱼挂件这类 high-z 浮层压住，正是本插件要解决的问题。 */
      if (typeof document === 'undefined') return h(React.Fragment, null, children)
      return ReactDOM.createPortal(
        h('div', { className: 'rsz-layer', 'data-rsz': 'layer' }, children),
        document.body,
      )
    }

    /* ------------------------------------------------------------ 挂载 */

    const inject = ['slots']

    function apply(ctx) {
      const styleEl = document.createElement('style')
      styleEl.setAttribute('data-plugin', 'dsh-open-card')
      styleEl.textContent = CSS
      document.head.appendChild(styleEl)
      ctx.effect(() => () => { styleEl.remove() }, 'dsh-open-card: styles')

      const engine = createEngine()
      engine.start()
      ctx.effect(() => () => { engine.dispose() }, 'dsh-open-card: engine')

      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'resizer', order: 60, label: '边框调整' },
        () => h(ResizerUI, { api: engine }),
      ))
    }

    exports.apply = apply
    exports.inject = inject
    exports.__test = { clamp, selectorFor, describe, classToken, stripIndex }
    return module.exports
  },
})
