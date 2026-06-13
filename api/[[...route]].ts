import { handle } from "hono/vercel";
import { createApp } from "./app";

export const config = { runtime: "nodejs" };

const { app } = createApp();

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
