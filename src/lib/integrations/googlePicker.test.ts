import { afterEach, describe, expect, it, vi } from "vitest";
import { createGooglePickerBridge, type GooglePickerConfig, type GooglePickerDependencies, type GooglePickerSdk } from "./googlePicker";

// Deliberately synthetic. No Google SDK, credentials, provider requests or browser storage.
const tokenFixture = "synthetic";
const config: GooglePickerConfig = {
  stage: "D2", externalAccess: true, origin: "https://pilot.example.test", allowedOrigins: ["https://pilot.example.test"],
  projectNumber: "1234567890", allowedProjectNumbers: ["1234567890"], developerKey: "synthetic-public-key",
  connectionId: "sample-connection", generation: 1,
};
function setup(overrides: Partial<GooglePickerConfig> = {}) {
  let callback: (event: unknown) => void = () => {};
  const picker = { setVisible: vi.fn(), dispose: vi.fn() };
  const builder = {
    addView: vi.fn().mockReturnThis(), setAppId: vi.fn().mockReturnThis(), setDeveloperKey: vi.fn().mockReturnThis(),
    setOAuthToken: vi.fn().mockReturnThis(), setOrigin: vi.fn().mockReturnThis(), setMaxItems: vi.fn().mockReturnThis(),
    enableFeature: vi.fn().mockReturnThis(), setCallback: vi.fn((cb: typeof callback) => { callback = cb; return builder; }), build: vi.fn(() => picker),
  };
  const view = { setMimeTypes: vi.fn().mockReturnThis(), setIncludeFolders: vi.fn().mockReturnThis(), setSelectFolderEnabled: vi.fn().mockReturnThis(), setEnableDrives: vi.fn().mockReturnThis() };
  const sdk = { PickerBuilder: vi.fn(function () { return builder; }), DocsView: vi.fn(function () { return view; }),
    ViewId: { DOCS: "all-docs" }, Feature: { MULTISELECT_ENABLED: "multi" }, Action: { PICKED: "picked", CANCEL: "cancel" },
    Response: { ACTION: "action", DOCUMENTS: "docs" }, Document: { ID: "id", MIME_TYPE: "mimeType" },
  } as unknown as GooglePickerSdk;
  const receipt = { accessToken: tokenFixture, expiresAt: "2099-01-01T00:00:00Z", origin: config.origin, projectNumber: config.projectNumber, connectionId: config.connectionId, generation: 1, scopes: ["https://www.googleapis.com/auth/drive.file", "openid"] };
  const dependencies = { loadPicker: vi.fn<GooglePickerDependencies["loadPicker"]>(async () => sdk), requestAccessToken: vi.fn<GooglePickerDependencies["requestAccessToken"]>(async () => ({ ...receipt })), getOrigin: () => config.origin };
  const bridge = createGooglePickerBridge({ ...config, ...overrides }, dependencies);
  return { bridge, dependencies, receipt, picker, builder, view, emit: (event: unknown) => callback(event) };
}
afterEach(() => vi.unstubAllGlobals());

