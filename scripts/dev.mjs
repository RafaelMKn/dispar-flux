#!/usr/bin/env node

import { spawn } from 'node:child_process';
import process from 'node:process';

const isWin = process.platform === 'win32';

console.log('\x1b[36m%s\x1b[0m', '==================================================');
console.log('\x1b[36m%s\x1b[0m', '   Dispar Flux — Iniciando Backend & Frontend     ');
console.log('\x1b[36m%s\x1b[0m', '==================================================\n');

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
const server = runCommand(isWin ? 'npx.cmd' : 'npx', ['tsx', 'apps/server/src/index.ts'], {
  PORT: process.env.PORT || '3000',
  HOST: process.env.HOST || '0.0.0.0',
});

let web = null;

// 2. Aguarda 600ms para o backend inicializar antes de subir o Vite
const timer = setTimeout(() => {
  web = runCommand(isWin ? 'npm.cmd' : 'npm', ['--workspace=@dispar-flux/web', 'run', 'dev']);

  web.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`\x1b[31m[Web Frontend finalizou com código ${code}]\x1b[0m`);
    }
  });
}, 600);

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
  clearTimeout(timer);
  console.log('\n\x1b[33m%s\x1b[0m', 'Encerrando servidores Dispar Flux...');
  killProcess(server);
  killProcess(web);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
