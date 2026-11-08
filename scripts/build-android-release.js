const fs = require('fs');
const path = require('path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const android = path.join(root, 'android');
const gradleWrapper = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const build = spawnSync(gradleWrapper, ['assembleRelease', 'bundleRelease'], {
  cwd: android,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

if (build.error) {
  console.error(`Unable to run the Android release build: ${build.error.message}`);
  process.exit(1);
}

if (build.status !== 0) {
  console.error(`Android release build failed with exit code ${build.status}.`);
  process.exit(build.status || 1);
}

const apk = path.join(android, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const aab = path.join(android, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
if (!fs.existsSync(apk) || !fs.existsSync(aab)) {
  console.error('Android release build completed but the APK or Play Console app bundle was not found.');
  process.exit(1);
}

const output = path.join(root, 'dist');
fs.mkdirSync(output, { recursive: true });
const apkOutput = path.join(output, 'app-generation-liaison.apk');
const aabOutput = path.join(output, 'app-generation-liaison.aab');
fs.copyFileSync(apk, apkOutput);
fs.copyFileSync(aab, aabOutput);

console.log(`Android release APK is available at ${path.relative(root, apkOutput)}.`);
console.log(`Google Play app bundle is available at ${path.relative(root, aabOutput)}.`);
