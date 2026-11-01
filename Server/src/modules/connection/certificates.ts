import { isIP } from 'node:net';
import { randomBytes, webcrypto, X509Certificate } from 'node:crypto';
import * as x509 from '@peculiar/x509';

/**
 * The kitchen certificate: HTTPS on the kitchen network, with no domain and no
 * internet.
 *
 * Mise makes its own certificate authority once and signs a certificate for
 * the addresses the tablets use (192.168.1.50, mise.local). Each tablet trusts
 * the authority once; from then on the browser treats Mise as a proper secure
 * site, which offline use and installing the app both require.
 *
 * ECDSA P-256: quick to make even on a Raspberry Pi Zero, and accepted by
 * every browser and by iOS.
 */

type CryptoKey = webcrypto.CryptoKey;
type CryptoKeyPair = webcrypto.CryptoKeyPair;

x509.cryptoProvider.set(webcrypto as never);

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' } as const;

/** The authority outlives any tablet. */
const CA_YEARS = 20;
/**
 * The certificate it signs. iOS refuses server certificates valid for longer
 * than 825 days, and browsers are moving shorter; Mise renews it by itself
 * well before the end, so a short life costs nothing.
 */
export const KITCHEN_CERT_DAYS = 397;

export interface PemPair {
  cert: string;
  key: string;
}

const DAY = 86_400_000;

function serial(): string {
  // Positive, so the first bit is clear.
  const bytes = randomBytes(16);
  bytes[0] = bytes[0]! & 0x7f;
  return bytes.toString('hex');
}

async function keyPair(): Promise<CryptoKeyPair> {
  return (await webcrypto.subtle.generateKey(ALGORITHM, true, [
    'sign',
    'verify',
  ])) as unknown as CryptoKeyPair;
}

async function keyPem(key: CryptoKey): Promise<string> {
  const der = await webcrypto.subtle.exportKey('pkcs8', key as never);
  return x509.PemConverter.encode(der, 'PRIVATE KEY');
}

async function importKey(pem: string): Promise<CryptoKey> {
  return (await webcrypto.subtle.importKey(
    'pkcs8',
    x509.PemConverter.decode(pem)[0]!,
    ALGORITHM,
    true,
    ['sign'],
  )) as unknown as CryptoKey;
}

/** A name for subjects: no commas or equals signs, which have meaning there. */
function plain(text: string): string {
  return (
    text
      .replace(/[,=+<>#;"\\]/g, ' ')
      .trim()
      .slice(0, 60) || 'Kitchen'
  );
}

/** The authority, made once per server. */
export async function createAuthority(kitchenName: string): Promise<PemPair> {
  const keys = await keyPair();
  const now = Date.now();
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: serial(),
    name: `CN=Mise · ${plain(kitchenName)}, O=Mise kitchen certificate`,
    notBefore: new Date(now - DAY),
    notAfter: new Date(now + CA_YEARS * 365 * DAY),
    keys,
    signingAlgorithm: ALGORITHM,
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
        true,
      ),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
    ],
  });
  return { cert: cert.toString('pem'), key: await keyPem(keys.privateKey) };
}

/** The certificate for the addresses tablets use, signed by the authority. */
export async function issueKitchenCertificate(
  authority: PemPair,
  names: string[],
): Promise<PemPair & { expiresAt: Date }> {
  const ca = new x509.X509Certificate(authority.cert);
  const caKey = await importKey(authority.key);
  const keys = await keyPair();
  const now = Date.now();
  const expiresAt = new Date(now + KITCHEN_CERT_DAYS * DAY);

  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: serial(),
    subject: `CN=${plain(names[0] ?? 'mise')}`,
    issuer: ca.subject,
    notBefore: new Date(now - DAY),
    notAfter: expiresAt,
    signingAlgorithm: ALGORITHM,
    publicKey: keys.publicKey,
    signingKey: caKey,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth]),
      new x509.SubjectAlternativeNameExtension(
        names.map((name) => ({ type: isIP(name) ? 'ip' : 'dns', value: name }) as const),
      ),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
      await x509.AuthorityKeyIdentifierExtension.create(ca),
    ],
  });
  // Served with its authority, as a chain.
  return {
    cert: `${cert.toString('pem')}\n${authority.cert}`,
    key: await keyPem(keys.privateKey),
    expiresAt,
  };
}

/** What someone compares on a tablet to know it is this server's authority. */
export function fingerprint(certPem: string): string {
  return new X509Certificate(certPem).fingerprint256;
}

/** A host a tablet could reach Mise by: an IP address or a host name, no port. */
export function validKitchenName(name: string): boolean {
  if (isIP(name)) return true;
  return /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(
    name,
  );
}
