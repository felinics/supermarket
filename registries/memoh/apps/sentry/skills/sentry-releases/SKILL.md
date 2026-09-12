---
name: sentry-releases
description: Manage Sentry releases, source maps and debug symbols with sentry-cli.
---

# Sentry Releases

## Separate investigation and publishing
Use the bundled read-only Sentry Skill and `sentry` for issue investigation. Use `sentry-cli` for release artifacts. Verify the intended organization and project and check `sentry-cli info` before publishing; configure credentials locally.

## Release artifacts
Inspect the project's existing Sentry build integration. Upload source maps with the matching build artifacts and release identifiers. Use `sentry-cli sourcemaps --help` and `sentry-cli releases --help` for the installed version's exact commands. Upload debug symbols only for the matching binary build.

## Verify
Check upload results and ensure the release identifier matches the deployed application. A successful upload alone does not prove a production stack trace resolves: report that distinction. Do not change live release state without the user's publishing request.

Reference: https://docs.sentry.io/cli/
