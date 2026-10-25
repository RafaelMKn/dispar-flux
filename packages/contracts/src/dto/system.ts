export interface SystemStatusResponse {
  installationId: string;
  version: string;
  edition: 'community' | 'enterprise';
  environment: string;
  operationalTimezone: string;
  uptimeSeconds: number;
  nodeVersion: string;
  isClaimed: boolean;
  activeConnectionsCount: number;
  storageType: string;
}
