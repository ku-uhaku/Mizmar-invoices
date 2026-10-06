'use client';

import { Badge, type BadgeTone } from './ui';
import { t } from '@/lib/format';

export interface DocBadge {
  key: string;
  tone: string;
  labelKey: string;
}

/**
 * Render the three orthogonal statuses the API computes.
 *
 * The labels come from the same catalogue the printed PDF uses, so a document
 * that reads "Partiellement livré" on screen reads the same on paper.
 */
export function DocBadges({ badges, className }: { badges: DocBadge[]; className?: string }) {
  return (
    <span className={className ?? 'flex flex-wrap items-center gap-1'}>
      {badges.map((badge) => (
        <Badge key={badge.key} tone={badge.tone as BadgeTone}>
          {t(badge.labelKey)}
        </Badge>
      ))}
    </span>
  );
}
