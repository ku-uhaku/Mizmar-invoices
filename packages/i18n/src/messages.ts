import type { Locale } from './locales';

/**
 * Every string a rendered document can print, in all three locales.
 *
 * Kept as one flat, fully-typed record per locale rather than nested JSON, so
 * adding a label to the template fails to compile until all three languages
 * have it. A silently missing Arabic label on a printed invoice is not a bug
 * anyone catches in review.
 */
export interface DocumentMessages {
  // Document titles
  'doc.DEVIS': string;
  'doc.SALES_ORDER': string;
  'doc.DELIVERY_NOTE': string;
  'doc.SALES_INVOICE': string;
  'doc.CREDIT_NOTE': string;
  'doc.PURCHASE_ORDER': string;
  'doc.GOODS_RECEIPT': string;
  'doc.PURCHASE_INVOICE': string;

  // Header fields
  'field.number': string;
  'field.date': string;
  'field.dueDate': string;
  'field.validUntil': string;
  'field.deliveryDate': string;
  'field.reference': string;
  'field.project': string;
  'field.client': string;
  'field.supplier': string;
  'field.billTo': string;
  'field.shipTo': string;
  'field.warehouse': string;
  'field.salesperson': string;
  'field.paymentTerms': string;

  // Legal identifiers
  'legal.ice': string;
  'legal.rc': string;
  'legal.if': string;
  'legal.patente': string;
  'legal.cnss': string;
  'legal.capital': string;
  'legal.tel': string;
  'legal.email': string;
  'legal.web': string;
  'legal.address': string;

  // Line table columns
  'col.index': string;
  'col.image': string;
  'col.sku': string;
  'col.barcode': string;
  'col.description': string;
  'col.unit': string;
  'col.quantity': string;
  'col.unitPrice': string;
  'col.discount': string;
  'col.vat': string;
  'col.lineTotal': string;
  'col.sourceReference': string;

  // Totals
  'total.subtotal': string;
  'total.lineDiscounts': string;
  'total.globalDiscount': string;
  'total.shipping': string;
  'total.exclVat': string;
  'total.vat': string;
  'total.inclVat': string;
  'total.vatBase': string;
  'total.vatRate': string;
  'total.vatAmount': string;
  'total.amountInWords': string;
  'total.deposit': string;
  'total.balanceDue': string;
  'total.paid': string;

  // Footer blocks
  'block.terms': string;
  'block.paymentInstructions': string;
  'block.bankDetails': string;
  'block.bank': string;
  'block.rib': string;
  'block.iban': string;
  'block.swift': string;
  'block.notes': string;
  'block.signature': string;
  'block.clientSignature': string;
  'block.companySignature': string;
  'block.stamp': string;
  'block.legalMentions': string;
  'block.vatSummary': string;

  // Pagination
  'page.xOfY': string;
  'page.x': string;
  'page.continued': string;

  // Status badges (shared with the web UI)
  'status.draft': string;
  'status.validated': string;
  'status.sent': string;
  'status.cancelled': string;
  'status.unpaid': string;
  'status.partiallyPaid': string;
  'status.paid': string;
  'status.overdue': string;

  // Fulfilment badges, labelled per document type
  'fulfilment.ordered.partial': string;
  'fulfilment.ordered.complete': string;
  'fulfilment.delivered.partial': string;
  'fulfilment.delivered.complete': string;
  'fulfilment.invoiced.partial': string;
  'fulfilment.invoiced.complete': string;
  'fulfilment.received.partial': string;
  'fulfilment.received.complete': string;
  'fulfilment.credited.partial': string;
  'fulfilment.credited.complete': string;
  'fulfilment.none.partial': string;
  'fulfilment.none.complete': string;
}

