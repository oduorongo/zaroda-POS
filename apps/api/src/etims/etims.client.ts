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
// KRA's GavaConnect gateway (developer.go.ke): ZARODA's consumer key and secret are swapped for a short-lived token.
const SANDBOX_TOKEN_URL = 'https://sbx.kra.go.ke/v1/token/generate';
const PRODUCTION_TOKEN_URL = 'https://api.kra.go.ke/v1/token/generate';
const TOKEN_EARLY_MS = 60_000;

interface CachedToken {
  token: string;
  expiresAt: number;
}

/**
 * The one place that talks to KRA's eTIMS server (JSON over HTTPS). When ZARODA's GavaConnect consumer key and secret are set for an
 * environment (ETIMS_SANDBOX_CONSUMER_KEY / _SECRET, ETIMS_PRODUCTION_CONSUMER_KEY / _SECRET), every call carries a gateway token,
 * fetched once and reused until it is about to expire, plus the business's tin, bhfId and cmcKey as headers (device sign-up carries
 * only the token). Without them the calls go out as before. It never throws for a network or format problem: those become a
 * response with code 894 or 899, so callers handle every outcome the same way.
 */
@Injectable()
export class EtimsClient {
  private readonly logger = new Logger(EtimsClient.name);
  private readonly tokens = new Map<EtimsEnvironment, CachedToken>();

  constructor(private readonly config: ConfigService) {}

  baseUrl(environment: EtimsEnvironment): string {
    const url =
      environment === 'PRODUCTION'
        ? (this.config.get<string>('ETIMS_PRODUCTION_URL') ?? PRODUCTION_URL)
        : (this.config.get<string>('ETIMS_SANDBOX_URL') ?? SANDBOX_URL);
    return url.endsWith('/') ? url : `${url}/`;
  }

  private credentials(environment: EtimsEnvironment): { key: string; secret: string; url: string } | null {
    const prefix = environment === 'PRODUCTION' ? 'ETIMS_PRODUCTION' : 'ETIMS_SANDBOX';
    const key = this.config.get<string>(`${prefix}_CONSUMER_KEY`)?.trim();
    const secret = this.config.get<string>(`${prefix}_CONSUMER_SECRET`)?.trim();
    if (!key || !secret) return null;
    const url = this.config.get<string>(`${prefix}_TOKEN_URL`) ?? (environment === 'PRODUCTION' ? PRODUCTION_TOKEN_URL : SANDBOX_TOKEN_URL);
    return { key, secret, url };
  }

  /** Whether calls to this environment go through the GavaConnect gateway (a consumer key and secret are set). */
  usesGateway(environment: EtimsEnvironment): boolean {
    return this.credentials(environment) !== null;
  }

  /** A gateway token: the cached one while it is good, else a new one; or why there is none. */
  private async token(environment: EtimsEnvironment, fresh = false): Promise<{ token: string } | { problem: string }> {
    const creds = this.credentials(environment);
    if (!creds) return { problem: 'No KRA gateway credentials are set' };
    const cached = this.tokens.get(environment);
    if (!fresh && cached && cached.expiresAt - TOKEN_EARLY_MS > Date.now()) return { token: cached.token };
    try {
      const sep = creds.url.includes('?') ? '&' : '?';
      const response = await fetch(`${creds.url}${sep}grant_type=client_credentials`, {
        method: 'GET',
        headers: { Authorization: `Basic ${Buffer.from(`${creds.key}:${creds.secret}`).toString('base64')}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const json = (await response.json().catch(() => null)) as { access_token?: string; expires_in?: number | string } | null;
      if (!response.ok || !json?.access_token) {
        this.tokens.delete(environment);
        this.logger.warn({ environment, status: response.status }, 'KRA GavaConnect refused the token request');
        return { problem: `KRA's gateway refused ZARODA's sign-in (HTTP ${response.status}). Check the GavaConnect consumer key and secret.` };
      }
      const seconds = Number(json.expires_in ?? 3600);
      this.tokens.set(environment, { token: json.access_token, expiresAt: Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000 });
      return { token: json.access_token };
    } catch (e) {
      this.logger.warn({ environment, err: e instanceof Error ? e.message : String(e) }, 'Could not reach KRA GavaConnect for a token');
      return { problem: "Could not reach KRA's gateway to sign in" };
    }
  }

  /** The headers for one call: the gateway token, and the business's tin, bhfId and cmcKey (not for device sign-up). */
  private headers(path: string, body: Record<string, unknown>, token: string | null): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (!token) return h;
    h.Authorization = `Bearer ${token}`;
    if (!/selectInitOsdcInfo$/.test(path)) {
      for (const k of ['tin', 'bhfId', 'cmcKey'] as const) {
        const v = body[k];
        if (typeof v === 'string' && v) h[k] = v;
      }
    }
    return h;
  }

  async call<T = unknown>(
    environment: EtimsEnvironment,
    path: string,
    body: Record<string, unknown>,
  ): Promise<EtimsResponse<T>> {
    const url = `${this.baseUrl(environment)}${path.replace(/^\/+/, '')}`;
    const gateway = this.usesGateway(environment);
    let token: string | null = null;
    if (gateway) {
      const t = await this.token(environment);
      if ('problem' in t) return { resultCd: '894', resultMsg: t.problem, resultDt: '', data: null };
      token = t.token;
    }
    try {
      const send = (bearer: string | null) =>
        fetch(url, {
          method: 'POST',
          headers: this.headers(path, body, bearer),
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      let response = await send(token);
      // The token ran out early, or was revoked: get a new one and try once more.
      if (gateway && response.status === 401) {
        const t = await this.token(environment, true);
        if ('problem' in t) return { resultCd: '894', resultMsg: t.problem, resultDt: '', data: null };
        response = await send(t.token);
      }
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
      const r = json as Partial<EtimsResponse<T>> & { fault?: { faultstring?: string } };
      if (typeof r.resultCd !== 'string') {
        return {
          resultCd: '899',
          resultMsg: r.fault?.faultstring
            ? `KRA's gateway refused the call: ${r.fault.faultstring} (HTTP ${response.status})`
            : `KRA's answer had no result code (HTTP ${response.status})`,
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
