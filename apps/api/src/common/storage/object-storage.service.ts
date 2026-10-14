import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectsCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Thin wrapper over an S3-compatible bucket - Cloudflare R2 by default
 * (cheap, no egress fees), but any S3 API works by changing the env vars.
 * Files are uploaded by the browser directly to the bucket using a
 * short-lived presigned URL, so the API never streams file bodies.
 *
 * Env (see .env.example): STORAGE_ENDPOINT, STORAGE_REGION,
 * STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY, STORAGE_BUCKET,
 * STORAGE_PUBLIC_BASE_URL. Unset means uploads fail with a clear 503,
 * the same "degrade without credentials" convention as M-Pesa/SMS.
 */
@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);
  private client: S3Client | null = null;

  constructor(private readonly config: ConfigService) {}

  private get bucket(): string {
    return this.require('STORAGE_BUCKET');
  }

  private require(name: string): string {
    const value = this.config.get<string>(name);
    if (!value) {
      throw new ServiceUnavailableException(
        'Photo storage is not configured on this server yet',
      );
    }
    return value;
  }

  private s3(): S3Client {
    if (!this.client) {
      this.client = new S3Client({
        endpoint: this.require('STORAGE_ENDPOINT'),
        region: this.config.get<string>('STORAGE_REGION') ?? 'auto',
        credentials: {
          accessKeyId: this.require('STORAGE_ACCESS_KEY_ID'),
          secretAccessKey: this.require('STORAGE_SECRET_ACCESS_KEY'),
        },
      });
    }
    return this.client;
  }

  /**
   * A URL the browser can PUT exactly one file to. Content-Type and
   * Content-Length are part of the signature, so the upload is rejected by
   * the bucket itself if the browser sends a different type or size than
   * the API approved.
   */
  createUploadUrl(key: string, contentType: string, sizeBytes: number): Promise<string> {
    return getSignedUrl(
      this.s3(),
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: sizeBytes,
      }),
      { expiresIn: 300, signableHeaders: new Set(['content-type', 'content-length']) },
    );
  }

  /** Size/type of an uploaded object, or null if nothing is there. */
  async head(key: string): Promise<{ sizeBytes: number; contentType: string | undefined } | null> {
    try {
      const result = await this.s3().send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { sizeBytes: result.ContentLength ?? 0, contentType: result.ContentType };
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw e;
    }
  }

  /**
   * Best-effort - a failed delete leaves an orphaned file in the bucket
   * (costs a little storage), which is logged rather than failing the
   * user's action, since their database change has already happened.
   */
  async deleteMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.s3().send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        }),
      );
    } catch (e) {
      this.logger.warn({ err: e, keys }, 'Failed to delete objects from storage');
    }
  }

  publicUrl(key: string): string {
    return `${this.require('STORAGE_PUBLIC_BASE_URL').replace(/\/+$/, '')}/${key}`;
  }
}
