import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

const compile = spawnSync(
  process.execPath,
  [
    resolve('node_modules/typescript/bin/tsc'),
    '--ignoreConfig',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--target',
    'ES2023',
    '--esModuleInterop',
    '--skipLibCheck',
    '--outDir',
    '.tmp/seed-run',
    '--rootDir',
    '.',
    'prisma/seed.ts',
  ],
  { stdio: 'inherit' },
);

if (compile.status !== 0) process.exit(compile.status ?? 1);

const seed = spawnSync(process.execPath, [resolve('.tmp/seed-run/prisma/seed.js')], {
  stdio: 'inherit',
});

process.exit(seed.status ?? 1);
