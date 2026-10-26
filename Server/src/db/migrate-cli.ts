import { loadConfig } from '../config.js';
import { runMigrations } from './migrate.js';

/**
 * npm run db:migrate. A file of its own, because the server bundles
 * migrate.ts into index.js, where a "was I run directly?" check is always true
 * and every start would migrate twice.
 */
const config = loadConfig();
await runMigrations(config.DATABASE_URL);
console.log('Migrations applied.');
