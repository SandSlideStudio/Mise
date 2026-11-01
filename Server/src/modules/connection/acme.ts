import * as acme from 'acme-client';

/**
 * A free certificate for the kitchen's own domain, from Let's Encrypt.
 *
 * The HTTP check: Let's Encrypt asks for a file under /.well-known/acme-challenge
 * on port 80 of the domain, the router passes port 80 on to Mise, and Mise
 * answers with the token held here. No email address: Let's Encrypt no longer
 * sends expiry mail, and Mise renews by itself a month ahead.
 */

export const LETS_ENCRYPT = acme.directory.letsencrypt.production;

export interface IssuedCertificate {
  cert: string;
  key: string;
  expiresAt: Date;
  accountKey: string;
}

/** Tokens Let's Encrypt will ask for, and what to answer. */
export type ChallengeAnswers = Map<string, string>;

/** Longer than Let's Encrypt ever takes when things work. */
const GIVE_UP_MS = 120_000;

export async function issueDomainCertificate(options: {
  domain: string;
  accountKey: string | null;
  directoryUrl: string;
  answers: ChallengeAnswers;
}): Promise<IssuedCertificate> {
  const accountKey = options.accountKey ?? (await acme.crypto.createPrivateEcdsaKey()).toString();
  const client = new acme.Client({ directoryUrl: options.directoryUrl, accountKey });
  const [key, csr] = await acme.crypto.createCsr(
    { commonName: options.domain },
    await acme.crypto.createPrivateEcdsaKey(),
  );
  let timer: NodeJS.Timeout | undefined;
  const giveUp = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            'Let’s Encrypt did not finish within two minutes. Check that port 80 reaches Mise, then try again.',
          ),
        ),
      GIVE_UP_MS,
    );
  });
  const ordered = client.auto({
    csr,
    termsOfServiceAgreed: true,
    challengePriority: ['http-01'],
    // Don't first try the domain from here: a home router often can't reach
    // its own public address from inside, and that test would fail (or hang)
    // where Let's Encrypt's own check, from outside, succeeds.
    skipChallengeVerification: true,
    challengeCreateFn: async (_authz, challenge, keyAuthorization) => {
      options.answers.set(challenge.token, keyAuthorization);
    },
    challengeRemoveFn: async (_authz, challenge) => {
      options.answers.delete(challenge.token);
    },
  });
  const cert = await Promise.race([ordered, giveUp]).finally(() => clearTimeout(timer));
  return {
    cert,
    key: key.toString(),
    expiresAt: acme.crypto.readCertificateInfo(cert).notAfter,
    accountKey,
  };
}

/** Let's Encrypt's own words, trimmed of the protocol around them. */
export function acmeReason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^.*?urn:ietf:params:acme:error:\w+\s*-?\s*/s, '').slice(0, 500);
}
