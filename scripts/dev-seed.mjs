#!/usr/bin/env node

/**
 * Dispar Flux — Seed de credenciais de desenvolvimento.
 *
 * Garante que exista um Proprietário de testes com senha conhecida e um
 * Dispositivo Autorizado já aprovado, para que `npm run dev` entregue um login
 * utilizável sem passar pelo fluxo de reivindicação (/claim) e sem aprovação
 * manual de dispositivo.
 *
 * NUNCA roda com NODE_ENV=production. Para desligar: DISPAR_DEV_SEED=0.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export const DEV_EMAIL = (process.env.DISPAR_DEV_EMAIL || 'dev@disparflux.local').trim().toLowerCase();
export const DEV_PASSWORD = process.env.DISPAR_DEV_PASSWORD || 'disparflux123';
export const DEV_NAME = process.env.DISPAR_DEV_NAME || 'Dev Tester';

/**
 * Fingerprint fixo usado pelo frontend em modo dev (apps/web/src/services/api.ts).
 * Mantenha os dois valores em sincronia.
 */
export const DEV_DEVICE_FINGERPRINT = 'df_fp_dev_fixed';

const DEVICE_TRUST_DURATION_MS = 90 * 24 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_LENGTH = 64;

/**
 * Reproduz o formato de @dispar-flux/auth PasswordHasher:
 *   $pbkdf2$sha512$i=<iterations>$<saltHex>$<hashHex>
 * Tenta usar o módulo compilado quando disponível para evitar divergência.
 */
async function hashPassword(plain) {
  try {
    const mod = await import('../packages/auth/dist/password/password-hasher.js');
    if (mod?.defaultPasswordHasher?.hash) {
      return mod.defaultPasswordHasher.hash(plain);
    }
  } catch {
    // dist ainda não compilado — usa implementação local equivalente
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.pbkdf2Sync(plain, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, 'sha512');
  return `$pbkdf2$sha512$i=${PBKDF2_ITERATIONS}$${salt}$${derived.toString('hex')}`;
}

function tableExists(db, name) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
  return Boolean(row);
}

/**
 * @param {{ dataDir?: string, silent?: boolean }} options
 * @returns {Promise<{ ok: boolean, reason?: string, email?: string, password?: string, organizationName?: string, createdMember?: boolean, approvedDevices?: number }>}
 */
