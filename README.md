# Supermarket

Official Skill and workspace dependency registry for [Memoh](https://github.com/felinics/Memoh).

## Project Structure

```text
supermarket/
├── registries/
│   ├── memoh/
│   │   ├── registry.yaml
│   │   ├── release.lock.json
│   │   └── packages/<package-id>/skills/<skill-id>/
│   └── openai/
│       ├── registry.yaml
│       └── release.lock.json
├── registry/                        # Registry model and publication
├── server/                          # API routes
├── workers/api/                     # Cloudflare Worker
└── client/                          # Reference client
```

Supermarket stores published Registry releases in a local data directory during development and in R2 for hosted environments. Its API provides Registry, Package, Skill, and Artifact access for Memoh clients.

## Development

Development requires the Bun version pinned in `.bun-version`.

```bash
bun install
bun run registry:publish
bun run dev
```

The development server listens on `http://127.0.0.1:5173` by default.

| Command | Purpose |
|---------|---------|
| `bun test` | Run the Bun test suite |
| `bun run typecheck` | Generate Worker types and check server and Vue projects |
| `bun run build` | Validate approved releases and build the Cloudflare Worker |
| `bun run registry:lock -- --registry <id>` | Rebuild one Registry lock |
| `bun run registry:validate` | Rebuild every enabled source and verify committed locks |
| `bun run registry:publish` | Publish approved releases to the local Store |
| `bun run registry:updates` | Check configured upstream tracking refs |
| `bun run registry:client -- <command>` | Run the reference discovery and installation client |

### Reference Client

The client defaults to `http://127.0.0.1:5173`. Override it with `--base` or `SUPERMARKET_URL`.

```bash
bun run registry:client -- list
bun run registry:client -- search pdf --registry memoh
bun run registry:client -- inspect memoh pdf pdf
bun run registry:client -- install memoh pdf pdf \
  --destination /tmp/supermarket-skills
```

## API

Base URL: `https://supermarket.memoh.ai`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/packages` | Search Skill Packages. Query: `q`, `registry`, `category`, `tag`, `page`, `limit`, `sort` |
| GET | `/api/skills` | Search enabled Registry Skills. Query: `q`, `registry`, `package`, `category`, `tag`, `page`, `limit`, `sort` |
| GET | `/api/registries` | List Registries and current counts |
| GET | `/api/registries/:registryId` | Get the approved Registry definition, source revision, and diagnostics |
| GET | `/api/registries/:registryId/categories` | List categories in one Registry |
| GET | `/api/registries/:registryId/packages` | Search Packages in one Registry |
| GET | `/api/registries/:registryId/packages/:packageId` | Get the current Package descriptor |
| GET | `/api/registries/:registryId/packages/:packageId/releases/:revision` | Get an immutable Package descriptor |
| GET | `/api/registries/:registryId/skills` | Search Skills in one Registry |
| GET | `/api/registries/:registryId/packages/:packageId/skills/:skillId` | Get one Registry Skill |
| GET | `/api/artifacts/skill/:digest` | Download a Skill archive |
| GET | `/api/artifacts/icon/:digest` | Download a Skill icon |

Skills use `(registry_id, package_id, skill_id)` identities.

## Contributing

### Adding a Skill

1. Create `registries/memoh/packages/<package-id>/skills/<skill-id>/SKILL.md` with YAML frontmatter. For an independent Skill, use the Skill ID as both the package and Skill ID:

```markdown
---
name: my-skill
description: What this Skill does and when to use it.
metadata:
  author:
    name: Your Name
    email: you@example.com
  tags: [example]
  category: productivity
  homepage: https://example.com
---

# My Skill

Instructions and documentation go here.
```

A Package that needs a system dependency may add `registries/memoh/packages/<package-id>/package.yaml`:

```yaml
schema_version: "1"
postinstall:
  - command: npm
    args: [install, --global, opencli]
```

2. Regenerate the approved Snapshot lock, then validate and publish it locally:

```bash
bun run registry:lock -- --registry memoh
bun run registry:validate
bun run registry:publish -- --registry memoh
bun run dev
```

Commit the Registry `release.lock.json` with the Skill source.

### Adding a Registry

Create `registries/<registry-id>/registry.yaml`:

```yaml
schema_version: "1"
id: example
name: Example
enabled: true
priority: 100
adapter:
  type: skill_directory
source:
  type: git
  url: https://github.com/example/skills.git
  revision: 0123456789abcdef0123456789abcdef01234567
  tracking_ref: main
```

Generate its initial release lock and validate it:

```bash
bun run registry:lock -- --registry example
bun run registry:validate
```

#### Sources and Adapters

Supported sources are `local` and HTTPS `git`. Supported adapters are `memoh`, `skill_directory`, and `codex_marketplace_skills`. Git sources pin an exact commit in `revision`; `tracking_ref` enables update checks.

## Registry Updates

Registry updates are reviewed through pull requests before publication.

## Deployment

The `Publish approved Registries` workflow publishes approved releases to R2. Worker environments and R2 bindings are defined in `workers/api/wrangler.jsonc`.

Deploy the read-only API Worker with:

```bash
# Test
bun run registry:api:deploy:test

# Production
bun run registry:api:deploy:production
```

Use the `test` environment to validate publication before production.

## License

[Apache-2.0](LICENSE)

---

Built with [Nitro](https://nitro.build) and [Cloudflare Workers](https://workers.cloudflare.com).

## Workspace dependencies

The official `memoh` registry also publishes workspace dependency definitions for
Codex, Claude Code, Node.js, Python and uv. Recipes live under
`registries/memoh/dependencies/<id>/`: `dependency.yaml`, referenced POSIX sh
scripts, and an optional icon. The manifest includes platform support, commands,
prerequisites, timeouts and English/Chinese/Japanese display metadata.

Dependencies have their own immutable releases and snapshot pointer; publishing
them does not change Skill Package releases. `dependencies.lock.json` records the
reviewed dependency snapshot. Existing registry commands publish both resource
kinds by default; `--kind` selects an independent workflow:

```bash
bun run registry:lock -- --kind dependencies
bun run registry:validate -- --kind dependencies
bun run registry:publish -- --kind dependencies
```

The dependency APIs are:

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/dependencies` | Current catalog (`q`, `registry`, `category`, `page`, `limit`) |
| GET | `/api/registries/memoh/dependencies/:id` | Current descriptor |
| GET | `/api/registries/memoh/dependencies/:id/releases/:revision` | Immutable release JSON |
| GET | `/api/artifacts/dependency/:digest` | Verified gzip/tar artifact |

A **definition revision** hashes the exact release JSON; an **artifact digest**
hashes the compressed archive. Neither is the **software version** requested by a
user. Immutable responses include ETag, content digest and immutable cache headers;
historical releases remain readable after catalog changes or disablement.

Memoh downloads and validates these definitions, caches them persistently, and runs
the scripts inside the chosen Bot workspace. It owns installation state, overlays,
locks, progress streams and software rollback. Supermarket does not execute the
scripts or host the CLI binaries. New management operations resolve the current
definition; a prepared operation keeps one revision through preview and execution.

The current recipes support Linux with glibc (amd64/arm64) and macOS arm64.
They deliberately do not advertise musl support. Node.js and uv archives are
verified against upstream SHA256 files obtained over HTTPS before extraction.
`NODEJS_MIRROR` and `UV_RELEASES_URL` change the archive location, but never the
checksum authority; these installs still require access to `nodejs.org` or
GitHub for verification. Memoh must explicitly pass the configured mirror
variables into the runner; exporting them only inside a client shell is not
sufficient. npm uses `NPM_MIRROR`, and Python uses uv's
`UV_PYTHON_INSTALL_MIRROR`.

npm lifecycle scripts are disabled, including when npm's strict script policy
is enabled. The Claude Code recipe links its platform binary itself. npm and
uv download caches created by these recipes stay under the dependency home
and are removed with the overlay; pre-existing shared user caches are retained.
Stable Python requests such as `3.15` never select alpha, beta or release
candidate builds; request an exact prerelease explicitly if it is required.

Install and update write their result before switching `current`. A failed
rename or switch restores the previous tree, and retries recover a saved tree
left by an interrupted replacement before doing network work. Unused saved
trees are retained when their ownership is ambiguous; uninstall removes the
whole dependency home. Server state and shim publication remain the consumer's
responsibility.

Recipe changes within schema version 1 must retain the managed layout/result
contract and handle installations made by prior revisions, including uninstall.
Third-party dependency registries and recursive prerequisite installation are not
part of this first release.

The producer's pinned Bun version is required for deterministic archives and locks.
To regenerate wire fixtures for the Go consumer:

```bash
bun scripts/registry/export-dependency-fixtures.ts --destination <consumer-testdata-directory>
```

The fixtures are test data; Memoh does not embed the official catalog in its Server.
