---
name: git-workflow
description: Inspect and change Git repositories, prepare scoped commits, manage branches and resolve merge or rebase conflicts. Use for Git repository operations; hosting-platform pull requests and CI need their platform tools.
---

# Git Workflow

## Establish the repository state

Read repository instructions and confirm the requested checkout with `git rev-parse --show-toplevel`. Inspect `git status --short --branch`, unstaged and staged diffs, and the relevant recent history before changing files or history. Distinguish existing user edits from the current task. Check the current branch, upstream and remote before fetching or pushing; do not infer a remote from a directory name.

## Prepare a scoped change

Preserve unrelated edits and staged files. Use explicit paths or selected hunks when staging, then inspect the complete staged diff before committing: a commit includes everything already in the index. If unrelated staged work prevents a clean commit, isolate the task or ask how to handle it. Follow the repository's commit conventions and run checks appropriate to the changed behavior.

For an isolated branch, use a worktree when it helps preserve a busy checkout. Honor the requested starting branch or revision; a new worktree does not automatically include uncommitted changes. Do not reset, clean or stash someone else's work merely to make an operation succeed.

## Resolve conflicts

Identify whether a merge, rebase or cherry-pick is in progress before continuing or aborting it. Inspect the conflicting changes and their intended behavior; resolve each conflict coherently rather than applying blanket ours/theirs. During a rebase those labels describe different sides than users may expect. Preserve the resolution, stage the affected files, run the relevant checks and continue the existing operation. Do not start a second history operation over an unfinished one.

## Publish within the requested scope

An inspection or review request does not authorize commits or pushes. When a push is requested, verify the destination and outgoing commits first. If a normal push is rejected, inspect the divergence and report it; do not turn it into a force push. Rewrite published history only with explicit authorization for that branch. If credentials are missing, use the environment's authentication flow without placing tokens in remote URLs or command output.

Report the resulting branch, commit hash, checks and any remaining conflicts or unpublished work. Creating a hosting-platform pull request requires the corresponding platform tool or connector; Git alone does not create one.
