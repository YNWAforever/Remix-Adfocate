import { handle } from "hono/vercel";
import { createPilotApp } from "../server/pilotApp.js";

export const config = { runtime: "nodejs" };

// An explicit pilot marker only closes the original runtime. No env flag admits a target.
const app = process.env.INTEGRATIONS_PILOT_STAGE !== undefined && process.env.INTEGRATIONS_PILOT_STAGE !== "D0"
  ? createPilotApp() : (await import("../server/app.js")).createApp().app;

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
