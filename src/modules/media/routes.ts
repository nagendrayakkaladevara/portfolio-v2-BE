import { Router } from "express";
import { z } from "zod";
import type { MediaService } from "./service.js";
export const uploadSchema = z.strictObject({
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z.number().int().min(1).max(5242880),
  alt: z.string().trim().min(1).max(250),
});
export function mediaRoutes(service: MediaService) {
  const router = Router();
  router.post("/uploads", async (req, res) =>
    res
      .status(201)
      .json({ data: await service.presign(uploadSchema.parse(req.body)) }),
  );
  router.post("/:id/complete", async (req, res) => {
    z.strictObject({}).parse(req.body);
    res.json({ data: await service.complete(z.uuid().parse(req.params.id)) });
  });
  return router;
}
