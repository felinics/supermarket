---
name: gitlab-development
description: Manage GitLab merge requests, issues and pipelines using glab.
---

# Gitlab Development

## Start in the repository
Run `git status --short`, `git remote -v`, and `glab auth status`. The connector login does not log glab in. If needed, guide the user through `glab auth login --hostname <host>` in this workspace; do not request tokens in chat.

## Merge requests and CI
Use `glab mr list`, `glab mr view <id>`, and `glab mr diff <id>` to establish the requested scope. For a failing pipeline, start with `glab ci status` and `glab ci view`; use `glab <command> --help` to select the supported job-log command. Preserve uncommitted files. Make the targeted change, run the relevant tests, and explain what changed.

## Publishing
Create or update an MR only when requested. Follow the repository's title, template, branch and commit conventions. Never infer permission to merge or force-push from passing CI. Record the MR URL and exact head commit.

Reference: https://docs.gitlab.com/editor_extensions/gitlab_cli/
