import type { IconName } from '@/components/icons';
import type { ChartKind } from '@/components/charts';

export type ReportGroup = 'finance' | 'stock' | 'activity' | 'expenses' | 'hr';

export interface ReportDef {
  name: string;
  group: ReportGroup;
  title: string;
  description: string;
  icon: IconName;
  /** Snapshot as of today: no date range. */
  asOf?: boolean;
  groupBy?: Array<{ value: string; label: string }>;
  period?: 'day' | 'week' | 'month';
  warehouse?: boolean;
  days?: boolean;
  chart?: {
    kind: ChartKind;
    x: string;
    /** Column keys to plot; 'money' plots every money column except `total`-like ones in `skip`. */
    series: string[] | 'money';
    skip?: string[];
  };
}

export const GROUP_TITLES: Record<ReportGroup, string> = {
  finance: 'Finance',
  stock: 'Achats et stock',
  activity: 'Activité',
  expenses: 'Dépenses et charges',
  hr: 'Ressources humaines',
};

export const REPORT_DEFS: ReportDef[] = [
  {
    name: 'profit-loss',
    group: 'finance',
    title: 'Résultat (compte de résultat simplifié)',
    description: 'Chiffre d’affaires, coût des ventes, marge brute, charges et résultat par période.',
    icon: 'trending',
    period: 'month',
    chart: { kind: 'bar', x: 'period', series: ['revenue', 'expenses', 'netResult'] },
  },
  {
    name: 'cash-flow',
    group: 'finance',
    title: 'Flux de trésorerie',
    description: 'Encaissements, paiements fournisseurs et dépenses par période, avec le cumul.',
    icon: 'wallet',
    period: 'month',
    chart: { kind: 'line', x: 'period', series: ['inflow', 'suppliers', 'expenses', 'cumulative'] },
  },
  {
    name: 'payments-by-method',
    group: 'finance',
    title: 'Paiements par moyen',
    description: 'Espèces, carte, chèque, virement : montants encaissés et décaissés.',
    icon: 'credit',
    chart: { kind: 'bar', x: 'method', series: ['inbound', 'outbound', 'expenses'] },
  },
  {
    name: 'payables-ageing',
    group: 'finance',
    title: 'Balance âgée fournisseurs',
    description: 'Ce que vous devez aux fournisseurs et sur les factures de charges, par ancienneté.',
    icon: 'clock',
    asOf: true,
    chart: { kind: 'bar', x: 'supplier', series: ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] },
  },
  {
    name: 'margin',
    group: 'finance',
    title: 'Marges et meilleures ventes',
    description: 'Chiffre d’affaires, coût et marge par article ou par client, classés par CA.',
    icon: 'tag',
    groupBy: [
      { value: 'product', label: 'Par article' },
      { value: 'customer', label: 'Par client' },
    ],
    chart: { kind: 'bar', x: 'label', series: ['revenue', 'margin'] },
  },
  {
    name: 'cash-up',
    group: 'activity',
    title: 'Clôture de caisse',
    description: 'Encaissements par jour et par moyen de paiement (caisse et factures).',
    icon: 'cart',
    period: 'day',
    chart: { kind: 'bar', x: 'period', series: ['CASH', 'CARD', 'CHEQUE', 'BANK_TRANSFER'] },
  },
  {
    name: 'user-activity',
    group: 'activity',
    title: 'Activité des utilisateurs',
    description: 'Actions enregistrées par utilisateur et par type d’objet.',
    icon: 'users',
  },
  {
    name: 'cash-sessions',
    group: 'activity',
    title: 'Sessions de caisse',
    description: 'Ouvertures et clôtures de caisse, ventes, espèces attendues et écarts.',
    icon: 'cart',
    chart: { kind: 'bar', x: 'date', series: ['total'] },
  },
  {
    name: 'cash-movements',
    group: 'activity',
    title: 'Mouvements de caisse',
    description: 'Entrées et sorties d’espèces hors ventes : dépôts, retraits, remboursements.',
    icon: 'wallet',
  },
  {
    name: 'recurring-runs',
    group: 'activity',
    title: 'Factures récurrentes générées',
    description: 'Historique des générations automatiques, avec les échecs.',
    icon: 'clock',
  },
  {
    name: 'purchases',
    group: 'stock',
    title: 'Achats',
    description: 'Achats par fournisseur, article ou période.',
    icon: 'cart',
    groupBy: [
      { value: 'supplier', label: 'Par fournisseur' },
      { value: 'product', label: 'Par article' },
      { value: 'period', label: 'Par période' },
    ],
    period: 'month',
    chart: { kind: 'bar', x: 'label', series: ['exclVat'] },
  },
  {
    name: 'stock-movements',
    group: 'stock',
    title: 'Mouvements de stock',
    description: 'Entrées et sorties par type de mouvement.',
    icon: 'truck',
    warehouse: true,
    chart: { kind: 'bar', x: 'type', series: ['inQty', 'outQty'] },
  },
  {
    name: 'low-stock',
    group: 'stock',
    title: 'Stock bas et ruptures',
    description: 'Articles sous leur seuil d’alerte ou en stock négatif.',
    icon: 'alert',
    asOf: true,
    warehouse: true,
  },
  {
    name: 'slow-movers',
    group: 'stock',
    title: 'Articles dormants',
    description: 'Articles en stock sans vente depuis un nombre de jours donné.',
    icon: 'box',
    asOf: true,
    warehouse: true,
    days: true,
  },
  {
    name: 'stock-counts',
    group: 'stock',
    title: 'Inventaires',
    description: 'Sessions de comptage et écarts constatés.',
    icon: 'order',
    warehouse: true,
  },
  {
    name: 'stock-transfers',
    group: 'stock',
    title: 'Transferts de stock',
    description: 'Transferts entre entrepôts et leur statut.',
    icon: 'warehouse',
  },
  {
    name: 'expenses-by-category',
    group: 'expenses',
    title: 'Dépenses par catégorie',
    description: 'Électricité, eau, internet, loyer… : montants, TVA et reste dû.',
    icon: 'wallet',
    chart: { kind: 'donut', x: 'category', series: ['total'] },
  },
  {
    name: 'utility-trend',
    group: 'expenses',
    title: 'Évolution des factures d’énergie, eau et télécoms',
    description: 'Comparez mois par mois vos factures d’électricité, d’eau et d’internet.',
    icon: 'trending',
    period: 'month',
    chart: { kind: 'line', x: 'period', series: 'money', skip: ['total'] },
  },
  {
    name: 'upcoming-bills',
    group: 'expenses',
    title: 'Factures à payer',
    description: 'Échéancier des factures de charges et d’achats, retards en tête.',
    icon: 'alert',
    asOf: true,
  },
  {
    name: 'headcount',
    group: 'hr',
    title: 'Effectif et mouvements',
    description: 'Effectif par département, embauches et départs sur la période.',
    icon: 'users',
    chart: { kind: 'bar', x: 'department', series: ['active', 'hired', 'left'] },
  },
  {
    name: 'leave-balances',
    group: 'hr',
    title: 'Soldes de congés',
    description: 'Droits, congés pris et solde restant par employé.',
    icon: 'clock',
    asOf: true,
  },
  {
    name: 'attendance-summary',
    group: 'hr',
    title: 'Synthèse des présences',
    description: 'Présences, retards, absences et heures supplémentaires par employé.',
    icon: 'check',
  },
  {
    name: 'payroll-register',
    group: 'hr',
    title: 'Journal de paie',
    description: 'Salaires bruts, retenues, nets et coût employeur de toutes les paies validées.',
    icon: 'wallet',
  },
  {
    name: 'cnss-declaration',
    group: 'hr',
    title: 'Déclaration CNSS et AMO',
    description: 'Cotisations salariales et patronales à verser, par employé et par mois.',
    icon: 'invoice',
  },
  {
    name: 'payroll-by-department',
    group: 'hr',
    title: 'Coût salarial par département',
    description: 'Brut, net et coût employeur par département.',
    icon: 'layout',
    chart: { kind: 'donut', x: 'department', series: ['cost'] },
  },
  {
    name: 'ir-annual',
    group: 'hr',
    title: 'Récapitulatif annuel de l’IR',
    description: 'Revenu imposable et impôt retenu par employé sur l’année.',
    icon: 'file',
  },
];

export const REPORT_DEF_BY_NAME = new Map(REPORT_DEFS.map((def) => [def.name, def]));
