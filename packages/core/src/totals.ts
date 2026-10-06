import {
  allocate,
  dec,
  Decimal,
  DEFAULT_ROUNDING,
  HUNDRED,
  money,
  ONE,
  round,
  roundLine,
  type Numeric,
  type RoundingConfig,
  sum,
  ZERO,
} from './money';

export type DiscountKind = 'PERCENT' | 'AMOUNT';

export interface Discount {
  kind: DiscountKind;
  value: Numeric;
}

/** Whether the unit prices on the document include VAT. */
export type PriceMode = 'EXCLUSIVE' | 'INCLUSIVE';

export interface TotalsLineInput {
  id: string;
  quantity: Numeric;
  unitPrice: Numeric;
  /** Percent, e.g. 20 for Morocco's standard rate. */
  vatRate: Numeric;
  discount?: Discount | null;
  /** Narrative lines (section headings, free text) never affect money. */
  isNote?: boolean;
}

export interface TotalsInput {
  lines: TotalsLineInput[];
  /** Applied after line discounts, spread pro-rata across lines. */
  globalDiscount?: Discount | null;
  shipping?: { amount: Numeric; vatRate: Numeric } | null;
  priceMode?: PriceMode;
  rounding?: RoundingConfig;
}

export interface LineTotals {
  id: string;
  /** quantity x unit price, VAT excluded. */
  gross: string;
  lineDiscount: string;
  /** gross - lineDiscount. */
  net: string;
  /** This line's share of the global discount. */
  globalDiscountShare: string;
  /** net - globalDiscountShare: what VAT is actually charged on. */
  taxableBase: string;
  vatRate: string;
  vatAmount: string;
  total: string;
}

export interface VatBucket {
  rate: string;
  base: string;
  amount: string;
}

export interface TotalsResult {
  lines: LineTotals[];
  /** Sum of line gross, before any discount. */
  subtotalGross: string;
  totalLineDiscounts: string;
  /** Sum of line net: the base the global discount is computed from. */
  subtotalNet: string;
  globalDiscount: string;
  shippingNet: string;
  /** Sum of line taxable bases plus shipping. */
  totalExclVat: string;
  vatBuckets: VatBucket[];
  totalVat: string;
  totalInclVat: string;
  /** Convenience aliases matching what the French documents print. */
  totalHT: string;
  totalTVA: string;
  totalTTC: string;
}

function discountAmount(base: Decimal, discount: Discount | null | undefined): Decimal {
  if (!discount) return ZERO;
  const value = dec(discount.value);
  if (value.isZero()) return ZERO;
  const raw = discount.kind === 'PERCENT' ? base.times(value).div(HUNDRED) : value;
  // A discount can never exceed what is being discounted, nor flip the sign.
  if (base.isNegative()) return raw.lt(base) ? base : raw;
  return raw.gt(base) ? base : raw;
}

/**
 * Compute every money figure on a document.
 *
 * This function is the single source of truth: the API calls it to persist
 * authoritative totals, the web editor calls it on every keystroke for instant
 * feedback, and the mobile app calls it offline. If any of those three
 * computed money on its own, they would drift.
 */
export function computeTotals(input: TotalsInput): TotalsResult {
  const config = input.rounding ?? DEFAULT_ROUNDING;
  const priceMode = input.priceMode ?? 'EXCLUSIVE';
  const payable = input.lines.filter((l) => !l.isNote);

  // ---- Stage 1: per-line gross and line discount, VAT excluded ----
  const stage1 = payable.map((line) => {
    const quantity = dec(line.quantity);
    const vatRate = dec(line.vatRate);
    const rawUnit = dec(line.unitPrice);

    // A TTC-quoted price is converted to HT before anything else, so discounts
    // and VAT buckets are all computed on one consistent basis.
    const unit =
      priceMode === 'INCLUSIVE' ? rawUnit.div(ONE.plus(vatRate.div(HUNDRED))) : rawUnit;

    const gross = roundLine(quantity.times(unit), config);
    const lineDiscount = roundLine(discountAmount(gross, line.discount), config);
    const net = gross.minus(lineDiscount);

    return { line, vatRate, gross, lineDiscount, net };
  });

  const subtotalGross = sum(stage1.map((s) => s.gross));
  const totalLineDiscounts = sum(stage1.map((s) => s.lineDiscount));
  const subtotalNet = sum(stage1.map((s) => s.net));

  // ---- Stage 2: global discount, spread pro-rata over line nets ----
  const globalDiscountTotal = round(discountAmount(subtotalNet, input.globalDiscount), config);
  const shares = allocate(
    globalDiscountTotal,
    stage1.map((s) => s.net),
    config,
  );

  // ---- Stage 3: taxable base and VAT per line ----
  const lines: LineTotals[] = stage1.map((s, i) => {
    const share = shares[i] ?? ZERO;
    const taxableBase = s.net.minus(share);
    const vatAmount = roundLine(taxableBase.times(s.vatRate).div(HUNDRED), config);

    return {
      id: s.line.id,
      gross: money(s.gross, config),
      lineDiscount: money(s.lineDiscount, config),
      net: money(s.net, config),
      globalDiscountShare: money(share, config),
      taxableBase: money(taxableBase, config),
      vatRate: s.vatRate.toFixed(2),
      vatAmount: money(vatAmount, config),
      total: money(taxableBase.plus(vatAmount), config),
    };
  });

  // ---- Stage 4: VAT buckets, one per distinct rate (shipping included) ----
  const buckets = new Map<string, { rate: Decimal; base: Decimal }>();
  const addToBucket = (rate: Decimal, base: Decimal) => {
    const key = rate.toFixed(4);
    const existing = buckets.get(key);
    if (existing) existing.base = existing.base.plus(base);
    else buckets.set(key, { rate, base });
  };

  stage1.forEach((s, i) => {
    addToBucket(s.vatRate, s.net.minus(shares[i] ?? ZERO));
  });

  let shippingNet = ZERO;
  if (input.shipping) {
    const shipRate = dec(input.shipping.vatRate);
    shippingNet = round(input.shipping.amount, config);
    if (!shippingNet.isZero()) addToBucket(shipRate, shippingNet);
  }

  const vatBuckets: VatBucket[] = [...buckets.values()]
    .sort((a, b) => b.rate.minus(a.rate).toNumber())
    .map(({ rate, base }) => ({
      rate: rate.toFixed(2),
      base: money(base, config),
      amount: money(base.times(rate).div(HUNDRED), config),
    }));

  // VAT is summed from the buckets, not from the lines: that is the figure the
  // document prints and the figure a tax audit recomputes.
  const totalVat = sum(vatBuckets.map((b) => dec(b.amount)));
  const totalExclVat = round(subtotalNet.minus(globalDiscountTotal).plus(shippingNet), config);
  const totalInclVat = round(totalExclVat.plus(totalVat), config);

  const htStr = money(totalExclVat, config);
  const tvaStr = money(totalVat, config);
  const ttcStr = money(totalInclVat, config);

  return {
    lines,
    subtotalGross: money(subtotalGross, config),
    totalLineDiscounts: money(totalLineDiscounts, config),
    subtotalNet: money(subtotalNet, config),
    globalDiscount: money(globalDiscountTotal, config),
    shippingNet: money(shippingNet, config),
    totalExclVat: htStr,
    vatBuckets,
    totalVat: tvaStr,
    totalInclVat: ttcStr,
    totalHT: htStr,
    totalTVA: tvaStr,
    totalTTC: ttcStr,
  };
}
