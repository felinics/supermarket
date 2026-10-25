# HTML & CSS Web Reference

> 快速参考：现代 HTML/CSS 开发实践、模式与常见陷阱。

---

## 目录

1. [Semantic HTML](#1-semantic-html)
2. [Document Head](#2-document-head)
3. [Responsive Layout](#3-responsive-layout)
4. [CSS Custom Properties](#4-css-custom-properties)
5. [Typography](#5-typography)
6. [Accessibility](#6-accessibility)
7. [Forms](#7-forms)
8. [Common Page Patterns](#8-common-page-patterns)
9. [Performance](#9-performance)
10. [Common Pitfalls](#10-common-pitfalls)

---

## 1. Semantic HTML

### 语义化元素速查

| 元素 | 用途 | 典型场景 |
|------|------|----------|
| `<header>` | 页面或区块的页眉 | 站点 logo + 导航；也可用在 `<article>` 内 |
| `<nav>` | 主要导航链接集合 | 主菜单、面包屑、分页 |
| `<main>` | 页面唯一主内容 | 每页只出现一次，不含重复内容 |
| `<article>` | 独立可复用内容 | 博客文章、新闻条目、评论 |
| `<section>` | 有主题的内容分组 | 需要标题的内容块，不能独立存在 |
| `<aside>` | 与主内容相关但次要 | 侧边栏、相关链接、广告 |
| `<footer>` | 页面或区块的页脚 | 版权信息、联系方式 |
| `<figure>` | 带说明的独立内容 | 图片、代码块、图表 |
| `<figcaption>` | `<figure>` 的说明文字 | 图片描述 |
| `<time>` | 日期/时间 | 文章发布日期，需配合 `datetime` 属性 |
| `<address>` | 联系信息 | 作者或组织的联系方式 |
| `<mark>` | 高亮/关键词 | 搜索结果中匹配的关键词 |

### 完整页面结构示例

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>页面标题 — 网站名</title>
</head>
<body>

  <header>
    <a href="/" aria-label="网站首页">
      <img src="/logo.svg" alt="网站名" width="120" height="40" />
    </a>
    <nav aria-label="主导航">
      <ul>
        <li><a href="/about">关于</a></li>
        <li><a href="/blog">博客</a></li>
        <li><a href="/contact">联系</a></li>
      </ul>
    </nav>
  </header>

  <main>
    <article>
      <header>
        <h1>文章标题</h1>
        <p>作者：<a href="/author/jane">Jane</a> ·
           发布于 <time datetime="2024-06-01">2024年6月1日</time>
        </p>
      </header>

      <section aria-labelledby="intro-heading">
        <h2 id="intro-heading">引言</h2>
        <p>正文内容……</p>
        <figure>
          <img src="chart.png" alt="2024年销售趋势：Q3 环比增长 23%" />
          <figcaption>图1：2024年各季度销售对比</figcaption>
        </figure>
      </section>

      <section aria-labelledby="detail-heading">
        <h2 id="detail-heading">详细分析</h2>
        <p>更多内容……</p>
      </section>

      <footer>
        <address>
          联系作者：<a href="mailto:jane@example.com">jane@example.com</a>
        </address>
      </footer>
    </article>

    <aside aria-label="相关文章">
      <h2>延伸阅读</h2>
      <ul>
        <li><a href="/post/2">相关文章一</a></li>
        <li><a href="/post/3">相关文章二</a></li>
      </ul>
    </aside>
  </main>

  <footer>
    <p>&copy; 2024 网站名. 保留所有权利。</p>
    <nav aria-label="页脚导航">
      <a href="/privacy">隐私政策</a>
      <a href="/terms">服务条款</a>
    </nav>
  </footer>

</body>
</html>
```

### 常见错误：用 div 替代语义元素

```html
<!-- ❌ 错误：全部 div，无语义 -->
<div class="header">
  <div class="nav">
    <div class="nav-item"><a href="/">首页</a></div>
  </div>
</div>
<div class="main">
  <div class="article">
    <div class="title">文章标题</div>
    <div class="content">正文……</div>
  </div>
</div>

<!-- ✅ 正确：语义化标签 + 必要时用 div 做布局容器 -->
<header>
  <nav>
    <ul>
      <li><a href="/">首页</a></li>
    </ul>
  </nav>
</header>
<main>
  <article>
    <h1>文章标题</h1>
    <p>正文……</p>
  </article>
</main>
```

---

## 2. Document Head

### 完整 `<head>` 模板

```html
<head>
  <!-- 字符编码：必须放最前面 -->
  <meta charset="UTF-8" />

  <!-- 响应式视口：移动端必须 -->
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />

  <!-- IE 兼容性（如需支持旧版）-->
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />

  <!-- 页面标题：50–60 字符以内 -->
  <title>页面标题 — 网站名</title>

  <!-- SEO 描述：150–160 字符以内 -->
  <meta name="description" content="本页的简洁描述，用于搜索引擎摘要。" />

  <!-- Open Graph（社交分享） -->
  <meta property="og:type"        content="website" />
  <meta property="og:url"         content="https://example.com/page" />
  <meta property="og:title"       content="页面标题" />
  <meta property="og:description" content="社交平台显示的描述文字。" />
  <meta property="og:image"       content="https://example.com/og-image.jpg" />
  <meta property="og:image:width"  content="1200" />
  <meta property="og:image:height" content="630" />

  <!-- Twitter Card -->
  <meta name="twitter:card"        content="summary_large_image" />
  <meta name="twitter:title"       content="页面标题" />
  <meta name="twitter:description" content="Twitter 显示的描述。" />
  <meta name="twitter:image"       content="https://example.com/og-image.jpg" />

  <!-- Canonical URL（避免重复内容） -->
  <link rel="canonical" href="https://example.com/page" />

  <!-- Favicon：现代多尺寸写法 -->
  <link rel="icon" href="/favicon.ico" sizes="32x32" />
  <link rel="icon" href="/icon.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="manifest" href="/manifest.webmanifest" />

  <!-- 主题色（浏览器 UI 配色） -->
  <meta name="theme-color" content="#1d4ed8"
        media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#0f172a"
        media="(prefers-color-scheme: dark)" />

  <!-- 预加载关键字体（减少 FOUT） -->
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="preload"
        href="/fonts/inter-var.woff2"
        as="font"
        type="font/woff2"
        crossorigin />

  <!-- 样式表 -->
  <link rel="stylesheet" href="/styles/main.css" />
</head>
```

---

## 3. Responsive Layout

### Viewport Meta 必要性

没有 viewport meta，移动端浏览器会以 980px 宽度渲染页面再缩小，导致文字极小、触控困难。

```html
<!-- 必须 -->
<meta name="viewport" content="width=device-width, initial-scale=1.0" />

<!-- 不要加 user-scalable=no，会破坏无障碍访问 -->
```

### CSS Flexbox 完整速查

```css
/* 容器属性 */
.container {
  display: flex;
  flex-direction: row;          /* row | row-reverse | column | column-reverse */
  justify-content: flex-start;  /* flex-start | center | flex-end | space-between | space-around | space-evenly */
  align-items: stretch;         /* stretch | flex-start | center | flex-end | baseline */
  flex-wrap: nowrap;            /* nowrap | wrap | wrap-reverse */
  gap: 1rem;                    /* gap: 行间距 列间距 */
  align-content: stretch;       /* 多行时的对齐（需 flex-wrap: wrap） */
}

/* 子项属性 */
.item {
  flex-grow: 0;      /* 分配剩余空间的比例，0=不扩展 */
  flex-shrink: 1;    /* 空间不足时收缩比例，0=不收缩 */
  flex-basis: auto;  /* 初始尺寸，可用 px/%/rem/content */

  /* 简写：grow shrink basis */
  flex: 1;           /* 等价于 flex: 1 1 0%  — 等分空间 */
  flex: auto;        /* 等价于 flex: 1 1 auto — 按内容分配后等分 */
  flex: none;        /* 等价于 flex: 0 0 auto — 固定尺寸 */

  align-self: auto;  /* 覆盖容器的 align-items */
  order: 0;          /* 排列顺序，数值小的在前 */
}

/* 常用模式 */
.centered   { display: flex; place-content: center; }
.space-btw  { display: flex; justify-content: space-between; align-items: center; }
.equal-cols { display: flex; gap: 1rem; }
.equal-cols > * { flex: 1; }
```

### CSS Grid 完整速查

```css
/* 容器属性 */
.grid {
  display: grid;

  /* 显式列定义 */
  grid-template-columns: 200px 1fr 1fr;         /* 固定+弹性 */
  grid-template-columns: repeat(3, 1fr);         /* 等分3列 */
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));  /* 自动填充 */
  grid-template-columns: repeat(auto-fit,  minmax(250px, 1fr));  /* 自动折叠 */

  /* 显式行定义 */
  grid-template-rows: auto 1fr auto;            /* header / main / footer */

  /* 命名区域 */
  grid-template-areas:
    "header header"
    "sidebar main"
    "footer footer";

  gap: 1.5rem;          /* 行列间距 */
  row-gap: 1rem;        /* 仅行间距 */
  column-gap: 1.5rem;   /* 仅列间距 */

  align-items: stretch; /* 子项垂直对齐 */
  justify-items: stretch; /* 子项水平对齐 */
}

/* 子项属性 */
.item {
  /* 列跨越 */
  grid-column: 1 / 3;       /* 从第1条线到第3条线 */
  grid-column: 1 / -1;      /* 跨越全部列 */
  grid-column: span 2;      /* 跨越2列 */

  /* 行跨越 */
  grid-row: 1 / 3;
  grid-row: span 2;

  /* 命名区域 */
  grid-area: header;
}

/* auto-fill vs auto-fit 区别 */
/* auto-fill: 保留空列（列轨道仍占位） */
/* auto-fit:  折叠空列（内容填满整行） */
```

### Media Query 断点约定（Mobile-First）

```css
/* Mobile-first：先写小屏，逐渐增强 */

/* 基础样式（< 640px，手机竖屏） */
.container { padding: 1rem; }

/* sm: 小屏平板 / 大手机横屏 */
@media (min-width: 640px) {
  .container { padding: 1.5rem; }
}

/* md: 平板 */
@media (min-width: 768px) {
  .container { padding: 2rem; }
}

/* lg: 小桌面 / 笔记本 */
@media (min-width: 1024px) {
  .container { max-width: 1024px; margin-inline: auto; }
}

/* xl: 大桌面 */
@media (min-width: 1280px) {
  .container { max-width: 1280px; }
}

/* 2xl: 超宽屏 */
@media (min-width: 1536px) {
  .container { max-width: 1536px; }
}

/* 深色模式 */
@media (prefers-color-scheme: dark) { ... }

/* 减少动画（用户设置） */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; }
}
```

### 常见响应式模式

```css
/* 1. Navigation Collapse（导航折叠） */
.nav-links { display: none; }
@media (min-width: 768px) {
  .nav-links { display: flex; gap: 1.5rem; }
}

/* 2. Card Grid（卡片网格：1列 → 2列 → 3列） */
.card-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.5rem;
}
@media (min-width: 640px) {
  .card-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (min-width: 1024px) {
  .card-grid { grid-template-columns: repeat(3, 1fr); }
}

/* 更简洁的等价写法（无需 media query） */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
  gap: 1.5rem;
}

/* 3. Sidebar Layout（侧边栏布局） */
.layout {
  display: grid;
  grid-template-columns: 1fr;
  gap: 2rem;
}
@media (min-width: 1024px) {
  .layout { grid-template-columns: 260px 1fr; }
}
```

---

## 4. CSS Custom Properties

### 定义和使用变量

```css
/* 在 :root 定义全局变量 */
:root {
  /* 颜色系统 */
  --color-primary-50:  #eff6ff;
  --color-primary-100: #dbeafe;
  --color-primary-500: #3b82f6;
  --color-primary-600: #2563eb;
  --color-primary-900: #1e3a8a;

  --color-gray-50:  #f9fafb;
  --color-gray-100: #f3f4f6;
  --color-gray-500: #6b7280;
  --color-gray-900: #111827;

  /* 语义化颜色 token（引用上面的原始色） */
  --bg:              var(--color-gray-50);
  --bg-card:         #ffffff;
  --text-primary:    var(--color-gray-900);
  --text-secondary:  var(--color-gray-500);
  --border:          var(--color-gray-100);
  --accent:          var(--color-primary-600);
  --accent-hover:    var(--color-primary-700, #1d4ed8);

  /* 字体大小 */
  --text-xs:   0.75rem;
  --text-sm:   0.875rem;
  --text-base: 1rem;
  --text-lg:   1.125rem;
  --text-xl:   1.25rem;
  --text-2xl:  1.5rem;
  --text-3xl:  1.875rem;
  --text-4xl:  2.25rem;

  /* 间距 */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-12: 3rem;
  --space-16: 4rem;

  /* 圆角 */
  --radius-sm: 0.25rem;
  --radius:    0.5rem;
  --radius-lg: 0.75rem;
  --radius-full: 9999px;

  /* 阴影 */
  --shadow-sm: 0 1px 2px rgb(0 0 0 / 0.05);
  --shadow:    0 1px 3px rgb(0 0 0 / 0.1), 0 1px 2px rgb(0 0 0 / 0.06);
  --shadow-lg: 0 10px 15px rgb(0 0 0 / 0.1), 0 4px 6px rgb(0 0 0 / 0.05);

  /* 过渡 */
  --transition: 150ms ease;
}

/* 使用变量 */
.button {
  background-color: var(--accent);
  color: #fff;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius);
  transition: background-color var(--transition);
}
.button:hover { background-color: var(--accent-hover); }
```

### 主题切换（Light / Dark）

```css
/* 方案一：跟随系统 */
@media (prefers-color-scheme: dark) {
  :root {
    --bg:           var(--color-gray-900);
    --bg-card:      #1f2937;
    --text-primary: var(--color-gray-50);
    --text-secondary: var(--color-gray-400, #9ca3af);
    --border:       #374151;
    --accent:       var(--color-primary-400, #60a5fa);
  }
}

/* 方案二：data-theme 属性切换（支持手动切换） */
[data-theme="dark"] {
  --bg:           var(--color-gray-900);
  --bg-card:      #1f2937;
  --text-primary: var(--color-gray-50);
  --border:       #374151;
}
```

```html
<!-- 切换按钮 -->
<button onclick="
  document.documentElement.dataset.theme =
    document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
" aria-label="切换深色模式">🌙</button>
```

---

## 5. Typography

### 系统字体栈

```css
:root {
  /* 无衬线（UI 首选） */
  --font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
               "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;

  /* 等宽（代码） */
  --font-mono: ui-monospace, "Cascadia Code", "Source Code Pro",
               Menlo, Monaco, Consolas, monospace;

  /* 衬线（长文章） */
  --font-serif: ui-serif, Georgia, Cambria, "Times New Roman", serif;
}

body { font-family: var(--font-sans); }
code, pre { font-family: var(--font-mono); }
```

### Google Fonts 引入方式对比

```html
<!-- ✅ 推荐：link（并行加载，支持 preconnect） -->
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
      rel="stylesheet" />

<!-- ⚠️ 不推荐：@import（串行加载，阻塞渲染） -->
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter&display=swap');
</style>
```

### 自托管字体（最佳性能）

```css
@font-face {
  font-family: "Inter";
  src: url("/fonts/inter-var.woff2") format("woff2");
  font-weight: 100 900;         /* 可变字体范围 */
  font-style: normal;
  font-display: swap;           /* 先显示系统字体，加载完成后替换 */
}
```

### 流式字体大小（clamp）

```css
/* clamp(最小值, 理想值, 最大值) */
/* 理想值通常用 vw 单位实现随视口缩放 */
h1 { font-size: clamp(1.75rem, 4vw + 1rem, 3.5rem); }
h2 { font-size: clamp(1.375rem, 2.5vw + 1rem, 2.25rem); }
p  { font-size: clamp(1rem, 1.2vw + 0.5rem, 1.125rem); }
```

### 段落可读性

```css
/* 正文区域 */
.prose {
  max-width: 65ch;          /* 约 65 个字符宽度，最佳阅读行长 */
  line-height: 1.7;         /* 正文推荐 1.6–1.8 */
  font-size: var(--text-base);
  color: var(--text-primary);
}

/* 标题行高更紧凑 */
h1, h2, h3 { line-height: 1.2; }

/* 段落间距 */
.prose p + p { margin-top: 1em; }

/* 字母间距（标题微调） */
h1 { letter-spacing: -0.025em; }
```

---

## 6. Accessibility

### WCAG 2.1 关键要求速查

| 类别 | 要求 | 级别 |
|------|------|------|
| 对比度（正文） | 文字与背景比 ≥ 4.5:1 | AA |
| 对比度（大字） | 18pt+ 或 14pt+ 粗体比 ≥ 3:1 | AA |
| 对比度（UI组件） | 图标、边框等 ≥ 3:1 | AA |
| 键盘导航 | 所有功能可通过键盘操作 | A |
| 焦点可见 | 焦点指示器清晰可见 | AA |
| 替代文字 | 所有非装饰性图片有 alt | A |
| 表单标签 | 每个 input 有关联 label | A |
| 语言声明 | `<html lang="...">` | A |

### 常用 ARIA Roles

```html
<!-- 地标角色（与语义元素对应） -->
<div role="banner">       <!-- = <header>（页级） -->
<div role="navigation">   <!-- = <nav> -->
<div role="main">         <!-- = <main> -->
<div role="complementary"><!-- = <aside> -->
<div role="contentinfo">  <!-- = <footer>（页级） -->
<div role="search">       <!-- 搜索区域 -->
<div role="form">         <!-- 表单区域 -->

<!-- 组件角色 -->
<div role="button">       <!-- 非 button 元素模拟按钮 -->
<div role="dialog">       <!-- 模态框 -->
<div role="alert">        <!-- 重要提示（自动读出） -->
<div role="status">       <!-- 状态消息（礼貌读出） -->
<div role="tablist">      <!-- 选项卡容器 -->
<div role="tab">          <!-- 选项卡标签 -->
<div role="tabpanel">     <!-- 选项卡内容 -->
<div role="tooltip">      <!-- 工具提示 -->
<div role="progressbar" aria-valuenow="70" aria-valuemin="0" aria-valuemax="100">
```

### Skip Navigation Link

```html
<!-- 放在 <body> 第一个元素 -->
<a href="#main-content" class="skip-link">跳至主内容</a>
<main id="main-content">...</main>
```

```css
.skip-link {
  position: absolute;
  top: -100%;
  left: 1rem;
  padding: 0.5rem 1rem;
  background: var(--accent);
  color: #fff;
  border-radius: var(--radius);
  z-index: 9999;
  transition: top var(--transition);
}
.skip-link:focus { top: 1rem; }
```

### 键盘可访问的自定义组件

```html
<!-- 自定义手风琴（无障碍版） -->
<div class="accordion">
  <button
    id="acc-btn-1"
    aria-expanded="false"
    aria-controls="acc-panel-1"
    class="accordion-trigger"
  >
    问题一
  </button>
  <div
    id="acc-panel-1"
    role="region"
    aria-labelledby="acc-btn-1"
    hidden
  >
    <p>答案内容……</p>
  </div>
</div>
```

```css
/* 焦点样式：不要移除 outline，要美化它 */
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

/* 隐藏视觉但保留屏幕阅读器可读 */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

### 图片 Alt 文本规范

```html
<!-- 有意义的图片：描述内容和功能 -->
<img src="chart.png" alt="2024年Q3销售额同比增长23%的柱状图" />

<!-- 链接内的图片：描述链接目的地 -->
<a href="/"><img src="logo.png" alt="返回首页" /></a>

<!-- 装饰性图片：空 alt（屏幕阅读器跳过） -->
<img src="divider.png" alt="" role="presentation" />

<!-- 复杂图表：用 aria-describedby 关联详细描述 -->
<img src="complex-chart.png" alt="销售趋势图"
     aria-describedby="chart-desc" />
<p id="chart-desc" class="sr-only">
  图表显示：1月100万、2月120万……（完整数据描述）
</p>
```

---

## 7. Forms

### 完整表单模板

```html
<form action="/submit" method="post" novalidate>

  <!-- 文本输入 -->
  <div class="field">
    <label for="name">
      姓名 <span class="required" aria-hidden="true">*</span>
    </label>
    <input type="text" id="name" name="name"
           required minlength="2" maxlength="50"
           autocomplete="name"
           aria-required="true"
           aria-describedby="name-hint name-error" />
    <p id="name-hint" class="hint">请输入真实姓名</p>
    <p id="name-error" class="error" role="alert" hidden>
      姓名不能少于2个字符
    </p>
  </div>

  <!-- 邮箱 -->
  <div class="field">
    <label for="email">邮箱地址 <span class="required" aria-hidden="true">*</span></label>
    <input type="email" id="email" name="email"
           required autocomplete="email"
           aria-required="true" />
  </div>

  <!-- 密码 -->
  <div class="field">
    <label for="password">密码</label>
    <input type="password" id="password" name="password"
           required minlength="8"
           pattern="(?=.*[A-Z])(?=.*[0-9]).{8,}"
           autocomplete="new-password"
           aria-describedby="pwd-hint" />
    <p id="pwd-hint" class="hint">至少8位，含大写字母和数字</p>
  </div>

  <!-- 选择框 -->
  <div class="field">
    <label for="country">国家</label>
    <select id="country" name="country" autocomplete="country">
      <option value="">请选择……</option>
      <option value="CN">中国</option>
      <option value="US">美国</option>
    </select>
  </div>

  <!-- 单选组（fieldset/legend） -->
  <fieldset>
    <legend>联系偏好 <span class="required" aria-hidden="true">*</span></legend>
    <label>
      <input type="radio" name="contact" value="email" required /> 邮件
    </label>
    <label>
      <input type="radio" name="contact" value="phone" /> 电话
    </label>
  </fieldset>

  <!-- 复选框 -->
  <fieldset>
    <legend>兴趣领域</legend>
    <label>
      <input type="checkbox" name="interests" value="design" /> 设计
    </label>
    <label>
      <input type="checkbox" name="interests" value="dev" /> 开发
    </label>
  </fieldset>

  <!-- 文件上传 -->
  <div class="field">
    <label for="avatar">头像</label>
    <input type="file" id="avatar" name="avatar"
           accept="image/png,image/jpeg,image/webp" />
  </div>

  <!-- 多行文本 -->
  <div class="field">
    <label for="message">留言</label>
    <textarea id="message" name="message"
              rows="4" maxlength="500"
              aria-describedby="msg-count"></textarea>
    <p id="msg-count" class="hint">最多 500 字</p>
  </div>

  <!-- 同意条款 -->
  <div class="field field--checkbox">
    <label>
      <input type="checkbox" name="agree" required aria-required="true" />
      我已阅读并同意<a href="/terms">服务条款</a>
    </label>
  </div>

  <button type="submit">提交</button>
</form>
```

### 表单样式（错误状态）

```css
.field { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 1.25rem; }
label  { font-weight: 500; font-size: var(--text-sm); color: var(--text-primary); }

input, select, textarea {
  width: 100%;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 1rem;           /* iOS 防缩放最低 16px */
  line-height: 1.5;
  background: var(--bg-card);
  color: var(--text-primary);
  transition: border-color var(--transition), box-shadow var(--transition);
}
input:focus, select:focus, textarea:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgb(59 130 246 / 0.25);
}

/* 无效状态（用 :user-invalid 优于 :invalid，避免初始即报错） */
input:user-invalid, select:user-invalid, textarea:user-invalid {
  border-color: #ef4444;
}
input:user-invalid:focus {
  box-shadow: 0 0 0 3px rgb(239 68 68 / 0.25);
}

.required { color: #ef4444; margin-left: 0.125rem; }
.hint  { font-size: var(--text-xs); color: var(--text-secondary); }
.error { font-size: var(--text-xs); color: #ef4444; }
```

---

## 8. Common Page Patterns

### a. Sticky Header with Scroll Shadow

```html
<header class="site-header">
  <a href="/" class="logo">Logo</a>
  <nav><!-- 导航内容 --></nav>
</header>
```

```css
.site-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--bg-card);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-6);
  height: 60px;
  /* 用 box-shadow transition 实现滚动阴影 */
  box-shadow: none;
  transition: box-shadow var(--transition);
}
.site-header.scrolled {
  box-shadow: var(--shadow);
}
```

```html
<script>
  const header = document.querySelector('.site-header');
  const observer = new IntersectionObserver(
    ([e]) => header.classList.toggle('scrolled', !e.isIntersecting),
    { rootMargin: '-1px 0px 0px 0px', threshold: [1] }
  );
  observer.observe(document.getElementById('scroll-sentinel'));
</script>
<!-- 在 header 下方放哨兵元素 -->
<div id="scroll-sentinel" style="height:1px"></div>
```

### b. Hero Section

```html
<section class="hero" aria-label="首页横幅">
  <div class="hero__content">
    <h1 class="hero__title">用更少代码，<br />做更多事情</h1>
    <p class="hero__subtitle">现代 Web 开发的最佳实践与工具。</p>
    <div class="hero__actions">
      <a href="/start" class="btn btn--primary">立即开始</a>
      <a href="/docs"  class="btn btn--outline">查看文档</a>
    </div>
  </div>
</section>
```

```css
.hero {
  min-height: 85svh;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--space-16) var(--space-6);
  background:
    linear-gradient(rgb(0 0 0 / 0.45), rgb(0 0 0 / 0.45)),
    url("/hero-bg.webp") center / cover no-repeat;
  color: #fff;
}
.hero__title    { font-size: clamp(2rem, 5vw + 1rem, 4rem); line-height: 1.1; }
.hero__subtitle { font-size: clamp(1rem, 2vw + 0.5rem, 1.375rem); max-width: 50ch; margin: 1rem auto; opacity: 0.9; }
.hero__actions  { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; margin-top: 2rem; }

.btn { padding: 0.75rem 1.75rem; border-radius: var(--radius); font-weight: 600; text-decoration: none; transition: all var(--transition); }
.btn--primary { background: var(--accent); color: #fff; }
.btn--primary:hover { background: var(--accent-hover); }
.btn--outline { border: 2px solid #fff; color: #fff; }
.btn--outline:hover { background: rgb(255 255 255 / 0.15); }
```

### c. Card Grid（响应式 3 列 → 1 列）

```html
<section aria-label="功能特点">
  <ul class="card-grid" role="list">
    <li class="card">
      <div class="card__icon" aria-hidden="true">⚡</div>
      <h3 class="card__title">极速性能</h3>
      <p class="card__body">经过优化，核心指标全绿。</p>
      <a href="/speed" class="card__link">了解更多 →</a>
    </li>
    <!-- 更多卡片 -->
  </ul>
</section>
```

```css
.card-grid {
  list-style: none;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
  gap: var(--space-6);
}
.card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-6);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  transition: box-shadow var(--transition), transform var(--transition);
}
.card:hover { box-shadow: var(--shadow-lg); transform: translateY(-2px); }
.card__link { margin-top: auto; color: var(--accent); font-weight: 500; text-decoration: none; }
.card__link:hover { text-decoration: underline; }
```

### d. 汉堡菜单（details/summary 纯 CSS）

```html
<nav class="mobile-nav" aria-label="移动端导航">
  <details class="nav-toggle">
    <summary aria-label="打开菜单">
      <span class="hamburger" aria-hidden="true"></span>
    </summary>
    <ul class="nav-menu">
      <li><a href="/about">关于</a></li>
      <li><a href="/blog">博客</a></li>
      <li><a href="/contact">联系</a></li>
    </ul>
  </details>
</nav>
```

```css
.nav-toggle summary { list-style: none; cursor: pointer; }
.nav-toggle summary::-webkit-details-marker { display: none; }

.hamburger, .hamburger::before, .hamburger::after {
  display: block; width: 24px; height: 2px;
  background: var(--text-primary);
  transition: transform var(--transition);
}
.hamburger { position: relative; }
.hamburger::before, .hamburger::after {
  content: ""; position: absolute; left: 0;
}
.hamburger::before { top: -7px; }
.hamburger::after  { top:  7px; }

/* 打开状态：变成 X */
details[open] .hamburger { background: transparent; }
details[open] .hamburger::before { transform: rotate(45deg) translate(5px, 5px); }
details[open] .hamburger::after  { transform: rotate(-45deg) translate(5px, -5px); }

.nav-menu {
  position: absolute; top: 100%; left: 0; right: 0;
  background: var(--bg-card);
  padding: var(--space-4);
  list-style: none;
  box-shadow: var(--shadow-lg);
}
```

### e. Modal Dialog（HTML `<dialog>` 元素）

```html
<button onclick="document.getElementById('my-dialog').showModal()">
  打开对话框
</button>

<dialog id="my-dialog" aria-labelledby="dialog-title" aria-describedby="dialog-desc">
  <form method="dialog">
    <header class="dialog-header">
      <h2 id="dialog-title">确认操作</h2>
      <button value="cancel" aria-label="关闭对话框" class="dialog-close">✕</button>
    </header>
    <p id="dialog-desc">此操作无法撤销，确定要继续吗？</p>
    <footer class="dialog-footer">
      <button value="cancel">取消</button>
      <button value="confirm" class="btn btn--primary">确认</button>
    </footer>
  </form>
</dialog>
```

```css
dialog {
  border: none;
  border-radius: var(--radius-lg);
  padding: 0;
  max-width: min(90vw, 480px);
  width: 100%;
  box-shadow: var(--shadow-lg);
  background: var(--bg-card);
  color: var(--text-primary);
}
dialog::backdrop {
  background: rgb(0 0 0 / 0.5);
  backdrop-filter: blur(4px);
}
.dialog-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--space-4) var(--space-6);
  border-bottom: 1px solid var(--border);
}
.dialog-close {
  background: none; border: none; cursor: pointer; font-size: 1.25rem;
  line-height: 1; padding: var(--space-1); border-radius: var(--radius-sm);
}
dialog > form > p { padding: var(--space-6); margin: 0; }
.dialog-footer {
  display: flex; gap: var(--space-3); justify-content: flex-end;
  padding: var(--space-4) var(--space-6);
  border-top: 1px solid var(--border);
}
```

### f. Toast Notification

```html
<div id="toast-container" class="toast-container" aria-live="polite" aria-atomic="false">
  <!-- Toast 动态插入 -->
</div>
```

```css
.toast-container {
  position: fixed; bottom: 1.5rem; right: 1.5rem;
  z-index: 9999;
  display: flex; flex-direction: column; gap: 0.75rem;
}
.toast {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: #1f2937; color: #f9fafb;
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  min-width: 260px; max-width: 380px;
  animation: toast-in 0.2s ease, toast-out 0.2s ease 3.8s forwards;
}
.toast--success { border-left: 4px solid #22c55e; }
.toast--error   { border-left: 4px solid #ef4444; }
.toast--info    { border-left: 4px solid #3b82f6; }

@keyframes toast-in  { from { opacity: 0; transform: translateX(100%); } }
@keyframes toast-out { to   { opacity: 0; transform: translateX(100%); } }
```

```html
<script>
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}
// 使用：showToast('保存成功！', 'success');
</script>
```

---

## 9. Performance

### 图片优化

```html
<!-- 响应式图片（srcset + sizes） -->
<img
  src="image-800w.jpg"
  srcset="image-400w.jpg 400w,
          image-800w.jpg 800w,
          image-1200w.jpg 1200w"
  sizes="(max-width: 640px) 100vw,
         (max-width: 1024px) 50vw,
         800px"
  alt="描述性文字"
  width="800"
  height="600"
  loading="lazy"
  decoding="async"
/>

<!-- 关键图片（LCP 候选）：不要 lazy，加 fetchpriority -->
<img src="hero.jpg" alt="..." width="1200" height="600" fetchpriority="high" />

<!-- WebP with PNG 回退 -->
<picture>
  <source srcset="image.avif" type="image/avif" />
  <source srcset="image.webp" type="image/webp" />
  <img src="image.jpg" alt="描述" width="800" height="600" loading="lazy" />
</picture>
```

### 关键 CSS Inline + 异步加载

```html
<head>
  <!-- 关键 CSS 内联（首屏渲染无阻塞） -->
  <style>
    /* 仅包含首屏可见内容的样式 */
    body { margin: 0; font-family: system-ui, sans-serif; }
    .hero { min-height: 100svh; display: flex; align-items: center; }
  </style>

  <!-- 非关键 CSS 异步加载 -->
  <link rel="preload" href="/styles/main.css" as="style"
        onload="this.onload=null;this.rel='stylesheet'" />
  <noscript><link rel="stylesheet" href="/styles/main.css" /></noscript>
</head>

<!-- Script 加载策略 -->
<!-- defer：按顺序，DOM 解析后执行（推荐用于大多数脚本） -->
<script src="/app.js" defer></script>

<!-- async：不保证顺序，下载完立即执行（适合独立脚本如分析） -->
<script src="/analytics.js" async></script>

<!-- type="module"：默认 defer，支持 import/export -->
<script type="module" src="/main.js"></script>
```

### Core Web Vitals 速查

| 指标 | 全称 | 定义 | 良好目标 | 改善方向 |
|------|------|------|----------|----------|
| **LCP** | Largest Contentful Paint | 最大内容元素渲染时间 | ≤ 2.5s | 优化图片、预加载字体、减少 TTFB、内联关键 CSS |
| **CLS** | Cumulative Layout Shift | 累计布局偏移分数 | ≤ 0.1 | 给图片/视频设置 width+height、避免动态插入内容 |
| **INP** | Interaction to Next Paint | 交互到下一帧延迟 | ≤ 200ms | 分解长任务、减少主线程阻塞、使用 Web Worker |

---

## 10. Common Pitfalls

### 不用 px 固定高度（用 min-height）

```css
/* ❌ 内容超出时溢出或截断 */
.card { height: 200px; }

/* ✅ 内容可自然撑开 */
.card { min-height: 200px; }
```

### 图片不设 width+height 导致 CLS

```html
<!-- ❌ 浏览器不知道图片尺寸，加载时页面跳动 -->
<img src="photo.jpg" alt="照片" />

<!-- ✅ 设置 width/height 让浏览器预留空间（CSS 可覆盖） -->
<img src="photo.jpg" alt="照片" width="800" height="600" />
```

```css
/* 保持比例自适应 */
img { max-width: 100%; height: auto; }
```

### 水平居中（Flexbox 时代）

```css
/* ❌ 旧写法：依赖 display:block + 固定宽度 */
.container { width: 960px; margin: 0 auto; }

/* ✅ 现代写法一：margin-inline: auto */
.container { max-width: 1280px; margin-inline: auto; padding-inline: 1.5rem; }

/* ✅ 现代写法二：place-items: center */
.parent { display: grid; place-items: center; min-height: 100vh; }

/* ✅ 现代写法三：Flexbox */
.parent { display: flex; justify-content: center; align-items: center; }
```

### position: absolute 的 Containing Block 问题

```css
/* ❌ 忘记给父级设置 position，子元素定位相对于意外的祖先 */
.parent { /* 没有 position */ }
.child  { position: absolute; top: 0; right: 0; } /* 相对于最近有 position 的祖先 */

/* ✅ 明确声明 containing block */
.parent { position: relative; }
.child  { position: absolute; top: 0; right: 0; }
```

### z-index Stacking Context 问题

```css
/* ❌ z-index 不生效或效果意外 */
.modal   { z-index: 9999; }  /* 但父级创建了新的 stacking context，困在里面 */

/* 以下属性会创建新 stacking context（z-index 在其内部重置）： */
/* opacity < 1 / transform / filter / isolation: isolate / will-change */

/* ✅ 方案一：使用 isolation: isolate 有意控制 stacking context */
.stacking-root { isolation: isolate; }

/* ✅ 方案二：将 modal 移至 body 顶层（使用 <dialog> 或 Popover API） */
dialog { /* 原生在 top layer，不受 z-index 问题影响 */ }
```

### iOS Safari 的 100vh 问题

```css
/* ❌ 100vh 在 iOS Safari 包含浏览器 UI 栏，导致内容被遮盖 */
.hero { min-height: 100vh; }

/* ✅ 使用动态视口单位（现代浏览器均支持） */
.hero { min-height: 100dvh; }  /* dvh = dynamic viewport height */

/* 回退方案 */
.hero {
  min-height: 100vh;
  min-height: 100dvh;  /* 支持时覆盖 */
}

/* 视口单位说明 */
/* svh = small viewport height（最小，UI 完全展开时） */
/* lvh = large viewport height（最大，UI 完全收起时） */
/* dvh = dynamic viewport height（动态跟随 UI 变化） */
```

### 表单 input 在 iOS 的字体缩放问题

```css
/* ❌ font-size < 16px 时，iOS Safari 会自动缩放页面（用户体验差） */
input { font-size: 14px; }

/* ✅ 表单元素 font-size 最低 16px */
input, select, textarea { font-size: 1rem; /* = 16px */ }

/* 如果设计要求视觉上更小，可配合 transform 缩小 */
.small-input {
  font-size: 1rem;          /* 保持 16px 防缩放 */
  transform: scale(0.875);  /* 视觉上缩小为 14px 效果 */
  transform-origin: left center;
}
```

---

*参考资料：[MDN Web Docs](https://developer.mozilla.org/zh-CN/) · [web.dev](https://web.dev/) · [WCAG 2.1](https://www.w3.org/TR/WCAG21/) · [Can I use](https://caniuse.com/)*
