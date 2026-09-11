# Workspace toolchain Apps

Apps combine connector access, executable tools and task-specific Skills. Installers are shared implementation dependencies, rather than additional storefront entries.

| App | Executable tools and libraries | Bundled workflow Skills |
| --- | --- | --- |
| GitHub | GitHub CLI (`gh`), Git, Python | OpenAI `gh-address-comments`, `gh-fix-ci`, `yeet` |
| GitLab | `glab`, Git | GitLab development |
| Cloudflare | Wrangler, Node.js | OpenAI `cloudflare-deploy` |
| Supabase | Supabase CLI | Supabase development |
| Stripe | Stripe CLI | Stripe development |
| Postman | Postman CLI | Collection testing |
| Shopify | Shopify CLI, Node.js, Git | Shopify development |
| Sentry | `sentry`, `sentry-cli` | OpenAI `sentry`, release management |
| Apify | Apify CLI, Node.js | Actor development |
| Node.js | Node.js, npm, npx, pnpm | Node development |
| Python | Python, pip, uv, Ruff, pytest | Python development |
| PDF | Document Python, Poppler, qpdf, Tesseract | Existing PDF workflow |
| Word Documents | Document Python/JavaScript, LibreOffice, Pandoc | Existing DOCX workflow |
| Spreadsheets | Document Python, LibreOffice | Existing XLSX workflow |
| Presentations | Document Python/JavaScript, LibreOffice, Poppler | Existing PPTX workflow |
| Rust | rustup, rustc, Cargo, rustfmt, Clippy, C/C++ compiler, Make, CMake, pkg-config | Rust development |
| Go | Go, gofmt | Go development |
| Bun | Bun, bunx | Bun development |
| Browser Testing | Playwright, Playwright Test/CLI, Chromium | OpenAI `playwright`, browser testing |
| Audio & Video | FFmpeg, ffprobe | Media processing |

`document-python` owns its interpreter and imports pypdf, pdfplumber, ReportLab, pdf2image, pytesseract, Pillow, openpyxl, pandas, MarkItDown, defusedxml, lxml, pypdfium2 and six. `document-node` exposes docx, PptxGenJS, sharp, React, React DOM, React Icons and pdf-lib without installing anything into the user's project. Project-specific dependencies still belong in the project's own lockfile/environment.

## Installation and updates

Recipes require a Python interpreter with safe tar extraction (Python 3.12+ or a security backport; provided by the workspace Python dependency). Generated recipes support Linux glibc amd64/arm64 and macOS arm64. Native libraries use isolated conda-forge environments managed by micromamba. LibreOffice on Debian-compatible Linux uses a private apt cache and extracts the complete package closure without installing into the system root; macOS uses the official application bundle. Playwright requires the workspace image's browser system libraries. macOS compilation requires the platform SDK/Command Line Tools.

Installations live under `MEMOH_DEP_HOME/versions/`. A candidate remains at its permanent prefix throughout installation, so embedded interpreter and library paths remain valid. The installer probes its commands/imports before atomically switching `current`. A failed download, installation, probe or switch leaves the previous installation usable. Old versions remain available until the dependency is removed. Installation does not modify shell profiles or system package databases.

Bundle versions are hashes of exact top-level package resolutions; saved resolution manifests permit reinstalling a previously resolved bundle. Package-manager solvers still resolve transitive dependencies, so these are not universal reproducible environment lockfiles. GitHub downloads require the release asset's SHA256; Go, Rust, GitLab and LibreOffice use upstream checksums. Postman supplies its archive over its official HTTPS endpoint without a separate checksum manifest.

## Authorization and environment requirements

Connector authorization and CLI authentication are separate upstream mechanisms. Installing a CLI does not implicitly give it the connector's credentials. Skills check CLI authentication and guide the appropriate login or workspace secret configuration. This registry change does not introduce a new Memoh CLI-login dialog or copy connector tokens into command environments.

Supabase local services and Shopify local development have additional project/runtime requirements; Skills describe them. No installer starts Docker services or publishes a deployment. Browser Testing uses the installed Chromium; headed desktop sessions remain a Memoh runtime feature.

## Upstream Skills

Six Skills are vendored from `openai/skills` at revision `49f948faa9258a0c61caceaf225e179651397431`. `registries/memoh/upstream-skills.lock.json` records their original file hashes and paths. Each Skill retains its upstream license, scripts, references and assets. Memoh adaptations normalize text whitespace, replace Codex-only execution/path guidance, use the managed Playwright CLI and retain explicit user intent for publishing actions. Existing document Skills retain their original licenses. New local workflow Skills use Apache-2.0.

Rust, Go, Bun and FFmpeg icons originate from Simple Icons (CC0). The Playwright icon is retained from the upstream OpenAI Skill.

## Maintenance and verification

Edit `scripts/dependencies/runtime.py` and `generate.ts`, then run:

```sh
bun run dependencies:generate
bun run registry:lock -- --registry memoh
bun test
bun run typecheck
bun run build
shellcheck -s sh registries/memoh/dependencies/*/*.sh
```

Offline regression tests cover publication failure recovery, archive traversal, checksums, saved bundle resolutions and platform rejection. Real downloads are opt-in and should only run in a disposable workspace:

```sh
bun scripts/dependencies/catalog.ts
# Mount this checkout at /registry in the disposable workspace.
python3 /registry/scripts/dependencies/smoke.py github-cli gitlab-cli stripe-cli supabase-cli pnpm wrangler shopify-cli apify-cli sentry sentry-cli postman-cli go bun python-dev document-python document-node micromamba git pandoc poppler qpdf tesseract ffmpeg native-build-tools rust libreoffice playwright
sh /registry/scripts/dependencies/behavior-smoke.sh
```

The smoke runner stores receipts and logs under `/data/toolchain-qa` (override with `SMOKE_HOME`) and skips completed installations. Remove only a dependency's smoke receipt to force its reinstall. Account-dependent API operations require separate human authorization and QA.

## Verification recorded on 2026-09-11

All 27 new managed dependencies were installed and their commands/imports probed in a disposable Linux ARM64 `memohai/workspace:debian` container. Integration smoke passed Rust compilation/format/Clippy, Go compilation, Bun execution, C++ compilation, DOCX/PPTX/XLSX generation and PDF conversion, Excel formula recalculation (21 × 2 = 42), PDF extraction/rasterization/OCR/validation, FFmpeg generation/probing, Chromium screenshots and Playwright CLI open/snapshot/close. GitHub CLI, pnpm, Python Development and Go update checks correctly reported no update immediately after installation.

The local registry serves 129 Apps; all 20 entries in this table expose dependencies and Skills. Automated repository tests, typechecks, build/registry validation and ShellCheck pass. Linux AMD64 and macOS ARM64 execution and third-party account authorization/business operations have not been verified. GitHub-hosted release assets and their SHA256 metadata were checked for every declared platform.
