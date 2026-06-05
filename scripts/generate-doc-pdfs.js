#!/usr/bin/env node
// generate-doc-pdfs.js
// Generates PDFs from KT markdown docs.
// Strategy 1: md-to-pdf (global npm) + system Chrome
// Strategy 2: pandoc CLI fallback
//
// Usage:
//   node scripts/generate-doc-pdfs.js
//
// To override Chrome path:
//   CHROME_PATH="C:/path/to/chrome.exe" node scripts/generate-doc-pdfs.js

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

const docs = [
  { src: 'docs/KT_FUNCTIONAL.md',  out: 'docs/KT_FUNCTIONAL.pdf'  },
  { src: 'docs/KT_TECHNICAL.md',   out: 'docs/KT_TECHNICAL.pdf'   },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find(p => fs.existsSync(p)) || null;
}

function findMdToPdf() {
  // Check local project, then global npm
  const localPath = path.join(ROOT, 'node_modules', 'md-to-pdf');
  if (fs.existsSync(localPath)) return localPath;
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    const globalPath = path.join(globalRoot, 'md-to-pdf');
    if (fs.existsSync(globalPath)) return globalPath;
  } catch {}
  return null;
}

function hasPandoc() {
  try { execSync('pandoc --version', { stdio: 'ignore' }); return true; }
  catch { return false; }
}

// ── Generators ────────────────────────────────────────────────────────────────

async function generateWithMdToPdf(srcAbs, outAbs, mdToPdfRoot, chromePath) {
  try {
    const { mdToPdf } = require(mdToPdfRoot);
    const launchOpts = chromePath
      ? { executablePath: chromePath, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
      : {};
    const pdf = await mdToPdf(
      { path: srcAbs },
      { dest: outAbs, launch_options: launchOpts }
    );
    return !!(pdf && pdf.filename);
  } catch (err) {
    console.warn(`  ⚠️  md-to-pdf error: ${err.message}`);
    return false;
  }
}

function generateWithPandoc(srcAbs, outAbs) {
  for (const engine of ['wkhtmltopdf', 'weasyprint', null]) {
    const cmd = engine
      ? `pandoc "${srcAbs}" -o "${outAbs}" --pdf-engine=${engine}`
      : `pandoc "${srcAbs}" -o "${outAbs}"`;
    const r = spawnSync(cmd, { shell: true, stdio: 'pipe' });
    if (r.status === 0) return true;
  }
  return false;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n📄  RevSecureCloud — KT PDF Generator\n');

  const chromePath  = findChrome();
  const mdToPdfRoot = findMdToPdf();

  console.log(chromePath  ? `🌐  Chrome : ${chromePath}` : '🌐  Chrome : not found');
  console.log(mdToPdfRoot ? `📦  md-to-pdf : ${mdToPdfRoot}` : '📦  md-to-pdf : not found');
  console.log(hasPandoc() ? '📝  pandoc : available' : '📝  pandoc : not found');

  let success = 0;

  for (const d of docs) {
    const srcAbs = path.join(ROOT, d.src);
    const outAbs = path.join(ROOT, d.out);

    if (!fs.existsSync(srcAbs)) {
      console.warn(`\n⏭️   Skipping (not found): ${d.src}`);
      continue;
    }

    console.log(`\n▶  ${d.src} → ${d.out}`);
    let ok = false;

    if (mdToPdfRoot && (chromePath || process.env.PUPPETEER_EXECUTABLE_PATH)) {
      ok = await generateWithMdToPdf(srcAbs, outAbs, mdToPdfRoot, chromePath);
      if (ok) { console.log(`  ✅  Generated via md-to-pdf`); success++; continue; }
    }

    if (hasPandoc()) {
      ok = generateWithPandoc(srcAbs, outAbs);
      if (ok) { console.log(`  ✅  Generated via pandoc`); success++; continue; }
    }

    console.error(`  ❌  Failed — install pandoc (https://pandoc.org/installing.html) or ensure Chrome is available`);
  }

  const total = docs.filter(d => fs.existsSync(path.join(ROOT, d.src))).length;
  console.log(`\n${'─'.repeat(50)}`);
  if (success === total) {
    console.log(`✅  All ${success} PDFs generated in docs/\n`);
  } else {
    console.log(`⚠️  ${success}/${total} PDFs generated.\n`);
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
