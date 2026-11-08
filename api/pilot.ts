import { handle } from "hono/vercel";
import { createPilotApp } from "../server/pilotApp.js";

// Dedicated pilot entry is closed independently of environment flags.
// A verified cloud composition is deliberately not installed until the target exists.
export const config = { runtime: "nodejs" };
const app = createPilotApp();
export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
