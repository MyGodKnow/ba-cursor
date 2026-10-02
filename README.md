# BA Cursor

轻量级**指针火花特效**：单文件、零依赖、Canvas 2D。
鼠标按下迸出光环与火星，拖动留下渐隐拖尾；已适配触摸屏，手机端手指点按同样生效。

移植自 **BASpark** 桌面版（WPF + WebView2，MIT License，Copyright (c) 2026 Doom），
在此基础上针对**个人网站 / 移动端**重做了交互层与生命周期管理。

---

## 特性

| 能力 | 说明 |
| --- | --- |
| 滚动也能拖尾 | 触摸走独立的 touch 通道；页面正在滚动时拖尾依旧跟随手指 |
| `destroy()` | 移除全部监听、取消动画帧、摘除 canvas，SPA 路由切换不残留 |
| 容器挂载 | 传入 `target` 只在指定区域生效，不再强制全屏 |
| 移动端省电 | 设备像素比上限默认 2、空闲即停渲染、页面切后台自动暂停 |
| 采样插值 | 快速滑动时按固定间距补插采样点，拖尾是连续曲线而不是折线 |
| 无障碍 | 识别 `prefers-reduced-motion`，自动降级为轻量迸发 |
| 运行时调参 | `setOptions()` 实时改颜色 / 缩放 / 速度，无需重建实例 |
| 脏矩形渲染 | 只重绘变化区域，静止时零 CPU 占用 |

---

## 快速开始

### 方式一：自动初始化（全屏）

把配置写在引入脚本**之前**：

```html
<script>
  window.BACursorConfig = { color: '45,175,255', scale: 1.5 };
</script>
<script src="ba-cursor.js"></script>
```

页面就绪后会自动创建一个覆盖全屏的实例，可从 `window.BACursor.instance` 取到。

### 方式二：手动挂载到容器

```html
<div id="hero" style="height: 320px"></div>
<script src="ba-cursor.js"></script>
<script>
  var fx = new BACursor({ target: '#hero' });   // 或 BACursor.create({ target: '#hero' })
  // 不再需要时：
  fx.destroy();
</script>
```

### 方式三：打包器（Vite / webpack）

`ba-cursor.js` 是 UMD，`import` 时会走 CommonJS 互操作：

```js
import BACursor from './ba-cursor.js';
const fx = new BACursor({ maxDpr: 2 });
```

> 本包未发布到 npm，直接拷贝 `ba-cursor.js` 使用即可；如需 CDN，将它发布到自己的 npm 包或静态资源站。

---

## 配置

```js
window.BACursorConfig = {
  color: '45,175,255',   // 主色，'R,G,B'
  scale: 1.5,            // 整体缩放
  opacity: 1.0,          // 整体不透明度
  trailSpeed: 1.0,       // 拖尾衰减速度，越大消失越快
  clickSpeed: 1.0,       // 点击特效播放速度
  maxTrail: 20,          // 拖尾最大采样点数
  trailAlways: false,    // true = 不按下也有拖尾（悬停即出）
  trailSpawnChance: 0.3, // 拖尾中额外迸出小火星的概率
  sparkCount: 4,         // 每次点击迸出的火星数量
  trailOpacity: 0.5,     // 拖尾浓度，1 = 与主色同浓，越小越淡
  trailColor: null,      // 拖尾单独配色，null = 跟随 color
  trailSpacing: 6,       // 拖尾采样点间距（px），越小越细腻
  maxInterpolation: 8,   // 单次移动最多补插几个采样点
  target: null,          // CSS 选择器或 DOM 元素；为空则全屏
  zIndex: 2147483647,    // canvas 层级
  maxDpr: 2,             // 设备像素比上限
  touch: true,           // 是否响应触摸 / 手写笔
  trailOnScroll: true,   // 触摸滚动页面时是否同时显示拖尾
  moveThreshold: 2,      // 拖动多少像素才记录一个拖尾点
  pauseOnHidden: true,   // 页面切后台时暂停渲染
  reduceMotion: 'auto',  // 'auto' | true | false
  autoInit: true,        // 是否自动初始化
};
```

