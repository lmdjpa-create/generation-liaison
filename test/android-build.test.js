const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

test('Android web assets omit downloadable builds, including stale files from a previous web build', () => {
  const root = path.join(__dirname, '..');
  const fixture = fs.mkdtempSync(path.join(root, 'node_modules', '.android-assets-test-'));
  try {
    for (const entry of [
      'index.html', 'aidant.html', 'pro.html', 'app-mobile.html', 'aide-installation-android.html',
      'reset-password.html', 'admin.html', 'privacy-policy.html', 'cgu.html', 'cgv.html',
      'language.js', 'robots.txt', 'sitemap.xml', 'logo-generation-liaison.jpg', 'accessibility.css',
      'homepage-images', 'push-service-worker.js', 'scripts'
    ]) {
      fs.cpSync(path.join(root, entry), path.join(fixture, entry), { recursive: true });
    }
    fs.mkdirSync(path.join(fixture, 'downloads'));
    for (const file of ['app-generation-liaison.apk', 'app-generation-liaison.aab']) {
      fs.writeFileSync(path.join(fixture, 'downloads', file), 'previous release');
    }
    const build = args => spawnSync(process.execPath, [path.join(fixture, 'scripts', 'build-web.js'), ...args], {
      cwd: fixture, encoding: 'utf8',
      env: { ...process.env, CAPACITOR_API_URL: 'https://generation-liaison.onrender.com' }
    });
    const web = build([]);
    assert.equal(web.status, 0, web.stderr);
    for (const file of ['app-generation-liaison.apk', 'app-generation-liaison.aab']) {
      assert.equal(fs.existsSync(path.join(fixture, 'dist', file)), true);
    }
    const android = build(['--android']);
    assert.equal(android.status, 0, android.stderr);
    for (const file of ['app-generation-liaison.apk', 'app-generation-liaison.aab']) {
      assert.equal(fs.existsSync(path.join(fixture, 'dist', file)), false);
    }
    assert.match(fs.readFileSync(path.join(fixture, 'dist', 'app-mobile.html'), 'utf8'), /generation-liaison\.onrender\.com/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
