/** Official web Picker surface only. No SDK script, HTTP transport or token cache is installed here. */
export const GOOGLE_PICKER_MIME_TYPES = ["application/vnd.google-apps.document", "text/plain", "application/pdf"] as const;
export type GooglePickerConfig = {
  stage: "D0" | "D2"; externalAccess?: boolean;
  origin: string; allowedOrigins: readonly string[];
  projectNumber: string; allowedProjectNumbers: readonly string[]; developerKey: string;
  connectionId: string; generation: number;
};
export type GooglePickerToken = {
  accessToken: string; expiresAt: string; origin: string; projectNumber: string;
  connectionId: string; generation: number; scopes: readonly string[];
};
type Picker = { setVisible(visible: boolean): void; dispose(): void };
type DocsView = {
  setMimeTypes(types: string): DocsView; setIncludeFolders(include: boolean): DocsView;
  setSelectFolderEnabled(enabled: boolean): DocsView; setEnableDrives(enabled: boolean): DocsView;
};
type PickerBuilder = {
  addView(view: DocsView): PickerBuilder; setAppId(id: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder; setOAuthToken(token: string): PickerBuilder;
  setOrigin(origin: string): PickerBuilder; setMaxItems(count: number): PickerBuilder;
  enableFeature(feature: string): PickerBuilder; setCallback(callback: (event: unknown) => void): PickerBuilder;
  build(): Picker;
};
export type GooglePickerSdk = {
  PickerBuilder: new () => PickerBuilder; DocsView: new (viewId: string) => DocsView;
  ViewId: { DOCS: string }; Feature: { MULTISELECT_ENABLED: string };
  Action: { PICKED: string; CANCEL: string }; Response: { ACTION: string; DOCUMENTS: string };
  Document: { ID: string; MIME_TYPE: string };
};
export type GooglePickerDependencies = {
  loadPicker(input: { signal: AbortSignal }): Promise<GooglePickerSdk>;
  /** Dedicated session/CSRF-protected, no-store callback; never a React Query mutation. */
  requestAccessToken(input: { connectionId: string; generation: number; signal: AbortSignal }): Promise<GooglePickerToken>;
  getOrigin?: () => string;
};
export type GooglePickerSelection = { status: "selected" | "cancelled"; fileIds: string[] };
export type GooglePickerBridge = { open(): Promise<GooglePickerSelection>; close(): void };
type ErrorCode = "PICKER_DISABLED" | "PICKER_CONFIG_INVALID" | "PICKER_TOKEN_INVALID" | "PICKER_SELECTION_INVALID" | "PICKER_BUSY" | "PICKER_UNAVAILABLE";
export class GooglePickerError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code === "PICKER_UNAVAILABLE" ? "Picker is temporarily unavailable" : code);
    this.name = "GooglePickerError";
  }
}
const fail = (code: ErrorCode): never => { throw new GooglePickerError(code); };
const record = (value: unknown): Record<string, unknown> | null => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const requiredScopes = ["https://www.googleapis.com/auth/drive.file", "openid"];

function validConfig(config: GooglePickerConfig, actualOrigin: string) {
  try {
    const url = new URL(config.origin);
    return config.origin === url.origin && url.protocol === "https:" && config.origin === actualOrigin
      && config.allowedOrigins.includes(config.origin) && /^\d+$/.test(config.projectNumber)
      && config.allowedProjectNumbers.includes(config.projectNumber) && Boolean(config.developerKey.trim())
      && Boolean(config.connectionId.trim()) && Number.isSafeInteger(config.generation) && config.generation > 0;
  } catch { return false; }
}
function validToken(token: GooglePickerToken | null, config: GooglePickerConfig) {
  return token && typeof token.accessToken === "string" && token.accessToken.length > 0
    && Number.isFinite(Date.parse(token.expiresAt)) && Date.parse(token.expiresAt) > Date.now()
    && token.origin === config.origin && token.projectNumber === config.projectNumber
    && token.connectionId === config.connectionId && token.generation === config.generation
    && Array.isArray(token.scopes) && requiredScopes.every(scope => token.scopes.includes(scope))
    && token.scopes.every(scope => requiredScopes.includes(scope));
}
function selectedIds(value: unknown, sdk: GooglePickerSdk): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 5) return fail("PICKER_SELECTION_INVALID");
  const ids = value.map(item => {
    const doc = record(item), id = doc?.[sdk.Document.ID], mime = doc?.[sdk.Document.MIME_TYPE];
    if (typeof id !== "string" || !/^[\w-]{1,256}$/.test(id) || typeof mime !== "string"
      || !(GOOGLE_PICKER_MIME_TYPES as readonly string[]).includes(mime) || doc?.driveId || doc?.isSharedDrive === true) return fail("PICKER_SELECTION_INVALID");
    return id;
  });
  if (new Set(ids).size !== ids.length) return fail("PICKER_SELECTION_INVALID");
  return ids;
}

