# Email Template Guide

HTML 邮件开发是前端开发中最特殊的领域之一。现代 Web 标准在这里几乎全部失效，你必须回到 2000 年代的开发方式：table 布局、inline style、条件注释。本文档是可直接使用的速查参考。

---

## 1. Why Email HTML is Different

### 主流客户端支持对比

| 特性 | Gmail | Outlook 2016-2021 | Outlook 365 | Apple Mail | Yahoo Mail |
|------|-------|-------------------|-------------|------------|------------|
| CSS `<style>` 标签 | ✅ 支持（剥离 class） | ⚠️ 部分 | ✅ 支持 | ✅ 支持 | ✅ 支持 |
| Inline style | ✅ | ✅ | ✅ | ✅ | ✅ |
| Media queries | ✅ | ❌ | ✅ | ✅ | ✅ |
| Flexbox | ❌ | ❌ | ❌ | ✅ | ❌ |
| CSS Grid | ❌ | ❌ | ❌ | ✅ | ❌ |
| CSS shorthand | ⚠️ 部分 | ❌ | ⚠️ 部分 | ✅ | ⚠️ 部分 |
| `background-image` | ❌ | ❌ | ❌ | ✅ | ⚠️ |
| SVG | ❌ | ❌ | ❌ | ✅ | ❌ |
| Web fonts (`@font-face`) | ❌ | ❌ | ❌ | ✅ | ❌ |
| VML | N/A | ✅ | ✅ | N/A | N/A |
| Dark mode (`prefers-color-scheme`) | ✅ | ❌ | ✅ | ✅ | ✅ |

### 各客户端主要限制

**Gmail**
- 剥离 `<head>` 内 `<style>` 中的 class 选择器（非 inline 的 class 样式失效）
- 不支持 `<link>` 外部样式表
- 不支持 `background-image`
- 邮件超过 102KB 会被截断并显示"查看完整邮件"

**Outlook 2016/2019/2021（Windows）**
- 使用 **Word 渲染引擎**，不是 Webkit/Blink
- 不支持 Flexbox、Grid、CSS shorthand
- `padding` 只在 `<td>` 上可靠
- `margin` 在多数元素上不生效
- `border-radius` 不支持（需 VML 实现圆角）
- 图片之间有默认间距（需设 `display:block`）

**Outlook 365（Web）**
- 比桌面端支持更好，但仍有限制
- 会剥离部分 CSS 属性

**Apple Mail**
- 支持最好，接近完整 Web 标准
- 支持 `@font-face`、Flexbox、SVG、`background-image`
- 深色模式自动反色，需要手动处理

**Yahoo Mail**
- 支持 `<style>` 标签，但会剥离部分属性
- 不支持 `background-image`

### 核心开发原则

1. **用 `<table>` 做布局**，不用 `<div>` + Flexbox/Grid
2. **所有样式写 inline**（`style="..."`），不依赖 class
3. **不用 CSS shorthand**，展开写每个属性（`padding-top`、`padding-right`...）
4. **不用 `em`/`rem`**，字号统一用 `px`
5. **图片用绝对 URL**，不用相对路径
6. **所有 `<img>` 必须有 `alt`、`width`、`height`、`border="0"`**
7. **MSO 条件注释**处理 Outlook 特有问题
8. **邮件体积控制在 100KB 以内**（含 HTML）

---

## 2. File Structure

### 完整 HTML 邮件骨架

```html
<!DOCTYPE html>
<html lang="zh-CN" xmlns="http://www.w3.org/1999/xhtml"
      xmlns:v="urn:schemas-microsoft-com:vml"
      xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <!-- 禁用 iOS 自动识别电话号码 -->
  <meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
  <!-- 强制 IE 使用最新渲染引擎 -->
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <!-- 响应式视口 -->
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>邮件标题</title>

  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->

  <style type="text/css">
    /* 全局重置 */
    body, table, td, a {
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }
    table, td {
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
    }
    img {
      -ms-interpolation-mode: bicubic;
    }

    /* 防止 Gmail 蓝色链接 */
    a[x-apple-data-detectors] {
      color: inherit !important;
      text-decoration: none !important;
    }

    /* 响应式：小屏处理（见第7章） */
    @media screen and (max-width: 600px) {
      .mobile-full { width: 100% !important; }
      .mobile-hide { display: none !important; }
      .mobile-font { font-size: 16px !important; line-height: 24px !important; }
    }

    /* 深色模式（见第8章） */
    @media (prefers-color-scheme: dark) {
      .dark-bg { background-color: #1a1a2e !important; }
      .dark-text { color: #e0e0e0 !important; }
    }
  </style>
</head>

<body style="margin: 0; padding: 0; background-color: #f4f4f4; word-spacing: normal;">

  <!-- 预览文字：在收件箱列表中显示，用不换行空格填充防止泄露内容 -->
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
    这里是预览摘要文字，建议 40-130 个字符。
    &nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <!-- 邮件外层容器 -->
  <table role="presentation" border="0" cellpadding="0" cellspacing="0"
         width="100%" style="border-collapse: collapse; background-color: #f4f4f4;">
    <tr>
      <td align="center" style="padding: 20px 0;">

        <!-- 内容区域（最大宽度 600px） -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0"
               width="600" style="border-collapse: collapse; max-width: 600px; width: 100%;">
          <tr>
            <td style="background-color: #ffffff; padding: 0;">
              <!-- 在这里放内容模块 -->
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>

</body>
</html>
```

