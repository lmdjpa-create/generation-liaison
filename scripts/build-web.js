const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env') });

const output = path.join(root, 'dist');
const download = 'app-generation-liaison.apk';
const downloadSource = path.join(root, 'downloads', download);
const bundle = 'app-generation-liaison.aab';
const bundleSource = path.join(root, 'downloads', bundle);
const buildAndroid = process.argv.includes('--android');
const apiUrl = (process.env.CAPACITOR_API_URL || '').replace(/\/+$/, '');
const pages = [
  'index.html',
  'aidant.html',
  'pro.html',
  'app-mobile.html',
  'reset-password.html',
  'admin.html',
  'privacy-policy.html',
  'cgu.html',
  'cgv.html'
];

if (buildAndroid) {
  let endpoint;
  try {
    endpoint = new URL(apiUrl);
  } catch {
    console.error('CAPACITOR_API_URL must be a valid HTTPS URL to build the Android app.');
    process.exit(1);
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
    console.error('CAPACITOR_API_URL must be a valid HTTPS URL to build the Android app.');
    process.exit(1);
  }
}

fs.mkdirSync(output, { recursive: true });

fs.copyFileSync(path.join(root, 'language.js'), path.join(output, 'language.js'));
for (const file of ['robots.txt', 'sitemap.xml']) {
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}

for (const page of pages) {
  const sourcePath = path.join(root, page);
  let content = fs.readFileSync(sourcePath, 'utf8');

  if ((page === 'app-mobile.html' || page === 'reset-password.html') && apiUrl) {
    content = content.replace(
      'const SERVER_URL = window.APP_API_BASE_URL || window.location.origin;',
      `const SERVER_URL = ${JSON.stringify(apiUrl)};`
    );
  }

  fs.writeFileSync(path.join(output, page), content);
}

esbuild.buildSync({
  entryPoints: [path.join(root, 'scripts', 'push-client.js')],
  outfile: path.join(output, 'push-client.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020']
});
fs.copyFileSync(
  path.join(root, 'push-service-worker.js'),
  path.join(output, 'push-service-worker.js')
);

const destinationPath = path.join(output, download);
if (fs.existsSync(downloadSource)) {
  fs.copyFileSync(downloadSource, destinationPath);
  console.log(`Android APK copied to ${path.relative(root, destinationPath)}.`);
} else {
  console.warn(`Android APK not found at ${path.relative(root, downloadSource)}; skipping copy.`);
}

if (!fs.existsSync(bundleSource)) {
  console.error(`Google Play app bundle not found at ${path.relative(root, bundleSource)}.`);
  process.exit(1);
}
const bundleDestinationPath = path.join(output, bundle);
fs.copyFileSync(bundleSource, bundleDestinationPath);
console.log(`Google Play app bundle copied to ${path.relative(root, bundleDestinationPath)}.`);

console.log(`Web files copied to ${path.relative(root, output)}.`);
