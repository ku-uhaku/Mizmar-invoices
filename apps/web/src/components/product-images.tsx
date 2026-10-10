'use client';

import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  ACCEPTED_TYPES,
  assetSrc,
  deleteProductImage,
  imageProblem,
  MAX_IMAGES,
  reorderProductImages,
  uploadProductImages,
  type GalleryImage,
} from '@/lib/product-images';
import { useT } from '@/lib/i18n/provider';
import { Icon } from './icons';
import { Badge, Spinner, toast } from './ui';

interface Tile {
  key: string;
  src: string;
  isMain: boolean;
}

/** Small square picture, or a neutral placeholder when there is none. */
export function Thumb({ url, className }: { url: string | null | undefined; className?: string }) {
  const src = assetSrc(url);
  return (
    <span
      className={clsx(
        'flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-muted text-ink-subtle',
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- authenticated proxy URL, not optimisable
        <img src={src} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <Icon name="box" className="size-4" />
      )}
    </span>
  );
}

function Gallery({
  tiles,
  busy,
  onPick,
  onMakeMain,
  onRemove,
}: {
  tiles: Tile[];
  busy: boolean;
  onPick: (files: File[]) => void;
  onMakeMain: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const full = tiles.length >= MAX_IMAGES;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-ink">{t('Photos du produit')}</span>
        <span className="text-xs text-ink-muted">
          {tiles.length} / {MAX_IMAGES}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {tiles.map((tile) => (
          <div
            key={tile.key}
            className="group relative aspect-square overflow-hidden rounded-xl border border-border bg-surface-muted"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- authenticated proxy URL or blob preview */}
            <img src={tile.src} alt="" className="size-full object-cover" />
            {tile.isMain ? (
              <Badge tone="info" className="absolute start-1 top-1">
                {t('Principale')}
              </Badge>
            ) : (
              <button
                type="button"
                onClick={() => onMakeMain(tile.key)}
                className="absolute start-1 top-1 rounded-full bg-surface/90 px-2 py-0.5 text-[11px] font-medium text-ink opacity-0 shadow transition group-hover:opacity-100 focus:opacity-100"
              >
                {t('Définir comme principale')}
              </button>
            )}
            <button
              type="button"
              aria-label={t('Supprimer')}
              onClick={() => onRemove(tile.key)}
              className="absolute end-1 top-1 flex size-6 items-center justify-center rounded-full bg-surface/90 text-ink shadow hover:text-danger"
            >
              <Icon name="x" className="size-3.5" />
            </button>
          </div>
        ))}

        {!full && (
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setOver(false);
              onPick([...event.dataTransfer.files]);
            }}
            className={clsx(
              'flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-1 text-center text-xs text-ink-muted transition',
              over ? 'border-brand bg-brand-soft text-brand' : 'border-border-strong hover:border-brand hover:text-brand',
            )}
          >
            {busy ? <Spinner /> : <Icon name="plus" className="size-5" />}
            <span>{busy ? t('Envoi…') : t('Ajouter des photos')}</span>
          </button>
        )}
      </div>

      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPTED_TYPES.join(',')}
        className="hidden"
        onChange={(event) => {
          onPick([...(event.target.files ?? [])]);
          event.target.value = '';
        }}
      />
      <p className="text-xs text-ink-subtle">
        {t('JPEG, PNG ou WebP · 8 Mo maximum par photo · la première photo est la photo principale.')}
      </p>
    </div>
  );
}

/** Keep the files that are valid and fit, and tell the user about the rest. */
function useAccept(currentCount: number) {
  const t = useT();
  return (picked: File[]): File[] => {
    const accepted: File[] = [];
    for (const file of picked) {
      const problem = imageProblem(file);
      if (problem === 'type') {
        toast.error(t('{name} n’est pas une image JPEG, PNG ou WebP.', { name: file.name }));
      } else if (problem === 'size') {
        toast.error(t('{name} dépasse 8 Mo.', { name: file.name }));
      } else if (currentCount + accepted.length >= MAX_IMAGES) {
        toast.error(t('Maximum {n} photos par produit.', { n: MAX_IMAGES }));
        break;
      } else {
        accepted.push(file);
      }
    }
    return accepted;
  };
}

/** Existing product: every change is saved to the server straight away. */
export function ProductImageManager({
  productId,
  images,
  onChange,
}: {
  productId: string;
  images: GalleryImage[];
  onChange: (images: GalleryImage[]) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const accept = useAccept(images.length);

  const run = async (action: () => Promise<GalleryImage[]>) => {
    setBusy(true);
    try {
      onChange(await action());
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : t('Opération impossible'));
    } finally {
      setBusy(false);
    }
  };

  const tiles: Tile[] = images.map((image, index) => ({
    key: image.id,
    src: assetSrc(image.url) ?? '',
    isMain: index === 0,
  }));

  return (
    <Gallery
      tiles={tiles}
      busy={busy}
      onPick={(files) => {
        const accepted = accept(files);
        if (accepted.length > 0) void run(() => uploadProductImages(productId, accepted));
      }}
      onMakeMain={(key) => void run(() => reorderProductImages(productId, [key]))}
      onRemove={(key) => void run(() => deleteProductImage(productId, key))}
    />
  );
}

/** New product: pictures are chosen now and uploaded once the product exists. */
export function StagedImagePicker({
  files,
  onChange,
}: {
  files: File[];
  onChange: (files: File[]) => void;
}) {
  const accept = useAccept(files.length);
  const previews = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  const tiles: Tile[] = files.map((_, index) => ({
    key: String(index),
    src: previews[index] ?? '',
    isMain: index === 0,
  }));

  return (
    <Gallery
      tiles={tiles}
      busy={false}
      onPick={(picked) => onChange([...files, ...accept(picked)])}
      onMakeMain={(key) => {
        const index = Number(key);
        onChange([files[index]!, ...files.filter((_, i) => i !== index)]);
      }}
      onRemove={(key) => onChange(files.filter((_, i) => i !== Number(key)))}
    />
  );
}
