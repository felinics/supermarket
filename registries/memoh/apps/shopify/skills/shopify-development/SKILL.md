---
name: shopify-development
description: Develop Shopify themes and applications using the Shopify CLI.
---

# Shopify Development

## Identify the project
Inspect `shopify.app.toml`, theme files and package scripts. Run `shopify version` and use `shopify help` for the installed CLI. Keep the target store and development environment explicit; connector access does not authenticate the development CLI.

## Develop and validate
For a theme, use `shopify theme dev --store <store>` and `shopify theme check`. For an App, use the existing project's `shopify app dev` workflow. Preserve the project's package manager and lockfile. Preview changes in the development store and check relevant page sizes.

## Publish
Only run theme publishing, `shopify app deploy`, or store mutations when requested. Record the target store, version and resulting deployment URL. Do not publish to the live theme to obtain a preview.

Reference: https://shopify.dev/docs/api/shopify-cli
