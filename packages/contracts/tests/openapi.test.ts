import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenApiSpec } from '../src/index.js';

describe('Contracts: OpenAPI 3.1 Specification Builder', () => {
  it('generates a valid OpenAPI 3.1.0 document structure', () => {
    const spec = buildOpenApiSpec();

    assert.equal(spec.openapi, '3.1.0');
    assert.equal(spec.info.title, 'Dispar Flux API');
    assert.equal(spec.info.version, '0.0.1');
    assert.equal(spec.info.license?.name, 'AGPL-3.0-only');
    assert.equal(spec.servers[0]?.url, '/api/v1');
  });

  it('defines all required core endpoints in paths', () => {
    const spec = buildOpenApiSpec();
    const paths = Object.keys(spec.paths);

    // Health & System
    assert.ok(paths.includes('/health'), 'Missing /health path');
    assert.ok(paths.includes('/ready'), 'Missing /ready path');
    assert.ok(paths.includes('/system/status'), 'Missing /system/status path');

    // Auth
    assert.ok(paths.includes('/auth/claim'), 'Missing /auth/claim path');
    assert.ok(paths.includes('/auth/login'), 'Missing /auth/login path');

    // Campaigns & Contacts & Messages
    assert.ok(paths.includes('/campaigns'), 'Missing /campaigns path');
    assert.ok(paths.includes('/contacts'), 'Missing /contacts path');
    assert.ok(paths.includes('/contacts/{id}/opt-out'), 'Missing /contacts/{id}/opt-out path');
    assert.ok(paths.includes('/conversations'), 'Missing /conversations path');
    assert.ok(paths.includes('/conversations/{id}/messages'), 'Missing /conversations/{id}/messages path');
  });

  it('defines all essential schema definitions in components', () => {
    const spec = buildOpenApiSpec();
    const schemas = spec.components.schemas;

    assert.ok(schemas['HealthResponse']);
    assert.ok(schemas['ReadyResponse']);
    assert.ok(schemas['SystemStatusResponse']);
    assert.ok(schemas['ClaimInstallationRequest']);
    assert.ok(schemas['ClaimInstallationResponse']);
    assert.ok(schemas['LoginRequest']);
    assert.ok(schemas['LoginResponse']);
    assert.ok(schemas['CreateCampaignRequest']);
    assert.ok(schemas['CampaignResponse']);
    assert.ok(schemas['CreateContactRequest']);
    assert.ok(schemas['ContactResponse']);
    assert.ok(schemas['SendMessageRequest']);
    assert.ok(schemas['MessageResponse']);
  });

  it('enforces Safety Floor boundaries in OpenAPI schemas (ADR 0060)', () => {
    const spec = buildOpenApiSpec();
    const campaignSchema = spec.components.schemas['CreateCampaignRequest'];
    assert.ok(campaignSchema);

    const pacingProp = campaignSchema.properties?.['pacingIntervalSeconds'];
    assert.equal(pacingProp?.minimum, 15, 'Pacing interval must have minimum: 15 in OpenAPI schema');

    const dailyLimitProp = campaignSchema.properties?.['dailyLimit'];
    assert.equal(dailyLimitProp?.maximum, 1000, 'Daily limit must have maximum: 1000 in OpenAPI schema');
    assert.equal(dailyLimitProp?.minimum, 1, 'Daily limit must have minimum: 1 in OpenAPI schema');
  });

  it('includes bearer authentication security scheme', () => {
    const spec = buildOpenApiSpec();
    assert.ok(spec.components.securitySchemes?.['bearerAuth']);
  });
});
