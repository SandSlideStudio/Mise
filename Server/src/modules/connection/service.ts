import { eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { connectionSettings } from '../../db/schema.js';
import { plainAddress } from '../../lib/network.js';
import { acmeReason, issueDomainCertificate, type ChallengeAnswers } from './acme.js';
import {
  authorityConstrained,
  authorityMadeAt,
  authorityPermits,
  isKitchenName,
  createAuthority,
  fingerprint,
  issueKitchenCertificate,
} from './certificates.js';
import type { HttpsListener } from './listener.js';

/** The one row's id. */
export const CONNECTION_ID = '00000000-0000-4000-8000-000000000002';

/** Certificates are renewed when they have less than this left. */
export const RENEW_DAYS = 30;
const DAY = 86_400_000;

/**
 * What every request is checked against, kept in memory: the proxy check runs
 * inside Fastify before any hook, where there is no time to ask the database.
 * Loaded when the server starts and changed only through this service.
 */
export interface ConnectionState {
  outsideDomain: string | null;
  trustedProxy: string | null;
  /** The domain a working Let's Encrypt certificate is on, for sending plain HTTP there over. */
  httpsDomain: string | null;
}

export function emptyConnectionState(): ConnectionState {
  return { outsideDomain: null, trustedProxy: null, httpsDomain: null };
}

/** A host name as compared: lower case, no trailing dot. */
export function plainHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}

/** The last web server seen passing requests on, offered for trusting. */
export interface SeenProxy {
  address: string;
  host: string;
  at: Date;
}

/** Getting a certificate from Let's Encrypt went wrong; the reason is theirs. */
export class CertificateFailure extends Error {}

/** Why the kitchen's authority can't be replaced as it stands. */
export class AuthorityRefusal extends Error {
  constructor(
    readonly reason: 'none' | 'already_constrained' | 'name_outside_kitchen',
    readonly host?: string,
  ) {
    super(reason);
  }
}

type Row = typeof connectionSettings.$inferSelect;
type Issue = typeof issueDomainCertificate;

