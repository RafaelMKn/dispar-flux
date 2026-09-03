export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string; // ISO 8601 string
  uptimeSeconds: number;
  version: string;
}

export interface ComponentHealthCheck {
  status: 'up' | 'down' | 'degraded';
  message?: string;
  latencyMs?: number;
}

export interface ReadyResponse {
  status: 'ready' | 'not_ready';
  database: 'connected' | 'disconnected' | 'error';
  storage: 'ready' | 'error';
  checks: Record<string, boolean>;
  timestamp: string;
}
