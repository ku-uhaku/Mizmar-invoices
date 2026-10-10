import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import type { Env } from '../config/env';

export type Bucket = 'assets' | 'documents';

/**
 * Object storage for logos, signatures, product images and rendered PDFs.
 *
 * Buckets are created on boot rather than by an init container, so a fresh
 * `docker compose up` needs no extra step and the API is the single place that
 * knows which buckets exist.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly buckets: Record<Bucket, string>;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.client = new S3Client({
      endpoint: config.get('S3_ENDPOINT', { infer: true }),
      region: config.get('S3_REGION', { infer: true }),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY', { infer: true }),
        secretAccessKey: config.get('S3_SECRET_KEY', { infer: true }),
      },
    });

    this.buckets = {
      assets: config.get('S3_BUCKET_ASSETS', { infer: true }),
      documents: config.get('S3_BUCKET_DOCUMENTS', { infer: true }),
    };
  }

  async onModuleInit(): Promise<void> {
    for (const bucket of Object.values(this.buckets)) {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch {
        try {
          await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
          this.logger.log(`Created bucket ${bucket}`);
        } catch (error) {
          // Not fatal: the API still serves everything that does not touch
          // storage, and the health endpoint reports storage as down.
          this.logger.warn(
            `Could not create bucket ${bucket}: ${error instanceof Error ? error.message : error}`,
          );
        }
      }
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.buckets.assets }));
      return true;
    } catch {
      return false;
    }
  }

  /** Content-addressed-ish key: organization prefix, uuid, original extension. */
  buildKey(organizationId: string, kind: string, fileName: string): string {
    const extension = fileName.includes('.') ? `.${fileName.split('.').pop()}` : '';
    return `${organizationId}/${kind.toLowerCase()}/${randomUUID()}${extension}`;
  }

  async put(
    bucket: Bucket,
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<{ key: string; byteSize: number }> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.buckets[bucket],
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return { key, byteSize: body.byteLength };
  }

  /**
   * Read an object back into memory.
   * Used to inline logos and signatures as data URIs, so a rendered PDF is
   * self-contained and Chromium needs no network to produce it.
   */
  async get(bucket: Bucket, key: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.buckets[bucket], Key: key }),
    );
    const body = result.Body;
    if (!body) throw new Error(`Object ${key} has no body`);
    return Buffer.from(await body.transformToByteArray());
  }

  /** Best effort: a leftover object is harmless, a failed request must not block the caller. */
  async delete(bucket: Bucket, key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.buckets[bucket], Key: key }));
    } catch (error) {
      this.logger.warn(`Could not delete ${key}: ${error instanceof Error ? error.message : error}`);
    }
  }

  async exists(bucket: Bucket, key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.buckets[bucket], Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Time-limited download URL.
   * Presigning rather than proxying keeps large PDFs off the API process.
   */
  async signedUrl(
    bucket: Bucket,
    key: string,
    options: { expiresInSeconds?: number; downloadName?: string } = {},
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.buckets[bucket],
      Key: key,
      ResponseContentDisposition: options.downloadName
        ? `attachment; filename="${options.downloadName.replace(/"/g, '')}"`
        : undefined,
    });
    return getSignedUrl(this.client, command, {
      expiresIn: options.expiresInSeconds ?? 900,
    });
  }
}
