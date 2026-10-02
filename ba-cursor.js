/**
 * BA Cursor — 轻量级指针火花特效
 * 单文件 / 零依赖 / Canvas 2D，鼠标、触摸、手写笔通用。
 *
 * 移植自 BASpark（WPF + WebView2 桌面应用，MIT License, Copyright (c) 2026 Doom），
 * 并针对「个人网站 + 移动端」做了以下改造：
 *   - 鼠标 / 手写笔走 Pointer Events，触摸走 Touch Events。
 *     触摸单独走 touch 通道的原因：页面滚动时浏览器会发出 pointercancel
 *     掐断 pointermove，而 touchmove 在滚动期间仍持续派发 —— 所以手机上
 *     「一边滚动页面、一边显示拖尾」是可以并存的。
 *   - destroy()：SPA 路由切换可安全卸载，不留全屏 canvas 与事件监听
 *   - target 选项：可挂载到任意容器，而非只能铺满全屏
 *   - prefers-reduced-motion 自动降级；页面隐藏时暂停渲染
 *   - 完整配置面板 + 运行时改参 setOptions()
 *
 * 用法 A —— 自动初始化（全屏）：
 *   <script>window.BACursorConfig = { color: '45,175,255' };</script>
 *   <script src="ba-cursor.js"></script>
 *
 * 用法 B —— 手动挂载到容器：
 *   var fx = new BACursor({ target: '#hero' });
 *   fx.destroy(); // 不再需要时卸载
 *
 * @version 1.0.0
 * @license MIT
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BACursor = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.1.0';

  // ---------------------------------------------------------------------------
  // 默认配置。所有键都可以在 window.BACursorConfig 或构造参数里覆盖。
  // ---------------------------------------------------------------------------
  var DEFAULTS = {
    // --- 外观 ---
    color: '45,175,255', // 主色，'R,G,B' 字符串
    scale: 1.5, // 整体缩放，1.5 为原始比例
    opacity: 1.0, // 整体不透明度 0~1

    // --- 动态 ---
    trailSpeed: 1.0, // 拖尾衰减速度，越大消失越快
    clickSpeed: 1.0, // 点击特效播放速度
    maxTrail: 20, // 拖尾最大采样点数
    trailAlways: false, // true = 不按下也有拖尾（悬停即出）
    trailSpawnChance: 0.3, // 拖尾过程中额外迸出小火星的概率
    trailOpacity: 0.5, // 拖尾浓度（alpha 乘数），越小越淡
    trailColor: null, // 拖尾单独配色，null = 跟随 color
    trailSpacing: 6, // 拖尾采样间距（px），越小越细腻
    maxInterpolation: 8, // 单次移动最多补几个采样点
    sparkCount: 4, // 每次点击迸出的火星数量

    // --- 挂载 ---
    target: null, // 挂载目标：CSS 选择器或 DOM 元素；为空则全屏 fixed
    zIndex: 2147483647, // canvas 层级
    maxDpr: 2, // 设备像素比上限（移动端 3x 屏降采样，省一半以上填充率）

    // --- 交互 ---
    touch: true, // 是否响应触摸 / 手写笔；false = 仅鼠标
    trailOnScroll: true, // 触摸滚动页面时是否同时显示拖尾
    moveThreshold: 2, // 拖动多少像素才记录一个拖尾点
    pauseOnHidden: true, // 页面切到后台时暂停渲染
    reduceMotion: 'auto', // 'auto' 尊重 prefers-reduced-motion；true 强制降级；false 关闭

    // --- 初始化 ---
    autoInit: true, // 读取全局配置自动初始化（仅脚本自动加载路径生效）

    // --- 高级参数（一般不用改，需要细调时用）---
    advanced: {
      fillGrowRate: 26, // 填充圆扩散速率
      fillLife: 16, // 填充圆生命周期（帧）
      ringLife: 23, // 光环生命周期（帧）
      ringLen: 1.1 * Math.PI, // 单段光环弧长
      ringSegments: 10, // 光环分段数（越大越平滑、越吃性能）
      ringMinWidth: 0.4, // 光环最细线宽
      ringMaxWidth: 3.3, // 光环最粗线宽
      trailWidth: 5.0, // 拖尾线宽
      trailGlow: 0, // 拖尾发光半径；>0 会逐段做高斯模糊，移动端会明显掉帧
      trailSparkSize: 9, // 拖尾小火星尺寸基数
      trailSparkSpeed: 1.3, // 拖尾小火星速度基数
      sparkSizeBase: 4, // 点击火星尺寸基数
      sparkSizeRange: 3, // 点击火星尺寸随机范围
      sparkSpeedBase: 4.8, // 点击火星速度基数
      sparkSpeedRange: 2 // 点击火星速度随机范围
    }
  };

  // 光环随时间变化的形状常量（曲线塑形，通常无需外露）
  var RING_LEN_STOP_ADD = 0.1; // 弧长生长阶段结束点
  var RING_LEN_START_DIM = 0.4; // 弧长开始收束点

  // ---------------------------------------------------------------------------
  // 工具
  // ---------------------------------------------------------------------------
  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (!src) continue;
      for (var k in src) {
        if (hasOwn(src, k)) target[k] = src[k];
      }
    }
    return target;
  }

  function mergeOptions(patch) {
    var out = assign({}, DEFAULTS);
    out.advanced = assign({}, DEFAULTS.advanced);
    var p = patch || {};
    for (var k in p) {
      if (!hasOwn(p, k)) continue;
      if (k === 'advanced') assign(out.advanced, p.advanced);
      else out[k] = p[k];
    }
    return out;
  }

  function warn(msg) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[ba-cursor] ' + msg);
    }
  }

  function readGlobalConfig() {
    if (typeof window === 'undefined') return null;
    return window.BACursorConfig || null;
  }

  function now() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  }

  function ringsEndColorFromRgb(rgbString) {
    return String(rgbString).split(',').map(Number).map(function (n) { return (n + 255 * 2) / 3; });
  }

  // ---------------------------------------------------------------------------
  // 实例
  // ---------------------------------------------------------------------------
  function BACursor(options) {
    if (!(this instanceof BACursor)) return new BACursor(options);

    this.version = VERSION;
    this.options = mergeOptions(options);
    this.destroyed = false;

    // 对象池与效果容器
    this.wavesPool = [];
    this.sparksPool = [];
    this.waves = [];
    this.sparks = [];
    this.trail = [];

    // 交互状态
    this.isDown = false;
    this.lastPos = null;
    this._anchor = null; // 拖尾采样锚点（保证慢速拖动也能出拖尾）
    this._touchId = null; // 正在跟踪的触摸点 identifier
    this._scrolling = false; // 页面是否正在滚动
    this._scrollTimer = 0;

    // 时序
    this.baseFrameMs = 1000 / 60;
    this.maxDeltaMs = 100;
    this.lastFrameTime = now();

    // 画布
    this.dpr = 1;
    this.cssWidth = 1;
    this.cssHeight = 1;

    // 脏矩形
    this.previousDirtyRects = [];
    this.forceFullRedraw = true;

    // 循环
    this.animationFramePending = false;
    this.renderingPaused = false;
    this._rafId = 0;

    // 内部
    this._listeners = [];
    this._resizeObserver = null;
    this._restorePosition = null;
    this._mq = null;
    this._mqListener = null;
    this.container = null;
    this.eventHost = null;
    this._fullscreen = true;

    this._initMediaQuery();
    this._applyRuntimeOptions();
    this._setup();
  }

  // ---------------------------------------------------------------------------
  // 初始化 / 卸载
  // ---------------------------------------------------------------------------
  BACursor.prototype._initMediaQuery = function () {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    try {
      this._mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    } catch (e) {
      this._mq = null;
    }
  };

  /** 把 options 里的标量同步到实例字段（渲染逻辑读实例字段，避免热路径查表） */
  BACursor.prototype._applyRuntimeOptions = function () {
    var o = this.options;
    this.color = o.color;
    this.scale = o.scale;
    this.opacity = o.opacity;
    this.trailSpeed = o.trailSpeed;
    this.clickSpeed = o.clickSpeed;
    this.maxTrail = o.maxTrail;
    this.adv = o.advanced;
    this.ringsStartColor = [250, 252, 252];
    this.ringsEndColor = ringsEndColorFromRgb(this.color);
    this._updateReducedMotion();
  };

  BACursor.prototype._updateReducedMotion = function () {
    var rm = this.options.reduceMotion;
    if (rm === true) this.reduced = true;
    else if (rm === 'auto') this.reduced = !!(this._mq && this._mq.matches);
    else this.reduced = false;
  };

  BACursor.prototype._setup = function () {
    var o = this.options;

    this.container = null;
    this._fullscreen = true;

    if (o.target) {
      this.container = typeof o.target === 'string'
        ? document.querySelector(o.target)
        : o.target;
      if (this.container) {
        this._fullscreen = false;
      } else {
        warn('target "' + o.target + '" 未找到，已回退为全屏模式');
        this.container = null;
      }
    }

    this._createCanvas();
    this._bindEvents();
    this._resize();
    this.scheduleNextAnimationFrame();
  };

  BACursor.prototype._createCanvas = function () {
    var o = this.options;
    var canvas = document.createElement('canvas');

    if (this._fullscreen) {
      if (!document.body) {
        warn('document.body 尚未就绪，无法挂载全屏 canvas');
        return;
      }
      canvas.style.cssText =
        'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;';
    } else {
      var cs = window.getComputedStyle(this.container);
      if (cs.position === 'static') {
        this._restorePosition = this.container.style.position;
        this.container.style.position = 'relative';
      }
      canvas.style.cssText =
        'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;';
    }

    canvas.style.zIndex = String(o.zIndex);
    canvas.setAttribute('aria-hidden', 'true');
    this.canvas = canvas;

    (this._fullscreen ? document.body : this.container).appendChild(canvas);

    this.ctx = canvas.getContext('2d');
    this.bufferCanvas = document.createElement('canvas');
    this.bufferCtx = this.bufferCanvas.getContext('2d');
  };

  BACursor.prototype._on = function (host, type, fn, opts) {
    var options = opts || { passive: true };
    host.addEventListener(type, fn, options);
    this._listeners.push({ host: host, type: type, fn: fn, opts: options });
  };

  BACursor.prototype._bindEvents = function () {
    var self = this;
    var o = this.options;
    var host = this._fullscreen ? window : this.container;
    this.eventHost = host;

    // Pointer Events：只处理鼠标 / 手写笔，触摸交给下面的 touch 事件
    this._on(host, 'pointerdown', function (e) {
      if (e.pointerType === 'touch') return;
      self._handleDown(e.clientX, e.clientY, e.button, e.pointerType);
    });
    this._on(host, 'pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      self._handleMove(e.clientX, e.clientY);
    });
    this._on(host, 'pointerup', function (e) {
      if (e.pointerType === 'touch') return;
      self._releasePointer();
    });
    this._on(host, 'pointerleave', function (e) {
      if (e.pointerType === 'touch') return;
      self._releasePointer();
    });
    this._on(host, 'pointercancel', function (e) {
      if (e.pointerType === 'touch') return;
      self._releasePointer();
    });
    // 窗口失焦时鼠标抬起收不到 pointerup，兜底复位
    this._on(window, 'blur', function () { self._releasePointer(); });

    // Touch Events：触摸专用通道。
    // 关键：页面滚动时浏览器会发出 pointercancel 掐断 pointermove，
    // 但 touchmove 在滚动期间仍会持续派发 —— 所以「滚动 + 拖尾」可以并存。
    if (o.touch) {
      this._on(host, 'touchstart', function (e) { self._handleTouchStart(e); });
      this._on(host, 'touchmove', function (e) { self._handleTouchMove(e); });
      this._on(host, 'touchend', function (e) { self._handleTouchEnd(e); });
      this._on(host, 'touchcancel', function (e) { self._handleTouchEnd(e); });
    }

    var onResize = function () { self._resize(); };
    this._on(window, 'resize', onResize);
    this._on(window, 'orientationchange', onResize);

    // 滚动状态：供 trailOnScroll 判断是否在滚动
    this._on(window, 'scroll', function () {
      self._scrolling = true;
      if (self._scrollTimer) clearTimeout(self._scrollTimer);
      self._scrollTimer = setTimeout(function () {
        self._scrolling = false;
        self._scrollTimer = 0;
      }, 150);
    });

    if (!this._fullscreen && typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(onResize);
      this._resizeObserver.observe(this.container);
    }

    if (o.pauseOnHidden) {
      this._on(document, 'visibilitychange', function () {
        if (document.hidden) self.pause();
        else self.resume();
      });
    }

    if (this._mq) {
      this._mqListener = function () { self._updateReducedMotion(); };
      if (this._mq.addEventListener) this._mq.addEventListener('change', this._mqListener);
      else if (this._mq.addListener) this._mq.addListener(this._mqListener);
    }
  };

  BACursor.prototype._teardownDom = function () {
    var i;
    for (i = 0; i < this._listeners.length; i++) {
      var l = this._listeners[i];
      l.host.removeEventListener(l.type, l.fn, l.opts);
    }
    this._listeners = [];

    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    if (this._mq && this._mqListener) {
      if (this._mq.removeEventListener) this._mq.removeEventListener('change', this._mqListener);
      else if (this._mq.removeListener) this._mq.removeListener(this._mqListener);
      this._mqListener = null;
    }

    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    this.canvas = null;
    this.ctx = null;
    this.bufferCanvas = null;
    this.bufferCtx = null;

    if (this.container && this._restorePosition !== null) {
      this.container.style.position = this._restorePosition;
      this._restorePosition = null;
    }
  };

  /**
   * 卸载：移除所有事件监听、取消动画帧、摘除 canvas。
   * SPA 路由切换 / 组件销毁时务必调用。
   */
  BACursor.prototype.destroy = function () {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = 0;
    }
    this.animationFramePending = false;

    if (this._scrollTimer) {
      clearTimeout(this._scrollTimer);
      this._scrollTimer = 0;
    }

    this._teardownDom();

    this.waves = [];
    this.sparks = [];
    this.trail = [];
    this.wavesPool = [];
    this.sparksPool = [];
    this.previousDirtyRects = [];
    this.isDown = false;
    this.lastPos = null;

    if (BACursor.instance === this) BACursor.instance = null;
  };

  // ---------------------------------------------------------------------------
  // 尺寸 / 坐标
  // ---------------------------------------------------------------------------
  BACursor.prototype._resize = function () {
    if (this.destroyed || !this.canvas) return;
    var o = this.options;
    var dpr = Math.min(window.devicePixelRatio || 1, o.maxDpr);

    var cssW, cssH;
    if (this._fullscreen) {
      cssW = window.innerWidth;
      cssH = window.innerHeight;
    } else {
      cssW = this.container.clientWidth;
      cssH = this.container.clientHeight;
    }
    cssW = Math.max(1, cssW);
    cssH = Math.max(1, cssH);

    var w = Math.max(1, Math.floor(cssW * dpr));
    var h = Math.max(1, Math.floor(cssH * dpr));

    this.dpr = dpr;
    this.cssWidth = cssW;
    this.cssHeight = cssH;
    this.canvas.width = w;
    this.canvas.height = h;
    this.bufferCanvas.width = w;
    this.bufferCanvas.height = h;
    this.previousDirtyRects = [];
    this.forceFullRedraw = true;

    this.bufferCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (this.waves.length || this.sparks.length || this.trail.length) {
      this.scheduleNextAnimationFrame();
    }
  };

  BACursor.prototype._posFromXY = function (clientX, clientY) {
    if (this._fullscreen) return { x: clientX, y: clientY };
    var r = this.container.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };

  // ---------------------------------------------------------------------------
  // 事件处理（鼠标 / 手写笔）
  // ---------------------------------------------------------------------------
  BACursor.prototype._handleDown = function (clientX, clientY, button, pointerType) {
    if (this.destroyed || this.renderingPaused) return;
    var o = this.options;
    if (!o.touch && pointerType !== 'mouse') return;
    if (pointerType === 'mouse' && button !== 0) return; // 仅左键

    var p = this._posFromXY(clientX, clientY);
    this.isDown = true;
    this.lastPos = p;
    this._anchor = null;
    this.trigger(p.x, p.y);
  };

  BACursor.prototype._handleMove = function (clientX, clientY) {
    if (this.destroyed || this.renderingPaused) return;
    var o = this.options;
    if (!this.isDown && !o.trailAlways) return;
    this._trackMove(this._posFromXY(clientX, clientY));
  };

  BACursor.prototype._releasePointer = function () {
    this.isDown = false;
    this._anchor = null;
  };

  // ---------------------------------------------------------------------------
  // 事件处理（触摸）
  // ---------------------------------------------------------------------------
  BACursor.prototype._handleTouchStart = function (e) {
    if (this.destroyed || this.renderingPaused) return;
    if (e.touches.length !== 1) return; // 多指手势（缩放等）不参与

    var t = e.touches[0];
    var p = this._posFromXY(t.clientX, t.clientY);
    this._touchId = t.identifier;
    this.isDown = true;
    this.lastPos = p;
    this._anchor = null;
    this.trigger(p.x, p.y);
  };

  BACursor.prototype._handleTouchMove = function (e) {
    if (this.destroyed || this.renderingPaused || !this.isDown) return;
    if (!this.options.trailOnScroll && this._scrolling) return;

    var t = this._findTouch(e.touches);
    if (!t) return;
    this._trackMove(this._posFromXY(t.clientX, t.clientY));
  };

  BACursor.prototype._handleTouchEnd = function (e) {
    if (e.touches && e.touches.length > 0) return; // 仍有手指在屏上
    this.isDown = false;
    this._touchId = null;
    this._anchor = null;
  };

  BACursor.prototype._findTouch = function (list) {
    if (!list) return null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].identifier === this._touchId) return list[i];
    }
    return null;
  };

  // ---------------------------------------------------------------------------
  // 拖尾采样
  // ---------------------------------------------------------------------------
  /**
   * 把一次指针移动转成拖尾采样点。
   * 用独立的锚点累计位移，慢速拖动同样能出拖尾；
   * 两点之间按 trailSpacing 补插，快速滑动时拖尾才是连续的曲线而非折线。
   */
  BACursor.prototype._trackMove = function (p) {
    var o = this.options;
    this.lastPos = p; // 拖尾头部始终跟随指针

    if (this.reduced) {
      this._anchor = p;
      return;
    }

    var a = this._anchor;
    if (!a) {
      this._anchor = p;
      return;
    }

    var dx = p.x - a.x;
    var dy = p.y - a.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < o.moveThreshold) return; // 位移还不够，等下一次累积

    var steps = Math.min(o.maxInterpolation, Math.max(1, Math.ceil(dist / o.trailSpacing)));
    for (var i = 1; i <= steps; i++) {
      var t = i / steps;
      this.trail.push({ x: a.x + dx * t, y: a.y + dy * t, life: 1 });
    }
    while (this.trail.length > this.maxTrail) this.trail.shift();
    this._anchor = p;

    if (Math.random() < o.trailSpawnChance) this._spawnTrailSpark(p.x, p.y);
    this.scheduleNextAnimationFrame();
  };

  BACursor.prototype._spawnTrailSpark = function (x, y) {
    var adv = this.adv;
    var a = Math.random() * Math.PI * 2;
    var speedAdjust = this.scale / 1.5;

    this.sparks.push({
      x: x + Math.cos(a) * 10 * this.scale,
      y: y + Math.sin(a) * 10 * this.scale,
      vx: Math.cos(a) * adv.trailSparkSpeed * speedAdjust,
      vy: Math.sin(a) * adv.trailSparkSpeed * speedAdjust,
      rot: Math.random() * Math.PI * 2,
      rs: 0.16,
      s: adv.trailSparkSize * this.scale,
      a: 0.5, // 比点击火星淡，避免拖尾过程中喧宾夺主
      f: 0.95,
      fromClick: false
    });
  };

  // ---------------------------------------------------------------------------
  // 公开控制
  // ---------------------------------------------------------------------------
  /** 在画布坐标系内手动迸发一次特效 */
  BACursor.prototype.trigger = function (x, y) {
    if (this.destroyed) return this;
    this.createEffects(x, y);
    this.scheduleNextAnimationFrame();
    return this;
  };

  /** 暂停渲染（保留现场），如页面进入后台 */
  BACursor.prototype.pause = function () {
    if (this.destroyed || this.renderingPaused) return;
    this.renderingPaused = true;
    this.animationFramePending = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = 0;
    }
    this.isDown = false;
  };

  /** 恢复渲染 */
  BACursor.prototype.resume = function () {
    if (this.destroyed || !this.renderingPaused) return;
    this.renderingPaused = false;
    this.lastFrameTime = now();
    this.forceFullRedraw = true;
    this.scheduleNextAnimationFrame();
  };

  /** 清空所有特效 */
  BACursor.prototype.clearEffects = function () {
    if (this.destroyed) return this;
    this.waves = [];
    this.sparks = [];
    this.trail = [];
    this.isDown = false;
    this.lastPos = null;
    this._anchor = null;
    this._touchId = null;
    this.previousDirtyRects = [];
    this.forceFullRedraw = true;
    this.lastFrameTime = now();
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    if (this.bufferCtx && this.bufferCanvas) {
      this.bufferCtx.clearRect(0, 0, this.bufferCanvas.width, this.bufferCanvas.height);
    }
    return this;
  };

  /** clearEffects 的别名 */
  BACursor.prototype.clear = BACursor.prototype.clearEffects;

  /**
   * 运行时改参。可改 color / scale / opacity / trailSpeed / clickSpeed /
   * maxTrail / trailAlways / sparkCount / advanced.* 等。
   * 修改 target 或 zIndex 会重建 canvas 与事件。
   */
  BACursor.prototype.setOptions = function (patch) {
    if (this.destroyed) return this;
    var p = patch || {};
    var rebuild = hasOwn(p, 'target') || hasOwn(p, 'zIndex');
    var needResize = hasOwn(p, 'maxDpr');

    for (var k in p) {
      if (!hasOwn(p, k)) continue;
      if (k === 'advanced') assign(this.options.advanced, p.advanced);
      else this.options[k] = p[k];
    }

    if (rebuild) {
      this._teardownDom();
      this._applyRuntimeOptions();
      this.clearEffects();
      this._setup();
    } else {
      this._applyRuntimeOptions();
      if (needResize) this._resize();
    }
    return this;
  };

  BACursor.prototype.alpha = function (value) {
    return Math.max(0, Math.min(1, value * this.opacity));
  };

  // ---------------------------------------------------------------------------
  // 特效生成
  // ---------------------------------------------------------------------------
  BACursor.prototype.createEffects = function (x, y) {
    var adv = this.adv;
    var rRoundRateList = [0, 1, 1.5, 2];
    var ringsRsList = [0, 0.03, 0.06];
    var count = this.reduced ? Math.max(1, Math.floor(this.options.sparkCount / 2)) : this.options.sparkCount;

    var wave;
    if (this.wavesPool.length > 0) {
      wave = this.wavesPool.pop();
    } else {
      wave = {};
    }
    if (!wave.ring) wave.ring = { segs: [] };

    wave.x = x;
    wave.y = y;
    wave.r = 0;
    wave.life = 0;
    wave.ring.ang = Math.random() * Math.PI * 2;
    wave.ring.rs = ringsRsList[Math.floor(Math.random() * ringsRsList.length)];
    wave.ring.segs[0] = {
      off: 0,
      len: adv.ringLen,
      rRoundRate: rRoundRateList[Math.floor(Math.random() * rRoundRateList.length)]
    };
    wave.ring.segs[1] = {
      off: (Math.random() * 3 - 1.5) * Math.PI,
      len: adv.ringLen,
      rRoundRate: rRoundRateList[Math.floor(Math.random() * rRoundRateList.length)]
    };

    this.waves.push(wave);

    var speedAdjust = this.scale / 1.5;
    for (var i = 0; i < count; i++) {
      var a = Math.random() * Math.PI * 2;
      var speed = (adv.sparkSpeedBase + Math.random() * adv.sparkSpeedRange) * speedAdjust;

      var spark;
      if (this.sparksPool.length > 0) {
        spark = this.sparksPool.pop();
      } else {
        spark = {};
      }

      spark.x = x;
      spark.y = y;
      spark.vx = Math.cos(a) * speed;
      spark.vy = Math.sin(a) * speed;
      spark.rot = Math.random() * Math.PI * 2;
      spark.rs = (Math.random() - 0.5) * 0.28;
      spark.s = (adv.sparkSizeBase + Math.random() * adv.sparkSizeRange) * this.scale;
      spark.a = 1;
      spark.f = 0.9;
      spark.fromClick = true;
      this.sparks.push(spark);
    }
  };

  // ---------------------------------------------------------------------------
  // 绘制
  // ---------------------------------------------------------------------------
  BACursor.prototype.clearBuffer = function (rect) {
    var ctx = this.bufferCtx;
    if (rect) {
      ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
    } else {
      ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    }
  };

  BACursor.prototype.clearBufferRects = function (rects) {
    if (!rects || rects.length === 0) return;
    for (var i = 0; i < rects.length; i++) {
      this.clearBuffer(rects[i]);
    }
  };

  BACursor.prototype.updateTrail = function (frameScale) {
    var ctx = this.bufferCtx;
    var o = this.options;
    var adv = this.adv;
    var n = this.trail.length;
    var baseDecay = (this.isDown ? 0.085 : 0.18) * frameScale;
    var maxStep = 0.42;

    for (var i = n - 1; i >= 0; i--) {
      var t = this.trail[i];
      var span = Math.max(1, n - 1);
      var along = n > 1 ? i / span : 1;
      var towardCursorBias = 1.25 - 0.55 * along;
      var step = baseDecay * towardCursorBias;
      if (step > maxStep) step = maxStep;
      t.life -= step;
      if (t.life <= 0) this.trail.splice(i, 1);
    }

    var head = this.lastPos;
    var pts = head && this.trail.length > 0
      ? this.trail.concat([{ x: head.x, y: head.y, life: 1 }])
      : this.trail.slice();

    if (pts.length < 2) return;

    var gapX = pts[pts.length - 1].x - pts[pts.length - 2].x;
    var gapY = pts[pts.length - 1].y - pts[pts.length - 2].y;
    var gap = Math.sqrt(gapX * gapX + gapY * gapY);

    var color = o.trailColor || this.color;
    var alphaMul = o.trailOpacity;

    // 拖尾自身用 source-over 绘制：相邻线段在 lighter 下重叠会让拖尾发白过亮
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = adv.trailWidth;

    if (adv.trailGlow > 0) {
      ctx.shadowColor = 'rgba(' + color + ', 0.6)';
      ctx.shadowBlur = adv.trailGlow;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    } else {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
    }

    if (gap < 0.75 && this.trail.length === 1) {
      var fade = Math.max(0, this.trail[0].life);
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, 2.5 + 2 * fade, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + color + ', ' + (fade * 0.85 * alphaMul) + ')';
      ctx.fill();
      ctx.restore();
      return;
    }

    var lastIdx = pts.length - 1;
    for (var j = 0; j < lastIdx; j++) {
      var a0 = pts[j];
      var a1 = pts[j + 1];
      // 逐段纯色（取段中点透明度）：比每段各建一个线性渐变更省，肉眼几乎无差别
      var alphaSeg = ((j + 0.5) / lastIdx) * alphaMul;

      ctx.beginPath();
      ctx.moveTo(a0.x, a0.y);
      ctx.lineTo(a1.x, a1.y);
      ctx.strokeStyle = 'rgba(' + color + ', ' + alphaSeg.toFixed(3) + ')';
      ctx.stroke();
    }
    ctx.restore();
  };

  BACursor.prototype.strokeRingSegment = function (wx, wy, radius, a0, a1, lineWidth, strokeStyle) {
    var ctx = this.bufferCtx;
    ctx.beginPath();
    ctx.arc(wx, wy, radius, a0, a1);
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();
  };

  BACursor.prototype.updateWaves = function (clickFrameScale) {
    var adv = this.adv;
    var ctx = this.bufferCtx;
    var self = this;

    function updateFilledCircle(w, waveProg) {
      w.life += clickFrameScale;
      var ease = 1 - Math.pow(1 - waveProg, 3);
      w.r = adv.fillGrowRate * self.scale * ease;
      var alpha = Math.max(0, 1 - waveProg);
      if (alpha > 0) {
        ctx.beginPath();
        ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + self.color + ',' + self.alpha(alpha) + ')';
        ctx.fill();
      }
    }

    function updateRings(w, ringProg) {
      function getWeightProp(t) { return Math.min(2 - Math.abs(4 * (t - 0.5)), 1); }
      function ringRgbAt(rProg) {
        var t = Math.min(1.2 * rProg, 1);
        var r = self.ringsStartColor[0] * (1 - t) + self.ringsEndColor[0] * t;
        var g = self.ringsStartColor[1] * (1 - t) + self.ringsEndColor[1] * t;
        var b = self.ringsStartColor[2] * (1 - t) + self.ringsEndColor[2] * t;
        return [Math.round(r), Math.round(g), Math.round(b)];
      }
      function getAlpha(rProg) { return Math.min(1.1 - 0.3 * rProg, 1); }

      var r = w.ring;
      r.ang -= r.rs * clickFrameScale;

      var start, end, len, seg;

      for (var i = 0; i < 2; i++) {
        seg = r.segs[i];
        var base = r.ang + seg.off;

        if (ringProg <= RING_LEN_STOP_ADD) {
          len = seg.len * (ringProg / RING_LEN_STOP_ADD);
          end = base + seg.len;
          start = end - len;
        } else if (ringProg > RING_LEN_START_DIM) {
          len = seg.len * (1 - (ringProg - RING_LEN_START_DIM) / (1 - RING_LEN_START_DIM));
          start = base;
          end = start + len;
        } else {
          len = seg.len;
          start = base;
          end = start + len;
        }

        var lineWidthMul = Math.min(-0.8 * (ringProg - 0.8) + 1, 1);
        var rrggbb = ringRgbAt(ringProg);
        var alphaRing = getAlpha(ringProg);

        for (var k = 0; k < adv.ringSegments; k++) {
          var t0 = k / adv.ringSegments;
          var t1 = (k + 1) / adv.ringSegments;
          var a0 = start + (end - start) * t0;
          var a1 = start + (end - start) * t1;

          if (Math.abs(a1 - a0) < 0.01) continue;

          var wT = getWeightProp(t0);
          var lw = (adv.ringMinWidth * (1 - wT) + adv.ringMaxWidth * wT) * lineWidthMul;
          var strokeStyle = 'rgba(' + rrggbb[0] + ',' + rrggbb[1] + ',' + rrggbb[2] + ',' + alphaRing + ')';
          var radius = w.r + seg.rRoundRate * self.scale;
          self.strokeRingSegment(w.x, w.y, radius, a0, a1, lw, strokeStyle);
        }
      }
    }

    for (var i = this.waves.length - 1; i >= 0; i--) {
      var w = this.waves[i];
      var waveProg = Math.min(w.life / adv.fillLife, 1);
      var ringProg = Math.min(w.life / adv.ringLife, 1);

      updateFilledCircle(w, waveProg);
      updateRings(w, ringProg);

      if (ringProg >= 1 && waveProg >= 1) {
        this.wavesPool.push(this.waves[i]);
        this.waves.splice(i, 1);
      }
    }
  };

  BACursor.prototype.updateSparks = function (clickFrameScale, trailFrameScale) {
    var ctx = this.bufferCtx;
    for (var i = this.sparks.length - 1; i >= 0; i--) {
      var s = this.sparks[i];
      var fs = s.fromClick ? clickFrameScale : trailFrameScale;
      s.x += s.vx * fs;
      s.y += s.vy * fs;
      s.vx *= Math.pow(s.f, fs);
      s.vy *= Math.pow(s.f, fs);
      s.rot += s.rs * fs;
      s.a -= 0.032 * fs;
      if (s.a <= 0) {
        this.sparksPool.push(this.sparks[i]);
        this.sparks.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.beginPath();
      ctx.moveTo(0, -s.s);
      ctx.lineTo(s.s * 0.6, s.s * 0.6);
      ctx.lineTo(-s.s * 0.6, s.s * 0.6);
      ctx.fillStyle = 'rgba(255,255,255,' + this.alpha(s.a) + ')';
      ctx.fill();
      ctx.restore();
    }
  };

  // ---------------------------------------------------------------------------
  // 脏矩形
  // ---------------------------------------------------------------------------
  BACursor.prototype.canvasRect = function () {
    return { x: 0, y: 0, w: this.cssWidth, h: this.cssHeight };
  };

  BACursor.prototype.clipRect = function (rect) {
    if (!rect) return null;
    var x0 = Math.max(0, Math.floor(rect.x));
    var y0 = Math.max(0, Math.floor(rect.y));
    var x1 = Math.min(this.cssWidth, Math.ceil(rect.x + rect.w));
    var y1 = Math.min(this.cssHeight, Math.ceil(rect.y + rect.h));
    if (x1 <= x0 || y1 <= y0) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };

  BACursor.prototype.pointRect = function (x, y, padding) {
    return { x: x - padding, y: y - padding, w: padding * 2, h: padding * 2 };
  };

  BACursor.prototype.segmentRect = function (a, b, padding) {
    var x0 = Math.min(a.x, b.x) - padding;
    var y0 = Math.min(a.y, b.y) - padding;
    var x1 = Math.max(a.x, b.x) + padding;
    var y1 = Math.max(a.y, b.y) + padding;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };

  BACursor.prototype.intersects = function (a, b) {
    return (
      a.x <= b.x + b.w &&
      a.x + a.w >= b.x &&
      a.y <= b.y + b.h &&
      a.y + a.h >= b.y
    );
  };

  BACursor.prototype.unionRect = function (a, b) {
    var x0 = Math.min(a.x, b.x);
    var y0 = Math.min(a.y, b.y);
    var x1 = Math.max(a.x + a.w, b.x + b.w);
    var y1 = Math.max(a.y + a.h, b.y + b.h);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };

  BACursor.prototype.mergeRects = function (rects) {
    var merged = [];
    for (var r = 0; r < rects.length; r++) {
      var rect = this.clipRect(rects[r]);
      if (!rect) continue;

      for (var j = 0; j < merged.length; j++) {
        if (this.intersects(merged[j], rect)) {
          rect = this.unionRect(merged[j], rect);
          merged.splice(j, 1);
          j = -1;
        }
      }

      merged.push(rect);
    }
    return merged;
  };

  BACursor.prototype.getEffectRects = function () {
    var adv = this.adv;
    var rects = [];
    var trailPad = 18 * this.scale + 12;
    var trailPoints = this.lastPos && this.trail.length > 0
      ? this.trail.concat([{ x: this.lastPos.x, y: this.lastPos.y }])
      : this.trail;

    if (trailPoints.length === 1) {
      rects.push(this.pointRect(trailPoints[0].x, trailPoints[0].y, trailPad));
    } else {
      for (var i = 0; i < trailPoints.length - 1; i++) {
        rects.push(this.segmentRect(trailPoints[i], trailPoints[i + 1], trailPad));
      }
    }

    var wavePad = 34 * this.scale + adv.ringMaxWidth + 16;
    for (var w = 0; w < this.waves.length; w++) {
      var wave = this.waves[w];
      var radius = Math.max(wave.r || 0, adv.fillGrowRate * this.scale) + wavePad;
      rects.push(this.pointRect(wave.x, wave.y, radius));
    }

    var maxFrameScale = this.maxDeltaMs / this.baseFrameMs;
    for (var s = 0; s < this.sparks.length; s++) {
      var spark = this.sparks[s];
      var speed = Math.sqrt((spark.vx || 0) * (spark.vx || 0) + (spark.vy || 0) * (spark.vy || 0));
      var speedScale = spark.fromClick ? this.clickSpeed : this.trailSpeed;
      var motionPad = speed * maxFrameScale * speedScale;
      var sparkPad = Math.max(spark.s || 0, adv.trailSparkSize * this.scale) * 2 + motionPad + 12;
      rects.push(this.pointRect(spark.x, spark.y, sparkPad));
    }

    return this.mergeRects(rects);
  };

  BACursor.prototype.getRenderRects = function () {
    if (this.forceFullRedraw) {
      return [this.canvasRect()];
    }
    return this.mergeRects(this.previousDirtyRects.concat(this.getEffectRects()));
  };

  BACursor.prototype.clipToRects = function (ctx, rects) {
    ctx.beginPath();
    for (var i = 0; i < rects.length; i++) {
      ctx.rect(rects[i].x, rects[i].y, rects[i].w, rects[i].h);
    }
    ctx.clip();
  };

  BACursor.prototype.renderToMain = function (rects) {
    var mainCtx = this.ctx;
    var mainCanvas = this.canvas;
    var bufferCanvas = this.bufferCanvas;

    if (!rects || rects.length === 0) {
      mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
      mainCtx.drawImage(bufferCanvas, 0, 0);
      return;
    }

    var dpr = this.dpr || 1;
    for (var i = 0; i < rects.length; i++) {
      var rect = rects[i];
      var sx = Math.max(0, Math.floor(rect.x * dpr));
      var sy = Math.max(0, Math.floor(rect.y * dpr));
      var sw = Math.min(mainCanvas.width - sx, Math.ceil(rect.w * dpr));
      var sh = Math.min(mainCanvas.height - sy, Math.ceil(rect.h * dpr));
      if (sw <= 0 || sh <= 0) continue;

      mainCtx.clearRect(sx, sy, sw, sh);
      mainCtx.drawImage(bufferCanvas, sx, sy, sw, sh, sx, sy, sw, sh);
    }
  };

  // ---------------------------------------------------------------------------
  // 主循环
  // ---------------------------------------------------------------------------
  BACursor.prototype.animationLoops = function (frameTime) {
    if (this.destroyed) return;

    if (this.renderingPaused) {
      this.lastFrameTime = frameTime;
      this.animationFramePending = false;
      return;
    }

    var hasWork = this.waves.length > 0 || this.sparks.length > 0 || this.trail.length > 0;

    if (!hasWork) {
      // 空闲即停：清掉最后一帧残留后不再排队，零 CPU 占用
      this.lastFrameTime = frameTime;
      if (this.previousDirtyRects.length > 0) {
        this.clearBufferRects(this.previousDirtyRects);
        this.renderToMain(this.previousDirtyRects);
        this.previousDirtyRects = [];
      }
      this.animationFramePending = false;
      return;
    }

    var deltaMs = Math.min(frameTime - this.lastFrameTime, this.maxDeltaMs);
    this.lastFrameTime = frameTime;
    var baseScale = deltaMs / this.baseFrameMs;
    var trailFrameScale = baseScale * this.trailSpeed;
    var clickFrameScale = baseScale * this.clickSpeed;

    var bctx = this.bufferCtx;
    var renderRects = this.getRenderRects();

    bctx.save();
    this.clipToRects(bctx, renderRects);
    bctx.globalCompositeOperation = 'lighter';

    this.clearBufferRects(renderRects);
    this.updateTrail(trailFrameScale);
    this.updateWaves(clickFrameScale);
    this.updateSparks(clickFrameScale, trailFrameScale);

    bctx.globalCompositeOperation = 'source-over';
    bctx.restore();

    this.renderToMain(renderRects);
    this.previousDirtyRects = this.getEffectRects();
    this.forceFullRedraw = false;

    this.animationFramePending = false;
    this.scheduleNextAnimationFrame();
  };

  BACursor.prototype.scheduleNextAnimationFrame = function () {
    if (this.destroyed || this.renderingPaused || this.animationFramePending) return;
    var self = this;
    this.animationFramePending = true;
    this._rafId = requestAnimationFrame(function (t) {
      self.animationLoops(t);
    });
  };

  // ---------------------------------------------------------------------------
  // 自动初始化
  // ---------------------------------------------------------------------------
  /** 读取 window.BACursorConfig 并自动创建一个全屏实例 */
  BACursor.autoInit = function () {
    if (typeof document === 'undefined') return null;
    if (BACursor.instance) return BACursor.instance;

    var start = function () {
      var cfg = readGlobalConfig() || {};
      if (cfg.autoInit === false) return;
      if (BACursor.instance) return;
      // 实例挂在构造函数上，全局可直接取 window.BACursor.instance
      BACursor.instance = new BACursor(cfg);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
    return null;
  };

  /** 语法糖：BACursor.create({ target: '#hero' }) */
  BACursor.create = function (options) {
    return new BACursor(options);
  };

  BACursor.VERSION = VERSION;
  BACursor.defaults = DEFAULTS;

  BACursor.autoInit();

  return BACursor;
});