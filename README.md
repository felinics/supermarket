# Supermarket

Official Skill Registry for [Memoh](https://github.com/memohai/Memoh).

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
