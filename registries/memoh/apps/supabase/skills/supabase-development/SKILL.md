---
name: supabase-development
description: Manage Supabase project migrations, types and functions with the CLI.
---

# Supabase Development

## Identify the target
Inspect `supabase/config.toml`, existing migrations and project instructions. Run `supabase --version` and `supabase projects list` to check CLI authentication. When needed, guide `supabase login` in the workspace. Keep project reference and environment explicit.

## Schema and functions
Create migrations with `supabase migration new <name>`; inspect generated SQL before applying it. Use `supabase gen types typescript --project-id <ref>` for generated types, and `supabase functions deploy <name> --project-ref <ref>` for requested deployments. Use `--help` for version-specific options.

## Local development
`supabase start` requires an accessible Docker-compatible runtime in the selected workspace. Installing this App does not grant a Docker socket or start a local database. Do not substitute a remote production project when local services are unavailable. Run `supabase db reset` only against an explicitly authorized disposable local database.

Reference: https://supabase.com/docs/reference/cli/introduction
