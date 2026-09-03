export interface SystemStatusResponse {
  installationId: string;
  version: string;
  edition: 'community';
  environment: string;
  operationalTimezone: string;
  uptimeSeconds: number;
  nodeVersion: string;
  isClaimed: boolean;
  activeConnectionsCount: number;
  storageType: string;
}
