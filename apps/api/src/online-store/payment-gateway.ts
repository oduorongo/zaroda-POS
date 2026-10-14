import { decryptSecret } from '../common/crypto/secret-box';
import type { DarajaCredentials } from './daraja.client';

export type PaymentGateway = 'TUMA' | 'DARAJA';

export interface GatewayFields {
  paymentGateway?: string | null;
  tumaEmail?: string | null;
  tumaApiKeyEncrypted?: string | null;
  mpesaAccountType?: string | null;
  mpesaShortcode?: string | null;
  mpesaTillNumber?: string | null;
  mpesaConsumerKeyEncrypted?: string | null;
  mpesaConsumerSecretEncrypted?: string | null;
  mpesaPasskeyEncrypted?: string | null;
  mpesaEnvironment?: string | null;
}

export const gatewayOf = (store: Pick<GatewayFields, 'paymentGateway'>): PaymentGateway => (store.paymentGateway === 'DARAJA' ? 'DARAJA' : 'TUMA');

export function tumaConnected(store: GatewayFields): boolean {
  return Boolean(store.tumaEmail && store.tumaApiKeyEncrypted);
}

/** All the Daraja details present: key, secret, passkey, the shortcode, and a till number when the account is a Till. */
export function darajaConnected(store: GatewayFields): boolean {
  const accountOk = store.mpesaAccountType === 'PAYBILL' || (store.mpesaAccountType === 'TILL' && Boolean(store.mpesaTillNumber));
  return Boolean(
    accountOk && store.mpesaShortcode && store.mpesaConsumerKeyEncrypted && store.mpesaConsumerSecretEncrypted && store.mpesaPasskeyEncrypted,
  );
}

/** Whether the gateway the business has CHOSEN is fully set up, so buyers can pay it. */
export function paymentsReady(store: GatewayFields): boolean {
  return gatewayOf(store) === 'DARAJA' ? darajaConnected(store) : tumaConnected(store);
}

/** The business's own Daraja app, decrypted for one call - or null if it is not fully set up. */
export function darajaCredentials(store: GatewayFields, key: Buffer): DarajaCredentials | null {
  if (!darajaConnected(store)) return null;
  return {
    environment: store.mpesaEnvironment === 'sandbox' ? 'sandbox' : 'production',
    consumerKey: decryptSecret(store.mpesaConsumerKeyEncrypted as string, key),
    consumerSecret: decryptSecret(store.mpesaConsumerSecretEncrypted as string, key),
    passkey: decryptSecret(store.mpesaPasskeyEncrypted as string, key),
    accountType: store.mpesaAccountType ?? 'PAYBILL',
    shortcode: store.mpesaShortcode as string,
    tillNumber: store.mpesaTillNumber ?? null,
  };
}
