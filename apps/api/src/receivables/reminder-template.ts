export type ReminderLocale = 'FR' | 'EN' | 'AR';

export interface ReminderInvoice {
  number: string;
  dueDate: string;
  daysOverdue: number;
  outstanding: string;
  currency: string;
}

export interface ReminderMessageInput {
  locale: ReminderLocale;
  level: 1 | 2 | 3;
  contactName: string;
  companyName: string;
  invoices: ReminderInvoice[];
}

const COPY = {
  EN: {
    subject: (level: number, nums: string) =>
      level === 3 ? `Final notice: overdue invoice ${nums}` : `Payment reminder: invoice ${nums}`,
    greeting: (name: string) => `Dear ${name},`,
    intro: [
      'This is a friendly reminder that the following invoice(s) are past their due date.',
      'Despite our previous reminder, the following invoice(s) remain unpaid.',
      'This is a final notice: the following invoice(s) are still unpaid.',
    ],
    line: (i: ReminderInvoice) =>
      `- ${i.number}: ${i.outstanding} ${i.currency} due on ${i.dueDate} (${i.daysOverdue} days overdue)`,
    outro: [
      'If payment has already been made, please disregard this message.',
      'Please arrange payment as soon as possible, or contact us if there is an issue.',
      'Please settle this balance immediately to avoid further action.',
    ],
    thanks: 'Kind regards,',
  },
  FR: {
    subject: (level: number, nums: string) =>
      level === 3 ? `Dernier rappel : facture impayée ${nums}` : `Rappel de paiement : facture ${nums}`,
    greeting: (name: string) => `Bonjour ${name},`,
    intro: [
      'Sauf erreur de notre part, la ou les factures suivantes sont arrivées à échéance.',
      'Malgré notre précédent rappel, la ou les factures suivantes restent impayées.',
      'Ceci est une mise en demeure : la ou les factures suivantes demeurent impayées.',
    ],
    line: (i: ReminderInvoice) =>
      `- ${i.number} : ${i.outstanding} ${i.currency} échue le ${i.dueDate} (${i.daysOverdue} jours de retard)`,
    outro: [
      'Si le règlement a déjà été effectué, merci de ne pas tenir compte de ce message.',
      'Merci de procéder au règlement dans les meilleurs délais ou de nous contacter en cas de difficulté.',
      'Merci de régler ce solde immédiatement afin d’éviter toute procédure complémentaire.',
    ],
    thanks: 'Cordialement,',
  },
  AR: {
    subject: (level: number, nums: string) =>
      level === 3 ? `إشعار أخير: فاتورة غير مسددة ${nums}` : `تذكير بالدفع: الفاتورة ${nums}`,
    greeting: (name: string) => `السيد/السيدة ${name}،`,
    intro: [
      'نذكّركم بأن الفاتورة أو الفواتير التالية قد تجاوزت تاريخ الاستحقاق.',
      'رغم تذكيرنا السابق، ما زالت الفاتورة أو الفواتير التالية غير مسددة.',
      'هذا إشعار أخير: الفاتورة أو الفواتير التالية ما زالت غير مسددة.',
    ],
    line: (i: ReminderInvoice) =>
      `- ${i.number}: ${i.outstanding} ${i.currency}، تاريخ الاستحقاق ${i.dueDate} (متأخرة ${i.daysOverdue} يومًا)`,
    outro: [
      'إذا تم السداد بالفعل، يرجى تجاهل هذه الرسالة.',
      'يرجى السداد في أقرب وقت أو الاتصال بنا في حال وجود أي مشكلة.',
      'يرجى تسوية هذا الرصيد فورًا لتفادي أي إجراء إضافي.',
    ],
    thanks: 'مع التحية،',
  },
} as const;

/** Plain-text reminder, localized. Pure so the wording is unit-testable. */
export function buildReminderMessage(input: ReminderMessageInput): {
  subject: string;
  body: string;
} {
  const copy = COPY[input.locale];
  const index = input.level - 1;
  const numbers = input.invoices.map((invoice) => invoice.number).join(', ');
  const body = [
    copy.greeting(input.contactName),
    '',
    copy.intro[index],
    '',
    ...input.invoices.map((invoice) => copy.line(invoice)),
    '',
    copy.outro[index],
    '',
    copy.thanks,
    input.companyName,
  ].join('\n');
  return { subject: copy.subject(input.level, numbers), body };
}
