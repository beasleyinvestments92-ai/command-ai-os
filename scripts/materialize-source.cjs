const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, '.source');
const manifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'manifest.json'), 'utf8'));
for (const entry of manifest) {
  const target = path.join(root, entry.target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const content = entry.parts.map((part) => fs.readFileSync(path.join(root, part), 'utf8')).join('');
  fs.writeFileSync(target, content);
  console.log(`Materialized ${entry.target} (${Buffer.byteLength(content)} bytes)`);
}
