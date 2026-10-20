declare const __MISE_VERSION__: string;
declare const __MISE_SOURCE__: string;

/** Stamped in at build time from the root package.json. */
export const VERSION = __MISE_VERSION__;

/**
 * Where the source lives. Mise is AGPL: anyone using it over a network is
 * entitled to the code, so it is offered on screen rather than buried.
 */
export const SOURCE_URL = __MISE_SOURCE__;
