import { randomUUID } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import sharp from "sharp";
import type { Env } from "../../config/env.js";
import type { Database } from "../../db/client.js";
import { HttpError } from "../../shared/errors.js";
export interface UploadInput {
  contentType: "image/jpeg" | "image/png" | "image/webp";
  sizeBytes: number;
  alt: string;
}
export async function normalizeImage(bytes: Buffer, expectedType: string) {
  const image = sharp(bytes, {
    limitInputPixels: 16000000,
    animated: false,
    failOn: "warning",
  });
  const metadata = await image.metadata();
  const formats: Record<string, string> = {
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };
  if (
    formats[metadata.format ?? ""] !== expectedType ||
    (metadata.pages ?? 1) > 1
  )
    throw new HttpError(
      400,
      "invalid_image",
      "Upload a non-animated JPEG, PNG or WebP matching its declared type.",
    );
  return image
    .rotate()
    .resize({
      width: 2400,
      height: 2400,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
}
export class MediaService {
  private client: S3Client | null;
  constructor(
    private db: Database,
    private env: Env,
  ) {
    this.client = env.R2_ACCOUNT_ID
      ? new S3Client({
          region: "auto",
          endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
          credentials: {
            accessKeyId: env.R2_ACCESS_KEY_ID!,
            secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
          },
          maxAttempts: 2,
          requestHandler: { requestTimeout: 15000, connectionTimeout: 5000 },
        })
      : null;
  }
  private storage() {
    if (!this.client)
      throw new HttpError(
        503,
        "storage_not_configured",
        "Object storage is not configured.",
      );
    return this.client;
  }
  async presign(input: UploadInput) {
    const client = this.storage(),
      id = randomUUID(),
      key = `incoming/${id}`;
    const url = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: this.env.R2_PRIVATE_BUCKET!,
        Key: key,
        ContentType: input.contentType,
        ContentLength: input.sizeBytes,
      }),
      { expiresIn: 300 },
    );
    await this.db.query(
      "INSERT INTO media(id,object_key,content_type,expected_bytes,alt) VALUES($1,$2,$3,$4,$5)",
      [id, key, input.contentType, input.sizeBytes, input.alt],
    );
    return {
      id,
      uploadUrl: url,
      method: "PUT",
      headers: { "Content-Type": input.contentType },
      expiresInSeconds: 300,
    };
  }
  async complete(id: string) {
    const client = this.storage();
    const { rows } = await this.db.query<{
      object_key: string;
      content_type: string;
      expected_bytes: number;
    }>(
      "UPDATE media SET status='processing' WHERE id=$1 AND status='pending' AND created_at>NOW()-INTERVAL '15 minutes' RETURNING object_key,content_type,expected_bytes",
      [id],
    );
    const row = rows[0];
    if (!row)
      throw new HttpError(
        409,
        "upload_unavailable",
        "Upload expired or has already been processed.",
      );
    let publicKey: string | undefined;
    try {
      const object = await client.send(
        new GetObjectCommand({
          Bucket: this.env.R2_PRIVATE_BUCKET!,
          Key: row.object_key,
        }),
        { abortSignal: AbortSignal.timeout(20000) },
      );
      if (
        !object.Body ||
        object.ContentLength !== row.expected_bytes ||
        object.ContentLength > 5242880
      ) {
        object.Body?.transformToWebStream().cancel();
        throw new HttpError(
          400,
          "invalid_image",
          "Image size differs from the upload request.",
        );
      }
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
        length += chunk.length;
        if (length > 5242880)
          throw new HttpError(413, "image_too_large", "Image exceeds 5 MiB.");
        chunks.push(Buffer.from(chunk));
      }
      if (length !== row.expected_bytes)
        throw new HttpError(400, "invalid_image", "Incomplete image upload.");
      const output = await normalizeImage(
        Buffer.concat(chunks),
        row.content_type,
      );
      publicKey = `images/${id}.webp`;
      await client.send(
        new PutObjectCommand({
          Bucket: this.env.R2_PUBLIC_BUCKET!,
          Key: publicKey,
          Body: output.data,
          ContentType: "image/webp",
          CacheControl: "public, max-age=31536000, immutable",
        }),
        { abortSignal: AbortSignal.timeout(20000) },
      );
      await this.db.query(
        "UPDATE media SET status='ready',public_key=$2,width=$3,height=$4 WHERE id=$1",
        [id, publicKey, output.info.width, output.info.height],
      );
      await client
        .send(
          new DeleteObjectCommand({
            Bucket: this.env.R2_PRIVATE_BUCKET!,
            Key: row.object_key,
          }),
        )
        .catch(() => undefined);
      return {
        id,
        url: `${this.env.R2_PUBLIC_URL!.replace(/\/$/, "")}/${publicKey}`,
        width: output.info.width,
        height: output.info.height,
      };
    } catch (error) {
      if (publicKey)
        await client
          .send(
            new DeleteObjectCommand({
              Bucket: this.env.R2_PUBLIC_BUCKET!,
              Key: publicKey,
            }),
          )
          .catch(() => undefined);
      await this.db.query("UPDATE media SET status='failed' WHERE id=$1", [id]);
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        422,
        "image_processing_failed",
        "Could not verify this image. Request a new upload.",
      );
    }
  }
}
