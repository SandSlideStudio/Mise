import { z } from 'zod';

/**
 * Configuration comes entirely from the environment, because the admin running
 * this server sets it once in a .env file next to the compose file and never
 * touches the application again.
 */

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SESSION_SECRET: z
    .string()
    .min(
      32,
      "SESSION_SECRET must be at least 32 characters. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    ),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  UPLOAD_DIR: z.string().default('./data/uploads'),
  /** Where nightly backups are kept on this machine. */
  BACKUP_DIR: z.string().default('./data/backups'),
  /**
   * The app Mise is registered as with Microsoft, for OneDrive backups. Not a
   * secret. Replace it to use an app registered in your own Microsoft account.
   */
  ONEDRIVE_CLIENT_ID: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().default('f9dce6ed-01b8-49d0-a3cf-c9e8953f552d'),
  ),
  /**
   * How many reverse proxies sit in front of Mise, so the client's address is
   * read from X-Forwarded-For. Off by default: anyone can send that header, and
   * believing it lets a caller dodge the sign-in rate limits.
   */
  TRUST_PROXY: z
    .string()
    .default('false')
    .transform((v, ctx) => {
      if (v === 'false' || v === '0' || v === '') return false;
      if (v === 'true') return 1;
      const hops = Number(v);
      if (Number.isInteger(hops) && hops > 0) return hops;
      ctx.addIssue({ code: 'custom', message: 'Use false, true, or a number of proxies' });
      return z.NEVER;
    }),
  /**
   * The one-time code that first-run setup asks for in production, so a fresh
   * server can't be claimed by whoever finds it first. The installer sets it;
   * if it's missing, the server makes one up and prints the setup link.
   */
  // An empty SETUP_TOKEN= line in .env counts as not set.
  SETUP_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(16).optional()),
  /** Where the built client lives. Served as static files from the same origin. */
  CLIENT_DIR: z.string().default('../Client/dist'),
});

export type Config = z.infer<typeof configSchema>;

/** The placeholder the example .env files ship with. Never valid in production. */
const EXAMPLE_SECRET = 'change-me';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }

  // A kitchen that copied the example file and started the server would be
  // signing cookies with a secret printed on the internet. Refuse, loudly.
  if (parsed.data.NODE_ENV === 'production') {
    const leftovers = (['SESSION_SECRET', 'DATABASE_URL'] as const).filter((key) =>
      parsed.data[key].includes(EXAMPLE_SECRET),
    );
    if (leftovers.length > 0) {
      const lines = leftovers.map(
        (key) => `  ${key}: still holds the example value. Set your own in .env.`,
      );
      throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
    }
  }

  return parsed.data;
}
