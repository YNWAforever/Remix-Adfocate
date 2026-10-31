import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { IntegrationConnection } from "@/lib/integrations/types";
import { DriveSourcePicker } from "./DriveSourcePicker";

vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ lang: "en" }) }));
afterEach(cleanup);
it("never opens an injected live Picker in D0 and releases it when its owner closes", () => {
  const connection: IntegrationConnection = { id: "fixture-live-shape", provider: "google_drive", label: "Sample boundary", status: "connected", scopes: ["https://www.googleapis.com/auth/drive.file", "openid"], sampleOnly: false, generation: 1, expiresAt: "2099-01-01T00:00:00Z", lastError: null, lastSyncAt: null, providerRevocation: "not_requested" };
  const officialPicker = { open: vi.fn(), close: vi.fn() }, onCancel = vi.fn(), onSelected = vi.fn();
  const view = render(<DriveSourcePicker connection={connection} officialPicker={officialPicker} onCancel={onCancel} onSelected={onSelected} />);
  expect(screen.getByRole("note", { name: "D0 offline verification" })).toBeVisible();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(officialPicker.open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onCancel).toHaveBeenCalledOnce();
  expect(onSelected).not.toHaveBeenCalled();
  view.unmount();
  expect(officialPicker.close).toHaveBeenCalledOnce();
});
