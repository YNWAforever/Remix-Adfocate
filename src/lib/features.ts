/**
 * Login-method feature flags. Each method's auth provider must be configured in
 * the dashboards first (see docs/deployment-config-runbook.md) — so both default
 * OFF, and a stage-1 deploy shows only the always-available email magic-link.
 * Flip a flag on (Vercel env `VITE_ENABLE_WHATSAPP` / `VITE_ENABLE_GOOGLE` = "true",
 * then redeploy) once that provider is live.
 */
export const WHATSAPP_LOGIN = import.meta.env.VITE_ENABLE_WHATSAPP === "true";
export const GOOGLE_LOGIN = import.meta.env.VITE_ENABLE_GOOGLE === "true";