调淡拖尾：把 `trailOpacity` 往下调（`0.35` 以下基本只剩一层薄光）；想让拖尾换个颜色，单独给 `trailColor` 即可。

### 高级参数

需要更细的调参时用 `advanced`（浅合并，只写要改的键）：

```js
new BACursor({
  target: '#hero',
  advanced: {
    fillGrowRate: 26,    // 填充圆扩散速率
    fillLife: 16,        // 填充圆生命周期（帧）
    ringLife: 23,        // 光环生命周期（帧）
    ringLen: 1.1 * Math.PI,
    ringSegments: 10,    // 光环分段数，越大越平滑也越吃性能
    ringMinWidth: 0.4,
    ringMaxWidth: 3.3,
    trailWidth: 5.0,     // 拖尾线宽
    trailGlow: 0,        // 拖尾发光半径；>0 会逐段做高斯模糊，移动端会明显掉帧
    trailSparkSize: 9,
    trailSparkSpeed: 1.3,
    sparkSizeBase: 4,
    sparkSizeRange: 3,
    sparkSpeedBase: 4.8,
    sparkSpeedRange: 2,
  },
});
```

---

## 方法

| 方法 | 说明 |
| --- | --- |
| `destroy()` | 彻底卸载：移除监听、取消动画帧、摘除 canvas、恢复容器样式 |
| `pause()` / `resume()` | 暂停 / 恢复渲染（保留现场） |
| `clear()` / `clearEffects()` | 立即清空所有特效 |
| `trigger(x, y)` | 在画布坐标系内手动迸发一次特效 |
| `setOptions(patch)` | 运行时改参；改 `target` 或 `zIndex` 会重建 canvas 与事件 |
| `BACursor.create(options)` | `new BACursor(options)` 的语法糖 |
| `BACursor.autoInit()` | 手动触发「读取全局配置并自动初始化」 |
| `BACursor.instance` | 自动初始化产生的全局实例 |

---

## 移动端说明

**滚动和拖尾可以同时存在**。这是本库和多数同类实现最大的不同：页面滚动时浏览器会发出 `pointercancel` 掐断 Pointer Events，但原生 `touchmove` 在滚动期间仍持续派发，所以触摸被单独接到 touch 通道上 —— 手指滑动时页面照常滚动，拖尾一路跟随。

- 拖尾画在固定于视口的画布上，因此手指滚动页面时它不会跟着页面内容走，只反映手指在屏幕上的真实轨迹。
- 不喜欢滚动时出现拖尾，把 `trailOnScroll` 设成 `false` 即可（此时只在按住不动或点按时出特效）。
- 多指手势（双指缩放等）会自动跳过，不影响页面缩放。
- 默认把设备像素比限制在 `2`，3x 屏幕下可省一半以上填充率；追求画质可设 `maxDpr: 3`。
- 系统开启「减弱动态效果」时（`prefers-reduced-motion: reduce`），自动降级：不产生跟随拖尾，火星数量减半。

---

## 浏览器兼容

依赖 `Pointer Events`、`Touch Events`、`requestAnimationFrame`、`matchMedia`。即 Chrome / Edge 55+、Firefox 59+、Safari 13+，含 iOS Safari 与 Android WebView。

`ResizeObserver` 为可选增强，不支持时回退到 `window.resize` 监听。

---

## 许可

[MIT](LICENSE) License · Copyright (c) 2026 MyGodKnow

本项目移植自 **BASpark**（WPF + WebView2 桌面应用，MIT License，Copyright (c) 2026 Doom）。
原始版权声明与许可条款已按 MIT 要求完整保留于 [LICENSE](LICENSE) 中。