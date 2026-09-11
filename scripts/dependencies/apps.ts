import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { parse, stringify } from 'yaml'

const root = path.resolve(import.meta.dirname, '../../registries/memoh/apps')
// App names remain user-facing; implementation dependencies are shared beneath them.
const apps = [
  ['github', 'GitHub', 'developer-tools', ['github-cli', 'git', 'python'], 'Connect GitHub and work with repositories, pull requests and CI.', '连接 GitHub，处理代码仓库、PR 评审与 CI。', 'GitHub に接続し、リポジトリ・PR レビュー・CI を操作します。'],
  ['gitlab', 'GitLab', 'developer-tools', ['gitlab-cli', 'git'], 'Connect GitLab and manage merge requests, issues and pipelines.', '连接 GitLab，管理合并请求、Issue 与流水线。', 'GitLab に接続し、MR・Issue・パイプラインを管理します。'],
  ['cloudflare', 'Cloudflare', 'developer-tools', ['wrangler'], 'Connect Cloudflare and develop and deploy Workers and Pages.', '连接 Cloudflare，开发和部署 Workers 与 Pages。', 'Cloudflare に接続し、Workers と Pages を開発・デプロイします。'],
  ['supabase', 'Supabase', 'developer-tools', ['supabase-cli'], 'Connect Supabase and manage projects, migrations and functions.', '连接 Supabase，管理项目、数据库迁移与函数。', 'Supabase に接続し、プロジェクト・マイグレーション・関数を管理します。'],
  ['stripe', 'Stripe', 'finance-payments', ['stripe-cli'], 'Connect Stripe and test payment integrations and webhooks.', '连接 Stripe，调试支付集成与 webhook。', 'Stripe に接続し、決済連携と webhook をテストします。'],
  ['postman', 'Postman', 'developer-tools', ['postman-cli'], 'Connect Postman and run API collections and regression tests.', '连接 Postman，运行接口集合与回归测试。', 'Postman に接続し、API コレクションと回帰テストを実行します。'],
  ['shopify', 'Shopify', 'ecommerce', ['shopify-cli', 'git'], 'Connect Shopify and develop themes, apps and storefronts.', '连接 Shopify，开发主题、应用与店面。', 'Shopify に接続し、テーマ・アプリ・ストアフロントを開発します。'],
  ['sentry', 'Sentry', 'monitoring', ['sentry', 'sentry-cli'], 'Connect Sentry, investigate errors and manage release artifacts.', '连接 Sentry，调查错误并管理发布产物。', 'Sentry に接続し、エラー調査とリリース成果物の管理を行います。'],
  ['apify', 'Apify', 'automation', ['apify-cli'], 'Connect Apify and develop, test and publish Actors.', '连接 Apify，开发、测试与发布 Actor。', 'Apify に接続し、Actor を開発・テスト・公開します。'],
  ['node', 'Node.js', 'runtime', ['node', 'pnpm'], 'JavaScript runtime with npm, npx and pnpm project workflows.', 'JavaScript 运行时，含 npm、npx 与 pnpm 项目工作流。', 'npm・npx・pnpm による開発に対応した JavaScript ランタイム。'],
  ['python', 'Python', 'runtime', ['python', 'uv', 'python-dev'], 'Python with uv, Ruff and pytest for development and testing.', 'Python 开发环境，含 uv、Ruff 与 pytest。', 'uv・Ruff・pytest を含む Python 開発環境。'],
  ['rust', 'Rust', 'runtime', ['rust'], 'Rust development with Cargo, rustfmt, Clippy and native build tools.', 'Rust 开发环境，含 Cargo、rustfmt、Clippy 与原生构建工具。', 'Cargo・rustfmt・Clippy とネイティブビルドツールを含む Rust 開発環境。'],
  ['go', 'Go', 'runtime', ['go'], 'Go toolchain for module management, builds, tests and formatting.', 'Go 工具链，支持模块管理、构建、测试与格式化。', 'モジュール管理・ビルド・テスト・整形に対応した Go ツールチェーン。'],
  ['bun', 'Bun', 'runtime', ['bun'], 'Bun and bunx for JavaScript and TypeScript development.', '使用 Bun 与 bunx 开发 JavaScript 和 TypeScript 项目。', 'Bun と bunx による JavaScript・TypeScript 開発。'],
  ['playwright', 'Browser Testing', 'automation', ['playwright'], 'Automate browser workflows, capture screenshots and run browser tests.', '自动化浏览器操作、截图与端到端测试。', 'ブラウザー操作・スクリーンショット・E2E テストを自動化します。'],
  ['ffmpeg', 'Audio & Video', 'creativity', ['ffmpeg'], 'Inspect, convert, trim and extract audio and video with FFmpeg.', '使用 FFmpeg 检查、转换、剪辑与提取音视频。', 'FFmpeg で音声・動画を解析・変換・トリミング・抽出します。'],
  ['pdf', 'PDF Processing', 'documents', ['document-python', 'document-node', 'poppler', 'qpdf', 'tesseract'], 'Read, create, merge, split, fill and OCR PDF documents.', '读取、生成、合并、拆分、填表与 OCR 处理 PDF。', 'PDF の読み取り・作成・結合・分割・フォーム入力・OCR。'],
  ['docx', 'Word Documents', 'documents', ['document-python', 'document-node', 'pandoc', 'libreoffice', 'poppler'], 'Create, edit, convert and render Word documents with complete tooling.', '使用完整工具链生成、编辑、转换与渲染 Word 文档。', '必要なツールを備えた Word 文書の作成・編集・変換・描画。'],
  ['xlsx', 'Spreadsheets', 'documents', ['document-python', 'libreoffice'], 'Create and edit spreadsheets, process data and recalculate formulas.', '生成与编辑电子表格、处理数据并重新计算公式。', 'スプレッドシートの作成・編集、データ処理、数式の再計算。'],
  ['pptx', 'PowerPoint Presentations', 'documents', ['document-python', 'document-node', 'libreoffice', 'poppler'], 'Create, edit, extract and render presentation slides.', '生成、编辑、提取与渲染演示文稿。', 'プレゼンテーションの作成・編集・抽出・描画。'],
] as const
for (const [id, name, category, dependencies, en, zh, ja] of apps) {
  const directory = path.join(root, id)
  await mkdir(directory, { recursive: true })
  let manifest: any
  try { manifest = parse(await readFile(path.join(directory, 'app.yaml'), 'utf8')); manifest.version = '1.1.0' }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    manifest = { schema_version: '2', id, version: '1.0.0', author: { name: 'Memoh' },
      repository: 'https://github.com/felinics/supermarket', license: 'Apache-2.0', icon: 'icon.svg', tags: [id, category] }
  }
  Object.assign(manifest, { name, category, description: en, dependencies })
  manifest.translations ??= {}
  manifest.translations.zh = { ...manifest.translations.zh, description: zh }
  manifest.translations.ja = { ...manifest.translations.ja, description: ja }
  if (id === 'playwright') { manifest.translations.zh.name = '浏览器测试'; manifest.translations.ja.name = 'ブラウザーテスト' }
  if (id === 'ffmpeg') { manifest.translations.zh.name = '音视频处理'; manifest.translations.ja.name = '音声・動画処理' }
  await writeFile(path.join(directory, 'app.yaml'), stringify(manifest))
}
console.log(`Updated ${apps.length} Apps.`)
