declare const __MISE_VERSION__: string | undefined;

/**
 * Which Mise this is. Stamped in at build time from the root package.json, so
 * the published image always knows its own version. Run through npm in
 * development, npm supplies it instead.
 */
export const VERSION =
  typeof __MISE_VERSION__ === 'string'
    ? __MISE_VERSION__
    : (process.env.npm_package_version ?? 'dev');

/** Whether this is a release build, stamped with its version, rather than development. */
export const BUILT = typeof __MISE_VERSION__ === 'string';

/**
 * Whether an app may load ahead from this server: only the same release, in
 * a release build. A tablet left open on an older app works out allergens
 * and cards with its own copy of the code, and the server only checks its
 * own; after an update the two could differ without anyone seeing it.
 */
export function sameRelease(app: string | undefined, server = VERSION, built = BUILT): boolean {
  return !built || app === server;
}
