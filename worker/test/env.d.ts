import type { D1Migration } from '@cloudflare/workers-types/experimental';
import type { Env } from '../src/types.js';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}
