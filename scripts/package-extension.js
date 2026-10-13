const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RUNTIME = ['manifest.json', 'background.js', 'editor', 'fonts', 'icons', 'lib', 'popup'];
// Finder and Windows Explorer metadata never belongs in the extension.
const OS_METADATA = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

// Writes dist/taptop-toolkit-importer-<version>.zip with manifest.json at the
// archive root and only runtime files from src/. Never overwrites a ZIP.
function packageExtension({ root = path.resolve(__dirname, '..') } = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src/manifest.json'), 'utf8'));
  if (pkg.version !== manifest.version) throw new Error('VERSION_MISMATCH');
  const refs = [manifest.background.service_worker, manifest.action.default_popup,
    ...Object.values(manifest.icons),
    ...manifest.content_scripts.flatMap(item => item.js),
    ...manifest.web_accessible_resources.flatMap(item => item.resources)];
  for (const file of refs) if (!fs.existsSync(path.join(root, 'src', file))) throw new Error(`MISSING_RUNTIME_FILE: ${file}`);
  const dist = path.join(root, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  const output = path.join(dist, `taptop-toolkit-importer-${pkg.version}.zip`);
  if (fs.existsSync(output)) throw new Error(`OUTPUT_EXISTS: ${output}`);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'taptop-importer-package-'));
  try {
    for (const file of RUNTIME) {
      fs.cpSync(path.join(root, 'src', file), path.join(stage, file), { recursive: true, errorOnExist: true, force: false, filter: source => !OS_METADATA.has(path.basename(source)) });
    }
    const zipped = spawnSync('zip', ['-q', '-r', '-X', output, ...RUNTIME], { cwd: stage, encoding: 'utf8' });
    if (zipped.status !== 0) throw new Error(`ZIP_FAILED: ${zipped.stderr || zipped.error?.message || zipped.status}`);
    return output;
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}

if (require.main === module) {
  try { console.log(packageExtension()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { packageExtension };
