#!/bin/sh
# Opt-in; run after installers inside a disposable workspace.
set -eu
export PATH="${SMOKE_HOME:-/data/toolchain-qa}/bin:$PATH"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"
cargo new --bin rust-smoke
cd rust-smoke
cargo test
cargo fmt --check
cargo clippy -- -D warnings
cargo run
cd ..
mkdir go-smoke
cd go-smoke
go mod init example.test/smoke
printf 'package main\nfunc main() { println("go works") }\n' > main.go
go test ./...
go build -o smoke .
./smoke
cd ..
bun -e 'console.log("bun works")'
pnpm --version
cat > documents.cjs <<'JS'
const fs = require('fs');
const { Document, Packer, Paragraph } = require('docx');
const PptxGenJS = require('pptxgenjs');
(async () => {
  fs.writeFileSync('word.docx', await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('Supermarket document smoke')]}]})));
  const slides = new PptxGenJS();
  slides.addSlide().addText('Supermarket presentation smoke', {x:1,y:1,w:8,h:1});
  await slides.writeFile({fileName:'slides.pptx'});
})().catch(error => {console.error(error);process.exit(1)});
JS
document-node documents.cjs
document-python - <<'PY'
from openpyxl import Workbook
from reportlab.pdfgen import canvas
book = Workbook()
book.active['A1'] = 21
book.active['A2'] = '=A1*2'
book.save('workbook.xlsx')
pdf = canvas.Canvas('sample.pdf')
pdf.drawString(50, 700, 'Supermarket PDF smoke')
pdf.save()
PY
mkdir converted
soffice --headless "-env:UserInstallation=file://$work/office-profile" --convert-to pdf --outdir converted word.docx slides.pptx workbook.xlsx
for file in converted/word.pdf converted/slides.pdf converted/workbook.pdf sample.pdf; do
  test -s "$file"
  pdfinfo "$file"
done
pdftotext sample.pdf - | grep 'Supermarket PDF smoke'
pdftoppm -f 1 -singlefile -scale-to 1000 -png sample.pdf page
tesseract page.png stdout | grep -i 'supermarket'
qpdf --check sample.pdf
pandoc word.docx -t plain | grep 'Supermarket document smoke'
document-python /registry/registries/memoh/apps/xlsx/skills/xlsx/scripts/recalc.py workbook.xlsx
document-python - <<'PY'
from openpyxl import load_workbook
assert load_workbook('workbook.xlsx', data_only=True).active['A2'].value == 42
PY
ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc=size=160x90:rate=10 -t 1 -pix_fmt yuv420p sample.mp4
ffprobe -v error -show_entries format=duration -of default=nw=1 sample.mp4
# Use the same managed package and browser location as the CLI wrapper.
playwright screenshot --browser chromium --wait-for-timeout 100 about:blank browser.png
test -s browser.png
playwright-cli -s=supermarket-smoke open about:blank
playwright-cli -s=supermarket-smoke snapshot
playwright-cli -s=supermarket-smoke close
printf 'PASS toolchain behavior smoke\n'
