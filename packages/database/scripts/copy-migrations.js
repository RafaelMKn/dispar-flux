import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcMigrations = path.resolve(__dirname, '../src/migrations');
const distMigrations = path.resolve(__dirname, '../dist/migrations');

if (fs.existsSync(srcMigrations)) {
  fs.mkdirSync(distMigrations, { recursive: true });
  fs.cpSync(srcMigrations, distMigrations, { recursive: true, force: true });
  console.log(`[database] Copied migrations from ${srcMigrations} to ${distMigrations}`);
}
