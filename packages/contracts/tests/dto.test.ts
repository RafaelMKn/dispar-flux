import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  HealthResponse,
  ReadyResponse,
  SystemStatusResponse,
  ClaimInstallationRequest,
  ClaimInstallationResponse,
  LoginRequest,
  LoginResponse,
  CreateCampaignRequest,
  CampaignResponse,
  CreateContactRequest,
  ContactResponse,
  SendMessageRequest,
  MessageResponse,
} from '../src/index.js';

describe('Contracts: REST API DTOs', () => {
  it('validates HealthResponse and ReadyResponse structures', () => {
    const health: HealthResponse = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: 3600,
      version: '0.0.1',
    };

    assert.equal(health.status, 'ok');
    assert.equal(typeof health.uptimeSeconds, 'number');

    const ready: ReadyResponse = {
      status: 'ready',
      database: 'connected',
      storage: 'ready',
      checks: { database: true, storage: true, migrations: true },
      timestamp: new Date().toISOString(),
    };

    assert.equal(ready.status, 'ready');
    assert.equal(ready.database, 'connected');
    assert.equal(ready.checks['database'], true);
  });

  it('validates SystemStatusResponse adheres to Community Edition naming', () => {
    const status: SystemStatusResponse = {
      installationId: 'inst-1',
      version: '0.0.1',
      edition: 'community',
      environment: 'production',
      operationalTimezone: 'America/Sao_Paulo',
      uptimeSeconds: 7200,
      nodeVersion: 'v25.8.2',
      isClaimed: true,
      activeConnectionsCount: 1,
      storageType: 'local',
    };

    assert.equal(status.edition, 'community');
    assert.equal(status.operationalTimezone, 'America/Sao_Paulo');
  });

  it('validates ClaimInstallationRequest and Response', () => {
    const claimReq: ClaimInstallationRequest = {
      claimCode: 'CLAIM-123-ABC',
      organizationName: 'Acme Corp',
      ownerName: 'Administrador',
      ownerEmail: 'admin@acme.com',
      password: 'SecurePassword!123',
      operationalTimezone: 'America/Sao_Paulo',
      retentionPolicyDays: {
        messagesDays: 365,
        mediaDays: 90,
        logsDays: 30,
      },
    };

    assert.equal(claimReq.claimCode, 'CLAIM-123-ABC');
    assert.equal(claimReq.retentionPolicyDays?.messagesDays, 365);

    const claimRes: ClaimInstallationResponse = {
      organizationId: 'org-1',
      ownerId: 'mem-1',
      token: 'jwt-token-here',
      recoveryKeyGuidance: 'Guarde sua chave de recuperação em local seguro fora do servidor.',
      message: 'Instalação reivindicada com sucesso.',
    };

    assert.equal(claimRes.organizationId, 'org-1');
  });

  it('validates Campaign and Message DTOs', () => {
    const campaignReq: CreateCampaignRequest = {
      name: 'Black Friday 2026',
      connectionId: 'conn-1',
      messageTemplate: 'Olá!',
      pacingIntervalSeconds: 30,
      dailyLimit: 300,
      confirmedResponsibility: true,
    };

    assert.equal(campaignReq.pacingIntervalSeconds, 30);

    const sendMsg: SendMessageRequest = {
      conversationId: 'conv-1',
      content: 'Resposta manual de teste',
    };

    assert.equal(sendMsg.content, 'Resposta manual de teste');
  });

  it('validates CRM and Appointment DTOs', () => {
    const funnelReq = {
      name: 'Funil Comercial',
      stages: [
        { id: 'stg-1', name: 'novo', order: 0 },
        { id: 'stg-2', name: 'em andamento', order: 1 },
      ],
    };
    assert.equal(funnelReq.name, 'Funil Comercial');
    assert.equal(funnelReq.stages.length, 2);

    const aptReq = {
      contactId: 'cnt-1',
      title: 'Reunião',
      scheduledStartTime: '2026-09-03T17:00:00.000Z',
      scheduledEndTime: '2026-09-03T18:00:00.000Z',
      timezone: 'America/Sao_Paulo',
    };
    assert.equal(aptReq.timezone, 'America/Sao_Paulo');
  });
});

