import { ApiError } from './api';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGES = 10;
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export interface GalleryImage {
  id: string;
  assetId: string;
  url: string;
  sortOrder: number;
}

const BASE = '/api/proxy/api/v1/catalog';

/** API image paths are relative to the API; the browser reaches them through the proxy. */
export const assetSrc = (url: string | null | undefined): string | null =>
  url ? `/api/proxy${url}` : null;

/** First problem with a picked file, or null. The server checks again by file signature. */
export function imageProblem(file: File): 'type' | 'size' | null {
  if (!ACCEPTED_TYPES.includes(file.type)) return 'type';
  if (file.size > MAX_IMAGE_BYTES) return 'size';
  return null;
}

async function failure(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
  return new ApiError(response.status, body.code ?? 'ERROR', body.message ?? 'Something went wrong');
}

async function call(path: string, init: RequestInit): Promise<GalleryImage[]> {
  const response = await fetch(`${BASE}${path}`, { ...init, cache: 'no-store' });
  if (!response.ok) throw await failure(response);
  return ((await response.json()) as { images: GalleryImage[] }).images;
}

export function uploadProductImages(productId: string, files: File[]): Promise<GalleryImage[]> {
  const form = new FormData();
  for (const file of files) form.append('file', file, file.name);
  // No content-type header: the browser adds the multipart boundary itself.
  return call(`/products/${productId}/images`, { method: 'POST', body: form });
}

export function reorderProductImages(productId: string, imageIds: string[]): Promise<GalleryImage[]> {
  return call(`/products/${productId}/images/order`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ imageIds }),
  });
}

export function deleteProductImage(productId: string, imageId: string): Promise<GalleryImage[]> {
  return call(`/products/${productId}/images/${imageId}`, { method: 'DELETE' });
}

/** Logos are small; the API enforces the same limit. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export async function uploadCompanyLogo(companyId: string, file: File): Promise<void> {
  const form = new FormData();
  form.append('file', file, file.name);
  const response = await fetch(`/api/proxy/api/v1/companies/${companyId}/logo`, {
    method: 'POST',
    body: form,
    cache: 'no-store',
  });
  if (!response.ok) throw await failure(response);
}

export async function deleteCompanyLogo(companyId: string): Promise<void> {
  const response = await fetch(`/api/proxy/api/v1/companies/${companyId}/logo`, {
    method: 'DELETE',
    cache: 'no-store',
  });
  if (!response.ok) throw await failure(response);
}
