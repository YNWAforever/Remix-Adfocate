import { Hono, type Context } from "hono";
import type { Env } from "../app.js";
import { ProfileMediaError, ownedAvatarPath, validateAvatarUpload } from "../lib/profileMedia/service.js";
import { PROFILE_MEDIA_BUCKET } from "../lib/profileMedia/types.js";
import {
  createProfileMediaLink,
  deleteProfileMediaLink,
  getProfileMedia,
  publishProfileMedia,
  selectUploadedAvatar,
  updateProfileMediaLink,
} from "../lib/profileMedia/repo.js";
import { serviceClient } from "../lib/supabase.js";
import { dbError } from "../lib/httpErrors.js";

export const profileMediaRoutes = new Hono<Env>();

function errorResponse(c: Context<Env>, error: unknown) {
  if (error instanceof ProfileMediaError) {
    if (error.code === "db_error") return dbError(c, error, "db_error", 500);
    return c.json({ error: error.message, code: error.code }, error.code === "not_found" ? 404 : 400);
  }
  const message = error instanceof Error ? error.message : "Profile media request failed";
  return dbError(c, { message }, "db_error", 500);
}

profileMediaRoutes.get("/", async (c) => {
  try {
    return c.json(await getProfileMedia(serviceClient(), c.get("userId")));
  } catch (error) {
    return errorResponse(c, error);
  }
});

profileMediaRoutes.post("/avatar-upload", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const request = validateAvatarUpload({
      fileName: body.fileName,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
    });
    const path = ownedAvatarPath(c.get("userId"), request.extension);
    const { data } = serviceClient().storage.from(PROFILE_MEDIA_BUCKET).getPublicUrl(path);
    return c.json({
      bucket: PROFILE_MEDIA_BUCKET,
      path,
      publicUrl: data.publicUrl,
      contentType: request.contentType,
      maxSizeBytes: 5_242_880,
    });
  } catch (error) {
    return errorResponse(c, error);
  }
});

profileMediaRoutes.post("/avatar-select", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const avatarUrl = await selectUploadedAvatar(serviceClient(), {
      creatorId: c.get("userId"),
      storagePath: body.storagePath,
    });
    return c.json({ avatarUrl });
  } catch (error) {
    return errorResponse(c, error);
  }
});

profileMediaRoutes.post("/portfolio", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const link = await createProfileMediaLink(serviceClient(), {
      creatorId: c.get("userId"),
      workspaceId: c.get("workspaceId"),
      url: body.url,
      title: body.title,
      platformType: body.platform_type,
      caption: body.caption,
      sortOrder: body.sort_order,
      publicHighlight: body.public_highlight,
    });
    return c.json({ link });
  } catch (error) {
    return errorResponse(c, error);
  }
});

profileMediaRoutes.patch("/portfolio/:id", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const link = await updateProfileMediaLink(serviceClient(), {
      creatorId: c.get("userId"),
      linkId: c.req.param("id"),
      patch: body,
    });
    return c.json({ link });
  } catch (error) {
    return errorResponse(c, error);
  }
});

profileMediaRoutes.delete("/portfolio/:id", async (c) => {
  try {
    await deleteProfileMediaLink(serviceClient(), c.get("userId"), c.req.param("id"));
    return c.json({ deleted: true });
  } catch (error) {
    return errorResponse(c, error);
  }
});

profileMediaRoutes.post("/publish", async (c) => {
  try {
    const published = await publishProfileMedia(serviceClient(), c.get("userId"));
    return c.json({ published });
  } catch (error) {
    return errorResponse(c, error);
  }
});
