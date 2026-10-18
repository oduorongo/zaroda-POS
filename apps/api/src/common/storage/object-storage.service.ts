import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { del, put } from '@vercel/blob';

/**
 * Thin wrapper over a PUBLIC Vercel Blob store (shoppers must be able to see
 * product photos without logging in). Works from any host, including Render -
 * Blob is just an HTTPS service reached with a token.
 *
 * Env (see .env.example): BLOB_READ_WRITE_TOKEN (from the Blob store in the
 * Vercel dashboard). STORAGE_PUBLIC_BASE_URL is optional: by default the
 * public address is worked out from the token, because a token looks like
 * `vercel_blob_rw_<storeId>_<secret>` and a public store lives at
 * `https://<storeid>.public.blob.vercel-storage.com`. Unset token means
 * uploads fail with a clear 503, the same "degrade without credentials"
 * convention as M-Pesa/SMS.
 *
 * Files are stored at the exact key we choose (no random suffix) - the key is
 * already unique (it contains a UUID) and is what the database records.
 */
@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);

  constructor(private readonly config: ConfigService) {}

  private get token(): string {
    const value = this.config.get<string>('BLOB_READ_WRITE_TOKEN');
    if (!value) {
      throw new ServiceUnavailableException('Photo storage is not configured on this server yet');
    }
    // A pasted value with quotes, spaces or the wrong prefix is the commonest setup mistake. Say so plainly,
    // without echoing the value back.
    if (!/^vercel_blob_rw_[A-Za-z0-9]+_[A-Za-z0-9]+$/.test(value)) {
      throw new ServiceUnavailableException(
        'Photo storage setting BLOB_READ_WRITE_TOKEN is not a valid Blob token (it should start with vercel_blob_rw_, with no quotes or spaces)',
      );
    }
    return value;
  }

  private get baseUrl(): string {
    const override = this.config.get<string>('STORAGE_PUBLIC_BASE_URL');
    if (override) return override.replace(/\/+$/, '');
    const storeId = /^vercel_blob_rw_([^_]+)_/.exec(this.token)?.[1];
    if (!storeId) {
      throw new ServiceUnavailableException('Photo storage is misconfigured on this server');
    }
    return `https://${storeId.toLowerCase()}.public.blob.vercel-storage.com`;
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    try {
      await put(key, body, {
        access: 'public',
        contentType,
        token: this.token,
        addRandomSuffix: false,
        allowOverwrite: false,
      });
    } catch (e) {
      // Without this the manager only sees a bare "Internal server error". The usual causes are a wrong or
      // revoked token, or a Private store (shop photos need a Public one) - say so.
      // Only the Blob SDK's own messages are shown (they never contain the token); anything else could, so it
      // goes to the server log only.
      this.logger.error({ err: e }, 'Blob upload failed');
      const isBlobError = e instanceof Error && e.name.startsWith('BlobError');
      throw new BadGatewayException(
        isBlobError ? `Photo storage rejected the upload: ${(e as Error).message}` : 'Photo storage rejected the upload - see the server log',
      );
    }
  }

  /**
   * Best-effort - a failed delete leaves an orphaned file in the store
   * (costs a little storage), which is logged rather than failing the
   * user's action, since their database change has already happened.
   */
  async deleteMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await del(
        keys.map((key) => this.publicUrl(key)),
        { token: this.token },
      );
    } catch (e) {
      this.logger.warn({ err: e, keys }, 'Failed to delete objects from storage');
    }
  }

  publicUrl(key: string): string {
    return `${this.baseUrl}/${key}`;
  }
}
