import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EtimsEnvironment } from '@prisma/client';
import { maskForLog } from './etims.util';

export interface EtimsResponse<T = unknown> {
  resultCd: string;
  resultMsg: string;
  resultDt: string;
  data: T | null;
}

const SANDBOX_URL = 'https://etims-api-sbx.kra.go.ke/etims-api/';
const PRODUCTION_URL = 'https://etims-api.kra.go.ke/etims-api/';
const TIMEOUT_MS = 20_000;

/**
 * The one place that talks to KRA's eTIMS server (JSON over HTTPS; the key travels in the body, as the spec says). It never throws
 * for a network or format problem: those become a response with code 894 or 899, so callers handle every outcome the same way.
 */
@Injectable()
export class EtimsClient {
  private readonly logger = new Logger(EtimsClient.name);

  constructor(private readonly config: ConfigService) {}

  baseUrl(environment: EtimsEnvironment): string {
    const url =
      environment === 'PRODUCTION'
        ? (this.config.get<string>('ETIMS_PRODUCTION_URL') ?? PRODUCTION_URL)
        : (this.config.get<string>('ETIMS_SANDBOX_URL') ?? SANDBOX_URL);
    return url.endsWith('/') ? url : `${url}/`;
  }

  async call<T = unknown>(
    environment: EtimsEnvironment,
    path: string,
    body: Record<string, unknown>,
  ): Promise<EtimsResponse<T>> {
    const url = `${this.baseUrl(environment)}${path.replace(/^\/+/, '')}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await response.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        this.logger.warn(
          { path, status: response.status },
          'eTIMS answered with something that is not JSON',
        );
        return {
          resultCd: '899',
          resultMsg: `KRA answered with something that is not JSON (HTTP ${response.status})`,
          resultDt: '',
          data: null,
        };
      }
      const r = json as Partial<EtimsResponse<T>>;
      if (typeof r.resultCd !== 'string') {
        return {
          resultCd: '899',
          resultMsg: `KRA's answer had no result code (HTTP ${response.status})`,
          resultDt: '',
          data: null,
        };
      }
      this.logger.debug(
        { path, request: maskForLog(body), resultCd: r.resultCd },
        'eTIMS call',
      );
      return {
        resultCd: r.resultCd,
        resultMsg: r.resultMsg ?? '',
        resultDt: r.resultDt ?? '',
        data: (r.data ?? null) as T | null,
      };
    } catch (e) {
      this.logger.warn(
        { path, err: e instanceof Error ? e.message : String(e) },
        'Could not reach eTIMS',
      );
      return {
        resultCd: '894',
        resultMsg: 'Could not reach the KRA server',
        resultDt: '',
        data: null,
      };
    }
  }
}
