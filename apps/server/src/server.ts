import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

import {
  openDatabase,
  runMigrations,
  InstallationLock,
  type DatabaseConnection,
} from '@dispar-flux/database';

import {
  normalizePhoneNumber,
  SAFETY_FLOOR,
  type MemberRole,
} from '@dispar-flux/domain';

import {
  createCorsHandler,
  createSecureHeadersHandler,
  createRateLimiter,
  createCsrfProtection,
  createSizeLimitHandler,
  SanitizedLogger,
  type CorsHandler,
  type SecureHeadersHandler,
  type RateLimiter,
  type CsrfProtection,
  type SizeLimitHandler,
} from '@dispar-flux/security';

import {
  PasswordHasher,
  defaultPasswordHasher,
  getOrCreateClaimToken,
  readClaimToken,
  destroyClaimToken,
  verifyClaimToken,
  AuditLogger,
  MemberService,
  DeviceService,
  SessionService,
  InviteService,
} from '@dispar-flux/auth';

import {
  ContactService,
  CampaignService,
} from '@dispar-flux/campaigns';

import {
  BackupService,
  MigrationImporter,
  type DeletionLedgerRecord,
} from '@dispar-flux/migration';

import type {
  HealthResponse,
  ReadyResponse,
  SystemStatusResponse,
} from '@dispar-flux/contracts';

export interface ServerOptions {
  port?: number;
  host?: string;
  dataDir?: string;
  allowedOrigins?: string[];
  claimCode?: string;
  recoveryKey?: string;
  nodeEnv?: string;
}

export class DisparFluxServer {
  public readonly port: number;
  public readonly host: string;
  public readonly dataDir: string;
  public readonly nodeEnv: string;
  public recoveryKey: string;

  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private db: DatabaseConnection | null = null;
  private lock: InstallationLock | null = null;
  private startTime: number = 0;

  // Security Handlers
  public readonly cors: CorsHandler;
  public readonly secureHeaders: SecureHeadersHandler;
  public readonly rateLimiter: RateLimiter;
  public readonly csrf: CsrfProtection;
  public readonly sizeLimits: SizeLimitHandler;
  public readonly logger: SanitizedLogger;

  // Services
  public memberService!: MemberService;
  public deviceService!: DeviceService;
  public sessionService!: SessionService;
  public inviteService!: InviteService;
  public contactService!: ContactService;
  public campaignService!: CampaignService;
  public auditLogger!: AuditLogger;
  public passwordHasher: PasswordHasher = defaultPasswordHasher;

  constructor(options: ServerOptions = {}) {
    this.port = options.port ?? 3000;
    this.host = options.host ?? '127.0.0.1';
    this.dataDir = path.resolve(options.dataDir ?? process.env.DATA_DIR ?? './data');
    this.nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? 'development';
    this.recoveryKey = options.recoveryKey ?? process.env.RECOVERY_KEY ?? 'flux_default_recovery_key_32_bytes_long_!!';

    this.logger = new SanitizedLogger('DisparFluxServer');

    this.cors = createCorsHandler({
      allowedOrigins: options.allowedOrigins ?? ['http://localhost:3000', 'http://127.0.0.1:3000'],
    });

    this.secureHeaders = createSecureHeadersHandler({
      enableHsts: this.nodeEnv === 'production',
    });

    this.rateLimiter = createRateLimiter();
    this.csrf = createCsrfProtection({
      isProduction: this.nodeEnv === 'production',
    });
    this.sizeLimits = createSizeLimitHandler();
  }

