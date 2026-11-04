import { BlockList, isIP } from 'node:net';
import { randomBytes, webcrypto, X509Certificate } from 'node:crypto';
import * as x509 from '@peculiar/x509';
import { AsnConvert } from '@peculiar/asn1-schema';
import {
  GeneralName,
  GeneralSubtree,
  GeneralSubtrees,
  NameConstraints,
  id_ce_nameConstraints,
} from '@peculiar/asn1-x509';

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

/** Names only a kitchen network uses: nobody can get a public certificate for these. */
const KITCHEN_DOMAINS = ['local', 'lan', 'home', 'home.arpa', 'internal', 'localhost', 'intranet'];
/** Private and link-local addresses, and the machine itself. */
const KITCHEN_RANGES = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  '100.64.0.0/10',
  '127.0.0.0/8',
  'fc00::/7',
  'fe80::/10',
  '::1/128',
];

/**
 * What the authority may vouch for: the kitchen network's own names and
 * addresses, and the names it was first made for. A tablet that trusts it
 * then trusts it for nothing else: not a bank, not any website, even if the
 * server were ever taken over.
 */
function nameConstraints(names: string[]): x509.Extension {
  const dns = [...KITCHEN_DOMAINS, ...names.filter((name) => !isIP(name))];
  const ips = [
    ...KITCHEN_RANGES,
    ...names.filter((name) => isIP(name)).map((ip) => `${ip}/${isIP(ip) === 4 ? 32 : 128}`),
  ];
  const permitted = new GeneralSubtrees([
    ...[...new Set(dns)].map(
      (dNSName) => new GeneralSubtree({ base: new GeneralName({ dNSName }) }),
    ),
    ...[...new Set(ips)].map(
      (iPAddress) => new GeneralSubtree({ base: new GeneralName({ iPAddress }) }),
    ),
  ]);
  return new x509.Extension(
    id_ce_nameConstraints,
    true,
    AsnConvert.serialize(new NameConstraints({ permittedSubtrees: permitted })),
  );
}

/**
 * Whether an authority may vouch for a name. One made before 2.2.2 has no
 * limits; replacing it would mean trusting it again on every tablet.
 */
export function authorityPermits(authorityPem: string, name: string): boolean {
  const extension = new x509.X509Certificate(authorityPem).getExtension(id_ce_nameConstraints);
  if (!extension) return true;
  const constraints = AsnConvert.parse(extension.value, NameConstraints);
  const subtrees = constraints.permittedSubtrees ?? [];
  const version = isIP(name);
  if (version) {
    const ranges = new BlockList();
    for (const { base } of subtrees) {
      if (!base.iPAddress) continue;
      const [address, prefix] = base.iPAddress.split('/') as [string, string];
      const type = isIP(address) === 6 ? 'ipv6' : 'ipv4';
      ranges.addSubnet(address, Number(prefix), type);
    }
    return ranges.check(name, version === 6 ? 'ipv6' : 'ipv4');
  }
  return subtrees.some(
    ({ base }) =>
      base.dNSName !== undefined && (name === base.dNSName || name.endsWith(`.${base.dNSName}`)),
  );
}

/** The authority, made once per server, for the names it is first asked for. */
export async function createAuthority(kitchenName: string, names: string[] = []): Promise<PemPair> {
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
      nameConstraints(names),
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
    // Not a host name: with only addresses in the certificate, OpenSSL would
    // hold a name-like CN to the authority's limits too. Browsers go by the
    // alternative names alone.
    subject: 'CN=Mise kitchen',
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
