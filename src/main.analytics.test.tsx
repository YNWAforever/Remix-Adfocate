import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));

vi.mock("./lib/activationAnalytics", () => ({
  initializeActivationAnalytics: mocks.initialize,
}));
vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: mocks.render }) }));
vi.mock("@tanstack/react-router", () => ({ RouterProvider: () => null }));
vi.mock("@tanstack/react-query", () => ({ QueryClientProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("./router", () => ({ router: {}, queryClient: {} }));

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="root"></div>';
  mocks.initialize.mockClear();
  mocks.render.mockClear();
});

it("initializes the production activation analytics transport before rendering", async () => {
  await import("./main");
  expect(mocks.initialize).toHaveBeenCalledOnce();
  expect(mocks.initialize.mock.invocationCallOrder[0]).toBeLessThan(mocks.render.mock.invocationCallOrder[0]);
});
