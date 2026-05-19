import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const srcScript = path.join(root, 'src', 'booth-batch.user.js');
const publicDir = path.join(root, 'public');
const distDir = path.join(root, 'dist');
const betaDir = path.join(distDir, 'beta');

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(betaDir, { recursive: true });

if (fs.existsSync(publicDir)) {
	fs.cpSync(publicDir, distDir, { recursive: true });
}

let code = fs.readFileSync(srcScript, 'utf8');
code = code.replaceAll('__BUILD_DATE__', new Date().toISOString());

fs.writeFileSync(path.join(betaDir, 'booth-batch.user.js'), code, 'utf8');

console.log('Built userscript to dist/beta/booth-batch.user.js');
