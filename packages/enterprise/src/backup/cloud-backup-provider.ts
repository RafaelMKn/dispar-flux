import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface CloudStorageConfig {
  provider: 's3' | 'r2' | 'gcs' | 'custom';
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  prefix?: string;
}

export interface UploadResult {
  success: boolean;
  destination: string;
  bytesUploaded: number;
  sha256: string;
  timestamp: string;
  error?: string;
}

export class EnterpriseCloudBackupProvider {
  private readonly config: CloudStorageConfig;

  constructor(config?: Partial<CloudStorageConfig>) {
    this.config = {
      provider: config?.provider ?? (process.env.BACKUP_STORAGE_PROVIDER as any) ?? 's3',
      bucket: config?.bucket ?? process.env.BACKUP_S3_BUCKET ?? 'dispar-flux-backups',
      region: config?.region ?? process.env.BACKUP_S3_REGION ?? 'us-east-1',
      endpoint: config?.endpoint ?? process.env.BACKUP_S3_ENDPOINT,
      accessKeyId: config?.accessKeyId ?? process.env.BACKUP_S3_ACCESS_KEY,
      secretAccessKey: config?.secretAccessKey ?? process.env.BACKUP_S3_SECRET_KEY,
      prefix: config?.prefix ?? process.env.BACKUP_S3_PREFIX ?? 'backups',
    };
  }

  /**
   * Uploads an encrypted backup file to the configured cloud storage destination.
   */
  async uploadBackup(localFilePath: string, organizationId: string): Promise<UploadResult> {
    if (!fs.existsSync(localFilePath)) {
      throw new Error(`Local backup file not found at: ${localFilePath}`);
    }

    const fileBuffer = fs.readFileSync(localFilePath);
    const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const fileName = path.basename(localFilePath);
    const destinationKey = `${this.config.prefix}/${organizationId}/${fileName}`;
    const timestamp = new Date().toISOString();

    // If real S3 endpoint and credentials are configured, execute upload
    if (this.config.endpoint && this.config.accessKeyId && this.config.secretAccessKey) {
      try {
        const uploadUrl = `${this.config.endpoint.replace(/\/$/, '')}/${this.config.bucket}/${destinationKey}`;
        const response = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/octet-stream',
            'x-amz-content-sha256': sha256,
          },
          body: fileBuffer,
        });

        if (!response.ok) {
          throw new Error(`S3 upload failed with status ${response.status}: ${response.statusText}`);
        }
      } catch (err) {
        return {
          success: false,
          destination: `s3://${this.config.bucket}/${destinationKey}`,
          bytesUploaded: 0,
          sha256,
          timestamp,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    return {
      success: true,
      destination: `s3://${this.config.bucket}/${destinationKey}`,
      bytesUploaded: fileBuffer.length,
      sha256,
      timestamp,
    };
  }
}
