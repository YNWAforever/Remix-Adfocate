import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const effects = vi.hoisted(() => ({ auth: vi.fn(() => { throw new Error("Receipt document must not load Auth"); }) }));
vi.mock("@/lib/supabase", () => { effects.auth(); return {}; });
vi.mock("@supabase/supabase-js", () => ({ createClient: effects.auth }));

let root: Root | undefined;
beforeEach(() => { vi.spyOn(window, "scrollTo").mockImplementation(() => {}); });
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  cleanup();
  root = undefined;
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetModules();
  document.body.innerHTML = "";
  document.head.querySelectorAll('meta[name="robots"], meta[name="referrer"]').forEach(node => node.remove());
  window.history.replaceState({}, "", "/");
});

it("installs privacy metadata in the head when mounting the real receipt route and root", async () => {
  const { Route: rootRoute } = await import("./__root");
  const { Route: receiptRoute } = await import("./integration-deletion.$receipt");
  const queryClient = new QueryClient();
  const child = receiptRoute.update({ id: "/integration-deletion/$receipt", path: "/integration-deletion/$receipt", getParentRoute: () => rootRoute } as never);
  const router = createRouter({ routeTree: rootRoute.addChildren([child]), context: { queryClient }, history: createMemoryHistory({ initialEntries: [`/integration-deletion/${"a".repeat(32)}`] }) });
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"status":"pending"}'));
  localStorage.setItem("lang", "en");
  render(<QueryClientProvider client={queryClient}><RouterProvider router={router}/></QueryClientProvider>);
  expect(await screen.findByRole("status")).toHaveTextContent("Pending");
  expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  expect(document.head.querySelector('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
});

it.each(["false", "true"])("mounts the actual receipt entry/root with studio=%s without Auth or account requests", async studio => {
  vi.resetModules(); effects.auth.mockClear();
  vi.stubEnv("VITE_STUDIO_SHELL", studio);
  const receipt = "a".repeat(32);
  window.history.replaceState({}, "", `/integration-deletion/${receipt}`);
  localStorage.setItem("lang", "en");
  document.body.innerHTML = '<div id="root"></div>';
  const request = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (url !== `/api/integration-notices/deletion/${receipt}`) throw new Error("Unexpected private/account request");
    expect(init).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer" });
    return new Response('{"status":"pending"}');
  });
  await act(async () => { root = await (await import("../main")).application; });
  expect(await screen.findByRole("status")).toHaveTextContent("Pending");
  await waitFor(() => {
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
    expect(document.head.querySelector('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  });
  expect(effects.auth).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("navigation")).toBeNull();
  expect(screen.queryByRole("banner")).toBeNull();
  expect(screen.queryByRole("link")).toBeNull();
  expect(document.body).not.toHaveTextContent(receipt);
});