### 必须的 meta 标签说明

| meta 标签 | 作用 |
|-----------|------|
| `charset="UTF-8"` | 字符编码，支持中文 |
| `format-detection` | 禁止 iOS 自动把数字变成可点击链接 |
| `X-UA-Compatible` | 强制 IE/旧版 Outlook 用最新引擎 |
| `viewport` | 移动端正确缩放 |

### MSO 条件注释类型

```html
<!--[if mso]> 仅 Outlook（所有版本）可见 <![endif]-->
<!--[if mso 16]> 仅 Outlook 2016 可见 <![endif]-->
<!--[if !mso]><!--> 非 Outlook 可见 <!--<![endif]-->
<!--[if (gte mso 9)&(lte mso 11)]> Outlook 2000-2003 <![endif]-->
```

---

## 3. Layout: Table-Based

### 为什么必须用 table

Outlook（Windows）使用 **Microsoft Word 的 HTML 渲染引擎**，完全不理解 CSS 盒模型的现代用法。`<div>` + `float`、Flexbox、Grid 在 Outlook 中行为不可预测。`<table>` 是唯一跨客户端可靠的布局方式。

### table 的必要属性

```html
<table
  role="presentation"
  border="0"
  cellpadding="0"
  cellspacing="0"
  width="600"
  style="border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt;">
```

- `role="presentation"` — 告诉屏幕阅读器这是布局用途，不是数据表格
- `border="0"` — 去除默认边框（HTML 属性，兼容性更好）
- `cellpadding="0" cellspacing="0"` — 去除默认间距
- `mso-table-lspace/rspace: 0pt` — 消除 Outlook 在 table 两侧添加的空白

### 单列布局完整示例

```html
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"
       style="border-collapse: collapse;">
  <tr>
    <td align="center" style="padding: 0;">

      <!-- 内容容器，最大 600px -->
      <table role="presentation" border="0" cellpadding="0" cellspacing="0"
             width="600" style="border-collapse: collapse; max-width: 600px; width: 100%;">

        <!-- Header -->
        <tr>
          <td style="background-color: #0066cc; padding: 24px 32px; text-align: center;">
            <img src="https://example.com/logo.png" alt="品牌 Logo"
                 width="150" height="40" border="0"
                 style="display: block; margin: 0 auto;">
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="background-color: #ffffff; padding: 32px;">
            <p style="margin: 0 0 16px 0; font-family: Arial, sans-serif;
                       font-size: 16px; line-height: 24px; color: #333333;">
              正文内容段落。
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background-color: #f4f4f4; padding: 16px 32px; text-align: center;">
            <p style="margin: 0; font-family: Arial, sans-serif;
                       font-size: 12px; line-height: 18px; color: #999999;">
              © 2025 品牌名称
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
```

### 两列布局完整示例（含移动端堆叠）

```html
<!-- 外层容器 -->
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600"
       style="border-collapse: collapse;">
  <tr>
    <!-- 左列 -->
    <td class="mobile-full" valign="top" width="300"
        style="width: 300px; padding: 0; background-color: #ffffff;">
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"
             style="border-collapse: collapse;">
        <tr>
          <td style="padding: 24px 20px 24px 32px;">
            <h2 style="margin: 0 0 8px 0; font-family: Arial, sans-serif;
                        font-size: 20px; line-height: 28px; color: #222222;">
              左列标题
            </h2>
            <p style="margin: 0; font-family: Arial, sans-serif;
                       font-size: 15px; line-height: 22px; color: #555555;">
              左列内容文字。
            </p>
          </td>
        </tr>
      </table>
    </td>

    <!-- 右列 -->
    <td class="mobile-full" valign="top" width="300"
        style="width: 300px; padding: 0; background-color: #f0f0f0;">
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"
             style="border-collapse: collapse;">
        <tr>
          <td style="padding: 24px 32px 24px 20px;">
            <h2 style="margin: 0 0 8px 0; font-family: Arial, sans-serif;
                        font-size: 20px; line-height: 28px; color: #222222;">
              右列标题
            </h2>
            <p style="margin: 0; font-family: Arial, sans-serif;
                       font-size: 15px; line-height: 22px; color: #555555;">
              右列内容文字。
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<!-- 移动端堆叠处理（在 <style> 中） -->
<!--
@media screen and (max-width: 600px) {
  .mobile-full {
    display: block !important;
    width: 100% !important;
    max-width: 100% !important;
  }
}
-->
```

---

## 4. Inline CSS Rules

### 支持好的 CSS 属性

