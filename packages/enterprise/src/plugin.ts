import type { DisparFluxPlugin, PluginContext } from '@dispar-flux/contracts';
import { EnterpriseLicenseManager } from './license/license-manager.js';
import { EnterpriseCloudBackupProvider } from './backup/cloud-backup-provider.js';
import { EnterpriseMultiSessionCoordinator } from './sessions/multi-session-coordinator.js';

export class EnterprisePlugin implements DisparFluxPlugin {
  public readonly name = '@dispar-flux/enterprise';
  public readonly version = '1.0.0';
  public readonly editionRequired = 'enterprise' as const;

  public readonly licenseManager: EnterpriseLicenseManager;
  public readonly backupProvider: EnterpriseCloudBackupProvider;
  public readonly sessionCoordinator: EnterpriseMultiSessionCoordinator;

  constructor() {
    this.licenseManager = new EnterpriseLicenseManager();
    this.backupProvider = new EnterpriseCloudBackupProvider();
    this.sessionCoordinator = new EnterpriseMultiSessionCoordinator();
  }

  init(context: PluginContext): void {
    if (context.logger?.info) {
      context.logger.info('Initializing Dispar Flux Enterprise Extension', {
        name: this.name,
        version: this.version,
        edition: context.edition,
      });
    }
  }

  onServerStart(context: PluginContext): void {
    if (context.broadcast) {
      context.broadcast('enterprise:status', {
        enabled: true,
        version: this.version,
      });
    }
  }

  onServerStop(): void {
    // cleanup
  }
}
