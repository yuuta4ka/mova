import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(String(key), String(value)); },
  };
}

// Node 26 exposes an unavailable storage stub unless a backing file is passed.
// Tests should stay hermetic and use jsdom-owned, in-memory storage instead.
const installStorage = () => {
  if (!globalThis.localStorage) Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: createMemoryStorage() });
  if (!globalThis.sessionStorage) Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, writable: true, value: createMemoryStorage() });
};

installStorage();
beforeEach(installStorage);

afterEach(() => cleanup());
