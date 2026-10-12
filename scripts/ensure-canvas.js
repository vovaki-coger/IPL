// canvas ships as a native addon. pnpm >= 10 does not run install scripts for
// dependencies unless they are whitelisted, which leaves
// node_modules/canvas/build/Release/canvas.node missing and breaks the 3D
// viewer at require time ("Cannot find module './build/Release/canvas.node'").
// This script detects that and rebuilds it once. It must never fail the install.
import { createRequire } from 'module';
import { execFileSync } from 'child_process';

const require = createRequire(import.meta.url);

function canLoadCanvas() {
    try {
        require('canvas');
        return true;
    } catch {
        return false;
    }
}

if (canLoadCanvas()) {
    console.log('[ensure-canvas] canvas OK');
    process.exit(0);
}

console.log('[ensure-canvas] canvas native binary missing, rebuilding...');

const attempts = [
    { cmd: 'pnpm', args: ['rebuild', 'canvas'] },
    { cmd: 'npm', args: ['rebuild', 'canvas'] }
];

for (const { cmd, args } of attempts) {
    try {
        execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    } catch (e) {
        console.log(`[ensure-canvas] ${cmd} ${args.join(' ')} failed: ${e.message}`);
        continue;
    }
    if (canLoadCanvas()) {
        console.log('[ensure-canvas] canvas rebuilt OK');
        process.exit(0);
    }
}

console.warn('[ensure-canvas] canvas still unavailable - the 3D viewer will stay disabled.');
console.warn('[ensure-canvas] on Replit run: pnpm rebuild canvas');