import { Prisma } from '@prisma/client';

/**
 * The one include shape every document read uses.
 *
 * Centralised so the mapper can be fully typed against it and no handler
 * accidentally returns a document missing its lines or its provenance.
 */
export const documentInclude = {
  contact: {
    select: {
      id: true,
      displayName: true,
      ice: true,
      paymentTerm: true,
      paymentTermDays: true,
      defaultCurrency: true,
      defaultLocale: true,
    },
  },
  createdBy: { select: { id: true, fullName: true } },
  lines: {
    orderBy: { sortOrder: 'asc' },
    include: {
      variant: {
        select: {
          id: true,
          sku: true,
          barcode: true,
          variantLabel: true,
          product: { select: { id: true, name: true, isService: true } },
        },
      },
      sources: {
        include: {
          sourceLine: {
            select: {
              id: true,
              document: { select: { id: true, type: true, number: true, lifecycle: true } },
            },
          },
        },
      },
    },
  },
  linksFrom: {
    include: {
      targetDocument: {
        select: { id: true, type: true, number: true, issueDate: true, lifecycle: true },
      },
    },
  },
  linksTo: {
    include: {
      sourceDocument: {
        select: { id: true, type: true, number: true, issueDate: true, lifecycle: true },
      },
    },
  },
} satisfies Prisma.DocumentInclude;

export type DocumentWithRelations = Prisma.DocumentGetPayload<{
  include: typeof documentInclude;
}>;

export type DocumentLineWithRelations = DocumentWithRelations['lines'][number];
