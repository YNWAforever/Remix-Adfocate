import "@testing-library/jest-dom/vitest";

// jsdom in this vitest config ships a stub localStorage ({} with no methods).
// Polyfill it with a real in-memory implementation so any code that reads/writes
// window.localStorage in components or hooks works correctly in unit tests.
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = String(value); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
})();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// Override navigator.language to "zh-HK" so i18n detection defaults to zh
// in tests (jsdom defaults to "en-US" which would flip the expected locale).
Object.defineProperty(window.navigator, "language", {
  value: "zh-HK",
  writable: true,
  configurable: true,
});
