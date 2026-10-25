/**
 * Contract for Dispar Flux Plugins and Extensions (ADR 0052).
 * Commercial and Enterprise features consume this public, versioned API
 * without polluting or permanently forking the AGPLv3 open-source core.
 */

export interface PluginContext {
  edition: 'community' | 'enterprise';
  dataDir: string;
  registerRoute?: (
    method: string,
    path: string,
    handler: (req: any, res: any, context?: any) => Promise<boolean | void> | boolean | void
  ) => void;
  broadcast?: (event: string, payload: any) => void;
  logger?: any;
  db?: any;
}

export interface DisparFluxPlugin {
  readonly name: string;
  readonly version: string;
  readonly editionRequired?: 'community' | 'enterprise';
  init?(context: PluginContext): Promise<void> | void;
  onServerStart?(context: PluginContext): Promise<void> | void;
  onServerStop?(): Promise<void> | void;
}
