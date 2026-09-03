import { resolve } from 'node:path';
import { config } from 'dotenv';

const workspaceEnvironmentPath = resolve(process.cwd(), '../../.env');

config({
  path: [resolve(process.cwd(), '.env'), workspaceEnvironmentPath],
  quiet: true,
});
