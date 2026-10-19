import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, 'build');
const assetsDir = path.join(root, 'assets');

function bumpVersion(version) {
  const parts = version.split('.').map(Number);
  parts[2]++;
  return parts.join('.');
}

const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const oldVersion = pkg.version;
// `--no-bump` packages the current version as-is (e.g. a deliberate 1.0.0 release).
const newVersion = process.argv.includes('--no-bump') ? oldVersion : bumpVersion(oldVersion);

pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

const pluginJsonPath = path.join(root, 'plugin.json');
const pluginJson = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf-8'));
pluginJson.version = newVersion;
fs.writeFileSync(pluginJsonPath, JSON.stringify(pluginJson, null, 2) + '\n');

const manifestPath = path.join(assetsDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
manifest.version = newVersion;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.log(`\n  Version: ${oldVersion} → ${newVersion}\n`);

console.log('  Building...');
execSync('npx vite build', { cwd: root, stdio: 'inherit' });

console.log('\n  Packaging...');

const pluginZip = new JSZip();

pluginZip.file('plugin.json', fs.readFileSync(pluginJsonPath, 'utf-8'));

const jsFile = path.join(buildDir, 'index.js');
if (!fs.existsSync(jsFile)) {
  console.error('Build output index.js not found');
  process.exit(1);
}
pluginZip.file('index.js', fs.readFileSync(jsFile));

const cssFile = path.join(buildDir, 'style.css');
if (fs.existsSync(cssFile)) {
  pluginZip.file('style.css', fs.readFileSync(cssFile));
}

const pluginZipBuffer = await pluginZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

const distZip = new JSZip();
distZip.file('plugin.zip', pluginZipBuffer);

if (fs.existsSync(assetsDir)) {
  const entries = fs.readdirSync(assetsDir);
  for (const entry of entries) {
    const filePath = path.join(assetsDir, entry);
    if (fs.statSync(filePath).isFile()) {
      distZip.file(`assets/${entry}`, fs.readFileSync(filePath));
    }
  }
}

const distBuffer = await distZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
const outputPath = path.join(buildDir, 'archon-forge.zip');
fs.writeFileSync(outputPath, distBuffer);

const pluginKB = (pluginZipBuffer.length / 1024).toFixed(1);
const distKB = (distBuffer.length / 1024).toFixed(1);
console.log(`  Plugin code: plugin.zip (${pluginKB} KB)`);
console.log(`  Distribution: archon-forge.zip (${distKB} KB)`);
console.log(`\n  ✓ Packaged v${newVersion}\n`);
