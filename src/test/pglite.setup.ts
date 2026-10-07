// Boots the test file's PGlite before its first test, so no test's timeout pays for the boot:
// about a second alone, three to four while the other files boot theirs.
import { beforeAll } from 'vitest';
import { pgliteTestStore } from '../infra/postgres/testing.ts';

beforeAll(async () => {
  await pgliteTestStore();
});
