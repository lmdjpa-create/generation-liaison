const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'dist', 'app-mobile.html');
const destination = path.join(root, 'ios', 'App', 'App', 'public', 'index.html');

if (!fs.existsSync(source)) {
  console.error(`iOS entry page was not found at ${source}. Run the iOS web build first.`);
  process.exit(1);
}

fs.copyFileSync(source, destination);
console.log('iOS entry page prepared.');