const EN: DocumentMessages = {
  'doc.DEVIS': 'Quotation',
  'doc.SALES_ORDER': 'Sales Order',
  'doc.DELIVERY_NOTE': 'Delivery Note',
  'doc.SALES_INVOICE': 'Invoice',
  'doc.CREDIT_NOTE': 'Credit Note',
  'doc.PURCHASE_ORDER': 'Purchase Order',
  'doc.GOODS_RECEIPT': 'Goods Received Note',
  'doc.PURCHASE_INVOICE': 'Purchase Invoice',

  'field.number': 'No.',
  'field.date': 'Date',
  'field.dueDate': 'Due date',
  'field.validUntil': 'Valid until',
  'field.deliveryDate': 'Delivery date',
  'field.reference': 'Reference',
  'field.project': 'Project',
  'field.client': 'Client',
  'field.supplier': 'Supplier',
  'field.billTo': 'Bill to',
  'field.shipTo': 'Ship to',
  'field.warehouse': 'Warehouse',
  'field.salesperson': 'Salesperson',
  'field.paymentTerms': 'Payment terms',

  'legal.ice': 'ICE',
  'legal.rc': 'TR',
  'legal.if': 'Tax ID',
  'legal.patente': 'Licence',
  'legal.cnss': 'CNSS',
  'legal.capital': 'Share capital',
  'legal.tel': 'Tel',
  'legal.email': 'Email',
  'legal.web': 'Web',
  'legal.address': 'Address',

  'col.index': '#',
  'col.image': 'Image',
  'col.sku': 'SKU',
  'col.barcode': 'Barcode',
  'col.description': 'Description',
  'col.unit': 'Unit',
  'col.quantity': 'Qty',
  'col.unitPrice': 'Unit price',
  'col.discount': 'Disc.',
  'col.vat': 'VAT',
  'col.lineTotal': 'Total',
  'col.sourceReference': 'Ref.',

  'total.subtotal': 'Subtotal',
  'total.lineDiscounts': 'Line discounts',
  'total.globalDiscount': 'Global discount',
  'total.shipping': 'Shipping',
  'total.exclVat': 'Total excl. VAT',
  'total.vat': 'VAT',
  'total.inclVat': 'Total incl. VAT',
  'total.vatBase': 'Base',
  'total.vatRate': 'Rate',
  'total.vatAmount': 'VAT amount',
  'total.amountInWords': 'Amount in words',
  'total.deposit': 'Deposit',
  'total.balanceDue': 'Balance due',
  'total.paid': 'Paid',

  'block.terms': 'Terms and conditions',
  'block.paymentInstructions': 'Payment instructions',
  'block.bankDetails': 'Bank details',
  'block.bank': 'Bank',
  'block.rib': 'RIB',
  'block.iban': 'IBAN',
  'block.swift': 'SWIFT',
  'block.notes': 'Notes',
  'block.signature': 'Signature',
  'block.clientSignature': 'Client signature',
  'block.companySignature': 'For the company',
  'block.stamp': 'Stamp',
  'block.legalMentions': 'Legal notices',
  'block.vatSummary': 'VAT breakdown',

  'page.xOfY': 'Page {x} of {y}',
  'page.x': 'Page {x}',
  'page.continued': 'continued…',

  'status.draft': 'Draft',
  'status.validated': 'Validated',
  'status.sent': 'Sent',
  'status.cancelled': 'Cancelled',
  'status.unpaid': 'Unpaid',
  'status.partiallyPaid': 'Partially paid',
  'status.paid': 'Fully paid',
  'status.overdue': 'Overdue',

  'fulfilment.ordered.partial': 'Partially ordered',
  'fulfilment.ordered.complete': 'Ordered',
  'fulfilment.delivered.partial': 'Partially delivered',
  'fulfilment.delivered.complete': 'Delivered',
  'fulfilment.invoiced.partial': 'Partially invoiced',
  'fulfilment.invoiced.complete': 'Invoiced',
  'fulfilment.received.partial': 'Partially received',
  'fulfilment.received.complete': 'Received',
  'fulfilment.credited.partial': 'Partially credited',
  'fulfilment.credited.complete': 'Fully credited',
  'fulfilment.none.partial': 'In progress',
  'fulfilment.none.complete': 'Complete',
};

