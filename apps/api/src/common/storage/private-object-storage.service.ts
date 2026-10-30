import { createReadStream, existsSync } from 'fs';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { dirname, join, normalize } from 'path';
import { Readable } from 'stream';
import { BadGatewayException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { del, get, put } from '@vercel/blob';

/**
 * PRIVATE file storage for documents that must never have a public address (permits, certificates, ID copies, contracts).
 * Uses a separate Private Vercel Blob store (BLOB_PRIVATE_READ_WRITE_TOKEN); files are only ever streamed back through the
 * API after its own permission checks. Without a token, development falls back to apps/api/.private-uploads; production
 * refuses with a clear 503.
 */
@Injectable()
export class PrivateObjectStorageService {
  private readonly logger = new Logger(PrivateObjectStorageService.name);
  private readonly localDir = join(process.cwd(), '.private-uploads');

  constructor(private readonly config: ConfigService) {}

  private get token(): string | null {
    return this.config.get<string>('BLOB_PRIVATE_READ_WRITE_TOKEN') || null;
  }

  private localPath(key: string): string {
    if (process.env.NODE_ENV === 'production') throw new ServiceUnavailableException('Private document storage is not configured on this server yet');
    const path = normalize(join(this.localDir, key));
    if (!path.startsWith(this.localDir)) throw new NotFoundException();
    return path;
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    const token = this.token;
    if (!token) {
      const path = this.localPath(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
      return;
    }
    try {
      await put(key, body, { access: 'private', contentType, token, addRandomSuffix: false, allowOverwrite: false });
    } catch (e) {
      this.logger.error({ err: e }, 'Private blob upload failed');
      throw new BadGatewayException('Document storage rejected the upload - see the server log');
    }
  }

  async read(key: string): Promise<{ stream: Readable; contentType: string | null }> {
    const token = this.token;
    if (!token) {
      const path = this.localPath(key);
      if (!existsSync(path)) throw new NotFoundException('File not found');
      return { stream: createReadStream(path), contentType: null };
    }
    const result = await get(key, { access: 'private', token }).catch((e) => {
      this.logger.error({ err: e }, 'Private blob read failed');
      throw new BadGatewayException('Could not fetch the document from storage');
    });
    if (!result || result.statusCode !== 200) throw new NotFoundException('File not found');
    return { stream: Readable.fromWeb(result.stream as never), contentType: result.blob.contentType };
  }

  /** Best-effort, like ObjectStorageService.deleteMany. */
  async delete(key: string): Promise<void> {
    try {
      const token = this.token;
      if (token) await del(key, { token });
      else await unlink(this.localPath(key));
    } catch (e) {
      this.logger.warn({ err: e, key }, 'Failed to delete a private document');
    }
  }
}
