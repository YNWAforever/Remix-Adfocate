import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MissionDraft, MissionWorkItemView } from "@/lib/activeMission";
import { DraftEditor } from "./DraftEditor";
import { VersionTimeline } from "./VersionTimeline";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function draft(revision: number): MissionDraft {
  return {
    id: `draft-${revision}`,
    caption: `Draft ${revision}`,
    externalUrl: null,
    checklist: { required: true },
    revision,
    lastSavedAt: "2026-07-18T09:00:00.000Z",
  };
}

function item(id: string, revision: number, state: MissionWorkItemView["state"] = "revision_requested"): MissionWorkItemView {
  return {
    id,
    title: `Deliverable ${id}`,
    platform: "instagram",
    requirements: [{ id: "required", label: "Show the product", required: true }],
    required: true,
    position: 0,
    deadline: "2026-07-22T09:30:00.000Z",
    state,
    draft: draft(revision),
    currentSubmittedVersionId: null,
    approvedVersionId: null,
    reviewStartedAt: null,
    reviewDueAt: null,
  };
}

describe("DraftEditor race safety", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ignores an old item save settlement and starts the new item from its own revision", async () => {
    const firstSave = deferred<MissionDraft>();
    const onSave = vi.fn()
      .mockReturnValueOnce(firstSave.promise)
      .mockResolvedValueOnce(draft(8));
    const { rerender } = render(<DraftEditor item={item("A", 3)} onSave={onSave} onSubmit={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Caption or copy"), { target: { value: "A edited" } });
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ workItemId: "A", revision: 3 }));

    rerender(<DraftEditor item={item("B", 7)} onSave={onSave} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText("Caption or copy")).toHaveValue("Draft 7");
    await act(async () => firstSave.resolve(draft(4)));
    expect(screen.getByRole("status")).toHaveTextContent("Draft ready");

    fireEvent.change(screen.getByLabelText("Caption or copy"), { target: { value: "B edited" } });
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ workItemId: "B", revision: 7 }));
  });

  it("serializes submit behind the active autosave and final-saves at the updated revision", async () => {
    const autosave = deferred<MissionDraft>();
    const finalSave = deferred<MissionDraft>();
    const onSave = vi.fn()
      .mockReturnValueOnce(autosave.promise)
      .mockReturnValueOnce(finalSave.promise);
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<DraftEditor item={item("A", 3)} onSave={onSave} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Caption or copy"), { target: { value: "Final copy" } });
    await act(async () => vi.advanceTimersByTimeAsync(800));
    fireEvent.click(screen.getByRole("button", { name: "Submit version" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();

    await act(async () => autosave.resolve(draft(4)));
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ workItemId: "A", revision: 4, caption: "Final copy" }));
    expect(onSubmit).not.toHaveBeenCalled();

    await act(async () => finalSave.resolve(draft(5)));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ workItemId: "A", expectedRevision: 5 }));
  });

  it("stops submit when the active autosave fails", async () => {
    const autosave = deferred<MissionDraft>();
    const onSave = vi.fn().mockReturnValue(autosave.promise);
    const onSubmit = vi.fn();
    render(<DraftEditor item={item("A", 3)} onSave={onSave} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Caption or copy"), { target: { value: "Final copy" } });
    await act(async () => vi.advanceTimersByTimeAsync(800));
    fireEvent.click(screen.getByRole("button", { name: "Submit version" }));
    await act(async () => autosave.reject(new Error("offline")));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/still here/i);
  });

  it("resets pending submit state on item switch and ignores the old settlement", async () => {
    vi.useRealTimers();
    const oldSubmit = deferred<unknown>();
    const newSubmit = deferred<unknown>();
    const onSave = vi.fn().mockImplementation(({ workItemId }: { workItemId: string }) =>
      Promise.resolve(draft(workItemId === "A" ? 4 : 8)),
    );
    const onSubmit = vi.fn()
      .mockReturnValueOnce(oldSubmit.promise)
      .mockReturnValueOnce(newSubmit.promise);
    const { rerender } = render(<DraftEditor item={item("A", 3)} onSave={onSave} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: "Submit version" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ workItemId: "A" })));
    expect(screen.getByRole("button", { name: "Submitting…" })).toBeDisabled();

    rerender(<DraftEditor item={item("B", 7)} onSave={onSave} onSubmit={onSubmit} />);
    const newSubmitButton = screen.getByRole("button", { name: "Submit version" });
    expect(newSubmitButton).toBeEnabled();
    fireEvent.click(newSubmitButton);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ workItemId: "B" })));
    expect(screen.getByRole("button", { name: "Submitting…" })).toBeDisabled();

    await act(async () => oldSubmit.resolve(undefined));
    expect(screen.getByRole("button", { name: "Submitting…" })).toBeDisabled();
    await act(async () => newSubmit.resolve(undefined));
    expect(screen.getByRole("button", { name: "Submit version" })).toBeEnabled();
  });
});

