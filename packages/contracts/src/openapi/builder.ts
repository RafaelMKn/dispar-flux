import { OpenApiDocument } from './types.js';

/**
 * Builds the canonical OpenAPI 3.1.0 specification for Dispar Flux REST API (/api/v1).
 */
export function buildOpenApiSpec(): OpenApiDocument {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Dispar Flux API',
      version: '0.0.1',
      description:
        'Plataforma Web de Atendimento Multiatendente e Mensageria WhatsApp (Edição Comunitária AGPLv3). REST API /api/v1.',
      license: {
        name: 'AGPL-3.0-only',
        url: 'https://www.gnu.org/licenses/agpl-3.0.html',
      },
    },
    servers: [
      {
        url: '/api/v1',
        description: 'Primary API v1 Base URL',
      },
    ],
    paths: {
      '/health': {
        get: {
          summary: 'Health check endpoint',
          description: 'Returns basic health and uptime of the installation runtime.',
          tags: ['System'],
          responses: {
            '200': {
              description: 'System is healthy',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/HealthResponse' },
                },
              },
            },
          },
        },
      },
      '/ready': {
        get: {
          summary: 'Readiness check endpoint',
          description: 'Checks connectivity to SQLite and local storage before receiving traffic.',
          tags: ['System'],
          responses: {
            '200': {
              description: 'System is ready to serve requests',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ReadyResponse' },
                },
              },
            },
            '503': {
              description: 'System is not ready',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ReadyResponse' },
                },
              },
            },
          },
        },
      },
      '/system/status': {
        get: {
          summary: 'Detailed system status',
          description: 'Returns operational parameters, timezone, active connections, and installation status.',
          tags: ['System'],
          responses: {
            '200': {
              description: 'System status retrieved',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/SystemStatusResponse' },
                },
              },
            },
          },
        },
      },
      '/auth/claim': {
        post: {
          summary: 'Claim initial installation',
          description:
            'One-time onboarding bootstrap: consumes the claim code, configures the Organization and first Owner.',
          tags: ['Authentication'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ClaimInstallationRequest' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Installation successfully claimed',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ClaimInstallationResponse' },
                },
              },
            },
            '400': {
              description: 'Invalid claim code or payload validation error',
            },
            '409': {
              description: 'Installation has already been claimed',
            },
          },
        },
      },
      '/auth/login': {
        post: {
          summary: 'Member login',
          description: 'Authenticates a member, validates device trust or issues an access request.',
          tags: ['Authentication'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LoginRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Login successful',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/LoginResponse' },
                },
              },
            },
            '401': {
              description: 'Invalid credentials or unauthorized device',
            },
          },
        },
      },
      '/campaigns': {
        get: {
          summary: 'List campaigns',
          description: 'Returns campaigns associated with the organization.',
          tags: ['Campaigns'],
          responses: {
            '200': {
              description: 'List of campaigns',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      campaigns: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/CampaignResponse' },
                      },
                      total: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          summary: 'Create campaign',
          description:
            'Creates a new campaign with message snapshot and Safety Floor validation (ADR 0060).',
          tags: ['Campaigns'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateCampaignRequest' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Campaign created successfully',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CampaignResponse' },
                },
              },
            },
            '400': {
              description: 'Safety Floor violation or validation failure',
            },
          },
        },
      },
      '/contacts': {
        get: {
          summary: 'List contacts',
          description: 'Lists canonical contacts with pagination.',
          tags: ['Contacts'],
          responses: {
            '200': {
              description: 'Paginated list of contacts',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      contacts: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/ContactResponse' },
                      },
                      total: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          summary: 'Create or update contact',
          description: 'Upserts a contact by normalized phone number (ADR 0034).',
          tags: ['Contacts'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateContactRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Contact created or updated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ContactResponse' },
                },
              },
            },
            '400': {
              description: 'Invalid phone number format',
            },
          },
        },
      },
      '/contacts/{id}/opt-out': {
        post: {
          summary: 'Register contact opt-out',
          description:
            'Applies an organization-wide opt-out blocking automated sends across all bases and connections (ADR 0040).',
          tags: ['Contacts'],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Opt-out registered successfully',
            },
          },
        },
      },
      '/conversations': {
        get: {
          summary: 'List conversations',
          description: 'Returns conversations ordered by recent activity.',
          tags: ['Inbox'],
          responses: {
            '200': {
              description: 'List of conversations',
            },
          },
        },
      },
      '/conversations/{id}/messages': {
        get: {
          summary: 'List messages in conversation',
          description: 'Paginated message history for a conversation.',
          tags: ['Inbox'],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Messages retrieved',
            },
          },
        },
        post: {
          summary: 'Send manual reply message',
          description: 'Dispatches a manual response without consuming automated pacing limits.',
          tags: ['Inbox'],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SendMessageRequest' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Message sent or queued',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/MessageResponse' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        HealthResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ok', 'degraded', 'error'] },
            timestamp: { type: 'string', format: 'date-time' },
            uptimeSeconds: { type: 'number' },
            version: { type: 'string' },
          },
          required: ['status', 'timestamp', 'uptimeSeconds', 'version'],
        },
        ReadyResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ready', 'not_ready'] },
            database: { type: 'string', enum: ['connected', 'disconnected', 'error'] },
            storage: { type: 'string', enum: ['ready', 'error'] },
            checks: { type: 'object', additionalProperties: { type: 'boolean' } },
            timestamp: { type: 'string', format: 'date-time' },
          },
          required: ['status', 'database', 'storage', 'checks', 'timestamp'],
        },
        SystemStatusResponse: {
          type: 'object',
          properties: {
            installationId: { type: 'string' },
            version: { type: 'string' },
            edition: { type: 'string', enum: ['community'] },
            environment: { type: 'string' },
            operationalTimezone: { type: 'string' },
            uptimeSeconds: { type: 'number' },
            nodeVersion: { type: 'string' },
            isClaimed: { type: 'boolean' },
            activeConnectionsCount: { type: 'integer' },
            storageType: { type: 'string' },
          },
          required: [
            'installationId',
            'version',
            'edition',
            'environment',
            'operationalTimezone',
            'uptimeSeconds',
            'nodeVersion',
            'isClaimed',
            'activeConnectionsCount',
            'storageType',
          ],
        },
        ClaimInstallationRequest: {
          type: 'object',
          properties: {
            claimCode: { type: 'string' },
            organizationName: { type: 'string' },
            ownerName: { type: 'string' },
            ownerEmail: { type: 'string', format: 'email' },
            password: { type: 'string', format: 'password' },
            operationalTimezone: { type: 'string' },
            retentionPolicyDays: {
              type: 'object',
              properties: {
                messagesDays: { type: 'integer' },
                mediaDays: { type: 'integer' },
                logsDays: { type: 'integer' },
              },
            },
          },
          required: [
            'claimCode',
            'organizationName',
            'ownerName',
            'ownerEmail',
            'password',
            'operationalTimezone',
          ],
        },
        ClaimInstallationResponse: {
          type: 'object',
          properties: {
            organizationId: { type: 'string' },
            ownerId: { type: 'string' },
            token: { type: 'string' },
            recoveryKeyGuidance: { type: 'string' },
            message: { type: 'string' },
          },
          required: ['organizationId', 'ownerId', 'recoveryKeyGuidance', 'message'],
        },
        LoginRequest: {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', format: 'password' },
            deviceFingerprint: { type: 'string' },
            deviceName: { type: 'string' },
          },
          required: ['email', 'password', 'deviceFingerprint'],
        },
        LoginResponse: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            member: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                email: { type: 'string' },
                role: { type: 'string', enum: ['owner', 'operator'] },
              },
              required: ['id', 'name', 'email', 'role'],
            },
            deviceId: { type: 'string' },
            requiresDeviceApproval: { type: 'boolean' },
          },
          required: ['token', 'member', 'deviceId'],
        },
        CreateCampaignRequest: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            connectionId: { type: 'string' },
            baseId: { type: 'string' },
            messageTemplate: { type: 'string' },
            pacingIntervalSeconds: { type: 'integer', minimum: 15 },
            dailyLimit: { type: 'integer', minimum: 1, maximum: 1000 },
            confirmedResponsibility: { type: 'boolean' },
          },
          required: [
            'name',
            'connectionId',
            'messageTemplate',
            'pacingIntervalSeconds',
            'dailyLimit',
            'confirmedResponsibility',
          ],
        },
        CampaignResponse: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            organizationId: { type: 'string' },
            connectionId: { type: 'string' },
            name: { type: 'string' },
            status: {
              type: 'string',
              enum: ['draft', 'running', 'paused', 'completed', 'canceled'],
            },
            messageTemplate: { type: 'string' },
            pacingIntervalSeconds: { type: 'integer' },
            dailyLimit: { type: 'integer' },
            confirmedResponsibility: { type: 'boolean' },
            snapshotTotal: { type: 'integer' },
            sentCount: { type: 'integer' },
            failedCount: { type: 'integer' },
            unknownCount: { type: 'integer' },
            createdAt: { type: 'string', format: 'date-time' },
          },
          required: [
            'id',
            'organizationId',
            'connectionId',
            'name',
            'status',
            'messageTemplate',
            'pacingIntervalSeconds',
            'dailyLimit',
            'confirmedResponsibility',
            'snapshotTotal',
            'sentCount',
            'failedCount',
            'unknownCount',
            'createdAt',
          ],
        },
        CreateContactRequest: {
          type: 'object',
          properties: {
            phone: { type: 'string' },
            name: { type: 'string' },
            customFields: { type: 'object', additionalProperties: { type: 'string' } },
            notes: { type: 'string' },
          },
          required: ['phone'],
        },
        ContactResponse: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            organizationId: { type: 'string' },
            normalizedPhone: { type: 'string' },
            name: { type: 'string' },
            canonicalProfile: {
              type: 'object',
              properties: {
                customFields: { type: 'object', additionalProperties: { type: 'string' } },
                notes: { type: 'string' },
              },
            },
            isOptedOut: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'organizationId', 'normalizedPhone', 'isOptedOut', 'createdAt'],
        },
        SendMessageRequest: {
          type: 'object',
          properties: {
            conversationId: { type: 'string' },
            contactId: { type: 'string' },
            connectionId: { type: 'string' },
            content: { type: 'string' },
            mediaUrl: { type: 'string' },
            mediaType: { type: 'string' },
          },
          required: ['content'],
        },
        MessageResponse: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            conversationId: { type: 'string' },
            direction: { type: 'string', enum: ['inbound', 'outbound'] },
            type: { type: 'string', enum: ['manual', 'automated'] },
            kind: { type: 'string', enum: ['inbound', 'outbound', 'manual', 'automated'] },
            content: { type: 'string' },
            mediaUrl: { type: 'string' },
            mediaType: { type: 'string' },
            status: {
              type: 'string',
              enum: ['pending', 'sent', 'delivered', 'read', 'failed'],
            },
            sentAt: { type: 'string', format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'conversationId', 'direction', 'type', 'kind', 'status', 'createdAt'],
        },
      },
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Session token or Service Account Bearer token',
        },
      },
    },
  };
}
