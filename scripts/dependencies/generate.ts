import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { stringify } from 'yaml'

const root = path.resolve(import.meta.dirname, '../..')
const source = await readFile(path.join(import.meta.dirname, 'runtime.py'), 'utf8')
const check = process.argv.includes('--check')
async function emit(file: string, content: string) {
  if (check) {
    if (await readFile(file, 'utf8') !== content) throw new Error(`Generated recipe is stale: ${file}`)
  } else {
    await writeFile(file, content)
  }
}
const all = ['linux/amd64', 'linux/arm64', 'darwin/arm64']
const definitions: Record<string, any> = {}
function add(id: string, name: string, zh: string, ja: string, recipe: Record<string, any>, requires = ['python']) {
  definitions[id] = { name, zh, ja, requires, supported: all, ...recipe }
}
function github(id: string, name: string, repo: string, commands: string[], assets: string[], extra = {}) {
  add(id, name, name + ' 命令行工具', name + ' コマンドラインツール', {
    backend: 'github', repo, commands, assets: Object.fromEntries(all.map((p, i) => [p, assets[i]])), ...extra,
  })
}
github('github-cli', 'GitHub CLI', 'cli/cli', ['gh'], ['gh_{version}_linux_amd64.tar.gz', 'gh_{version}_linux_arm64.tar.gz', 'gh_{version}_macOS_arm64.zip'])
github('stripe-cli', 'Stripe CLI', 'stripe/stripe-cli', ['stripe'], ['stripe_{version}_linux_x86_64.tar.gz', 'stripe_{version}_linux_arm64.tar.gz', 'stripe_{version}_mac-os_arm64.tar.gz'])
github('supabase-cli', 'Supabase CLI', 'supabase/cli', ['supabase'], ['supabase_{version}_linux_amd64.tar.gz', 'supabase_{version}_linux_arm64.tar.gz', 'supabase_{version}_darwin_arm64.tar.gz'])
github('sentry', 'Sentry', 'getsentry/cli', ['sentry'], ['sentry-linux-x64', 'sentry-linux-arm64', 'sentry-darwin-arm64'], { raw: true, tag_prefix: '' })
github('sentry-cli', 'Sentry Release CLI', 'getsentry/sentry-cli', ['sentry-cli'], ['sentry-cli-Linux-x86_64', 'sentry-cli-Linux-aarch64', 'sentry-cli-Darwin-universal'], { raw: true, tag_prefix: '' })
github('bun', 'Bun', 'oven-sh/bun', ['bun', 'bunx'], ['bun-linux-x64-baseline.zip', 'bun-linux-aarch64.zip', 'bun-darwin-aarch64.zip'], { tag_prefix: 'bun-v', probes: { bunx: ['--version'] } })
github('micromamba', 'Micromamba', 'mamba-org/micromamba-releases', ['micromamba'], ['micromamba-linux-64', 'micromamba-linux-aarch64', 'micromamba-osx-arm64'], { raw: true, tag_prefix: '' })
add('gitlab-cli', 'GitLab CLI', 'GitLab 命令行工具', 'GitLab コマンドラインツール', { backend: 'gitlab', commands: ['glab'] })
add('postman-cli', 'Postman CLI', 'Postman 接口测试工具', 'Postman API テストツール', { backend: 'postman', commands: ['postman'], platforms: { 'linux/amd64': 'linux64', 'linux/arm64': 'linux_arm64', 'darwin/arm64': 'osx_arm64' } })
for (const [id, name, pkg, cmd] of [
  ['pnpm', 'pnpm', 'pnpm', 'pnpm'], ['wrangler', 'Wrangler', 'wrangler', 'wrangler'],
  ['shopify-cli', 'Shopify CLI', '@shopify/cli', 'shopify'], ['apify-cli', 'Apify CLI', 'apify-cli', 'apify'],
]) add(id!, name!, name + ' 开发工具', name + ' 開発ツール', { backend: 'npm', packages: [pkg], commands: [cmd] }, ['python', 'node'])
add('document-node', 'Document JavaScript', '文档生成 JavaScript 库', '文書生成 JavaScript ライブラリ', {
  backend: 'npm', packages: ['docx', 'pptxgenjs', 'sharp', 'react', 'react-dom', 'react-icons', 'pdf-lib'],
  commands: ['document-node'], imports: ['docx', 'pptxgenjs', 'sharp', 'react', 'react-dom', 'react-icons', 'pdf-lib'],
}, ['python', 'node'])
add('document-python', 'Document Python', '文档处理 Python 环境', '文書処理 Python 環境', {
  backend: 'python', packages: ['pypdf', 'pdfplumber', 'reportlab', 'pdf2image', 'pytesseract', 'Pillow', 'openpyxl', 'pandas', 'markitdown[pptx]', 'defusedxml', 'lxml', 'pypdfium2', 'six'],
  commands: ['document-python'], imports: ['pypdf', 'pdfplumber', 'reportlab', 'pdf2image', 'pytesseract', 'PIL', 'openpyxl', 'pandas', 'markitdown', 'defusedxml', 'lxml', 'pypdfium2', 'six'],
}, ['python', 'uv'])
add('python-dev', 'Python Development', 'Python 代码检查和测试', 'Python のコード検査とテスト', {
  backend: 'python', packages: ['ruff', 'pytest'], commands: ['ruff', 'pytest'],
}, ['python', 'uv'])
for (const [id, name, commands] of [
  ['git', 'Git', ['git']], ['pandoc', 'Pandoc', ['pandoc']], ['poppler', 'Poppler', ['pdftotext', 'pdftoppm', 'pdfinfo']],
  ['qpdf', 'qpdf', ['qpdf']], ['tesseract', 'Tesseract OCR', ['tesseract']], ['ffmpeg', 'FFmpeg', ['ffmpeg', 'ffprobe']],
] as const) add(id, name, name + ' 工具及运行库', name + ' ツールとランタイム', {
  backend: 'conda', package: id, commands, probes: id === 'poppler' ? Object.fromEntries(commands.map(c => [c, ['-v']]))
    : id === 'ffmpeg' ? Object.fromEntries(commands.map(c => [c, ['-version']])) : {},
}, ['python', 'micromamba'])
add('native-build-tools', 'Native Build Tools', '原生编译器与构建工具', 'ネイティブコンパイラとビルドツール', {
  backend: 'conda', package: 'c-compiler', extra_packages: ['cxx-compiler', 'make', 'cmake', 'pkg-config'],
  commands: ['cc', 'gcc', 'c++', 'g++', 'make', 'cmake', 'pkg-config'], compiler: true,
}, ['python', 'micromamba'])
add('libreoffice', 'LibreOffice', 'Office 文档转换与公式重算', 'Office 文書変換と数式再計算', { backend: 'libreoffice', commands: ['soffice', 'libreoffice'] })
add('go', 'Go', 'Go 编译、测试与格式化', 'Go のビルド・テスト・フォーマット', { backend: 'go', commands: ['go', 'gofmt'], probes: { go: ['version'], gofmt: [] } })
add('rust', 'Rust', 'Rust 编译、测试与代码检查', 'Rust のビルド・テスト・コード検査', { backend: 'rust', commands: ['rustup', 'rustc', 'cargo', 'rustfmt', 'cargo-fmt', 'clippy-driver', 'cargo-clippy'], probes: { 'cargo-fmt': ['--version'], 'cargo-clippy': ['--version'] } }, ['python', 'native-build-tools'])
add('playwright', 'Playwright', '浏览器自动化和测试环境', 'ブラウザー自動化とテスト環境', { backend: 'npm', packages: ['playwright', '@playwright/test', '@playwright/cli'], commands: ['playwright', 'playwright-cli'], playwright: true }, ['python', 'node'])