describe("DraftEditor asset contract", () => {
  afterEach(() => vi.useRealTimers());

  it("uses the exact 20 MB MIME contract and caps existing plus local assets at five", async () => {
    const onUploadFile = vi.fn().mockResolvedValue(undefined);
    render(<DraftEditor item={item("A", 3)} onSave={vi.fn()} onSubmit={vi.fn()} onUploadFile={onUploadFile} existingAssetCount={4} />);
    const input = screen.getByLabelText("Upload draft files");
    expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm");

    const pdf = new File(["x"], "document.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [pdf] } });
    expect(screen.getByRole("alert")).toHaveTextContent("document.pdf must be an accepted file type");
    expect(onUploadFile).not.toHaveBeenCalled();

    const tooLarge = new File(["x"], "large.webp", { type: "image/webp" });
    Object.defineProperty(tooLarge, "size", { value: 20 * 1024 * 1024 + 1 });
    fireEvent.change(input, { target: { files: [tooLarge] } });
    expect(screen.getByRole("alert")).toHaveTextContent("20 MB or smaller");

    const first = new File(["a"], "first.gif", { type: "image/gif" });
    const sixth = new File(["b"], "sixth.webm", { type: "video/webm" });
    fireEvent.change(input, { target: { files: [first, sixth] } });
    await waitFor(() => expect(onUploadFile).toHaveBeenCalledTimes(1));
    expect(onUploadFile).toHaveBeenCalledWith(first);
    expect(screen.getByRole("alert")).toHaveTextContent(/five assets/i);
  });

  it("reserves a failed upload slot while allowing its retry to reuse that slot", async () => {
    const pendingUpload = new Promise<unknown>(() => undefined);
    const failed = new File(["failed"], "failed.png", { type: "image/png" });
    const onUploadFile = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation((file: File) => file === failed ? Promise.resolve() : pendingUpload);
    render(<DraftEditor item={item("A", 3)} onSave={vi.fn()} onSubmit={vi.fn()} onUploadFile={onUploadFile} />);
    const input = screen.getByLabelText("Upload draft files");

    fireEvent.change(input, { target: { files: [failed] } });
    const retry = await screen.findByRole("button", { name: "Retry failed.png" });

    const additional = ["second.png", "third.png", "fourth.png", "fifth.png", "sixth.png"]
      .map((name) => new File([name], name, { type: "image/png" }));
    fireEvent.change(input, { target: { files: additional } });

    expect(onUploadFile).toHaveBeenCalledTimes(5);
    expect(screen.queryByText("sixth.png")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/five assets/i);

    fireEvent.click(retry);
    await waitFor(() => expect(onUploadFile).toHaveBeenCalledTimes(6));
    expect(onUploadFile).toHaveBeenLastCalledWith(failed);
    expect(screen.queryByText("sixth.png")).not.toBeInTheDocument();
    expect(screen.getByText("failed.png")).toBeVisible();
  });

  it("clears the native file input immediately while uploading copied File objects", async () => {
    const attempt = deferred<unknown>();
    const onUploadFile = vi.fn().mockReturnValue(attempt.promise);
    render(<DraftEditor item={item("A", 3)} onSave={vi.fn()} onSubmit={vi.fn()} onUploadFile={onUploadFile} />);
    const input = screen.getByLabelText("Upload draft files") as HTMLInputElement;
    const file = new File(["a"], "draft.webp", { type: "image/webp" });
    Object.defineProperty(input, "value", { configurable: true, writable: true, value: "C:\\\\fakepath\\\\draft.webp" });

    fireEvent.change(input, { target: { files: [file] } });

    expect(input.value).toBe("");
    expect(onUploadFile).toHaveBeenCalledWith(file);
    await act(async () => attempt.resolve(undefined));
    expect(screen.getByText("Uploaded")).toBeVisible();
  });

  it("exposes a noninteractive upload control when the item is not editable", () => {
    render(<DraftEditor item={item("A", 3, "under_review")} onSave={vi.fn()} onSubmit={vi.fn()} onUploadFile={vi.fn()} />);
    const input = screen.getByLabelText("Upload draft files");
    const label = screen.getByText("Upload draft files");
    expect(input).toBeDisabled();
    expect(label).toHaveAttribute("aria-disabled", "true");
    expect(label).toHaveClass("pointer-events-none", "cursor-not-allowed");
    expect(label).not.toHaveClass("cursor-pointer", "hover:bg-[var(--color-paper)]");
  });

  it("ignores an older completion after the same file is reselected", async () => {
    const oldAttempt = deferred<unknown>();
    const newAttempt = deferred<unknown>();
    const onUploadFile = vi.fn()
      .mockReturnValueOnce(oldAttempt.promise)
      .mockReturnValueOnce(newAttempt.promise);
    render(<DraftEditor item={item("A", 3)} onSave={vi.fn()} onSubmit={vi.fn()} onUploadFile={onUploadFile} />);
    const input = screen.getByLabelText("Upload draft files");
    const file = new File(["a"], "draft.png", { type: "image/png" });

    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.change(input, { target: { files: [file] } });
    await act(async () => newAttempt.resolve(undefined));
    expect(screen.getByText("Uploaded")).toBeVisible();
    await act(async () => oldAttempt.reject(new Error("late failure")));
    expect(screen.getByText("Uploaded")).toBeVisible();
    expect(screen.queryByText(/Upload failed/)).not.toBeInTheDocument();
  });

  it("ignores upload completion after item switch and does not retain the successful File blob", async () => {
    const attempt = deferred<unknown>();
    const onUploadFile = vi.fn().mockReturnValue(attempt.promise);
    const { rerender } = render(<DraftEditor item={item("A", 3)} onSave={vi.fn()} onSubmit={vi.fn()} onUploadFile={onUploadFile} />);
    const file = new File(["a"], "draft.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Upload draft files"), { target: { files: [file] } });
    rerender(<DraftEditor item={item("B", 7)} onSave={vi.fn()} onSubmit={vi.fn()} onUploadFile={onUploadFile} />);
    await act(async () => attempt.resolve(undefined));
    expect(screen.queryByText("draft.png")).not.toBeInTheDocument();

    let readingBlobNameMustFail = false;
    const successful = new File(["b"], "success.webp", { type: "image/webp" });
    Object.defineProperty(successful, "name", { get: () => {
      if (readingBlobNameMustFail) throw new Error("successful File blob retained");
      return "success.webp";
    } });
    const upload = deferred<unknown>();
    onUploadFile.mockReturnValueOnce(upload.promise);
    fireEvent.change(screen.getByLabelText("Upload draft files"), { target: { files: [successful] } });
    await act(async () => upload.resolve(undefined));
    readingBlobNameMustFail = true;
    rerender(<DraftEditor item={item("B", 7)} onSave={vi.fn()} onSubmit={vi.fn()} onUploadFile={onUploadFile} />);
    expect(screen.getByText("success.webp")).toBeVisible();
    expect(screen.getByText("Uploaded")).toBeVisible();
  });

  it("disables retry after the item becomes non-editable", async () => {
    vi.useRealTimers();
    const onUploadFile = vi.fn().mockRejectedValue(new Error("offline"));
    const { rerender } = render(<DraftEditor item={item("A", 3)} onSave={vi.fn()} onSubmit={vi.fn()} onUploadFile={onUploadFile} />);
    const file = new File(["a"], "draft.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Upload draft files"), { target: { files: [file] } });
    const retry = await screen.findByRole("button", { name: "Retry draft.png" });
    rerender(<DraftEditor item={item("A", 3, "under_review")} onSave={vi.fn()} onSubmit={vi.fn()} onUploadFile={onUploadFile} />);
    expect(retry).toBeDisabled();
  });
});

