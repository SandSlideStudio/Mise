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