const remove = await readFile(path.join(root, 'registries/memoh/dependencies/codex/remove.sh'), 'utf8')
for (const [id, recipe] of Object.entries(definitions)) {
  const dir = path.join(root, 'registries/memoh/dependencies', id)
  await mkdir(dir, { recursive: true })
  const { name, zh, ja, requires, ...config } = recipe
  const manifest = {
    schema_version: '1', id, name, description: name + ' installed in an isolated, versioned workspace directory.',
    category: ['rust', 'go', 'bun'].includes(id) ? 'runtime' : 'tool', source: 'managed', requires, provides: config.commands,
    platforms: [{ os: 'linux', arch: ['amd64', 'arm64'], libc: 'glibc' }, { os: 'darwin', arch: ['arm64'] }],
    timeouts: { install: 3600, update: 3600, remove: 300, check_update: 300, version: 60 },
    scripts: { install: 'install.sh', update: 'install.sh', remove: 'remove.sh', check_update: 'check-update.sh' },
    translations: { en: { description: name + ' tools' }, zh: { description: zh }, ja: { description: ja } },
  }
  await emit(path.join(dir, 'dependency.yaml'), stringify(manifest))
  for (const [file, action] of [['install.sh', 'install'], ['check-update.sh', 'check_update']]) {
    const script = '# shellcheck shell=sh\n# Generated by scripts/dependencies/generate.ts; edit the source, then regenerate.\n' +
      "python3 - <<'MEMOH_RECIPE_PY'\nimport json\nCONFIG = json.loads(" + JSON.stringify(JSON.stringify(config)) + ')\nACTION = ' + JSON.stringify(action) + '\n' + source + '\nMEMOH_RECIPE_PY\n'
    await emit(path.join(dir, file!), script)
  }
  await emit(path.join(dir, 'remove.sh'), remove.replaceAll('@openai/codex', name))
}
console.log(`Generated ${Object.keys(definitions).length} dependency recipes.`)