| 属性 | 说明 |
|------|------|
| `background-color` | 背景色，可靠 |
| `color` | 文字颜色 |
| `font-family` | 字体，需要回退栈 |
| `font-size` | 用 px |
| `font-weight` | `bold` 或 `normal` |
| `font-style` | `italic` |
| `text-align` | 文字对齐 |
| `text-decoration` | 下划线等 |
| `line-height` | 不带单位（如 `1.5`）或 px |
| `padding-top/right/bottom/left` | 分开写，不用简写 |
| `margin-top/right/bottom/left` | 分开写，`<td>` 上才可靠 |
| `width` / `height` | 用 px 或 % |
| `border-top/right/bottom/left` | 分开写 |
| `display: block` | 图片必须加 |
| `vertical-align` | td 对齐 |

### 不支持或支持差的属性

| 属性 | 问题 |
|------|------|
| `display: flex` | Outlook / Gmail 不支持 |
| `display: grid` | 同上 |
| `float` | Outlook 行为不可预测 |
| `position` | 邮件中基本不可用 |
| `background-image` | Gmail / Outlook 不支持 |
| `border-radius` | Outlook 不支持 |
| `box-shadow` | Outlook / Gmail 不支持 |
| `transition` / `animation` | 多数客户端不支持 |
| `max-width` 单独使用 | Outlook 忽略，需配合 `width` |

### CSS Shorthand 的问题

Outlook Word 引擎无法正确解析 CSS shorthand，必须展开写：

```html
<!-- ❌ 错误写法：Outlook 可能忽略 -->
<td style="padding: 20px 32px; border: 1px solid #cccccc; font: bold 16px/24px Arial, sans-serif;">

<!-- ✅ 正确写法：逐个属性展开 -->
<td style="
  padding-top: 20px;
  padding-right: 32px;
  padding-bottom: 20px;
  padding-left: 32px;
  border-top: 1px solid #cccccc;
  border-right: 1px solid #cccccc;
  border-bottom: 1px solid #cccccc;
  border-left: 1px solid #cccccc;
  font-family: Arial, sans-serif;
  font-size: 16px;
  font-weight: bold;
  line-height: 24px;">
```

### 使用 scripts/inline_css.py 自动 inline

如果项目中有 `scripts/inline_css.py`，可以在 `<style>` 中写 class，然后用脚本自动 inline：

```html
<!-- 开发时写 class（方便维护） -->
<td class="content-cell">
  <p class="body-text">文字内容</p>
</td>
```

```html
<!-- 构建后输出（inline_css.py 处理结果） -->
<td style="padding-top: 24px; padding-right: 32px; padding-bottom: 24px; padding-left: 32px; background-color: #ffffff;">
  <p style="margin: 0 0 16px 0; font-family: Arial, sans-serif; font-size: 16px; line-height: 24px; color: #333333;">文字内容</p>
</td>
```

