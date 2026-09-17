---
name: html
description: "Use this skill any time the user wants to create or edit an HTML file of any kind. This includes: static web pages, landing pages, portfolios, documentation pages, HTML email templates, newsletters, responsive layouts, and any task where the final deliverable is a .html file. Trigger when the user mentions \"HTML\", \"web page\", \"landing page\", \"email template\", \"newsletter\", \"static site\", or asks to build something that will run in a browser or email client. Also trigger when the user wants to convert content (Markdown, data, a design brief) into an HTML file."
metadata:
  author:
    name: Anthropic
    email: ""
  tags:
    - html
    - css
    - web
    - email
    - responsive
  homepage: https://github.com/anthropics/skills
---

# HTML

## Quick Reference

| Task | Guide |
|---|---|
| Static web page / landing page | [reference.md](reference.md) |
| Responsive layout (Flexbox / Grid) | [reference.md](reference.md) |
| Accessibility, semantic markup | [reference.md](reference.md) |
| Common patterns (hero, cards, modal, nav) | [reference.md](reference.md) |
| HTML email / newsletter template | [email.md](email.md) |
| Inline CSS for email clients | [email.md](email.md) + `scripts/inline_css.py` |

## Are you building a web page or an email?

**Web page** → Read [reference.md](reference.md). You can use modern CSS (Flexbox, Grid, custom properties, media queries) freely.

**Email template** → Read [email.md](email.md) first. Email clients are severely limited: no Flexbox/Grid, `<style>` blocks are often stripped, Outlook renders with Microsoft Word's engine. The rules are completely different.

---

## Web Page Boilerplate

Start every web page from this base:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Page description here">
  <title>Page Title</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, sans-serif; line-height: 1.6; }
    img { max-width: 100%; display: block; }
  </style>
</head>
<body>
  <header>
    <nav aria-label="Main navigation">
      <!-- navigation -->
    </nav>
  </header>

  <main>
    <!-- page content -->
  </main>

  <footer>
    <!-- footer -->
  </footer>
</body>
</html>
```

---

## Email Boilerplate

Email HTML requires a completely different structure. Always start from this:

```html
<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
  <title>Email Subject</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f4f4f4; }
    table { border-collapse: collapse; }
    img { border: 0; display: block; }
    /* Mobile */
    @media (max-width: 600px) {
      .container { width: 100% !important; }
      .stack { display: block !important; width: 100% !important; }
    }
  </style>
</head>
<body>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center">
        <table class="container" role="presentation"
               width="600" cellpadding="0" cellspacing="0" border="0">
          <!-- email content goes here -->
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

Then run `python scripts/inline_css.py input.html output.html` before sending.

---

## Inlining CSS for Email

Most email clients (Gmail, Yahoo) strip `<style>` blocks. Inline CSS into each element before sending:

```bash
python scripts/inline_css.py input.html output.html
```

The script uses `premailer` to merge `<style>` rules into element `style=""` attributes while keeping `@media` queries intact (they must stay in `<style>`).

```bash
pip install premailer   # one-time install
python scripts/inline_css.py draft.html ready-to-send.html
```

---

## Key Rules at a Glance

### Web pages
- Use semantic elements: `<header>`, `<nav>`, `<main>`, `<article>`, `<section>`, `<footer>`
- Every `<img>` needs `alt`, `width`, and `height`
- Forms: every input must have a `<label>` associated via `for`/`id`
- Use `rem` / `em` for font sizes; `px` only for borders and fine details
- Test keyboard navigation (Tab through the page, Enter to activate)

### Email templates
- **Never** use Flexbox or Grid — use `<table>` for all layout
- **Never** use CSS shorthand (`padding: 10px 20px`) — expand to `padding-top`, `padding-right`, etc.
- Every `<table>` must have `border="0" cellpadding="0" cellspacing="0"`
- Every layout `<table>` should have `role="presentation"`
- All font sizes in `px` — no `em`/`rem`
- Images must have `width`, `height`, `border="0"`, and `alt`
- Always use absolute URLs for images (no relative paths)
- Run `inline_css.py` before sending

---

## Design Tips

### Web pages
- **Spacing system**: pick a base unit (e.g. 8px) and use multiples — 8, 16, 24, 32, 48
- **Colour contrast**: text on background must meet WCAG AA (4.5:1 for body, 3:1 for large text)
- **Mobile-first**: write base styles for small screens, add `@media (min-width: ...)` for larger
- **Max line length**: `max-width: 65ch` on paragraph containers for readability

### Email templates
- **Width**: keep the container at 600px max — narrower for better Outlook compatibility
- **Font stack**: `Arial, Helvetica, sans-serif` or `Georgia, 'Times New Roman', serif` — no web fonts in Outlook
- **Background colours**: use `bgcolor` attribute on `<td>` as well as `background-color` in CSS for Outlook
- **CTA buttons**: use the bulletproof table-based button from [email.md](email.md) — never a plain `<a>` styled as a button
