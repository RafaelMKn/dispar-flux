import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
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
import QRCode from 'qrcode';
import {
  BaileysConnector,
  type InboundMessage,
  type QREventPayload,
  type StatusEventPayload,
} from '@dispar-flux/connector-baileys';
import { handleApiRoutes } from './api-router.js';

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
  public db: DatabaseConnection | null = null;
  private lock: InstallationLock | null = null;
  private startTime: number = 0;

  // Baileys Connector & WhatsApp State
  public baileysConnector: BaileysConnector;
  public whatsappState: {
    status: 'disconnected' | 'connecting' | 'pairing' | 'connected' | 'failed';
    qrDataUrl: string | null;
    me: { id: string; name?: string } | null;
  } = {
    status: 'disconnected',
    qrDataUrl: null,
    me: null,
  };

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
    this.baileysConnector = new BaileysConnector();

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

    // 9. Register Baileys WhatsApp connector event listeners
    this.registerBaileysListeners();

    // 10. Check if credentials already exist and attempt auto-connect in background
    const waAuthDir = path.join(this.dataDir, 'wa-auth');
    if (fs.existsSync(waAuthDir) && this.db) {
      const defaultConn =
        (this.db.prepare('SELECT id FROM messaging_connections WHERE is_default = 1 LIMIT 1').get() as { id: string } | undefined) ||
        (this.db.prepare('SELECT id FROM messaging_connections LIMIT 1').get() as { id: string } | undefined);
      if (defaultConn) {
        const credsPath = path.join(waAuthDir, defaultConn.id, 'creds.json');
        if (fs.existsSync(credsPath)) {
          this.baileysConnector.connect(defaultConn.id, { dataDir: this.dataDir }).catch((err) => {
            this.logger.warn('Failed to auto-connect WhatsApp on startup', {
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
      }
    }

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

      // Migrate any pre-existing default org records to the claimed organization
      const defaultOrg = this.db!.prepare("SELECT id FROM organizations WHERE id = 'org_default'").get();
      if (defaultOrg) {
        this.db!.prepare("UPDATE messaging_connections SET organization_id = ? WHERE organization_id = 'org_default'").run(orgId);
        this.db!.prepare("UPDATE bases SET organization_id = ? WHERE organization_id = 'org_default'").run(orgId);
        this.db!.prepare("UPDATE contacts SET organization_id = ? WHERE organization_id = 'org_default'").run(orgId);
        this.db!.prepare("UPDATE campaigns SET organization_id = ? WHERE organization_id = 'org_default'").run(orgId);
        this.db!.prepare("UPDATE conversations SET organization_id = ? WHERE organization_id = 'org_default'").run(orgId);
        this.db!.prepare("UPDATE funnels SET organization_id = ? WHERE organization_id = 'org_default'").run(orgId);
        try {
          this.db!.prepare("UPDATE appointments SET organization_id = ? WHERE organization_id = 'org_default'").run(orgId);
          this.db!.prepare("UPDATE follow_up_rules SET organization_id = ? WHERE organization_id = 'org_default'").run(orgId);
        } catch {}
        this.db!.prepare("DELETE FROM organizations WHERE id = 'org_default'").run();
      }

      // Create default messaging connection if none exists (ADR 0002 & ADR 0005)
      const existingConn = this.db!.prepare('SELECT id FROM messaging_connections WHERE organization_id = ? LIMIT 1').get(orgId);
      if (!existingConn) {
        const defaultConnId = crypto.randomUUID();
        this.db!.prepare(`
          INSERT INTO messaging_connections (id, organization_id, name, provider, status, is_default, created_at, updated_at)
          VALUES (?, ?, 'WhatsApp Principal', 'baileys', 'disconnected', 1, ?, ?)
        `).run(defaultConnId, orgId, now, now);
      }

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

      this.setSessionCookie(res, rawToken);

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

      this.setSessionCookie(res, rawToken);

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

    if (method === 'GET' && (pathname === '/api/v1/auth/session' || pathname === '/api/v1/auth/me')) {
      const token = this.extractToken(req);
      if (!token) {
        this.sendJson(res, 401, { error: 'Unauthorized', message: 'Missing session token' });
        return;
      }

      try {
        const authContext = this.sessionService.validateToken(token);
        const org = this.db!.prepare('SELECT id, name, operational_timezone FROM organizations WHERE id = ?').get(
          authContext.member.organizationId
        );
        this.sendJson(res, 200, {
          session: authContext.session,
          member: authContext.member,
          device: authContext.device,
          organization: org,
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
      this.clearSessionCookie(res);
      this.sendJson(res, 200, { success: true });
      return;
    }

    // --- List Devices (ADR 0022) ---
    if (method === 'GET' && (pathname === '/api/v1/devices' || pathname === '/api/v1/auth/devices')) {
      const token = this.extractToken(req);
      if (!token) {
        this.sendJson(res, 401, { error: 'Unauthorized', message: 'Missing session token' });
        return;
      }
      try {
        const authContext = this.sessionService.validateToken(token);
        const devices = this.db!.prepare(`
          SELECT d.id, d.member_id as memberId, d.name, d.device_identifier as deviceIdentifier,
                 d.is_approved as isApproved, d.approved_at as approvedAt, d.last_seen_at as lastSeenAt,
                 d.created_at as createdAt, m.name as memberName, m.email as memberEmail, m.role as memberRole
          FROM authorized_devices d
          JOIN members m ON m.id = d.member_id
          WHERE m.organization_id = ?
          ORDER BY d.created_at DESC
        `).all(authContext.member.organizationId);

        this.sendJson(res, 200, { devices });
      } catch (err) {
        this.sendJson(res, 401, { error: 'Unauthorized', message: err instanceof Error ? err.message : 'Session invalid' });
      }
      return;
    }

    // --- Device Approval ---
    if (method === 'POST' && (pathname === '/api/v1/devices/approve' || pathname === '/api/v1/auth/devices/approve')) {
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

    // --- Dynamic Business API Routes (WhatsApp, Bases, Campaigns, Inbox, CRM, Agenda, Cron) ---
    const handledByApiRouter = await handleApiRoutes(this, req, res, pathname, method, url);
    if (handledByApiRouter) return;

    // --- Static Frontend Files & SPA Fallback ---
    if (this.serveStaticFile(req, res, pathname, method)) {
      return;
    }

    // 404 Not Found
    this.sendJson(res, 404, { error: 'Not Found', message: `Route ${method} ${pathname} not found` });
  }

  public setSessionCookie(res: ServerResponse, token: string): void {
    const isSecure = this.nodeEnv === 'production';
    const cookie = `df_session=${token}; Path=/; HttpOnly; SameSite=Lax${isSecure ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', cookie);
  }

  public clearSessionCookie(res: ServerResponse): void {
    res.setHeader('Set-Cookie', 'df_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax');
  }

  public extractToken(req: IncomingMessage): string | null {
    const authHeader = req.headers['authorization'];
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7).trim();
    }
    const cookies = this.csrf.parseCookies(req);
    return cookies['df_session'] || null;
  }

  private serveStaticFile(req: IncomingMessage, res: ServerResponse, pathname: string, method: string): boolean {
    if (method !== 'GET' && method !== 'HEAD') return false;
    if (pathname.startsWith('/api/') || pathname === '/health' || pathname === '/ready' || pathname.startsWith('/ws')) {
      return false;
    }

    const staticDir = this.resolveStaticDir();
    if (!staticDir) return false;

    // Sanitize pathname
    const cleanPath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    let targetPath = path.join(staticDir, cleanPath);

    let isFile = false;
    try {
      const stat = fs.statSync(targetPath);
      if (stat.isFile()) {
        isFile = true;
      } else if (stat.isDirectory()) {
        const indexInDir = path.join(targetPath, 'index.html');
        if (fs.existsSync(indexInDir)) {
          targetPath = indexInDir;
          isFile = true;
        }
      }
    } catch {}

    // SPA Fallback: if not found, serve index.html
    if (!isFile) {
      targetPath = path.join(staticDir, 'index.html');
      try {
        if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
          isFile = true;
        }
      } catch {}
    }

    if (!isFile) return false;

    const ext = path.extname(targetPath).toLowerCase();
    const MIME_TYPES: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.mjs': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.ico': 'image/x-icon',
      '.webp': 'image/webp',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.webmanifest': 'application/manifest+json',
      '.txt': 'text/plain; charset=utf-8',
    };

    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const isAsset = cleanPath.startsWith('/assets/') || cleanPath.startsWith('assets/');

    try {
      const stat = fs.statSync(targetPath);
      res.statusCode = 200;
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', stat.size);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (isAsset) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }

      if (method === 'HEAD') {
        res.end();
        return true;
      }

      const stream = fs.createReadStream(targetPath);
      stream.pipe(res);
      return true;
    } catch {
      return false;
    }
  }

  private resolveStaticDir(): string | null {
    const __filename = fileURLToPath(import.meta.url);
    const currentDir = path.dirname(__filename);
    const candidates = [
      process.env.STATIC_DIR,
      path.resolve(currentDir, '../../web/dist'),
      path.resolve(currentDir, '../web/dist'),
      path.resolve(process.cwd(), 'apps/web/dist'),
      path.resolve(process.cwd(), 'web/dist'),
    ];
    for (const c of candidates) {
      if (c && fs.existsSync(c)) {
        return c;
      }
    }
    return null;
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
    try {
      await this.baileysConnector.disconnectAll();
      this.baileysConnector.removeAllListeners();
    } catch (err) {
      this.logger.error('Error disconnecting WhatsApp connector on shutdown', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

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
      if (typeof (this.httpServer as any).closeAllConnections === 'function') {
        (this.httpServer as any).closeAllConnections();
      }
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

  public getDefaultOrgId(): string {
    if (!this.db) return 'org_default';
    const org =
      (this.db.prepare("SELECT id FROM organizations WHERE id != 'org_default' LIMIT 1").get() as { id: string } | undefined) ||
      (this.db.prepare('SELECT id FROM organizations LIMIT 1').get() as { id: string } | undefined);
    if (org) return org.id;

    const orgId = 'org_default';
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT OR IGNORE INTO organizations (id, name, operational_timezone, created_at, updated_at)
      VALUES (?, 'Organização Padrão', 'America/Sao_Paulo', ?, ?)
    `).run(orgId, now, now);
    return orgId;
  }

  public getDefaultConnectionId(): string {
    if (!this.db) return 'default-conn';
    const row =
      (this.db.prepare('SELECT id FROM messaging_connections WHERE is_default = 1 LIMIT 1').get() as { id: string } | undefined) ||
      (this.db.prepare('SELECT id FROM messaging_connections LIMIT 1').get() as { id: string } | undefined);
    if (row) return row.id;

    const orgId = this.getDefaultOrgId();
    const connId = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO messaging_connections (id, organization_id, name, provider, status, is_default, created_at, updated_at)
      VALUES (?, ?, 'WhatsApp Principal', 'baileys', 'disconnected', 1, ?, ?)
    `).run(connId, orgId, now, now);
    return connId;
  }

  private registerBaileysListeners(): void {
    this.baileysConnector.removeAllListeners();

    // Event: 'qr'
    this.baileysConnector.on('qr', async (payload: QREventPayload) => {
      try {
        const qrDataUrl = await QRCode.toDataURL(payload.qr);
        this.whatsappState = {
          status: 'pairing',
          qrDataUrl,
          me: null,
        };
        this.broadcast('whatsapp:state', this.whatsappState);
        this.broadcast('whatsapp:qr', { qrDataUrl });
      } catch (err) {
        this.logger.error('Failed to generate QR data URL', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    // Event: 'status'
    this.baileysConnector.on('status', (payload: StatusEventPayload) => {
      const now = new Date().toISOString();
      const connId = payload.connectionId;

      if (payload.status === 'connected') {
        let me: { id: string; name?: string } | null = null;
        const user = this.baileysConnector.getSessionUser(connId);
        if (user?.id) {
          me = { id: user.id, name: user.name };
        } else {
          try {
            const credsPath = path.join(this.dataDir, 'wa-auth', connId, 'creds.json');
            if (fs.existsSync(credsPath)) {
              const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
              if (creds.me?.id) {
                me = { id: creds.me.id, name: creds.me.name };
              }
            }
          } catch {}
        }

        const splitColon = me?.id ? me.id.split(':') : [];
        const rawPhone = splitColon[0] ? splitColon[0].split('@')[0] || null : null;
        const phone = rawPhone ? (rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`) : null;

        if (this.db) {
          try {
            this.db.prepare(`
              UPDATE messaging_connections
              SET status = 'connected',
                  phone_number = COALESCE(?, phone_number),
                  jid = COALESCE(?, jid),
                  updated_at = ?
              WHERE id = ?
            `).run(phone, me?.id || null, now, connId);
          } catch (err) {
            this.logger.error('Failed to update messaging_connections on connect', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        this.whatsappState = {
          status: 'connected',
          qrDataUrl: null,
          me,
        };
      } else if (payload.status === 'connecting') {
        this.whatsappState = {
          status: 'connecting',
          qrDataUrl: null,
          me: this.whatsappState.me,
        };
      } else if (payload.status === 'disconnected' || payload.status === 'failed') {
        if (this.db) {
          try {
            this.db.prepare(`
              UPDATE messaging_connections
              SET status = 'disconnected',
                  updated_at = ?
              WHERE id = ?
            `).run(now, connId);
          } catch (err) {
            this.logger.error('Failed to update messaging_connections on disconnect', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        this.whatsappState = {
          status: 'disconnected',
          qrDataUrl: null,
          me: null,
        };
      }

      this.broadcast('whatsapp:state', this.whatsappState);
    });

    // Event: 'message'
    this.baileysConnector.on('message', (payload: InboundMessage) => {
      if (!this.db) return;
      const now = new Date().toISOString();

      try {
        const conn =
          (this.db.prepare('SELECT id, organization_id FROM messaging_connections WHERE id = ?').get(payload.connectionId) as { id: string; organization_id: string } | undefined) ||
          (this.db.prepare('SELECT id, organization_id FROM messaging_connections LIMIT 1').get() as { id: string; organization_id: string } | undefined);

        const orgId = conn?.organization_id || this.getDefaultOrgId();
        const connId = conn?.id || this.getDefaultConnectionId();

        const norm = normalizePhoneNumber(payload.from);
        const normalizedPhone = norm.isValid && norm.e164
          ? norm.e164
          : (payload.from.startsWith('+') ? payload.from : `+${payload.from.replace('@s.whatsapp.net', '').replace(/\D/g, '')}`);

        let contact = this.db.prepare('SELECT id FROM contacts WHERE organization_id = ? AND normalized_phone = ?').get(orgId, normalizedPhone) as { id: string } | undefined;
        if (!contact) {
          const contactId = crypto.randomUUID();
          const contactName = payload.from.split('@')[0] || payload.from;
          this.db.prepare(`
            INSERT INTO contacts (id, organization_id, normalized_phone, name, custom_fields, is_opted_out, created_at, updated_at)
            VALUES (?, ?, ?, ?, '{}', 0, ?, ?)
          `).run(contactId, orgId, normalizedPhone, contactName, now, now);
          contact = { id: contactId };
        }

        let conv = this.db.prepare('SELECT id, unread_count FROM conversations WHERE connection_id = ? AND contact_id = ?').get(connId, contact.id) as { id: string; unread_count: number } | undefined;

        if (!conv) {
          const convId = crypto.randomUUID();
          this.db.prepare(`
            INSERT INTO conversations (id, organization_id, connection_id, contact_id, unread_count, last_message_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?, ?)
          `).run(convId, orgId, connId, contact.id, now, now, now);
          conv = { id: convId, unread_count: 1 };
        } else {
          this.db.prepare(`
            UPDATE conversations
            SET last_message_at = ?,
                unread_count = unread_count + 1,
                updated_at = ?
            WHERE id = ?
          `).run(now, now, conv.id);
        }

        const msgId = crypto.randomUUID();
        this.db.prepare(`
          INSERT INTO messages (id, conversation_id, direction, type, kind, content, media_url, media_type, external_id, status, created_at)
          VALUES (?, ?, 'inbound', 'manual', 'inbound', ?, ?, ?, ?, 'delivered', ?)
        `).run(
          msgId,
          conv.id,
          payload.content || '',
          payload.mediaUrl || null,
          payload.mediaType || null,
          payload.messageId || null,
          payload.timestamp instanceof Date ? payload.timestamp.toISOString() : now
        );

        this.broadcast('inbox:changed', { chatJid: payload.from });

        // CRM lead progression
        const leads = this.db.prepare('SELECT id, funnel_id, stage_id FROM leads WHERE contact_id = ?').all(contact.id) as Array<{ id: string; funnel_id: string; stage_id: string }>;
        if (leads && leads.length > 0) {
          let crmChanged = false;
          for (const lead of leads) {
            let inProgressStageId = 'st_2';
            const funnel = this.db.prepare('SELECT stages FROM funnels WHERE id = ?').get(lead.funnel_id) as { stages: string } | undefined;
            if (funnel?.stages) {
              try {
                const stages = JSON.parse(funnel.stages) as Array<{ id: string; name: string; order?: number }>;
                const inProgress = stages.find((s) => s.name.toLowerCase().includes('andamento') || s.order === 1);
                if (inProgress) {
                  inProgressStageId = inProgress.id;
                } else if (stages.length > 1 && stages[1]) {
                  inProgressStageId = stages[1].id;
                }
              } catch {}
            }

            if (lead.stage_id !== inProgressStageId) {
              this.db.prepare('UPDATE leads SET stage_id = ?, updated_at = ? WHERE id = ?').run(inProgressStageId, now, lead.id);
              crmChanged = true;
            }
          }
          if (crmChanged) {
            this.broadcast('crm:changed', {});
          }
        }
      } catch (err) {
        this.logger.error('Failed to process inbound message', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
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

  broadcast(event: string, payload: unknown): void {
    if (!this.wss) return;
    const msg = JSON.stringify({ type: event, event, payload });
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }
}

export function createServer(options: ServerOptions = {}): DisparFluxServer {
  return new DisparFluxServer(options);
}

export { DisparFluxServer as DisparServer };