export function createConnectionService(options: {
  db: Database;
  state: ConnectionState;
  listener: HttpsListener;
  directoryUrl: string;
  issue?: Issue;
}) {
  const { db, state, listener } = options;
  const issue = options.issue ?? issueDomainCertificate;
  let seen: SeenProxy | null = null;
  /** The last visitor relayed by the container's own gateway: where they are can't be told. */
  let relayed: { address: string; at: Date } | null = null;
  let row: Row | null = null;
  /** Let's Encrypt's tokens while a certificate is being fetched. */
  const answers: ChallengeAnswers = new Map();
  /**
   * Changes to the kitchen certificate, one after the other. Each reads the
   * authority, waits while keys are made, then saves: two at once (new
   * addresses while the authority is replaced, or a renewal) would save a
   * certificate for the wrong addresses, or put the old authority back.
   */
  let kitchenChanges: Promise<unknown> = Promise.resolve();
  function oneAtATime<T>(change: () => Promise<T>): Promise<T> {
    const next = kitchenChanges.then(change, change);
    kitchenChanges = next.catch(() => undefined);
    return next;
  }

  async function read(): Promise<Row | null> {
    const [found] = await db
      .select()
      .from(connectionSettings)
      .where(eq(connectionSettings.id, CONNECTION_ID))
      .limit(1);
    return found ?? null;
  }

  async function save(values: Partial<Omit<Row, 'id'>>): Promise<void> {
    const [saved] = await db
      .insert(connectionSettings)
      .values({ id: CONNECTION_ID, ...values })
      .onConflictDoUpdate({
        target: connectionSettings.id,
        set: { ...values, updatedAt: new Date() },
      })
      .returning();
    row = saved ?? null;
    await apply();
  }

  /** Bring memory and the HTTPS listener in line with the row. */
  async function apply(): Promise<void> {
    state.outsideDomain = row?.outsideDomain ?? null;
    state.trustedProxy = row?.trustedProxy ?? null;
    const domain =
      row?.domainHttps && row.domainCert && row.domainKey && row.domainCertFor
        ? { name: row.domainCertFor, cert: row.domainCert, key: row.domainKey }
        : null;
    const kitchen =
      row?.kitchenHttps && row.kitchenCert && row.kitchenKey
        ? { cert: row.kitchenCert, key: row.kitchenKey }
        : null;
    state.httpsDomain = domain?.name ?? null;
    await listener.serve({ kitchen, domain });
  }

  async function makeKitchenCertificate(names: string[], kitchenName: string) {
    const authority =
      row?.kitchenCaCert && row.kitchenCaKey
        ? { cert: row.kitchenCaCert, key: row.kitchenCaKey }
        : await createAuthority(kitchenName, names);
    const issued = await issueKitchenCertificate(authority, names);
    return {
      kitchenCaCert: authority.cert,
      kitchenCaKey: authority.key,
      kitchenCert: issued.cert,
      kitchenKey: issued.key,
      kitchenNames: names,
      kitchenExpiresAt: issued.expiresAt,
    };
  }

  async function fetchDomainCertificate(domain: string) {
    try {
      const issued = await issue({
        domain,
        accountKey: row?.acmeAccountKey ?? null,
        directoryUrl: options.directoryUrl,
        answers,
      });
      return {
        domainCert: issued.cert,
        domainKey: issued.key,
        domainCertFor: domain,
        domainExpiresAt: issued.expiresAt,
        domainError: null,
        acmeAccountKey: issued.accountKey,
      };
    } catch (error) {
      throw new CertificateFailure(acmeReason(error));
    }
  }

  const due = (expiresAt: Date | null | undefined) =>
    !expiresAt || expiresAt.getTime() - Date.now() < RENEW_DAYS * DAY;

  return {
    async load(): Promise<void> {
      row = await read();
      await apply();
    },

    /** The address that leads to Mise from outside, or null for any. */
    outsideDomain: () => state.outsideDomain,
    /** The web server in front of Mise, or null. */
    trustedProxy: () => state.trustedProxy,
    /** The domain plain HTTP is sent on to HTTPS for, or null. */
    httpsDomain: () => state.httpsDomain,

    /** Whether visitors relayed by the container's gateway count as inside. */
    trustsContainerGateway: () => row?.trustContainerGateway ?? false,

    async update(changes: {
      outsideDomain?: string | null;
      trustedProxy?: string | null;
      trustContainerGateway?: boolean;
    }) {
      const values: Partial<Row> = {};
      if (changes.trustContainerGateway !== undefined) {
        values.trustContainerGateway = changes.trustContainerGateway;
      }
      if (changes.outsideDomain !== undefined) {
        values.outsideDomain = changes.outsideDomain && plainHost(changes.outsideDomain);
      }
      if (changes.trustedProxy !== undefined) {
        values.trustedProxy = changes.trustedProxy && plainAddress(changes.trustedProxy);
      }
      await save({
        outsideDomain: state.outsideDomain,
        trustedProxy: state.trustedProxy,
        ...values,
      });
    },

    sawProxy(address: string, host: string): void {
      seen = { address: plainAddress(address), host: plainHost(host), at: new Date() };
    },
    seenProxy: () => seen,

    sawContainerGateway(address: string): void {
      relayed = { address: plainAddress(address), at: new Date() };
    },
    containerGateway: () => relayed,

    /** How HTTPS stands, for Settings → Connection. */
    https() {
      return {
        kitchen: {
          enabled: row?.kitchenHttps ?? false,
          names: row?.kitchenNames ?? [],
          expiresAt: row?.kitchenExpiresAt ?? null,
          fingerprint: row?.kitchenCaCert ? fingerprint(row.kitchenCaCert) : null,
          authority: row?.kitchenCaCert
            ? {
                constrained: authorityConstrained(row.kitchenCaCert),
                createdAt: authorityMadeAt(row.kitchenCaCert),
              }
            : null,
        },
        domain: {
          enabled: row?.domainHttps ?? false,
          domain: row?.domainCertFor ?? null,
          expiresAt: row?.domainExpiresAt ?? null,
          error: row?.domainError ?? null,
        },
      };
    },

    /** The authority a tablet trusts, or null before there is one. */
    authority: () => row?.kitchenCaCert ?? null,

    /** Names the kitchen's authority can't vouch for, made before or not. */
    namesOutsideAuthority(names: string[]): string[] {
      const authority = row?.kitchenCaCert;
      // Not made yet: it will be made for kitchen names only, so it can never
      // vouch for a public one.
      return authority
        ? names.filter((name) => !authorityPermits(authority, name))
        : names.filter((name) => !isKitchenName(name));
    },

    enableKitchenHttps(names: string[], kitchenName: string): Promise<void> {
      return oneAtATime(async () => {
        await save({ kitchenHttps: true, ...(await makeKitchenCertificate(names, kitchenName)) });
      });
    },

    /**
     * A new authority in place of one made before 2.2.2, limited to the
     * kitchen network like any made since, with a new certificate from it
     * served at once. The old one is dropped rather than kept alongside: what
     * it is worth to an intruder is exactly that tablets still trust it, so
     * it should vouch for nothing more. Every tablet then trusts the new one
     * once; until then it shows the browser's warning over HTTPS, and plain
     * HTTP keeps working.
     */
    replaceAuthority(kitchenName: string): Promise<void> {
      return oneAtATime(async () => {
        const old = row?.kitchenCaCert;
        if (!old) throw new AuthorityRefusal('none');
        // Only the old kind: replacing a limited one gains nothing and costs
        // every tablet a visit.
        if (authorityConstrained(old)) throw new AuthorityRefusal('already_constrained');
        const names = row?.kitchenNames ?? [];
        // The old authority took any name; the new one would carry a public
        // one in its limits, and with it the risk this is meant to end.
        const outside = names.find((name) => !isKitchenName(name));
        if (outside) throw new AuthorityRefusal('name_outside_kitchen', outside);
        const authority = await createAuthority(kitchenName, names);
        const values: Partial<Row> = { kitchenCaCert: authority.cert, kitchenCaKey: authority.key };
        if (names.length > 0) {
          const issued = await issueKitchenCertificate(authority, names);
          Object.assign(values, {
            kitchenCert: issued.cert,
            kitchenKey: issued.key,
            kitchenExpiresAt: issued.expiresAt,
          });
        }
        await save(values);
      });
    },

    /** The authority stays, so turning it back on asks no tablet to trust it again. */
    disableKitchenHttps(): Promise<void> {
      return oneAtATime(() => save({ kitchenHttps: false }));
    },

    /** Ask Let's Encrypt for the outside address. Throws CertificateFailure with their reason. */
    async enableDomainHttps(): Promise<void> {
      const domain = state.outsideDomain;
      if (!domain) throw new CertificateFailure('Set the address from outside first.');
      try {
        await save({ domainHttps: true, ...(await fetchDomainCertificate(domain)) });
      } catch (error) {
        if (error instanceof CertificateFailure) await save({ domainError: error.message });
        throw error;
      }
    },

    async disableDomainHttps(): Promise<void> {
      await save({ domainHttps: false, domainError: null });
    },

    /** Let's Encrypt's question and Mise's answer, while a certificate is being fetched. */
    challenge: (token: string) => answers.get(token) ?? null,

    /**
     * Renew what is close to running out, and fetch anew when the outside
     * address changed. A failed renewal keeps the old certificate, which
     * still has weeks left, and says why in Settings.
     */
    async renew(kitchenName: string): Promise<void> {
      await oneAtATime(async () => {
        if (row?.kitchenHttps && due(row.kitchenExpiresAt) && row.kitchenNames?.length) {
          await save(await makeKitchenCertificate(row.kitchenNames, kitchenName));
        }
      });
      const domain = state.outsideDomain;
      if (
        row?.domainHttps &&
        domain &&
        (due(row.domainExpiresAt) || row.domainCertFor !== domain)
      ) {
        try {
          await save(await fetchDomainCertificate(domain));
        } catch (error) {
          await save({ domainError: error instanceof Error ? error.message : String(error) });
        }
      }
    },
  };
}

export type ConnectionService = ReturnType<typeof createConnectionService>;
