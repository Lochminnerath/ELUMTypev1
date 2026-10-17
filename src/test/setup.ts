import { beforeEach } from 'vitest';

beforeEach(() => {
  globalThis.localStorage?.clear();
});