/** Call open only from an explicit user action. D0 cannot load a provider even with externalAccess=true. */
export function createGooglePickerBridge(input: GooglePickerConfig, dependencies: GooglePickerDependencies): GooglePickerBridge {
  const config = { ...input, allowedOrigins: [...input.allowedOrigins], allowedProjectNumbers: [...input.allowedProjectNumbers] };
  let active: { close(): void } | null = null;
  return {
    close() { active?.close(); },
    open() {
      if (config.stage !== "D2" || config.externalAccess !== true) return Promise.reject(new GooglePickerError("PICKER_DISABLED"));
      if (!validConfig(config, dependencies.getOrigin?.() ?? globalThis.location?.origin ?? "")) return Promise.reject(new GooglePickerError("PICKER_CONFIG_INVALID"));
      if (active) return Promise.reject(new GooglePickerError("PICKER_BUSY"));
      return new Promise<GooglePickerSelection>((resolve, reject) => {
        const controller = new AbortController();
        let settled = false, picker: Picker | null = null, builder: PickerBuilder | null = null, token: GooglePickerToken | null = null;
        const finish = (result?: GooglePickerSelection, error?: unknown) => {
          if (settled) return;
          settled = true;
          controller.abort();
          // Disposal attempts are independent: a failed hide must not retain our token references.
          try { picker?.setVisible(false); } catch { /* Continue disposal. */ }
          try { picker?.dispose(); } catch { /* References still get cleared. */ }
          try { builder?.setOAuthToken(""); } catch { /* Discard the builder below. */ }
          token = null; picker = null; builder = null; active = null;
          if (error) reject(error instanceof GooglePickerError ? error : new GooglePickerError("PICKER_UNAVAILABLE"));
          else resolve(result ?? { status: "cancelled", fileIds: [] });
        };
        active = { close: () => finish() };
        void (async () => {
          try {
            const sdk = await dependencies.loadPicker({ signal: controller.signal });
            if (settled) return;
            token = await dependencies.requestAccessToken({ connectionId: config.connectionId, generation: config.generation, signal: controller.signal });
            if (settled) { token = null; return; }
            if (!validToken(token, config)) return fail("PICKER_TOKEN_INVALID");
            if (!validConfig(config, dependencies.getOrigin?.() ?? globalThis.location?.origin ?? "")) return fail("PICKER_CONFIG_INVALID");
            const view = new sdk.DocsView(sdk.ViewId.DOCS).setMimeTypes(GOOGLE_PICKER_MIME_TYPES.join(","))
              .setIncludeFolders(false).setSelectFolderEnabled(false).setEnableDrives(false);
            builder = new sdk.PickerBuilder().addView(view).setAppId(config.projectNumber).setDeveloperKey(config.developerKey)
              .setOrigin(config.origin).setMaxItems(5).enableFeature(sdk.Feature.MULTISELECT_ENABLED);
            builder.setOAuthToken(token!.accessToken);
            token = null;
            builder.setCallback(event => {
              if (settled) return;
              const data = record(event), action = data?.[sdk.Response.ACTION];
              if (action === sdk.Action.CANCEL) finish();
              if (action === sdk.Action.PICKED) {
                try { finish({ status: "selected", fileIds: selectedIds(data?.[sdk.Response.DOCUMENTS], sdk) }); }
                catch (error) { finish(undefined, error); }
              }
            });
            picker = builder.build();
            // An injected SDK can synchronously call its callback while building.
            if (settled) { try { picker.dispose(); } finally { picker = null; } return; }
            picker.setVisible(true);
          } catch (error) { token = null; finish(undefined, error); }
        })();
      });
    },
  };
}