推荐工具：[Premailer](https://github.com/peterbe/premailer)（Python）、[juice](https://github.com/Automattic/juice)（Node.js）

---

## 5. Typography

### Web-safe 字体栈

```html
<!-- 无衬线（推荐正文） -->
style="font-family: Arial, Helvetica, sans-serif;"

<!-- 衬线 -->
style="font-family: Georgia, 'Times New Roman', Times, serif;"

<!-- 等宽 -->
style="font-family: 'Courier New', Courier, monospace;"

<!-- 中文友好（加入中文字体回退） -->
style="font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif;"
```

### 字体大小建议

| 用途 | 推荐大小 | 说明 |
|------|----------|------|
| 大标题 H1 | 28-36px | 移动端可用 media query 缩小 |
| 小标题 H2 | 20-24px | |
| 正文 | 14-16px | 最小不低于 14px |
| 辅助文字 / Footer | 12px | |
| 按钮文字 | 16-18px | |

**注意**：不用 `em`/`rem`，邮件客户端的根字号不可控。

### 行高（line-height）

```html
<!-- 推荐：不带单位的数值，相对于 font-size 计算 -->
style="line-height: 1.5;"

<!-- 或者直接写 px，更安全 -->
style="font-size: 16px; line-height: 24px;"

<!-- ❌ 不要用 em（部分客户端不识别） -->
style="line-height: 1.5em;"
```

### 链接样式

```html
<!-- 链接需要 inline style，不要依赖 a:hover（Outlook 不支持） -->
<a href="https://example.com"
   style="color: #0066cc; text-decoration: underline; font-family: Arial, sans-serif;">
  链接文字
</a>

<!-- 防止 Gmail 把链接变成蓝色（在 <style> 中加） -->
<!--
a[x-apple-data-detectors],
u + #body a,
#MessageViewBody a {
  color: inherit !important;
  text-decoration: none !important;
  font-size: inherit !important;
}
-->
```

---

## 6. Images

### 必须的属性

```html
<!-- 标准图片写法 -->
<img
  src="https://cdn.example.com/images/banner.jpg"
  alt="Banner 描述文字"
  width="600"
  height="300"
  border="0"
  style="display: block; max-width: 100%; height: auto; -ms-interpolation-mode: bicubic;">
```

| 属性 | 必要性 | 原因 |
|------|--------|------|
| `alt` | 必须 | 图片被屏蔽时显示文字；无障碍访问 |
| `width` / `height` | 必须 | 图片未加载时占位，避免布局跳动 |
| `border="0"` | 必须 | 旧版 IE / Outlook 会给图片加边框 |
| `display: block` | 必须 | 消除图片下方默认 4px 间距（Outlook 严重） |
| 绝对 URL | 必须 | 邮件客户端无法解析相对路径 |

### 图片被屏蔽的降级

```html
<!-- 有意义的 alt + 背景色 = 即使图片屏蔽也不难看 -->
<td style="background-color: #0066cc; text-align: center;">
  <img src="https://cdn.example.com/logo.png"
       alt="品牌 Logo"
       width="160" height="48" border="0"
       style="display: block; margin: 0 auto; color: #ffffff;
              font-family: Arial, sans-serif; font-size: 14px;">
</td>
```

### Outlook VML 背景图片

Outlook 不支持 CSS `background-image`，需要 VML：

```html
<!--[if gte mso 9]>
<v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false"
        style="width: 600px; height: 300px;">
  <v:fill type="frame" src="https://cdn.example.com/hero.jpg" color="#0066cc"/>
  <v:textbox inset="0,0,0,0">
<![endif]-->
<div style="background-image: url('https://cdn.example.com/hero.jpg');
            background-color: #0066cc; background-size: cover;
            background-position: center; min-height: 300px; padding: 40px;">
  <!-- 背景图上的内容 -->
  <p style="color: #ffffff; font-family: Arial, sans-serif; font-size: 24px;">
    Hero 标题
  </p>
</div>
<!--[if gte mso 9]>
    </v:textbox>
  </v:rect>
<![endif]-->
```

### Retina 图片（2x）

```html
<!-- 实际图片 1200x600，显示 600x300，看起来清晰 -->
<img src="https://cdn.example.com/banner@2x.jpg"
     alt="Banner"
     width="600"
     height="300"
     border="0"
     style="display: block; width: 600px; height: 300px; max-width: 100%;">
```

---

## 7. Responsive Email

### Media Query 在邮件中的支持

| 客户端 | 支持 media query |
|--------|-----------------|
| Gmail App（Android/iOS） | ✅（2019 年后） |
| Gmail Web | ✅ |
| Outlook 2016-2021（Windows） | ❌ |
| Outlook 365（Web） | ✅ |
| Apple Mail | ✅ |
| Yahoo Mail | ✅ |

**Outlook 不支持 media query**，因此要用"mobile-first fluid"方案作为基础，再用 media query 增强。

### Fluid Layout 方案（不依赖 media query）

```html
<!-- 内容容器：用 max-width + width: 100% 实现流体 -->
<table role="presentation" border="0" cellpadding="0" cellspacing="0"
       style="border-collapse: collapse; max-width: 600px; width: 100%;">
```

这样在 Outlook 中宽度固定 600px，在其他客户端上如果视口小于 600px 会自动缩小。

### 完整 Media Query 写法

```html
<style type="text/css">
  @media screen and (max-width: 600px) {

    /* 容器全宽 */
    .email-wrapper { width: 100% !important; }

    /* 两列变单列 */
    .col-half {
      display: block !important;
      width: 100% !important;
      max-width: 100% !important;
    }

    /* 调整内边距 */
    .content-cell {
      padding-top: 16px !important;
      padding-right: 20px !important;
      padding-bottom: 16px !important;
      padding-left: 20px !important;
    }

    /* 隐藏某些元素 */
    .mobile-hide {
      display: none !important;
      max-height: 0 !important;
      overflow: hidden !important;
    }

    /* 全宽图片 */
    .img-full {
      width: 100% !important;
      height: auto !important;
    }
  }
</style>
```

### 移动端字体覆盖

```html
<style type="text/css">
  @media screen and (max-width: 600px) {
    /* 覆盖 inline style 中的字号 */
    .mobile-title {
      font-size: 22px !important;
      line-height: 30px !important;
    }
    .mobile-body {
      font-size: 15px !important;
      line-height: 23px !important;
    }
    /* 按钮全宽 */
    .mobile-btn {
      display: block !important;
      width: 100% !important;
      text-align: center !important;
    }
  }
</style>
```

---

## 8. Dark Mode

### 支持深色模式的客户端

| 客户端 | 支持方式 |
|--------|----------|
| Apple Mail | `@media (prefers-color-scheme: dark)` |
| Outlook 2019/365（macOS） | `@media (prefers-color-scheme: dark)` |
| Gmail（iOS/Android） | 自动反色（需处理） |
| Outlook iOS | `[data-ogsc]` 属性选择器 |
| Yahoo Mail | `@media (prefers-color-scheme: dark)` |

### 完整深色模式示例

```html
<style type="text/css">
  /* ===== 深色模式 ===== */

  /* 标准 media query（Apple Mail、Gmail Web、Yahoo 等） */
  @media (prefers-color-scheme: dark) {
    .dark-bg        { background-color: #1e1e2e !important; }
    .dark-card      { background-color: #2a2a3e !important; }
    .dark-text      { color: #e0e0e0 !important; }
    .dark-subtext   { color: #a0a0b0 !important; }
    .dark-border    { border-color: #444466 !important; }
    .dark-btn-bg    { background-color: #4488ff !important; }
    .dark-btn-text  { color: #ffffff !important; }

    /* 图片在深色模式下降低亮度（避免刺眼） */
    .dark-img { filter: brightness(0.9) !important; }
  }

  /* Outlook iOS 使用 [data-ogsc] 属性选择器 */
  [data-ogsc] .dark-bg      { background-color: #1e1e2e !important; }
  [data-ogsc] .dark-card    { background-color: #2a2a3e !important; }
  [data-ogsc] .dark-text    { color: #e0e0e0 !important; }
  [data-ogsc] .dark-subtext { color: #a0a0b0 !important; }
  [data-ogsc] .dark-btn-bg  { background-color: #4488ff !important; }
</style>

<!-- HTML 使用方式 -->
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600"
       style="border-collapse: collapse; background-color: #ffffff;">
  <tr>
    <td class="dark-card"
        style="background-color: #ffffff; padding-top: 32px; padding-right: 32px;
               padding-bottom: 32px; padding-left: 32px;">
      <p class="dark-text"
         style="margin: 0; font-family: Arial, sans-serif; font-size: 16px;
                line-height: 24px; color: #333333;">
        正文文字（深色模式下自动变浅色）
      </p>
    </td>
  </tr>
</table>
```

---

## 9. Bulletproof Buttons

### table + td 实现（兼容所有 Outlook）

```html
<table role="presentation" border="0" cellpadding="0" cellspacing="0"
       style="border-collapse: collapse;">
  <tr>
    <td align="center" style="padding-top: 24px; padding-bottom: 24px;">

      <!-- Outlook 不支持 border-radius，所以这里用方形按钮兜底 -->
      <table role="presentation" border="0" cellpadding="0" cellspacing="0"
             style="border-collapse: collapse;">
        <tr>
          <td align="center" bgcolor="#0066cc"
              style="border-radius: 4px; background-color: #0066cc;">
            <a href="https://example.com/action"
               target="_blank"
               style="display: inline-block;
                      padding-top: 14px;
                      padding-right: 28px;
                      padding-bottom: 14px;
                      padding-left: 28px;
                      font-family: Arial, sans-serif;
                      font-size: 16px;
                      font-weight: bold;
                      line-height: 1;
                      color: #ffffff;
                      text-decoration: none;
                      border-radius: 4px;
                      background-color: #0066cc;
                      mso-padding-alt: 14px 28px;">
              立即行动
            </a>
          </td>
        </tr>
      </table>

    </td>
  </tr>
</table>
```

### VML 圆角按钮（Outlook 完美圆角）

```html
<table role="presentation" border="0" cellpadding="0" cellspacing="0">
  <tr>
    <td align="center" style="padding-top: 24px; padding-bottom: 24px;">

      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml"
                   xmlns:w="urn:schemas-microsoft-com:office:word"
                   href="https://example.com/action"
                   style="height: 48px; v-text-anchor: middle; width: 200px;"
                   arcsize="10%" strokecolor="#0066cc" fillcolor="#0066cc">
        <w:anchorlock/>
        <center style="color: #ffffff; font-family: Arial, sans-serif;
                       font-size: 16px; font-weight: bold;">
          立即行动
        </center>
      </v:roundrect>
      <![endif]-->

      <!--[if !mso]><!-->
      <a href="https://example.com/action"
         target="_blank"
         style="display: inline-block;
                padding-top: 14px;
                padding-right: 32px;
                padding-bottom: 14px;
                padding-left: 32px;
                font-family: Arial, sans-serif;
                font-size: 16px;
                font-weight: bold;
                line-height: 20px;
                color: #ffffff;
                text-decoration: none;
                border-radius: 24px;
                background-color: #0066cc;">
        立即行动
      </a>
      <!--<![endif]-->

    </td>
  </tr>
</table>
```

---

## 10. Complete Template

以下是一个完整营销邮件模板，包含 header、hero、正文、CTA 和 footer：

```html
<!DOCTYPE html>
<html lang="zh-CN"
      xmlns="http://www.w3.org/1999/xhtml"
      xmlns:v="urn:schemas-microsoft-com:vml"
      xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>限时优惠 | 品牌名称</title>

  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings>
    <o:PixelsPerInch>96</o:PixelsPerInch>
  </o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->

  <style type="text/css">
    /* Reset */
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; }

    /* 防止客户端自动识别内容 */
    a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
    u + #body a { color: inherit !important; text-decoration: none !important; }
    #MessageViewBody a { color: inherit !important; text-decoration: none !important; }

    /* ===== 响应式 ===== */
    @media screen and (max-width: 600px) {
      .email-wrapper  { width: 100% !important; }
      .col-half       { display: block !important; width: 100% !important; }
      .content-cell   { padding-top: 20px !important; padding-right: 20px !important;
                        padding-bottom: 20px !important; padding-left: 20px !important; }
      .mobile-title   { font-size: 24px !important; line-height: 32px !important; }
      .mobile-hide    { display: none !important; }
      .img-full       { width: 100% !important; height: auto !important; }
      .btn-full       { display: block !important; width: 100% !important; }
    }

    /* ===== 深色模式 ===== */
    @media (prefers-color-scheme: dark) {
      .dark-bg     { background-color: #1a1a2e !important; }
      .dark-card   { background-color: #252540 !important; }
      .dark-text   { color: #e0e0e0 !important; }
      .dark-muted  { color: #9090a8 !important; }
    }
    [data-ogsc] .dark-bg   { background-color: #1a1a2e !important; }
    [data-ogsc] .dark-card { background-color: #252540 !important; }
    [data-ogsc] .dark-text { color: #e0e0e0 !important; }
  </style>
</head>

<!-- id="body" 用于 Gmail 的 CSS 选择器 -->
<body id="body" style="margin: 0; padding: 0; background-color: #f0f0f0; word-spacing: normal;">

  <!-- ==================== 预览文字 ==================== -->
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
    限时 7 折优惠，仅剩 48 小时！专属好礼等你来领。
    &nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
    &nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <!-- ==================== 最外层容器 ==================== -->
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"
         class="dark-bg"
         style="border-collapse: collapse; background-color: #f0f0f0;">
    <tr>
      <td align="center" style="padding-top: 24px; padding-bottom: 24px;">

        <!-- ====== 邮件主体（max-width: 600px） ====== -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0"
               class="email-wrapper"
               style="border-collapse: collapse; max-width: 600px; width: 100%;">

          <!-- ==================== HEADER / LOGO ==================== -->
          <tr>
            <td style="background-color: #0a0a23; padding-top: 20px; padding-right: 32px;
                        padding-bottom: 20px; padding-left: 32px; text-align: center;">
              <!-- Logo 图片 -->
              <img src="https://cdn.example.com/logo-white.png"
                   alt="品牌名称"
                   width="140" height="38" border="0"
                   style="display: block; margin-top: 0; margin-right: auto;
                          margin-bottom: 0; margin-left: auto;">
            </td>
          </tr>

          <!-- ==================== HERO IMAGE ==================== -->
          <tr>
            <td style="padding: 0; background-color: #0a0a23;">
              <img src="https://cdn.example.com/hero-banner.jpg"
                   alt="限时 7 折优惠活动"
                   width="600" height="280" border="0"
                   class="img-full"
                   style="display: block; width: 600px; height: auto; max-width: 100%;">
            </td>
          </tr>

          <!-- ==================== 主标题区 ==================== -->
          <tr>
            <td class="dark-card content-cell"
                style="background-color: #ffffff;
                       padding-top: 36px; padding-right: 48px;
                       padding-bottom: 28px; padding-left: 48px;
                       text-align: center;">
              <h1 class="mobile-title dark-text"
                  style="margin-top: 0; margin-right: 0; margin-bottom: 12px; margin-left: 0;
                         font-family: Arial, Helvetica, sans-serif;
                         font-size: 30px; font-weight: bold;
                         line-height: 38px; color: #111111;">
                限时 7 折，专属礼遇
              </h1>
              <p class="dark-muted"
                 style="margin-top: 0; margin-right: 0; margin-bottom: 0; margin-left: 0;
                        font-family: Arial, Helvetica, sans-serif;
                        font-size: 14px; line-height: 20px; color: #777777;">
                活动截止：2025 年 8 月 31 日 23:59
              </p>
            </td>
          </tr>

          <!-- ==================== 正文内容 ==================== -->
          <tr>
            <td class="dark-card content-cell"
                style="background-color: #ffffff;
                       padding-top: 0; padding-right: 48px;
                       padding-bottom: 32px; padding-left: 48px;">
              <p class="dark-text"
                 style="margin-top: 0; margin-right: 0; margin-bottom: 16px; margin-left: 0;
                        font-family: Arial, Helvetica, sans-serif;
                        font-size: 16px; line-height: 26px; color: #444444;">
                亲爱的用户，
              </p>
              <p class="dark-text"
                 style="margin-top: 0; margin-right: 0; margin-bottom: 16px; margin-left: 0;
                        font-family: Arial, Helvetica, sans-serif;
                        font-size: 16px; line-height: 26px; color: #444444;">
                感谢你一直以来的支持。为回馈忠实用户，我们特别推出本次专属优惠活动。全场精选商品限时 7 折，数量有限，先到先得。
              </p>
              <p class="dark-text"
                 style="margin-top: 0; margin-right: 0; margin-bottom: 0; margin-left: 0;
                        font-family: Arial, Helvetica, sans-serif;
                        font-size: 16px; line-height: 26px; color: #444444;">
                活动期间购物满 ¥199 还可享受免费配送，订单 24 小时内发出。
              </p>
            </td>
          </tr>

          <!-- ==================== 两列特色商品 ==================== -->
          <tr>
            <td class="dark-card"
                style="background-color: #ffffff;
                       padding-top: 0; padding-right: 48px;
                       padding-bottom: 32px; padding-left: 48px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"
                     style="border-collapse: collapse;">
                <tr>
                  <!-- 商品 1 -->
                  <td class="col-half" valign="top" width="240"
                      style="width: 240px; padding-right: 12px;">
                    <img src="https://cdn.example.com/product-1.jpg"
                         alt="商品一名称"
                         width="240" height="160" border="0"
                         class="img-full"
                         style="display: block; width: 240px; height: auto;
                                max-width: 100%; border-radius: 4px;">
                    <p style="margin-top: 10px; margin-right: 0; margin-bottom: 4px; margin-left: 0;
                               font-family: Arial, sans-serif; font-size: 15px;
                               font-weight: bold; line-height: 22px; color: #222222;">
                      商品一名称
                    </p>
                    <p style="margin: 0; font-family: Arial, sans-serif;
                               font-size: 14px; line-height: 20px; color: #e05500;">
                      ¥139 <span style="color: #999999; text-decoration: line-through;">¥199</span>
                    </p>
                  </td>
                  <!-- 商品 2 -->
                  <td class="col-half" valign="top" width="240"
                      style="width: 240px; padding-left: 12px;">
                    <img src="https://cdn.example.com/product-2.jpg"
                         alt="商品二名称"
                         width="240" height="160" border="0"
                         class="img-full"
                         style="display: block; width: 240px; height: auto;
                                max-width: 100%; border-radius: 4px;">
                    <p style="margin-top: 10px; margin-right: 0; margin-bottom: 4px; margin-left: 0;
                               font-family: Arial, sans-serif; font-size: 15px;
                               font-weight: bold; line-height: 22px; color: #222222;">
                      商品二名称
                    </p>
                    <p style="margin: 0; font-family: Arial, sans-serif;
                               font-size: 14px; line-height: 20px; color: #e05500;">
                      ¥209 <span style="color: #999999; text-decoration: line-through;">¥299</span>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ==================== CTA 按钮 ==================== -->
          <tr>
            <td class="dark-card"
                style="background-color: #ffffff; padding-top: 8px; padding-right: 48px;
                        padding-bottom: 40px; padding-left: 48px; text-align: center;">

              <!-- VML 圆角按钮（Outlook） -->
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml"
                           xmlns:w="urn:schemas-microsoft-com:office:word"
                           href="https://example.com/shop?ref=email"
                           style="height: 52px; v-text-anchor: middle; width: 220px;"
                           arcsize="10%" strokecolor="#cc3300" fillcolor="#ff4400">
                <w:anchorlock/>
                <center style="color: #ffffff; font-family: Arial, sans-serif;
                               font-size: 18px; font-weight: bold;">
                  立即抢购 &rarr;
                </center>
              </v:roundrect>
              <![endif]-->

              <!--[if !mso]><!-->
              <a href="https://example.com/shop?ref=email"
                 target="_blank"
                 class="btn-full"
                 style="display: inline-block;
                        padding-top: 16px; padding-right: 40px;
                        padding-bottom: 16px; padding-left: 40px;
                        font-family: Arial, Helvetica, sans-serif;
                        font-size: 18px; font-weight: bold;
                        line-height: 22px; color: #ffffff;
                        text-decoration: none;
                        background-color: #ff4400;
                        border-radius: 6px;">
                立即抢购 &rarr;
              </a>
              <!--<![endif]-->

            </td>
          </tr>

          <!-- ==================== 分割线 ==================== -->
          <tr>
            <td style="background-color: #ffffff; padding-top: 0; padding-right: 48px;
                        padding-bottom: 0; padding-left: 48px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"
                     style="border-collapse: collapse;">
                <tr>
                  <td style="border-top: 1px solid #eeeeee; font-size: 0; line-height: 0; height: 1px;">
                    &nbsp;
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ==================== FOOTER ==================== -->
          <tr>
            <td style="background-color: #f8f8f8; padding-top: 24px; padding-right: 48px;
                        padding-bottom: 24px; padding-left: 48px; text-align: center;">

              <!-- 社交链接 -->
              <table role="presentation" border="0" cellpadding="0" cellspacing="0"
                     style="border-collapse: collapse; margin-top: 0; margin-right: auto;
                            margin-bottom: 16px; margin-left: auto;">
                <tr>
                  <td style="padding-right: 8px;">
                    <a href="https://weibo.com/example" target="_blank"
                       style="color: #0066cc; text-decoration: none;
                              font-family: Arial, sans-serif; font-size: 13px;">
                      微博
                    </a>
                  </td>
                  <td style="padding-right: 8px; padding-left: 8px;
                              border-left: 1px solid #cccccc;">
                    <a href="https://example.com/wechat" target="_blank"
                       style="color: #0066cc; text-decoration: none;
                              font-family: Arial, sans-serif; font-size: 13px;">
                      微信
                    </a>
                  </td>
                  <td style="padding-left: 8px; border-left: 1px solid #cccccc;">
                    <a href="https://example.com" target="_blank"
                       style="color: #0066cc; text-decoration: none;
                              font-family: Arial, sans-serif; font-size: 13px;">
                      官网
                    </a>
                  </td>
                </tr>
              </table>

              <!-- 版权 & 地址 -->
              <p style="margin-top: 0; margin-right: 0; margin-bottom: 8px; margin-left: 0;
                         font-family: Arial, Helvetica, sans-serif;
                         font-size: 12px; line-height: 18px; color: #999999;">
                © 2025 品牌名称有限公司。保留所有权利。<br>
                地址：北京市朝阳区某某大厦 888 号
              </p>

              <!-- 退订链接（CAN-SPAM / CASL 合规必须） -->
              <p style="margin: 0; font-family: Arial, Helvetica, sans-serif;
                         font-size: 12px; line-height: 18px; color: #999999;">
                你收到此邮件是因为订阅了我们的营销通讯。
                <a href="https://example.com/unsubscribe?token=UNSUBSCRIBE_TOKEN"
                   style="color: #0066cc; text-decoration: underline;">
                  退订
                </a>
                &nbsp;|&nbsp;
                <a href="https://example.com/preferences"
                   style="color: #0066cc; text-decoration: underline;">
                  管理偏好
                </a>
              </p>
            </td>
          </tr>

        </table>
        <!-- ====== 邮件主体结束 ====== -->

      </td>
    </tr>
  </table>
  <!-- ==================== 最外层容器结束 ==================== -->

</body>
</html>
```

---

## 11. Testing Checklist

### 发送前必查清单

**内容与结构**
- [ ] 预览文字（preheader）已设置，长度 40-130 字符
- [ ] `<title>` 标签已填写
- [ ] 所有链接均为绝对 URL，已测试可访问
- [ ] 退订链接存在且有效（CAN-SPAM / GDPR 合规）
- [ ] 所有图片均有有意义的 `alt` 属性

**HTML 质量**
- [ ] 邮件体积 < 100KB（Gmail 102KB 会截断）
- [ ] 没有使用 `<script>`（邮件客户端全部过滤）
- [ ] 没有外部 CSS `<link>`（多数客户端过滤）
- [ ] 所有 style 均已 inline（或经工具处理）
- [ ] CSS shorthand 已展开（`padding` → `padding-top` 等）
- [ ] `<table>` 均有 `role="presentation"` / `border="0"` / `cellpadding="0"` / `cellspacing="0"`
- [ ] 所有 `<img>` 均有 `width`、`height`、`border="0"`、`display:block`

**客户端测试**
- [ ] Gmail（Web，Chrome）
- [ ] Gmail（Android App）
- [ ] Gmail（iOS App）
- [ ] Outlook 2016 / 2019 / 2021（Windows）
- [ ] Outlook 365（Web）
- [ ] Apple Mail（macOS）
- [ ] Apple Mail（iOS）
- [ ] Yahoo Mail（Web）
- [ ] 图片关闭状态下测试（alt 文字可读性）
- [ ] 深色模式下测试
- [ ] 移动端（375px 宽）测试

**垃圾邮件风险**
- [ ] 发件人域名已配置 SPF 记录
- [ ] 已配置 DKIM 签名
- [ ] 已配置 DMARC 策略
- [ ] 主题行不含全大写、感叹号堆叠、"免费"等触发词
- [ ] 文字与图片比例合理（不要全图邮件）
- [ ] 文本版（Plain Text）备用内容已提供
- [ ] 退订机制正常工作
- [ ] 未使用 URL 短链（易被 spam 过滤器拦截）

### 推荐测试工具

| 工具 | 用途 | 费用 |
|------|------|------|
| [Litmus](https://litmus.com) | 90+ 客户端截图预览、垃圾邮件测试 | 付费（有试用） |
| [Email on Acid](https://www.emailonacid.com) | 客户端截图、可访问性测试 | 付费 |
| [Mail Tester](https://www.mail-tester.com) | 发送到专属地址，评分垃圾邮件风险 | 免费（3次/天）|
| [MXToolbox](https://mxtoolbox.com) | 检查 SPF/DKIM/DMARC | 免费 |
| [Putsmail](https://putsmail.com) | 免费发送测试邮件 | 免费 |
| [Can I Email](https://www.caniemail.com) | 查询 CSS/HTML 属性在各客户端的支持 | 免费 |

### Spam 风险规避要点

1. **认证**：SPF + DKIM + DMARC 三件套缺一不可
2. **发送量**：新 IP/域名需要"暖机"（从小量逐步增加）
3. **列表卫生**：定期清理无效地址，硬退件（hard bounce）立即移除
4. **退订处理**：退订后 10 个工作日内停止发送（CAN-SPAM）
5. **内容平衡**：文字:图片 = 至少 60:40，不要纯图片邮件
6. **发送频率**：根据用户期望和互动率控制频率，避免过度发送
