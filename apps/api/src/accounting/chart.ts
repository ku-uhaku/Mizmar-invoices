/**
 * Default chart of accounts, a simplified Moroccan PCGE. Accounts with a
 * `role` are the ones automatic postings use; their codes may be renamed.
 */
export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';

export interface ChartAccount {
  code: string;
  name: string;
  type: AccountType;
  role?: string;
}

export const DEFAULT_CHART: ChartAccount[] = [
  { code: '1111', name: 'Capital social', type: 'EQUITY', role: 'CAPITAL' },
  { code: '1191', name: 'Report à nouveau', type: 'EQUITY' },
  { code: '3421', name: 'Clients', type: 'ASSET', role: 'RECEIVABLE' },
  { code: '3425', name: 'Clients - chèques et effets à encaisser', type: 'ASSET', role: 'CHEQUES_IN' },
  { code: '3455', name: 'État - TVA récupérable', type: 'ASSET', role: 'VAT_DEDUCTIBLE' },
  { code: '4411', name: 'Fournisseurs', type: 'LIABILITY', role: 'PAYABLE' },
  { code: '4415', name: 'Fournisseurs - chèques et effets à payer', type: 'LIABILITY', role: 'CHEQUES_OUT' },
  { code: '4455', name: 'État - TVA facturée', type: 'LIABILITY', role: 'VAT_COLLECTED' },
  { code: '5141', name: 'Banque', type: 'ASSET', role: 'BANK' },
  { code: '5161', name: 'Caisse espèces', type: 'ASSET', role: 'CASH' },
  { code: '6111', name: 'Achats revendus de marchandises', type: 'EXPENSE', role: 'PURCHASES' },
  { code: '6125', name: 'Achats non stockés (eau, énergie, fournitures)', type: 'EXPENSE', role: 'EXP_SUPPLIES' },
  { code: '6131', name: 'Locations et charges locatives', type: 'EXPENSE', role: 'EXP_RENT' },
  { code: '6134', name: "Primes d'assurances", type: 'EXPENSE', role: 'EXP_INSURANCE' },
  { code: '6167', name: 'Impôts, taxes et droits assimilés', type: 'EXPENSE', role: 'EXP_TAX' },
  { code: '6171', name: 'Rémunérations du personnel', type: 'EXPENSE', role: 'EXP_SALARY' },
  { code: '6188', name: 'Autres charges externes', type: 'EXPENSE', role: 'EXP_OTHER' },
  { code: '7111', name: 'Ventes de marchandises', type: 'INCOME', role: 'SALES' },
];

/** Which expense account a category kind posts to. */
export const EXPENSE_ROLE: Record<string, string> = {
  UTILITY: 'EXP_SUPPLIES',
  FUEL: 'EXP_SUPPLIES',
  SUPPLIES: 'EXP_SUPPLIES',
  RENT: 'EXP_RENT',
  INSURANCE: 'EXP_INSURANCE',
  TAX: 'EXP_TAX',
  SALARY: 'EXP_SALARY',
  OTHER: 'EXP_OTHER',
};