const FR: DocumentMessages = {
  'doc.DEVIS': 'Devis',
  'doc.SALES_ORDER': 'Bon de commande',
  'doc.DELIVERY_NOTE': 'Bon de livraison',
  'doc.SALES_INVOICE': 'Facture',
  'doc.CREDIT_NOTE': 'Facture d’avoir',
  'doc.PURCHASE_ORDER': 'Bon de commande fournisseur',
  'doc.GOODS_RECEIPT': 'Bon de réception',
  'doc.PURCHASE_INVOICE': 'Facture d’achat',

  'field.number': 'N°',
  'field.date': 'Date',
  'field.dueDate': 'Échéance',
  'field.validUntil': 'Valable jusqu’au',
  'field.deliveryDate': 'Date de livraison',
  'field.reference': 'Référence',
  'field.project': 'Projet',
  'field.client': 'Client',
  'field.supplier': 'Fournisseur',
  'field.billTo': 'Facturer à',
  'field.shipTo': 'Livrer à',
  'field.warehouse': 'Dépôt',
  'field.salesperson': 'Commercial',
  'field.paymentTerms': 'Conditions de paiement',

  'legal.ice': 'ICE',
  'legal.rc': 'RC',
  'legal.if': 'IF',
  'legal.patente': 'Patente',
  'legal.cnss': 'CNSS',
  'legal.capital': 'Capital social',
  'legal.tel': 'Tél',
  'legal.email': 'E-mail',
  'legal.web': 'Site',
  'legal.address': 'Adresse',

  'col.index': '#',
  'col.image': 'Image',
  'col.sku': 'Réf.',
  'col.barcode': 'Code-barres',
  'col.description': 'Désignation',
  'col.unit': 'Unité',
  'col.quantity': 'Qté',
  'col.unitPrice': 'P.U. HT',
  'col.discount': 'Remise',
  'col.vat': 'TVA',
  'col.lineTotal': 'Total HT',
  'col.sourceReference': 'Réf. BL',

  'total.subtotal': 'Sous-total',
  'total.lineDiscounts': 'Remises lignes',
  'total.globalDiscount': 'Remise globale',
  'total.shipping': 'Frais de port',
  'total.exclVat': 'Total HT',
  'total.vat': 'TVA',
  'total.inclVat': 'Total TTC',
  'total.vatBase': 'Base',
  'total.vatRate': 'Taux',
  'total.vatAmount': 'Montant TVA',
  'total.amountInWords': 'Arrêtée la présente à la somme de',
  'total.deposit': 'Acompte',
  'total.balanceDue': 'Reste à payer',
  'total.paid': 'Payé',

  'block.terms': 'Conditions générales',
  'block.paymentInstructions': 'Modalités de paiement',
  'block.bankDetails': 'Coordonnées bancaires',
  'block.bank': 'Banque',
  'block.rib': 'RIB',
  'block.iban': 'IBAN',
  'block.swift': 'SWIFT',
  'block.notes': 'Observations',
  'block.signature': 'Signature',
  'block.clientSignature': 'Signature du client',
  'block.companySignature': 'Pour la société',
  'block.stamp': 'Cachet',
  'block.legalMentions': 'Mentions légales',
  'block.vatSummary': 'Récapitulatif TVA',

  'page.xOfY': 'Page {x} sur {y}',
  'page.x': 'Page {x}',
  'page.continued': 'suite…',

  'status.draft': 'Brouillon',
  'status.validated': 'Validé',
  'status.sent': 'Envoyé',
  'status.cancelled': 'Annulé',
  'status.unpaid': 'Non payé',
  'status.partiallyPaid': 'Partiellement payé',
  'status.paid': 'Payé',
  'status.overdue': 'En retard',

  'fulfilment.ordered.partial': 'Partiellement commandé',
  'fulfilment.ordered.complete': 'Commandé',
  'fulfilment.delivered.partial': 'Partiellement livré',
  'fulfilment.delivered.complete': 'Livré',
  'fulfilment.invoiced.partial': 'Partiellement facturé',
  'fulfilment.invoiced.complete': 'Facturé',
  'fulfilment.received.partial': 'Partiellement reçu',
  'fulfilment.received.complete': 'Reçu',
  'fulfilment.credited.partial': 'Partiellement avoiré',
  'fulfilment.credited.complete': 'Totalement avoiré',
  'fulfilment.none.partial': 'En cours',
  'fulfilment.none.complete': 'Terminé',
};

