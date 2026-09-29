import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

// Both src/config and dist/config sit at the same depth. Load the repository's
// .env before imports that read environment variables at module initialization.
const envFile = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(envFile)) loadEnvFile(envFile);
