const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

test('iOS declares usage descriptions for optional location, calls, dictation and photos', () => {
  const plist = fs.readFileSync(path.join(__dirname, '..', 'ios', 'App', 'App', 'Info.plist'), 'utf8');
  for (const key of [
    'NSLocationWhenInUseUsageDescription',
    'NSLocationAlwaysAndWhenInUseUsageDescription',
    'NSCameraUsageDescription',
    'NSMicrophoneUsageDescription',
    'NSSpeechRecognitionUsageDescription',
    'NSPhotoLibraryUsageDescription'
  ]) {
    assert.match(plist, new RegExp(`<key>${key}</key>\\s*<string>[^<]+</string>`), key);
  }
});
