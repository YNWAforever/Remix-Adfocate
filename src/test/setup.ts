import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/dom";
import { afterEach } from "vitest";

// Exclude <option> elements from getByText queries so that closed <select> option
// text doesn't conflict with visible badge/label text in the same component.
configure({ defaultIgnore: "script, style, option" });

// jsdom does not implement IntersectionObserver. Polyfill with a no-op class so
// components that call `new IntersectionObserver(...)` in useEffect can mount in
// unit/smoke tests without throwing.
if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = class IntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  } as unknown as typeof IntersectionObserver;
}

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

// Reset the shared in-memory store between tests so locale/state seeded by one
// test (e.g. localStorage.setItem("lang", …)) never leaks into the next.
afterEach(() => {
  localStorageMock.clear();
});