  /**
   * Boots the server: acquires lock, runs migrations, executes crash recovery, starts HTTP/WS.
   */
  async start(): Promise<{ port: number; address: string }> {
    this.startTime = Date.now();
    fs.mkdirSync(this.dataDir, { recursive: true });

    // 1. Acquire Installation Lock (ADR 0004 & ADR 0010: single instance per data directory)
    this.lock = InstallationLock.acquire(this.dataDir);

    // 2. Open SQLite Connection with WAL mode
    this.db = openDatabase({
      dataDir: this.dataDir,
      filePath: path.join(this.dataDir, 'dispar-flux.sqlite'),
    });

    // 3. Execute migrations forward-only
    runMigrations(this.db);

    // 4. ADR 0028: Envio Incerto crash recovery on boot
    this.recoverInFlightJobs();

    // 5. Initialize claim token
    getOrCreateClaimToken(this.dataDir);

    // 6. Initialize services
    this.auditLogger = new AuditLogger(this.db);
    this.memberService = new MemberService(this.db, this.auditLogger, this.passwordHasher);
    this.deviceService = new DeviceService(this.db, this.auditLogger);
    this.sessionService = new SessionService(this.db, this.auditLogger);
    this.inviteService = new InviteService(this.db, this.sessionService, this.auditLogger, this.passwordHasher);
    this.contactService = new ContactService(this.db);
    this.campaignService = new CampaignService(this.db);

    // 7. Initialize HTTP server
    this.httpServer = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        this.logger.error('Unhandled server error', { error: err instanceof Error ? err.message : String(err) });
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Internal Server Error' }));
        }
      });
    });

    // 8. Initialize WebSocket server for /ws
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on('connection', (ws) => {
      ws.send(JSON.stringify({ type: 'system.status_changed', payload: { status: 'connected' } }));
    });

    this.httpServer.on('upgrade', (req, socket, head) => {
      const pathname = req.url ? req.url.split('?')[0] : '';
      if (pathname === '/ws') {
        this.wss!.handleUpgrade(req, socket, head, (ws) => {
          this.wss!.emit('connection', ws, req);
        });
      } else {
        socket.destroy();
      }
    });

    return new Promise((resolve, reject) => {
      this.httpServer!.listen(this.port, this.host, () => {
        const addr = this.httpServer!.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : this.port;
        this.logger.info(`Dispar Flux server listening on http://${this.host}:${actualPort}`);
        resolve({ port: actualPort, address: `http://${this.host}:${actualPort}` });
      });
      this.httpServer!.on('error', reject);
    });
  }

  /**
   * ADR 0028: In-flight jobs left in 'sending' status become 'unknown' and are NEVER retried automatically.
   */
  public recoverInFlightJobs(): number {
    if (!this.db) return 0;
    const now = new Date().toISOString();

    const jobs = this.db.prepare("SELECT id, campaign_id FROM campaign_jobs WHERE status = 'sending'").all() as Array<{
      id: string;
      campaign_id: string;
    }>;

    if (jobs.length === 0) return 0;

    const updateJobStmt = this.db.prepare(`
      UPDATE campaign_jobs
      SET status = 'unknown',
          error_reason = 'Envio Incerto: process interrupted in-flight (ADR 0028)',
          updated_at = ?
      WHERE id = ?
    `);

    const updateCampStmt = this.db.prepare(`
      UPDATE campaigns
      SET unknown_count = unknown_count + 1, updated_at = ?
      WHERE id = ?
    `);

    this.db.transaction(() => {
      for (const job of jobs) {
        updateJobStmt.run(now, job.id);
        updateCampStmt.run(now, job.campaign_id);
      }
    });

    this.logger.warn(`Recovered ${jobs.length} in-flight sending jobs to unknown (ADR 0028)`);
    return jobs.length;
  }

  /**
   * Primary HTTP request router and middleware dispatcher.
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 1. Secure HTTP Headers & CSP
    this.secureHeaders.apply(req, res);

    // 2. Strict CORS Handler
    const corsPreflightHandled = this.cors.handle(req, res);
    if (corsPreflightHandled) return;

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method?.toUpperCase() || 'GET';

    // 3. Early Body Size / Content-Length limit check
    if (this.sizeLimits.checkContentLength(req, res, pathname)) return;

    // 4. Rate Limiting
    if (this.rateLimiter.handle(req, res, pathname)) return;

    // 5. CSRF Protection for state-changing routes
    if (this.csrf.handle(req, res)) return;

    // Route Dispatcher
    // --- Health & Readiness ---
    if (method === 'GET' && pathname === '/health') {
      const response: HealthResponse = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
        version: '0.0.1',
      };
      this.sendJson(res, 200, response);
      return;
    }

    if (method === 'GET' && pathname === '/ready') {
      const isDbReady = Boolean(this.db && this.db.isOpen);
      const isLockHeld = Boolean(this.lock && this.lock.isHeld);

      const ready: ReadyResponse = {
        status: isDbReady && isLockHeld ? 'ready' : 'not_ready',
        database: isDbReady ? 'connected' : 'error',
        storage: 'ready',
        checks: {
          database: isDbReady,
          storage: true,
          migrations: true,
          lock: isLockHeld,
          installationLock: isLockHeld,
        },
        timestamp: new Date().toISOString(),
      };
      this.sendJson(res, isDbReady && isLockHeld ? 200 : 503, ready);
      return;
    }

    if (method === 'GET' && pathname === '/api/v1/system/status') {
      const org = this.db!.prepare('SELECT id, operational_timezone FROM organizations LIMIT 1').get() as {
        id: string;
        operational_timezone: string;
      } | undefined;

      const response: SystemStatusResponse = {
        installationId: org?.id || 'unclaimed',
        version: '0.0.1',
        edition: 'community',
        environment: this.nodeEnv,
        operationalTimezone: org?.operational_timezone || 'America/Sao_Paulo',
        uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
        nodeVersion: process.version,
        isClaimed: Boolean(org),
        activeConnectionsCount: 1,
        storageType: 'local',
      };
      this.sendJson(res, 200, response);
      return;
    }

    if (method === 'GET' && pathname === '/api/v1/openapi.json') {
      const openApiDoc = {
        openapi: '3.1.0',
        info: {
          title: 'Dispar Flux API',
          version: '0.0.1',
          description: 'Dispar Flux Modular Monolith API',
        },
        paths: {
          '/health': { get: { summary: 'Health check' } },
          '/ready': { get: { summary: 'Readiness check' } },
          '/api/v1/system/status': { get: { summary: 'System status' } },
          '/api/v1/auth/claim': { post: { summary: 'Onboarding claim flow' } },
          '/api/v1/auth/login': { post: { summary: 'Member login' } },
        },
      };
      this.sendJson(res, 200, openApiDoc);
      return;
    }

    // --- Authentication & Onboarding ---
    if (method === 'POST' && pathname === '/api/v1/auth/claim') {
      const body = await this.sizeLimits.readJson<{
        claimCode: string;
        organizationName: string;
        ownerName: string;
        ownerEmail: string;
        password: string;
        operationalTimezone: string;
      }>(req);

      // Check if already claimed
      const existingOwner = this.db!.prepare("SELECT id FROM members WHERE role = 'owner' LIMIT 1").get();
      if (existingOwner) {
        this.sendJson(res, 409, {
          error: 'Conflict',
          message: 'Installation has already been claimed by an Owner',
        });
        return;
      }

      // Verify claim token from dataDir
      const isValidClaim = verifyClaimToken(this.dataDir, body.claimCode);
      if (!isValidClaim) {
        this.sendJson(res, 400, {
          error: 'Bad Request',
          message: 'Invalid claim code provided',
        });
        return;
      }

      // Create Organization
      const orgId = crypto.randomUUID();
      const now = new Date().toISOString();
      this.db!.prepare(`
        INSERT INTO organizations (id, name, operational_timezone, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(orgId, body.organizationName.trim(), body.operationalTimezone || 'America/Sao_Paulo', now, now);

      // Create default messaging connection (ADR 0002 & ADR 0005)
      const defaultConnId = crypto.randomUUID();
      this.db!.prepare(`
        INSERT INTO messaging_connections (id, organization_id, name, provider, status, is_default, created_at, updated_at)
        VALUES (?, ?, 'WhatsApp Principal', 'baileys', 'disconnected', 1, ?, ?)
      `).run(defaultConnId, orgId, now, now);

      // Create Owner member
      const member = this.memberService.createMember({
        organizationId: orgId,
        name: body.ownerName.trim(),
        email: body.ownerEmail.trim(),
        role: 'owner',
        password: body.password,
      });

      // Register and auto-approve Owner's first device
      const { device } = this.deviceService.registerOrGetDevice({
        memberId: member.id,
        deviceFingerprint: 'owner-primary-browser',
        name: 'Primary Owner Console',
      });
      this.deviceService.approveDevice({
        deviceId: device.id,
        approvedByMemberId: member.id,
        actorRole: 'owner',
        organizationId: orgId,
      });

      // Create initial session
      const { rawToken } = this.sessionService.createSession(member.id, device.id);

      // Invalidate claim code (destroy file)
      destroyClaimToken(this.dataDir);

      this.sendJson(res, 201, {
        organizationId: orgId,
        ownerId: member.id,
        token: rawToken,
        recoveryKeyGuidance:
          'Keep your Recovery Key safe in an external password manager. It is required for disaster recovery.',
        message: 'Installation successfully claimed',
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/v1/auth/login') {
      const body = await this.sizeLimits.readJson<{
        email: string;
        password: string;
        deviceFingerprint: string;
        deviceName?: string;
      }>(req);

      const memberRow = this.db!.prepare('SELECT * FROM members WHERE email = ?').get(
        body.email.trim().toLowerCase()
      ) as {
        id: string;
        organization_id: string;
        name: string;
        email: string;
        role: MemberRole;
        password_hash: string | null;
        is_active: number;
      } | undefined;

      if (!memberRow || !memberRow.password_hash || memberRow.is_active !== 1) {
        this.sendJson(res, 401, { error: 'Unauthorized', message: 'Invalid credentials' });
        return;
      }

      const isPasswordValid = this.passwordHasher.verify(body.password, memberRow.password_hash);
      if (!isPasswordValid) {
        this.sendJson(res, 401, { error: 'Unauthorized', message: 'Invalid credentials' });
        return;
      }

      const { device } = this.deviceService.registerOrGetDevice({
        memberId: memberRow.id,
        deviceFingerprint: body.deviceFingerprint || 'unknown-fingerprint',
        name: body.deviceName,
      });

      if (!device.isApproved) {
        this.sendJson(res, 200, {
          member: {
            id: memberRow.id,
            name: memberRow.name,
            email: memberRow.email,
            role: memberRow.role,
          },
          deviceId: device.id,
          requiresDeviceApproval: true,
          message: 'Device requires Owner approval before granting access',
        });
        return;
      }

      const { rawToken } = this.sessionService.createSession(memberRow.id, device.id);

      this.sendJson(res, 200, {
        token: rawToken,
        member: {
          id: memberRow.id,
          name: memberRow.name,
          email: memberRow.email,
          role: memberRow.role,
        },
        deviceId: device.id,
        requiresDeviceApproval: false,
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/v1/auth/session') {
      const token = this.extractToken(req);
      if (!token) {
        this.sendJson(res, 401, { error: 'Unauthorized', message: 'Missing session token' });
        return;
      }

      try {
        const authContext = this.sessionService.validateToken(token);
        this.sendJson(res, 200, {
          session: authContext.session,
          member: authContext.member,
          device: authContext.device,
        });
      } catch (err) {
        this.sendJson(res, 401, { error: 'Unauthorized', message: err instanceof Error ? err.message : 'Session invalid' });
      }
      return;
    }

    if (method === 'POST' && pathname === '/api/v1/auth/logout') {
      const token = this.extractToken(req);
      if (token) {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const now = new Date().toISOString();
        this.db!.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?').run(now, tokenHash);
      }
      this.sendJson(res, 200, { success: true });
      return;
    }

    // --- Device Approval ---
    if (method === 'POST' && pathname === '/api/v1/devices/approve') {
      const body = await this.sizeLimits.readJson<{ deviceId: string; approve: boolean; ownerMemberId?: string }>(req);
      const ownerRow = this.db!.prepare("SELECT id FROM members WHERE role = 'owner' LIMIT 1").get() as { id: string } | undefined;
      const orgRow = this.db!.prepare('SELECT id FROM organizations LIMIT 1').get() as { id: string } | undefined;

      const ownerId = body.ownerMemberId || ownerRow?.id || 'owner_default';
      const approved = this.deviceService.approveDevice({
        deviceId: body.deviceId,
        approvedByMemberId: ownerId,
        actorRole: 'owner',
        organizationId: orgRow?.id || 'org_default',
      });

      this.sendJson(res, 200, {
        deviceId: approved.id,
        isApproved: approved.isApproved,
        approvedAt: approved.approvedAt?.toISOString(),
      });
      return;
    }

    // --- Contacts & Brazilian Phone Normalization (ADR 0034) ---
    if (method === 'POST' && pathname === '/api/v1/contacts') {
      const body = await this.sizeLimits.readJson<{ phone: string; name?: string }>(req);
      const orgRow = this.db!.prepare('SELECT id FROM organizations LIMIT 1').get() as { id: string } | undefined;
      const orgId = orgRow?.id || 'org_default';

      try {
        const result = this.contactService.findOrCreateContact(orgId, {
          phone: body.phone,
          name: body.name,
        });
        this.sendJson(res, 200, result);
      } catch (err) {
        this.sendJson(res, 400, { error: 'Bad Request', message: err instanceof Error ? err.message : 'Invalid phone' });
      }
      return;
    }

    // --- Campaigns & Safety Floor Validation (ADR 0060) ---
    if (method === 'POST' && pathname === '/api/v1/campaigns') {
      const body = await this.sizeLimits.readJson<{
        name: string;
        messageTemplate: string;
        pacingIntervalSeconds: number;
        dailyLimit: number;
        confirmedResponsibility: boolean;
        connectionId?: string;
      }>(req);

      const orgRow = this.db!.prepare('SELECT id FROM organizations LIMIT 1').get() as { id: string } | undefined;
      const connRow = this.db!.prepare('SELECT id FROM messaging_connections LIMIT 1').get() as { id: string } | undefined;

      // Safety Floor Invariant Checks (ADR 0060)
      if (body.pacingIntervalSeconds < SAFETY_FLOOR.MIN_PACING_INTERVAL_SECONDS) {
        this.sendJson(res, 400, {
          error: 'SafetyFloorViolation',
          message: `Pacing interval (${body.pacingIntervalSeconds}s) violates Safety Floor: minimum is ${SAFETY_FLOOR.MIN_PACING_INTERVAL_SECONDS}s`,
        });
        return;
      }

      if (body.dailyLimit > SAFETY_FLOOR.MAX_DAILY_LIMIT_CEILING || body.dailyLimit <= 0) {
        this.sendJson(res, 400, {
          error: 'SafetyFloorViolation',
          message: `Daily limit (${body.dailyLimit}) violates Safety Floor: ceiling is ${SAFETY_FLOOR.MAX_DAILY_LIMIT_CEILING}`,
        });
        return;
      }

      if (!body.confirmedResponsibility) {
        this.sendJson(res, 400, {
          error: 'SafetyFloorViolation',
          message: 'Explicit confirmation of operational responsibility is required to configure campaigns',
        });
        return;
      }

      let connectionId = body.connectionId;
      if (!connectionId) {
        const connRow = this.db!.prepare('SELECT id FROM messaging_connections LIMIT 1').get() as { id: string } | undefined;
        if (connRow) {
          connectionId = connRow.id;
        } else {
          connectionId = crypto.randomUUID();
          const now = new Date().toISOString();
          this.db!.prepare(`
            INSERT INTO messaging_connections (id, organization_id, name, provider, status, is_default, created_at, updated_at)
            VALUES (?, ?, 'Default Connection', 'baileys', 'disconnected', 1, ?, ?)
          `).run(connectionId, orgRow?.id || 'org_default', now, now);
        }
      }

      const campaign = this.campaignService.createCampaign({
        organizationId: orgRow?.id || 'org_default',
        connectionId,
        name: body.name,
        messageTemplate: body.messageTemplate,
        pacingIntervalSeconds: body.pacingIntervalSeconds,
        dailyLimit: body.dailyLimit,
        confirmedResponsibility: body.confirmedResponsibility,
      });

      this.sendJson(res, 201, campaign);
      return;
    }

    // --- Opt-Out & Reauthorization (ADR 0040, ADR 0045) ---
    const optOutMatch = pathname.match(/^\/api\/v1\/contacts\/([^/]+)\/opt-out$/);
    if (method === 'POST' && optOutMatch && optOutMatch[1]) {
      const contactId = optOutMatch[1];
      const body = await this.sizeLimits.readJson<{ reason?: string }>(req);

      const contact = this.contactService.findById(contactId);
      if (!contact) {
        this.sendJson(res, 404, { error: 'Not Found', message: 'Contact not found' });
        return;
      }

      const now = new Date().toISOString();
      this.db!.transaction(() => {
        this.db!.prepare('UPDATE contacts SET is_opted_out = 1, updated_at = ? WHERE id = ?').run(now, contact.id);
        this.db!.prepare(`
          INSERT INTO opt_outs (id, organization_id, normalized_phone, contact_id, reason, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(crypto.randomUUID(), contact.organizationId, contact.normalizedPhone, contact.id, body.reason || 'User requested opt-out', now);
      });

      this.sendJson(res, 200, { optedOut: true, phone: contact.normalizedPhone });
      return;
    }

    const reauthMatch = pathname.match(/^\/api\/v1\/contacts\/([^/]+)\/reauthorize$/);
    if (method === 'POST' && reauthMatch && reauthMatch[1]) {
      const contactId = reauthMatch[1];
      const body = await this.sizeLimits.readJson<{ actorMemberId: string; justification: string }>(req);

      if (!body.actorMemberId || !body.justification?.trim()) {
        this.sendJson(res, 400, {
          error: 'Bad Request',
          message: 'Traceable reauthorization requires actorMemberId and explicit justification (ADR 0045)',
        });
        return;
      }

      const contact = this.contactService.findById(contactId);
      if (!contact) {
        this.sendJson(res, 404, { error: 'Not Found', message: 'Contact not found' });
        return;
      }

      const now = new Date().toISOString();
      this.db!.transaction(() => {
        this.db!.prepare('UPDATE contacts SET is_opted_out = 0, updated_at = ? WHERE id = ?').run(now, contact.id);
        this.db!.prepare(`
          UPDATE opt_outs
          SET reauthorized_at = ?, reauthorized_by_member_id = ?, reauthorization_reason = ?
          WHERE organization_id = ? AND normalized_phone = ? AND reauthorized_at IS NULL
        `).run(now, body.actorMemberId, body.justification, contact.organizationId, contact.normalizedPhone);
      });

      this.sendJson(res, 200, { reauthorized: true, phone: contact.normalizedPhone });
      return;
    }

    // --- Migration Package Import (ADR 0008, 0017) ---
    if (method === 'POST' && pathname === '/api/v1/migration/import') {
      const body = await this.sizeLimits.readJson<{ packagePath: string }>(req);
      const result = MigrationImporter.importPackage({
        packagePath: body.packagePath,
        targetDb: this.db!,
      });
      this.sendJson(res, 200, result);
      return;
    }

    // --- Disaster Recovery Encrypted Backup & Restore (ADR 0020, 0031, 0046) ---
    if (method === 'POST' && pathname === '/api/v1/backup/create') {
      const body = await this.sizeLimits.readJson<{ outputPath: string; recoveryKey?: string }>(req);
      const key = body.recoveryKey || this.recoveryKey;

      const result = BackupService.createBackup({
        db: this.db!,
        dataDir: this.dataDir,
        outputPath: body.outputPath,
        recoveryKey: key,
      });
      this.sendJson(res, 200, result);
      return;
    }

    if (method === 'POST' && pathname === '/api/v1/backup/restore') {
      const body = await this.sizeLimits.readJson<{
        backupPath: string;
        targetDbPath: string;
        recoveryKey?: string;
        deletionLedger?: DeletionLedgerRecord[];
      }>(req);
      const key = body.recoveryKey || this.recoveryKey;

      const result = BackupService.restoreBackup({
        backupPath: body.backupPath,
        targetDataDir: path.dirname(body.targetDbPath),
        targetDbPath: body.targetDbPath,
        recoveryKey: key,
        deletionLedgerRecords: body.deletionLedger,
      });
      this.sendJson(res, 200, result);
      return;
    }

    // 404 Not Found
    this.sendJson(res, 404, { error: 'Not Found', message: `Route ${method} ${pathname} not found` });
  }

  private extractToken(req: IncomingMessage): string | null {
    const authHeader = req.headers['authorization'];
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7).trim();
    }
    const cookies = this.csrf.parseCookies(req);
    return cookies['df_session'] || null;
  }

  private sendJson(res: ServerResponse, status: number, data: unknown): void {
    if (res.headersSent) return;
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  }

  /**
   * Gracefully shuts down the server, releases the lock, and closes the database.
   */
  async stop(): Promise<void> {
    if (this.wss) {
      for (const client of this.wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.close();
        }
      }
      this.wss.close();
      this.wss = null;
    }

    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }

    if (this.db) {
      this.db.close();
      this.db = null;
    }

    if (this.lock) {
      this.lock.release();
      this.lock = null;
    }

    this.logger.info('Dispar Flux server shut down gracefully');
  }

  get isRunning(): boolean {
    return this.httpServer !== null && this.httpServer.listening;
  }

  get url(): string {
    const addr = this.httpServer?.address();
    const actualPort = typeof addr === 'object' && addr ? addr.port : this.port;
    return `http://${this.host}:${actualPort}`;
  }

  get wsUrl(): string {
    return this.url.replace(/^http/, 'ws') + '/ws';
  }

  get database(): DatabaseConnection | null {
    return this.db;
  }
}

export function createServer(options: ServerOptions = {}): DisparFluxServer {
  return new DisparFluxServer(options);
}

export { DisparFluxServer as DisparServer };
