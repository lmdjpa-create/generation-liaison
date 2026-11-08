const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'dist', 'app-mobile.html');
const destination = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'public', 'index.html');

if (!fs.existsSync(source)) {
  console.error(`Android entry page was not found at ${source}. Run the Android web build first.`);
  process.exit(1);
}

fs.copyFileSync(source, destination);
console.log('Android entry page prepared.');
