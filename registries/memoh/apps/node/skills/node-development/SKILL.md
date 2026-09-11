---
name: node-development
description: Develop Node.js projects with npm, npx and pnpm, respecting project lockfiles.
---

# Node Development

## Choose the project toolchain
Read `package.json`, its `packageManager` and `engines` fields, repository instructions and lockfiles. Use pnpm for a pnpm project, npm for a package-lock project, and the requested tool for a new project. Do not replace an existing lockfile or install competing package managers into the project.

## Install and run
Check `node --version` and `pnpm --version`. Use `pnpm install --frozen-lockfile` for a locked checkout, and `pnpm run <script>` for the project's build, lint and test scripts. Use `pnpm --filter <workspace>` in monorepos. For npm projects, use `npm ci` and existing npm scripts.

## Dependencies
Use `pnpm add` / `pnpm add -D` in the correct package when a change requires a dependency. Review both manifest and lockfile changes. Prefer project-local compiler, formatter and test-runner versions over globally installed replacements.

References: https://nodejs.org/en/learn/ ; https://pnpm.io/cli/install
