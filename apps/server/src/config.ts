import crypto from 'node:crypto';
import path from 'node:path';

export interface ServerConfig {
  port: number;
  host: string;
  dataDir: string;
  databasePath: string;
  operationalKey: string;
  nodeEnv: string;
  version: string;
  edition: 'community';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  logFormat: 'json' | 'text';
}

/**
 * Loads server configuration from environment variables with safe defaults.
 */
export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const nodeEnv = overrides.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const port = overrides.port ?? (process.env.PORT ? parseInt(process.env.PORT, 10) : 3000);
  const host = overrides.host ?? process.env.HOST ?? '0.0.0.0';
  const rawDataDir = overrides.dataDir ?? process.env.DATA_DIR ?? './data';
  const dataDir = path.resolve(rawDataDir);
  const databasePath = overrides.databasePath ?? path.join(dataDir, 'dispar-flux.sqlite');

  // OPERATIONAL_KEY: hex or base64 string, auto-generated if omitted (ADR 0020)
  const operationalKey =
    overrides.operationalKey ??
    process.env.OPERATIONAL_KEY ??
    crypto.randomBytes(32).toString('hex');

  const version = overrides.version ?? '0.0.1';
  const edition = 'community' as const;

  const rawLogLevel = (overrides.logLevel ?? process.env.LOG_LEVEL ?? (nodeEnv === 'production' ? 'info' : 'debug')).toLowerCase();
  const logLevel: 'debug' | 'info' | 'warn' | 'error' =
    rawLogLevel === 'debug' || rawLogLevel === 'info' || rawLogLevel === 'warn' || rawLogLevel === 'error'
      ? rawLogLevel
      : 'info';

  const logFormat: 'json' | 'text' = overrides.logFormat ?? (process.env.LOG_FORMAT === 'text' ? 'text' : 'json');

  return {
    port,
    host,
    dataDir,
    databasePath,
    operationalKey,
    nodeEnv,
    version,
    edition,
    logLevel,
    logFormat,
  };
}
