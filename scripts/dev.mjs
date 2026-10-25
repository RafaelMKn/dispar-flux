#!/usr/bin/env node

import { spawn } from 'node:child_process';
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { seedDevCredentials, printDevCredentials } from './dev-seed.mjs';

const isWin = process.platform === 'win32';

console.log('\x1b[36m%s\x1b[0m', '==================================================');
console.log('\x1b[36m%s\x1b[0m', '   Dispar Flux — Iniciando Backend & Frontend     ');
console.log('\x1b[36m%s\x1b[0m', '==================================================\n');

const dataDir = process.env.DATA_DIR || './data';
const claimFile = path.join(dataDir, 'claim.token');
if (fs.existsSync(claimFile)) {
  const token = fs.readFileSync(claimFile, 'utf-8').trim();
  if (token) {
    console.log('\x1b[32m%s\x1b[0m', '┌──────────────────────────────────────────────────────────┐');
    console.log('\x1b[32m%s\x1b[0m', '│  🔑 CÓDIGO DE INSTALAÇÃO INICIAL (CLAIM TOKEN):          │');
    console.log(`│     \x1b[1m\x1b[33m${token.padEnd(52, ' ')}\x1b[0m│`);
    console.log('\x1b[32m%s\x1b[0m', '│                                                          │');
    console.log('\x1b[32m%s\x1b[0m', '│  Cole este código na tela de configuração (/claim)       │');
    console.log('\x1b[32m%s\x1b[0m', '│  ou altere pelo terminal com: npm run token -- --set ... │');
    console.log('\x1b[32m%s\x1b[0m', '└──────────────────────────────────────────────────────────┘\n');
  }
}

function runCommand(command, args = [], env = {}) {
  const fullEnv = { ...process.env, ...env };
  if (isWin) {
    const fullCmd = [command, ...args].join(' ');
    return spawn(fullCmd, {
      stdio: 'inherit',
      shell: true,
      env: fullEnv,
    });
  }
  return spawn(command, args, {
    stdio: 'inherit',
    env: fullEnv,
  });
}

// 1. Iniciar servidor Backend (API + WebSocket na porta 3000)
const server = runCommand(isWin ? 'npx.cmd' : 'npx', ['tsx', 'watch', 'apps/server/src/index.ts'], {
  PORT: process.env.PORT || '3000',
  HOST: process.env.HOST || '0.0.0.0',
  NODE_ENV: process.env.NODE_ENV || 'development',
});

let web = null;

// 2. Espera o backend responder (aplica migrações no boot), roda o seed de
//    credenciais de teste e só então sobe o Vite.
const PORT = process.env.PORT || '3000';

async function waitForBackend(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (res.ok) return true;
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

let cancelled = false;

const bootstrap = (async () => {
  const ready = await waitForBackend();
  if (cancelled) return;

  if (!ready) {
    console.log('\x1b[90m%s\x1b[0m', `[dev-seed] backend não respondeu em /health (porta ${PORT}); seed ignorado.`);
  } else {
    try {
      printDevCredentials(await seedDevCredentials({ dataDir }));
    } catch (err) {
      console.error('\x1b[31m%s\x1b[0m', `[dev-seed] falhou: ${err?.message || err}`);
    }
  }

  if (cancelled) return;

  web = runCommand(isWin ? 'npm.cmd' : 'npm', ['--workspace=@dispar-flux/web', 'run', 'dev']);

  web.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`\x1b[31m[Web Frontend finalizou com código ${code}]\x1b[0m`);
    }
  });
})();

server.on('exit', (code) => {
  if (code !== null && code !== 0) {
    console.error(`\x1b[31m[Backend finalizou com código ${code}]\x1b[0m`);
  }
});

function killProcess(child) {
  if (!child || !child.pid) return;
  try {
    if (isWin) {
      spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' });
    } else {
      child.kill('SIGINT');
    }
  } catch {
    // Ignora se o processo já estiver encerrado
  }
}

function shutdown() {
  cancelled = true;
  void bootstrap;
  console.log('\n\x1b[33m%s\x1b[0m', 'Encerrando servidores Dispar Flux...');
  killProcess(server);
  killProcess(web);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
