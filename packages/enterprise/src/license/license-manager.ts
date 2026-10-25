import crypto from 'node:crypto';

export interface EnterpriseFeatures {
  multiConnection: boolean;
  multiFunnel: boolean;
  cloudBackup: boolean;
  advancedAudit: boolean;
  sso: boolean;
  maxConnections: number;
  maxFunnels: number;
}

export interface LicenseValidationResult {
  valid: boolean;
  edition: 'enterprise';
  organizationId?: string;
  features: EnterpriseFeatures;
  expiresAt?: string;
  error?: string;
}

export class EnterpriseLicenseManager {
  private readonly secretKey: string;

  constructor(secretKey: string = process.env.ENTERPRISE_LICENSE_SECRET || 'dispar_flux_enterprise_license_key_default') {
    this.secretKey = secretKey;
  }

  /**
   * Generates a signed enterprise license token for an organization.
   */
  generateLicenseToken(organizationId: string, features: Partial<EnterpriseFeatures> = {}, expiresInDays: number = 365): string {
    const payload = {
      org: organizationId,
      edition: 'enterprise',
      features: {
        multiConnection: features.multiConnection ?? true,
        multiFunnel: features.multiFunnel ?? true,
        cloudBackup: features.cloudBackup ?? true,
        advancedAudit: features.advancedAudit ?? true,
        sso: features.sso ?? true,
        maxConnections: features.maxConnections ?? 50,
        maxFunnels: features.maxFunnels ?? 100,
      },
      exp: Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
    };

    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', this.secretKey).update(data).digest('base64url');
    return `${data}.${signature}`;
  }

  /**
   * Validates a license token and extracts granted capabilities.
   */
  validateLicenseToken(token: string): LicenseValidationResult {
    const defaultFeatures: EnterpriseFeatures = {
      multiConnection: true,
      multiFunnel: true,
      cloudBackup: true,
      advancedAudit: true,
      sso: true,
      maxConnections: 50,
      maxFunnels: 100,
    };

    if (!token || typeof token !== 'string') {
      return {
        valid: false,
        edition: 'enterprise',
        features: defaultFeatures,
        error: 'Missing license token',
      };
    }

    const parts = token.split('.');
    if (parts.length !== 2) {
      return {
        valid: false,
        edition: 'enterprise',
        features: defaultFeatures,
        error: 'Malformed license token format',
      };
    }

    const [data, signature] = parts;
    if (!data || !signature) {
      return {
        valid: false,
        edition: 'enterprise',
        features: defaultFeatures,
        error: 'Malformed license token format',
      };
    }
    const expectedSignature = crypto.createHmac('sha256', this.secretKey).update(data).digest('base64url');

    if (signature !== expectedSignature) {
      return {
        valid: false,
        edition: 'enterprise',
        features: defaultFeatures,
        error: 'Invalid license signature',
      };
    }

    try {
      const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf-8'));
      if (payload.exp && Date.now() > payload.exp) {
        return {
          valid: false,
          edition: 'enterprise',
          organizationId: payload.org,
          features: payload.features || defaultFeatures,
          expiresAt: new Date(payload.exp).toISOString(),
          error: 'License token expired',
        };
      }

      return {
        valid: true,
        edition: 'enterprise',
        organizationId: payload.org,
        features: payload.features || defaultFeatures,
        expiresAt: payload.exp ? new Date(payload.exp).toISOString() : undefined,
      };
    } catch {
      return {
        valid: false,
        edition: 'enterprise',
        features: defaultFeatures,
        error: 'Failed to decode license payload',
      };
    }
  }
}