const AR: DocumentMessages = {
  'doc.DEVIS': 'عرض سعر',
  'doc.SALES_ORDER': 'أمر بيع',
  'doc.DELIVERY_NOTE': 'سند تسليم',
  'doc.SALES_INVOICE': 'فاتورة',
  'doc.CREDIT_NOTE': 'فاتورة إشعار دائن',
  'doc.PURCHASE_ORDER': 'أمر شراء',
  'doc.GOODS_RECEIPT': 'سند استلام',
  'doc.PURCHASE_INVOICE': 'فاتورة شراء',

  'field.number': 'رقم',
  'field.date': 'التاريخ',
  'field.dueDate': 'تاريخ الاستحقاق',
  'field.validUntil': 'صالح حتى',
  'field.deliveryDate': 'تاريخ التسليم',
  'field.reference': 'المرجع',
  'field.project': 'المشروع',
  'field.client': 'العميل',
  'field.supplier': 'المورّد',
  'field.billTo': 'عنوان الفاتورة',
  'field.shipTo': 'عنوان التسليم',
  'field.warehouse': 'المخزن',
  'field.salesperson': 'المسؤول التجاري',
  'field.paymentTerms': 'شروط الدفع',

  'legal.ice': 'المعرف الموحد',
  'legal.rc': 'السجل التجاري',
  'legal.if': 'التعريف الجبائي',
  'legal.patente': 'الضريبة المهنية',
  'legal.cnss': 'الضمان الاجتماعي',
  'legal.capital': 'رأس المال',
  'legal.tel': 'الهاتف',
  'legal.email': 'البريد الإلكتروني',
  'legal.web': 'الموقع',
  'legal.address': 'العنوان',

  'col.index': '#',
  'col.image': 'الصورة',
  'col.sku': 'المرجع',
  'col.barcode': 'الباركود',
  'col.description': 'البيان',
  'col.unit': 'الوحدة',
  'col.quantity': 'الكمية',
  'col.unitPrice': 'الثمن الوحدوي',
  'col.discount': 'الخصم',
  'col.vat': 'الضريبة',
  'col.lineTotal': 'المجموع',
  'col.sourceReference': 'مرجع السند',

  'total.subtotal': 'المجموع الفرعي',
  'total.lineDiscounts': 'خصومات السطور',
  'total.globalDiscount': 'الخصم الإجمالي',
  'total.shipping': 'مصاريف التسليم',
  'total.exclVat': 'المجموع بدون ضريبة',
  'total.vat': 'الضريبة على القيمة المضافة',
  'total.inclVat': 'المجموع مع الضريبة',
  'total.vatBase': 'الأساس',
  'total.vatRate': 'النسبة',
  'total.vatAmount': 'مبلغ الضريبة',
  'total.amountInWords': 'المبلغ بالحروف',
  'total.deposit': 'التسبيق',
  'total.balanceDue': 'المبلغ المتبقي',
  'total.paid': 'المدفوع',

  'block.terms': 'الشروط العامة',
  'block.paymentInstructions': 'طرق الدفع',
  'block.bankDetails': 'المعلومات البنكية',
  'block.bank': 'البنك',
  'block.rib': 'الحساب البنكي',
  'block.iban': 'الحساب الدولي',
  'block.swift': 'سويفت',
  'block.notes': 'ملاحظات',
  'block.signature': 'التوقيع',
  'block.clientSignature': 'توقيع العميل',
  'block.companySignature': 'عن الشركة',
  'block.stamp': 'الطابع',
  'block.legalMentions': 'البيانات القانونية',
  'block.vatSummary': 'تفصيل الضريبة',

  'page.xOfY': 'صفحة {x} من {y}',
  'page.x': 'صفحة {x}',
  'page.continued': 'يتبع…',

  'status.draft': 'مسودة',
  'status.validated': 'مُصادق',
  'status.sent': 'مُرسل',
  'status.cancelled': 'مُلغى',
  'status.unpaid': 'غير مدفوع',
  'status.partiallyPaid': 'مدفوع جزئياً',
  'status.paid': 'مدفوع بالكامل',
  'status.overdue': 'متأخر',

  'fulfilment.ordered.partial': 'مطلوب جزئياً',
  'fulfilment.ordered.complete': 'مطلوب',
  'fulfilment.delivered.partial': 'مُسلَّم جزئياً',
  'fulfilment.delivered.complete': 'مُسلَّم',
  'fulfilment.invoiced.partial': 'مُفوتر جزئياً',
  'fulfilment.invoiced.complete': 'مُفوتر',
  'fulfilment.received.partial': 'مُستلَم جزئياً',
  'fulfilment.received.complete': 'مُستلَم',
  'fulfilment.credited.partial': 'مُضمَّن جزئياً في إشعار دائن',
  'fulfilment.credited.complete': 'مُضمَّن بالكامل في إشعار دائن',
  'fulfilment.none.partial': 'قيد التنفيذ',
  'fulfilment.none.complete': 'مكتمل',
};

export const MESSAGES: Record<Locale, DocumentMessages> = { EN, FR, AR };

export type MessageKey = keyof DocumentMessages;

/** Translate, with `{token}` interpolation. */
export function translate(
  locale: Locale,
  key: MessageKey,
  values?: Record<string, string | number>,
): string {
  const template = MESSAGES[locale][key];
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, token: string) =>
    token in values ? String(values[token]) : match,
  );
}

/** A translator bound to one locale, for passing into the renderer. */
export function translator(locale: Locale) {
  return (key: MessageKey, values?: Record<string, string | number>) =>
    translate(locale, key, values);
}

export type Translate = ReturnType<typeof translator>;
