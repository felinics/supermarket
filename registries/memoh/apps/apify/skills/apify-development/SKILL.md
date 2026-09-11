---
name: apify-development
description: Develop, run and publish Apify Actors using the CLI.
---

# Apify Development

## Inspect and authenticate
Inspect `.actor/actor.json`, its Dockerfile, input schema and package scripts. Run `apify --version` and guide `apify login` when needed. Confirm the intended Actor and account before publishing.

## Local work
Use `apify create` for an explicitly requested new Actor, selecting a template appropriate to the task. In an existing Actor, preserve its language and package manager. Use `apify run` with a small representative input and inspect dataset output and errors. Keep credentials in local environment configuration.

## Publish
Use `apify push` only when deployment is requested. Report the Actor identity, build result and a sample run. Do not silently run a large paid crawl as a smoke test.

Reference: https://docs.apify.com/cli/docs
