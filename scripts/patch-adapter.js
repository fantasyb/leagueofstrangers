/**
 * Patches @sveltejs/adapter-vercel to support newer Node.js versions.
 * adapter-vercel@3.0.1 only supports Node 16/18, but Vercel now runs Node 20+.
 * This runs as a postinstall script to ensure the patch persists.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adapterPath = path.join(__dirname, '..', 'node_modules', '@sveltejs', 'adapter-vercel', 'index.js');

try {
    let content = fs.readFileSync(adapterPath, 'utf-8');

    // Patch VALID_RUNTIMES to include nodejs20.x and nodejs22.x
    content = content.replace(
        "const VALID_RUNTIMES = ['edge', 'nodejs16.x', 'nodejs18.x'];",
        "const VALID_RUNTIMES = ['edge', 'nodejs16.x', 'nodejs18.x', 'nodejs20.x', 'nodejs22.x'];"
    );

    // Patch get_default_runtime to handle newer Node versions
    content = content.replace(
        /const get_default_runtime = \(\) => \{[\s\S]*?^\};/m,
        `const get_default_runtime = () => {
\tconst major = process.version.slice(1).split('.')[0];
\tif (major === '16') return 'nodejs16.x';
\tif (major === '18') return 'nodejs18.x';
\tif (major === '20') return 'nodejs20.x';
\tif (major === '22') return 'nodejs22.x';
\treturn 'nodejs20.x';
};`
    );

    fs.writeFileSync(adapterPath, content);
    console.log('Patched @sveltejs/adapter-vercel for Node.js 20+ support');
} catch (e) {
    console.warn('Could not patch adapter-vercel:', e.message);
}