export async function seedDevCredentials(options = {}) {
  const nodeEnv = process.env.NODE_ENV || 'development';
  if (nodeEnv === 'production') {
    return { ok: false, reason: 'NODE_ENV=production — seed de desenvolvimento desativado' };
  }
  if (process.env.DISPAR_DEV_SEED === '0' || process.env.DISPAR_DEV_SEED === 'false') {
    return { ok: false, reason: 'DISPAR_DEV_SEED desligado' };
  }

  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || './data');
  const dbPath = process.env.DATABASE_FILE || path.join(dataDir, 'dispar-flux.sqlite');

  if (!fs.existsSync(dbPath)) {
    return { ok: false, reason: `banco não encontrado em ${dbPath}` };
  }

  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('PRAGMA busy_timeout = 5000;');

    for (const required of ['organizations', 'members', 'authorized_devices']) {
      if (!tableExists(db, required)) {
        return { ok: false, reason: `migrações ainda não aplicadas (falta a tabela ${required})` };
      }
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAtIso = new Date(now.getTime() + DEVICE_TRUST_DURATION_MS).toISOString();

    // 1. Organização: usa a existente ou cria uma de desenvolvimento.
    let org = db.prepare('SELECT id, name FROM organizations ORDER BY created_at ASC LIMIT 1').get();
    if (!org) {
      const orgId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO organizations (
          id, name, operational_timezone,
          retention_policy_messages_days, retention_policy_media_days, retention_policy_logs_days,
          created_at, updated_at
        ) VALUES (?, ?, 'America/Sao_Paulo', 365, 90, 30, ?, ?)
      `).run(orgId, 'Organização de Desenvolvimento', nowIso, nowIso);
      org = { id: orgId, name: 'Organização de Desenvolvimento' };
    }

    // 2. Proprietário de testes: cria ou reaplica a senha conhecida.
    const passwordHash = await hashPassword(DEV_PASSWORD);
    const existing = db.prepare('SELECT id FROM members WHERE email = ?').get(DEV_EMAIL);

    let memberId;
    let createdMember = false;
    if (existing) {
      memberId = existing.id;
      db.prepare(`
        UPDATE members
        SET password_hash = ?, role = 'owner', is_active = 1, organization_id = ?, updated_at = ?
        WHERE id = ?
      `).run(passwordHash, org.id, nowIso, memberId);
    } else {
      memberId = crypto.randomUUID();
      createdMember = true;
      db.prepare(`
        INSERT INTO members (
          id, organization_id, name, email, role, password_hash, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'owner', ?, 1, ?, ?)
      `).run(memberId, org.id, DEV_NAME, DEV_EMAIL, passwordHash, nowIso, nowIso);
    }

    // 3. Dispositivo fixo de dev, já aprovado, para TODOS os membros.
    //    Em dev o frontend usa um fingerprint fixo, então qualquer conta do banco
    //    (não só a de testes) entra direto, sem a tela de aprovação de dispositivo.
    const members = db.prepare('SELECT id FROM members').all();
    for (const m of members) {
      const device = db
        .prepare('SELECT id FROM authorized_devices WHERE member_id = ? AND device_identifier = ?')
        .get(m.id, DEV_DEVICE_FINGERPRINT);

      if (device) {
        db.prepare(`
          UPDATE authorized_devices
          SET is_approved = 1, approved_at = ?, approved_by_member_id = ?,
              last_seen_at = ?, expires_at = ?, revoked_at = NULL
          WHERE id = ?
        `).run(nowIso, m.id, nowIso, expiresAtIso, device.id);
      } else {
        db.prepare(`
          INSERT INTO authorized_devices (
            id, member_id, device_identifier, name, is_approved,
            approved_at, approved_by_member_id, last_seen_at, expires_at, created_at
          ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
        `).run(
          crypto.randomUUID(),
          m.id,
          DEV_DEVICE_FINGERPRINT,
          'Navegador de Desenvolvimento',
          nowIso,
          m.id,
          nowIso,
          expiresAtIso,
          nowIso
        );
      }
    }

    // 4. Aprova qualquer outro dispositivo pendente do usuário de testes
    //    (cobre localStorage com fingerprint aleatório de execuções anteriores).
    const pending = db.prepare(`
      UPDATE authorized_devices
      SET is_approved = 1, approved_at = ?, approved_by_member_id = ?, expires_at = ?, revoked_at = NULL
      WHERE member_id = ? AND (is_approved = 0 OR revoked_at IS NOT NULL)
    `).run(nowIso, memberId, expiresAtIso, memberId);

    return {
      ok: true,
      email: DEV_EMAIL,
      password: DEV_PASSWORD,
      organizationName: org.name,
      createdMember,
      approvedDevices: Number(pending.changes ?? 0),
    };
  } finally {
    db.close();
  }
}

/** Caixa colorida com as credenciais, no mesmo estilo do box do claim token. */
export function printDevCredentials(result) {
  if (!result?.ok) {
    if (result?.reason) {
      console.log('\x1b[90m%s\x1b[0m', `[dev-seed] ignorado: ${result.reason}`);
    }
    return;
  }

  const WIDTH = 58; // largura interna da caixa, em colunas
  const M = '\x1b[35m';
  const HL = '\x1b[1m\x1b[33m';
  const R = '\x1b[0m';

  // Largura visível: ignora sequências ANSI e conta emoji como 2 colunas.
  const visibleWidth = (s) => {
    const plain = s.replace(/\x1b\[[0-9;]*m/g, '');
    let w = 0;
    for (const ch of plain) {
      const cp = ch.codePointAt(0);
      w += cp >= 0x1f300 && cp <= 0x1faff ? 2 : 1;
    }
    return w;
  };

  const line = (content = '') => {
    const filler = ' '.repeat(Math.max(0, WIDTH - visibleWidth(content)));
    console.log(`${M}│${R}${content}${filler}${M}│${R}`);
  };

  const rule = (l, mid, r) => console.log(`${M}${l}${mid.repeat(WIDTH)}${r}${R}`);

  rule('┌', '─', '┐');
  line(`${M}  👤 USUÁRIO DE TESTES (somente desenvolvimento)${R}`);
  rule('├', '─', '┤');
  line(`${M}  E-mail:  ${HL}${result.email}${R}`);
  line(`${M}  Senha:   ${HL}${result.password}${R}`);
  line(`${M}  Login:   http://localhost:5173/login${R}`);
  line();
  line(`${M}  Papel: Proprietário · dispositivo já aprovado${R}`);
  line(`${M}  Desligar: DISPAR_DEV_SEED=0 npm run dev${R}`);
  rule('└', '─', '┘');
  console.log('');
}

const invokedDirectly =
  process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/dev-seed.mjs');

if (invokedDirectly) {
  const result = await seedDevCredentials();
  printDevCredentials(result);
  process.exit(result.ok ? 0 : 1);
}
