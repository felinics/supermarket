---
name: browser-testing
description: Write and run project-local browser regression tests using Playwright Test.
---

# Browser Testing

## Choose the workflow
For interactive navigation and screenshots, use the bundled Playwright CLI Skill. For requested repeatable regression tests, inspect the repository's Playwright config and existing tests first.

## Run tests
Use the project's pinned `@playwright/test` and scripts when available. The App provides Playwright, Chromium and a CLI fallback. Match downloaded browser versions to the Playwright version executing the test; use the App's `playwright install chromium` when its browsers need restoring.

## Scope and verification
Exercise the requested user flow with explicit assertions. Avoid arbitrary sleeps; wait for page states, locators or responses. Save traces and screenshots inside the workspace and report browser, viewport and relevant failure evidence. Never treat a screenshot alone as proof that a form submission or backend change succeeded.

Reference: https://playwright.dev/docs/intro
