const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env') });

const output = path.join(root, 'dist');
const buildAndroid = process.argv.includes('--android');
const apiUrl = (process.env.CAPACITOR_API_URL || '').replace(/\/+$/, '');
const pages = ['index.html', 'aidant.html', 'pro.html', 'app-mobile.html'];

if (buildAndroid && !apiUrl) {
  console.error('CAPACITOR_API_URL is required to build the Android app.');
  process.exit(1);
}

fs.mkdirSync(output, { recursive: true });

for (const page of pages) {
  const sourcePath = path.join(root, page);
  let content = fs.readFileSync(sourcePath, 'utf8');

  if (page === 'app-mobile.html' && apiUrl) {
    content = content.replace(
      'const SERVER_URL = window.APP_API_BASE_URL || window.location.origin;',
      `const SERVER_URL = ${JSON.stringify(apiUrl)};`
    );
  }

  fs.writeFileSync(path.join(output, page), content);
}

if (buildAndroid) {
  fs.copyFileSync(path.join(output, 'app-mobile.html'), path.join(output, 'index.html'));
}

console.log(`Web files copied to ${path.relative(root, output)}.`);