describe("DraftEditor review context and reusable IDs", () => {
  it("places feedback beside its matching checkbox and displays the revision deadline", () => {
    render(<DraftEditor item={item("A", 3)} requiredChanges={[{
      id: "change-1",
      requirementId: "required",
      text: "Keep the product visible for 3 seconds",
      createdAt: "2026-07-18T08:00:00.000Z",
    }]} onSave={vi.fn()} onSubmit={vi.fn()} />);

    const checkbox = screen.getByRole("checkbox", { name: /Show the product/ });
    const requirement = checkbox.closest("li");
    expect(requirement).not.toBeNull();
    expect(requirement).toHaveTextContent("Keep the product visible for 3 seconds");
    expect(screen.getByText("Revision deadline").nextElementSibling).toHaveAttribute("datetime", "2026-07-22T09:30:00.000Z");
  });

  it("uses unique labelled headings for repeated DraftEditor and VersionTimeline instances", () => {
    const { container } = render(<>
      <DraftEditor item={item("A", 3)} onSave={vi.fn()} onSubmit={vi.fn()} />
      <DraftEditor item={item("A", 3)} onSave={vi.fn()} onSubmit={vi.fn()} />
      <VersionTimeline versions={[]} events={[]} />
      <VersionTimeline versions={[]} events={[]} />
    </>);

    const regions = Array.from(container.querySelectorAll<HTMLElement>("section[aria-labelledby]"));
    const ids = regions.map((region) => region.getAttribute("aria-labelledby"));
    expect(regions).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(container.querySelector(`#${CSS.escape(id!)}`)).not.toBeNull();
  });
});
