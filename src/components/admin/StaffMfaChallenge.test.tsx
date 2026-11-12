import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  listFactors: vi.fn(),
  enroll: vi.fn(),
  challenge: vi.fn(),
  verify: vi.fn(),
  unenroll: vi.fn(),
  refreshSession: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      mfa: { listFactors: h.listFactors, enroll: h.enroll, challenge: h.challenge, verify: h.verify, unenroll: h.unenroll },
      refreshSession: h.refreshSession,
    },
  },
}));
vi.mock("@/lib/i18n", async () => {
  const { dict } = await import("@/lib/i18n.dict");
  return { useI18n: () => ({ lang: "en", t: (key: string) => dict.en[key] ?? key }) };
});

import { StaffMfaChallenge } from "./StaffMfaChallenge";

beforeEach(() => {
  vi.clearAllMocks();
  h.unenroll.mockResolvedValue({ error: null });
  h.refreshSession.mockResolvedValue({});
  h.challenge.mockResolvedValue({ data: { id: "c1" }, error: null });
  h.verify.mockResolvedValue({ data: {}, error: null });
});

describe("StaffMfaChallenge", () => {
  it("enrols TOTP on first use and verifies the code", async () => {
    h.listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
    h.enroll.mockResolvedValue({
      data: { id: "f1", totp: { qr_code: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", secret: "SECRET123" } },
      error: null,
    });
    const onVerified = vi.fn();
    render(<StaffMfaChallenge onVerified={onVerified} signOut={vi.fn()} />);

    expect(await screen.findByAltText("MFA enrollment QR code")).toBeInTheDocument();
    expect(screen.getByText("SECRET123")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => expect(h.verify).toHaveBeenCalledWith({ factorId: "f1", challengeId: "c1", code: "123456" }));
    expect(h.refreshSession).toHaveBeenCalledOnce();
    expect(onVerified).toHaveBeenCalledOnce();
  });

  it("challenges an existing verified factor without re-enrolling", async () => {
    h.listFactors.mockResolvedValue({ data: { totp: [{ id: "f9", status: "verified" }] }, error: null });
    const onVerified = vi.fn();
    render(<StaffMfaChallenge onVerified={onVerified} signOut={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText("6-digit code"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => expect(h.verify).toHaveBeenCalledWith({ factorId: "f9", challengeId: "c1", code: "654321" }));
    expect(h.enroll).not.toHaveBeenCalled();
    expect(onVerified).toHaveBeenCalledOnce();
  });

  it("rejects malformed codes before calling Supabase", async () => {
    h.listFactors.mockResolvedValue({ data: { totp: [{ id: "f9", status: "verified" }] }, error: null });
    render(<StaffMfaChallenge onVerified={vi.fn()} signOut={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText("6-digit code"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter the current 6-digit code.");
    expect(h.challenge).not.toHaveBeenCalled();
  });
});
