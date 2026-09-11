---
name: bun-development
description: Develop JavaScript and TypeScript projects with Bun and bunx.
---

# Bun Development

## Project conventions
Inspect `package.json`, Bun configuration, lockfiles and repository instructions. Use Bun when the project already uses it or the user selected it. Do not convert npm/pnpm projects merely because Bun is installed.

## Workflow
Check `bun --version`. Install a locked checkout with `bun install --frozen-lockfile`. Use `bun run <script>` for existing scripts and `bun test` when the project uses Bun's test runner. Use project-pinned packages when invoking tools through bunx.

## Validation
Bun executing TypeScript does not replace static type checking. Run the project's typecheck and build scripts as well as relevant tests. Check compatibility with the actual production runtime if it differs from Bun.

Reference: https://bun.sh/docs
