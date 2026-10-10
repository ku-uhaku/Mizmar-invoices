import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { RequestContext } from '../tenancy/request-context';

/** Largest picture accepted, and how many a product may carry. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGES_PER_PRODUCT = 10;

export const assetUrl = (assetId: string) => `/api/v1/catalog/assets/${assetId}/file`;

type ImageType = { contentType: string; extension: string };

/**
 * What the bytes actually are. The browser's reported type is only a hint a
 * user (or attacker) controls, so the file signature decides. SVG is refused on
 * purpose: it can carry script and is served from our own origin.
 */
export function sniffImage(bytes: Buffer): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: 'image/jpeg', extension: 'jpg' };
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { contentType: 'image/png', extension: 'png' };
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { contentType: 'image/webp', extension: 'webp' };
  }
  return null;
}

export interface IncomingImage {
  fileName: string;
  bytes: Buffer;
}

@Injectable()
export class ProductImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Store pictures and append them to the product's gallery. */
  async add(ctx: RequestContext, productId: string, files: IncomingImage[]) {
    const product = await this.productOrThrow(ctx, productId);
    if (files.length === 0) throw AppError.badRequest('NO_FILE', 'Choose at least one image');

    const existing = await this.prisma.productImage.count({ where: { productId: product.id } });
    if (existing + files.length > MAX_IMAGES_PER_PRODUCT) {
      throw AppError.unprocessable(
        'TOO_MANY_IMAGES',
        `A product can have at most ${MAX_IMAGES_PER_PRODUCT} images`,
        { max: MAX_IMAGES_PER_PRODUCT, existing },
      );
    }

    // Validate everything before storing anything, so a bad file leaves no half-upload.
    const checked = files.map((file) => {
      const type = sniffImage(file.bytes);
      if (!type) {
        throw AppError.unprocessable(
          'UNSUPPORTED_IMAGE',
          `${file.fileName} is not a JPEG, PNG or WebP image`,
        );
      }
      if (file.bytes.byteLength > MAX_IMAGE_BYTES) {
        throw AppError.unprocessable('IMAGE_TOO_LARGE', `${file.fileName} is larger than 8 MB`);
      }
      return { file, type };
    });

    const last = await this.prisma.productImage.findFirst({
      where: { productId: product.id },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    let sortOrder = (last?.sortOrder ?? -1) + 1;

    for (const { file, type } of checked) {
      const key = this.storage.buildKey(ctx.organizationId, 'PRODUCT_IMAGE', `image.${type.extension}`);
      await this.storage.put('assets', key, file.bytes, type.contentType);
      await this.prisma.asset.create({
        data: {
          organizationId: ctx.organizationId,
          kind: 'PRODUCT_IMAGE',
          storageKey: key,
          fileName: file.fileName.slice(0, 200),
          contentType: type.contentType,
          byteSize: file.bytes.byteLength,
          productImages: { create: { productId: product.id, sortOrder: sortOrder++ } },
        },
      });
    }
    return this.gallery(product.id);
  }

  /** Put the given images first, in that order; unlisted ones keep their relative order after. */
  async reorder(ctx: RequestContext, productId: string, imageIds: string[]) {
    const product = await this.productOrThrow(ctx, productId);
    const current = await this.prisma.productImage.findMany({
      where: { productId: product.id },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });
    const known = new Set(current.map((image) => image.id));
    if (imageIds.some((id) => !known.has(id)) || new Set(imageIds).size !== imageIds.length) {
      throw AppError.badRequest('INVALID_IMAGES', 'The list contains an image that is not on this product');
    }
    const ordered = [...imageIds, ...current.map((image) => image.id).filter((id) => !imageIds.includes(id))];
    await this.prisma.$transaction(
      ordered.map((id, index) =>
        this.prisma.productImage.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );
    return this.gallery(product.id);
  }

  async remove(ctx: RequestContext, productId: string, imageId: string) {
    const product = await this.productOrThrow(ctx, productId);
    const image = await this.prisma.productImage.findFirst({
      where: { id: imageId, productId: product.id },
      include: { asset: { select: { id: true, storageKey: true } } },
    });
    if (!image) throw AppError.notFound('Image', imageId);

    await this.prisma.$transaction([
      // A variant pointing at this picture falls back to the product's main image.
      this.prisma.productVariant.updateMany({
        where: { productId: product.id, imageAssetId: image.assetId },
        data: { imageAssetId: null },
      }),
      this.prisma.productImage.delete({ where: { id: image.id } }),
      this.prisma.asset.delete({ where: { id: image.assetId } }),
    ]);
    await this.storage.delete('assets', image.asset.storageKey);
    return this.gallery(product.id);
  }

  /** Give one variant its own picture, chosen among the product's images (or clear it). */
  async setVariantImage(ctx: RequestContext, productId: string, variantId: string, assetId: string | null) {
    const product = await this.productOrThrow(ctx, productId);
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId: product.id },
      select: { id: true },
    });
    if (!variant) throw AppError.notFound('Variant', variantId);
    if (assetId) {
      const onProduct = await this.prisma.productImage.findFirst({
        where: { productId: product.id, assetId },
        select: { id: true },
      });
      if (!onProduct) {
        throw AppError.badRequest('INVALID_IMAGES', 'Choose one of this product’s images');
      }
    }
    await this.prisma.productVariant.update({ where: { id: variant.id }, data: { imageAssetId: assetId } });
    return { ok: true as const };
  }

  /** Bytes for the file endpoint; scoped to the caller's organisation. */
  async read(ctx: RequestContext, assetId: string) {
    const asset = await this.prisma.asset.findFirst({
      where: { id: assetId, organizationId: ctx.organizationId },
      select: { storageKey: true, contentType: true },
    });
    if (!asset) throw AppError.notFound('Image', assetId);
    return { bytes: await this.storage.get('assets', asset.storageKey), contentType: asset.contentType };
  }

  private async gallery(productId: string) {
    const rows = await this.prisma.productImage.findMany({
      where: { productId },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, assetId: true, sortOrder: true },
    });
    return rows.map((row) => ({ ...row, url: assetUrl(row.assetId) }));
  }

  private async productOrThrow(ctx: RequestContext, productId: string) {
    if (!ctx.ability.can('manage', 'Product') && !ctx.ability.can('update', 'Product')) {
      throw AppError.forbidden('Your role may not change the catalog');
    }
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!product) throw AppError.notFound('Product', productId);
    return product;
  }
}
