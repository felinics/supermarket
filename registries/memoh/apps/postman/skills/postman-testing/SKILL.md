---
name: postman-testing
description: Run Postman collections and produce API regression reports.
---

# Postman Testing

## Select collection and environment
Inspect the repository's collection and environment files. Use a local export when provided. For cloud collections, check the CLI session and guide `postman login` as needed; never copy an API key into chat or a committed environment file.

## Execute
Run `postman collection run <collection-file-or-id> --environment <environment-file-or-id>` with the installed version's supported reporter flags (`postman collection run --help`). Validate the resolved base URL before running a collection that creates or deletes data. Use a test environment and test records for regression testing.

## Report
Save the report inside the workspace. Summarize failed request names, assertions and response status codes without exposing authentication headers or response secrets. A command exiting successfully is not sufficient if assertions failed; inspect its summary and report.

Reference: https://learning.postman.com/docs/postman-cli/postman-cli-overview/