describe("injected official web Picker bridge", () => {
  it.each([{ stage: "D0", externalAccess: false }, { stage: "D0", externalAccess: true }, { externalAccess: false }, { externalAccess: undefined }] as const)("fails closed before any dependency is touched for %j", async options => {
    const { bridge, dependencies } = setup(options);
    await expect(bridge.open()).rejects.toMatchObject({ code: "PICKER_DISABLED" });
    expect(dependencies.loadPicker).not.toHaveBeenCalled();
    expect(dependencies.requestAccessToken).not.toHaveBeenCalled();
  });

  it.each([
    { origin: "https://attacker.example.test" }, { origin: "https://pilot.example.test/path" }, { origin: "http://pilot.example.test" },
    { projectNumber: "99999999" }, { allowedOrigins: [] }, { allowedProjectNumbers: [] }, { developerKey: "" },
  ])("rejects unapproved origin/project configuration before loading (%j)", async options => {
    const { bridge, dependencies } = setup(options);
    await expect(bridge.open()).rejects.toMatchObject({ code: "PICKER_CONFIG_INVALID" });
    expect(dependencies.loadPicker).not.toHaveBeenCalled();
    expect(dependencies.requestAccessToken).not.toHaveBeenCalled();
  });

  it("does nothing on construction, uses a file selection view without upload, and returns only candidate IDs", async () => {
    const network = vi.fn(() => { throw new Error("No network in this test"); }); vi.stubGlobal("fetch", network);
    const { bridge, dependencies, builder, picker, view, emit } = setup();
    expect(dependencies.loadPicker).not.toHaveBeenCalled();
    const result = bridge.open();
    await vi.waitFor(() => expect(picker.setVisible).toHaveBeenCalledWith(true));
    expect(builder.setAppId).toHaveBeenCalledWith(config.projectNumber);
    expect(builder.setOrigin).toHaveBeenCalledWith(config.origin);
    expect(builder.setMaxItems).toHaveBeenCalledWith(5);
    expect(builder.addView).toHaveBeenCalledOnce();
    expect(builder.addView).toHaveBeenCalledWith(view);
    expect(view.setIncludeFolders).toHaveBeenCalledWith(false);
    expect(view.setSelectFolderEnabled).toHaveBeenCalledWith(false);
    expect(view.setEnableDrives).toHaveBeenCalledWith(false);
    expect(view.setMimeTypes).toHaveBeenCalledWith("application/vnd.google-apps.document,text/plain,application/pdf");
    emit({ action: "picked", docs: [{ id: "sample-doc", mimeType: "text/plain", title: "UNTRUSTED TITLE", owner: "someone", canDownload: true, rights: "owned" }] });
    await expect(result).resolves.toEqual({ status: "selected", fileIds: ["sample-doc"] });
    expect(builder.setOAuthToken).toHaveBeenLastCalledWith("");
    expect(picker.dispose).toHaveBeenCalledOnce();
    expect(network).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it.each([
    [], Array.from({ length: 6 }, (_, i) => ({ id: `doc-${i}`, mimeType: "text/plain" })),
    [{ id: "same", mimeType: "text/plain" }, { id: "same", mimeType: "text/plain" }],
    [{ id: "https://attacker.example.test", mimeType: "text/plain" }], [{ id: "doc", mimeType: "application/vnd.google-apps.folder" }],
    [{ id: "doc", mimeType: "application/vnd.google-apps.shortcut" }], [{ id: "doc", mimeType: "text/plain", driveId: "shared-drive" }],
  ].map(docs => ({ docs })))("rejects invalid selections and disposes the token-bearing picker (%j)", async ({ docs }) => {
    const { bridge, picker, builder, emit } = setup();
    const promise = bridge.open();
    const result = expect(promise).rejects.toMatchObject({ code: "PICKER_SELECTION_INVALID" });
    await vi.waitFor(() => expect(picker.setVisible).toHaveBeenCalledWith(true));
    emit({ action: "picked", docs }); await result;
    expect(builder.setOAuthToken).toHaveBeenLastCalledWith("");
    expect(picker.dispose).toHaveBeenCalledOnce();
  });

  it.each([
    { projectNumber: "other-project" }, { connectionId: "other-connection" }, { generation: 2 },
    { origin: "https://attacker.example.test" }, { expiresAt: "2000-01-01T00:00:00Z" },
    { scopes: ["https://www.googleapis.com/auth/drive"] }, { accessToken: "" },
  ])("rejects mismatched or expired token receipts without building a picker (%j)", async change => {
    const { bridge, dependencies, receipt, builder } = setup();
    dependencies.requestAccessToken.mockResolvedValue({ ...receipt, ...change });
    await expect(bridge.open()).rejects.toMatchObject({ code: "PICKER_TOKEN_INVALID" });
    expect(builder.setOAuthToken).not.toHaveBeenCalledWith(tokenFixture);
    expect(builder.build).not.toHaveBeenCalled();
  });

  it("cancels during token acquisition, aborts the request and ignores the late token", async () => {
    const { bridge, dependencies, receipt, builder } = setup();
    let finish!: (value: typeof receipt) => void;
    dependencies.requestAccessToken.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const result = bridge.open();
    await vi.waitFor(() => expect(dependencies.requestAccessToken).toHaveBeenCalledOnce());
    bridge.close();
    await expect(result).resolves.toEqual({ status: "cancelled", fileIds: [] });
    expect(dependencies.requestAccessToken.mock.calls[0][0].signal.aborted).toBe(true);
    finish(receipt); await Promise.resolve();
    expect(builder.build).not.toHaveBeenCalled();
  });

  it("disposes on cancel and ignores late callbacks; reopening obtains a fresh access token", async () => {
    const { bridge, dependencies, picker, builder, emit } = setup();
    const first = bridge.open();
    await vi.waitFor(() => expect(picker.setVisible).toHaveBeenCalledWith(true));
    emit({ action: "cancel" });
    await expect(first).resolves.toEqual({ status: "cancelled", fileIds: [] });
    emit({ action: "picked", docs: [{ id: "late", mimeType: "text/plain" }] });
    expect(builder.setOAuthToken).toHaveBeenLastCalledWith("");
    const second = bridge.open();
    await vi.waitFor(() => expect(dependencies.requestAccessToken).toHaveBeenCalledTimes(2));
    bridge.close();
    await expect(second).resolves.toEqual({ status: "cancelled", fileIds: [] });
  });

  it("sanitizes injected loader/token failures instead of leaking diagnostics or tokens", async () => {
    const { bridge, dependencies } = setup();
    dependencies.requestAccessToken.mockRejectedValue(new Error(`private diagnostic ${tokenFixture}`));
    await expect(bridge.open()).rejects.toMatchObject({ code: "PICKER_UNAVAILABLE", message: "Picker is temporarily unavailable" });
  });
});
