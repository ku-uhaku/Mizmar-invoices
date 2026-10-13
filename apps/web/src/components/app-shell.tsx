'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, unwrap } from '@/lib/api';
import { activeCompanyId, signOut, switchCompany } from '@/lib/session-client';
import { LOCALES } from '@mizmar/i18n';
import { LOCALE_NAMES } from '@/lib/i18n/locale';
import { useLocale, useT } from '@/lib/i18n/provider';
import { Icon, type IconName } from './icons';
import { Avatar, IconButton } from './ui';
import { usePosSettings } from '@/lib/use-pos';
import { assetSrc } from '@/lib/product-images';

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Document type, when the entry is a filtered view of /documents. */
  type?: string;
  /** Hidden when the caisse is switched off for the active company. */
  pos?: boolean;
}

const NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: 'Pilotage',
    items: [{ href: '/dashboard', label: 'Tableau de bord', icon: 'dashboard' }],
  },
  {
    group: 'Ventes',
    items: [
      { href: '/pos', label: 'Caisse', icon: 'wallet', pos: true },
      { href: '/pos/sessions', label: 'Sessions de caisse', icon: 'clock', pos: true },
      { href: '/documents?type=DEVIS', label: 'Devis', icon: 'quote', type: 'DEVIS' },
      { href: '/documents?type=SALES_ORDER', label: 'Bons de commande', icon: 'order', type: 'SALES_ORDER' },
      { href: '/documents?type=DELIVERY_NOTE', label: 'Bons de livraison', icon: 'truck', type: 'DELIVERY_NOTE' },
      { href: '/documents?type=SALES_INVOICE', label: 'Factures', icon: 'invoice', type: 'SALES_INVOICE' },
      { href: '/documents?type=CREDIT_NOTE', label: 'Avoirs', icon: 'credit', type: 'CREDIT_NOTE' },
      { href: '/receivables', label: 'Créances', icon: 'clock' },
      { href: '/recurring', label: 'Factures récurrentes', icon: 'clock' },
    ],
  },
  {
    group: 'Achats',
    items: [
      { href: '/documents?type=PURCHASE_ORDER', label: 'Commandes fournisseur', icon: 'cart', type: 'PURCHASE_ORDER' },
      { href: '/documents?type=GOODS_RECEIPT', label: 'Bons de réception', icon: 'download', type: 'GOODS_RECEIPT' },
      { href: '/documents?type=PURCHASE_INVOICE', label: "Factures d'achat", icon: 'invoice', type: 'PURCHASE_INVOICE' },
      { href: '/payables', label: 'Dettes fournisseurs', icon: 'clock' },
      { href: '/expenses', label: 'Dépenses et factures', icon: 'wallet' },
    ],
  },
  {
    group: 'Stock',
    items: [
      { href: '/stock', label: 'Stock', icon: 'box' },
      { href: '/stock/warehouses', label: 'Entrepôts', icon: 'warehouse' },
      { href: '/stock/transfers', label: 'Transferts', icon: 'truck' },
      { href: '/stock/counts', label: 'Inventaires', icon: 'order' },
      { href: '/stock/lots', label: 'Lots et péremptions', icon: 'clock' },
    ],
  },
  {
    group: 'Données',
    items: [
      { href: '/products', label: 'Produits & services', icon: 'tag' },
      { href: '/products/labels', label: 'Étiquettes code-barres', icon: 'printer' },
      { href: '/contacts', label: 'Clients & fournisseurs', icon: 'users' },
    ],
  },
  {
    group: 'Trésorerie',
    items: [
      { href: '/payments', label: 'Paiements', icon: 'credit' },
      { href: '/cheques', label: 'Suivi des chèques', icon: 'check' },
      { href: '/bank', label: 'Rapprochement bancaire', icon: 'wallet' },
    ],
  },
  {
    group: 'Comptabilité',
    items: [
      { href: '/accounting/trial-balance', label: 'Balance générale', icon: 'layout' },
      { href: '/accounting/journal', label: 'Journal', icon: 'file' },
      { href: '/accounting/ledger', label: 'Grand livre', icon: 'order' },
      { href: '/accounting/accounts', label: 'Plan comptable', icon: 'tag' },
    ],
  },
  {
    group: 'Ressources humaines',
    items: [
      { href: '/hr', label: 'Vue d’ensemble RH', icon: 'dashboard' },
      { href: '/hr/employees', label: 'Employés', icon: 'users' },
      { href: '/hr/leave', label: 'Congés', icon: 'clock' },
      { href: '/hr/attendance', label: 'Présences', icon: 'check' },
      { href: '/hr/payroll', label: 'Paie', icon: 'wallet' },
    ],
  },
  {
    group: 'Rapports',
    items: [
      { href: '/reports', label: 'Tous les rapports', icon: 'dashboard' },
      { href: '/reports/sales', label: 'Rapport des ventes', icon: 'trending' },
      { href: '/reports/vat', label: 'Déclaration de TVA', icon: 'invoice' },
      { href: '/reports/statements', label: 'Relevé de compte', icon: 'file' },
      { href: '/reports/stock-valuation', label: 'Valorisation du stock', icon: 'box' },
    ],
  },
  {
    group: 'Paramètres',
    items: [
      { href: '/settings/company', label: 'Société', icon: 'layout' },
      { href: '/settings/vat-rates', label: 'TVA', icon: 'invoice' },
      { href: '/settings/payment-methods', label: 'Modes de paiement', icon: 'credit' },
      { href: '/settings/expense-categories', label: 'Catégories de dépenses', icon: 'tag' },
      { href: '/settings/pos', label: 'Caisse', icon: 'wallet' },
      { href: '/settings/hr', label: 'Paramètres RH', icon: 'users' },
      { href: '/settings/payroll', label: 'Taux de paie', icon: 'wallet' },
      { href: '/settings/price-lists', label: 'Listes de prix', icon: 'tag' },
      { href: '/settings/exchange-rates', label: 'Taux de change', icon: 'trending' },
      { href: '/settings/numbering', label: 'Numérotation', icon: 'order' },
      { href: '/settings/members', label: 'Membres', icon: 'users' },
      { href: '/settings/whatsapp', label: 'WhatsApp', icon: 'mail' },
      { href: '/settings/templates', label: 'Modèles de document', icon: 'file' },
      { href: '/settings/audit-log', label: 'Journal d’activité', icon: 'clock' },
      { href: '/settings/language', label: 'Langue & apparence', icon: 'sun' },
    ],
  },
];

const CREATE: Array<{ type: string; label: string; icon: IconName }> = [
  { type: 'DEVIS', label: 'Devis', icon: 'quote' },
  { type: 'SALES_INVOICE', label: 'Facture', icon: 'invoice' },
  { type: 'SALES_ORDER', label: 'Bon de commande', icon: 'order' },
  { type: 'DELIVERY_NOTE', label: 'Bon de livraison', icon: 'truck' },
  { type: 'PURCHASE_ORDER', label: 'Commande fournisseur', icon: 'cart' },
];

/** An entry matches the current URL; several can match, the longest wins. */
function matchLength(item: NavItem, pathname: string, type: string | null): number {
  const base = item.href.split('?')[0]!;
  if (item.type) return pathname === base && item.type === type ? base.length + 1000 : -1;
  return pathname === base || pathname.startsWith(`${base}/`) ? base.length : -1;
}

function activeHref(items: NavItem[], pathname: string, type: string | null): string | null {
  let best: string | null = null;
  let bestLength = -1;
  for (const item of items) {
    const length = matchLength(item, pathname, type);
    if (length > bestLength) {
      best = item.href;
      bestLength = length;
    }
  }
  return best;
}

const COLLAPSED_KEY = 'nav-collapsed';

/**
 * The product's own mark, served from apps/web/public/logo.png. Until that file
 * exists (or if it fails to load) the generated star keeps the sidebar intact.
 */
function AppLogo() {
  const [missing, setMissing] = useState(false);
  if (missing) {
    return (
      <div className="star-mark flex size-11 shrink-0 items-center justify-center text-base font-bold text-white drop-shadow-sm">
        M
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="Mizmar"
      onError={() => setMissing(true)}
      className="size-11 shrink-0 rounded-xl object-contain"
    />
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const t = useT();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Read after mount: the cookie does not exist during server rendering, and
  // reading `document` in render would make the two passes disagree.
  const [companyId, setCompanyId] = useState<string | null>(null);
  useEffect(() => setCompanyId(activeCompanyId()), []);

  // Close the drawer whenever the route changes, however it changed.
  useEffect(() => setMobileOpen(false), [pathname, searchParams]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const session = useQuery({
    queryKey: ['session'],
    queryFn: async () => unwrap(await api.auth.me()),
    staleTime: 5 * 60_000,
  });

  const pos = usePosSettings();

  const sections = useMemo(
    () => NAV.map((section) => ({ ...section, items: section.items.filter((item) => pos.enabled || !item.pos) })),
    [pos.enabled],
  );
  const current = activeHref(
    sections.flatMap((section) => section.items),
    pathname,
    searchParams.get('type'),
  );

  // Groups the user folded by hand; the group holding the current page always shows.
  const [collapsed, setCollapsed] = useState<string[]>(['Paramètres']);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLLAPSED_KEY);
      if (saved) setCollapsed(JSON.parse(saved) as string[]);
    } catch {
      // Storage can be blocked; the default folding applies.
    }
  }, []);
  function toggleGroup(group: string) {
    setCollapsed((list) => {
      const next = list.includes(group) ? list.filter((entry) => entry !== group) : [...list, group];
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        // Not persisting is acceptable.
      }
      return next;
    });
  }

  const companies = session.data?.companies ?? [];
  const active = companies.find((company) => company.id === companyId) ?? companies[0];

  return (
    <div className="flex min-h-screen">
      <aside
        className={clsx(
          'fixed inset-y-0 z-40 flex w-65 shrink-0 flex-col overflow-hidden bg-side [&>*:not(.zellige-pattern)]:relative text-side-ink transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full lg:rtl:translate-x-0',
        )}
      >
        <div aria-hidden className="zellige-pattern absolute inset-x-0 top-0 h-56" />
        <div className="relative flex items-center gap-3 px-5 pb-4 pt-5">
          <AppLogo />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold tracking-tight">Mizmar</p>
            <p className="truncate text-xs text-side-muted">
              {session.data?.organizationName ?? ' '}
            </p>
          </div>
          <IconButton
            label={t('Fermer le menu')}
            onClick={() => setMobileOpen(false)}
            className="text-side-muted hover:bg-side-raised hover:text-side-ink lg:hidden"
          >
            <Icon name="x" />
          </IconButton>
        </div>

        {/* The company switcher comes first because every figure below it is
            scoped to the chosen legal entity. */}
        <div className="px-3 pb-3">
          {active?.logoUrl && (
            <div className="mb-2 flex h-16 items-center justify-center rounded-xl bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={assetSrc(active.logoUrl)!}
                alt={active.name}
                className="max-h-full max-w-full object-contain"
              />
            </div>
          )}
          {companies.length > 0 ? (
            <label className="relative block">
              <span className="sr-only">{t('Société')}</span>
              <select
                value={active?.id ?? ''}
                onChange={(event) => void switchCompany(event.target.value)}
                className="h-11 w-full cursor-pointer appearance-none rounded-xl border border-side-border bg-side-raised ps-3 pe-9 text-sm font-medium text-side-ink transition hover:border-side-muted focus:border-brand focus:outline-none"
              >
                {companies.map((company) => (
                  <option key={company.id} value={company.id} className="text-ink">
                    {company.code} — {company.name}
                  </option>
                ))}
              </select>
              <Icon
                name="chevronsUpDown"
                className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-side-muted"
              />
            </label>
          ) : (
            <div className="h-11 animate-pulse rounded-xl bg-side-raised" />
          )}
        </div>

        <nav className="side-scroll flex-1 space-y-3 overflow-y-auto px-3 pb-4 pt-2" aria-label={t('Navigation principale')}>
          {sections.map((section) => {
            const holdsCurrent = section.items.some((item) => item.href === current);
            const open = holdsCurrent || !collapsed.includes(section.group);
            const single = section.items.length === 1;
            return (
              <div key={section.group}>
                {!single && (
                  <button
                    type="button"
                    onClick={() => toggleGroup(section.group)}
                    aria-expanded={open}
                    className="group/head flex w-full items-center justify-between rounded-md px-3 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-side-muted/80 transition-colors hover:text-side-ink"
                  >
                    <span>{t(section.group)}</span>
                    <Icon
                      name="chevronDown"
                      className={clsx('size-3.5 transition-transform', !open && '-rotate-90 rtl:rotate-90')}
                    />
                  </button>
                )}
                {(open || single) && (
                  <ul className="space-y-0.5">
                    {section.items.map((item) => {
                      const isActive = item.href === current;
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            aria-current={isActive ? 'page' : undefined}
                            className={clsx(
                              'relative flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors',
                              isActive
                                ? 'bg-brand/15 font-medium text-white'
                                : 'text-side-muted hover:bg-side-raised hover:text-side-ink',
                            )}
                          >
                            {isActive && (
                              <span className="absolute inset-y-2 start-0 w-0.5 rounded-full bg-brand" />
                            )}
                            <Icon name={item.icon} className={clsx('size-[18px]', isActive && 'text-brand')} />
                            <span className="truncate">{t(item.label)}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>

        <div className="border-t border-side-border p-3">
          <LanguageSwitcher />
          <div className="flex items-center gap-3 rounded-xl p-2">
            {session.data ? (
              <Avatar name={session.data.fullName} className="size-9 bg-side-raised text-side-ink" />
            ) : (
              <div className="size-9 animate-pulse rounded-full bg-side-raised" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{session.data?.fullName ?? ' '}</p>
              <p className="truncate text-xs capitalize text-side-muted">
                {session.data?.role?.toLowerCase()}
              </p>
            </div>
            <IconButton
              label={t('Se déconnecter')}
              onClick={() => void signOut()}
              className="text-side-muted hover:bg-side-raised hover:text-side-ink"
            >
              <Icon name="logout" />
            </IconButton>
          </div>
        </div>
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 animate-fade-in bg-ink/50 backdrop-blur-[2px] lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <div className="relative flex min-w-0 flex-1 flex-col">
        <div aria-hidden className="zellige-pattern zellige-soft absolute inset-x-0 top-14 h-80" />
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-canvas/85 px-4 backdrop-blur-md lg:px-8">
          <IconButton label={t('Ouvrir le menu')} onClick={() => setMobileOpen(true)} className="-ms-2 lg:hidden">
            <Icon name="menu" className="size-5" />
          </IconButton>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="group flex h-9 w-full max-w-md items-center gap-2.5 rounded-lg border border-border bg-surface px-3 text-sm text-ink-subtle shadow-sm transition hover:border-border-strong"
          >
            <Icon name="search" />
            <span className="flex-1 truncate text-start">{t('Rechercher ou aller à…')}</span>
            <kbd className="hidden rounded border border-border bg-surface-muted px-1.5 py-0.5 font-sans text-[11px] text-ink-muted sm:block">
              Ctrl K
            </kbd>
          </button>

          <div className="ms-auto flex items-center gap-1">
            <ThemeToggle />
            <CreateMenu />
          </div>
        </header>

        <main className="relative mx-auto w-full max-w-350 min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function ThemeToggle() {
  const t = useT();
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const explicit = root.dataset.theme;
    setDark(explicit ? explicit === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('theme');
      if (saved) {
        document.documentElement.dataset.theme = saved;
        setDark(saved === 'dark');
      }
    } catch {
      // Storage can be blocked; the OS preference still applies.
    }
    // The settings page can change the theme too.
    const sync = () => {
      const explicit = document.documentElement.dataset.theme;
      setDark(explicit ? explicit === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
    };
    window.addEventListener('mz-theme', sync);
    return () => window.removeEventListener('mz-theme', sync);
  }, []);

  function toggle() {
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    setDark(!dark);
    try {
      localStorage.setItem('theme', next);
    } catch {
      // Not persisting is acceptable.
    }
  }

  return (
    <IconButton label={dark ? t('Mode clair') : t('Mode sombre')} onClick={toggle}>
      <Icon name={dark ? 'sun' : 'moon'} className="size-[18px]" />
    </IconButton>
  );
}

function CreateMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="ms-1 inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-sm font-medium text-white shadow-sm transition hover:bg-brand-strong dark:text-canvas"
      >
        <Icon name="plus" />
        <span className="hidden sm:inline">{t('Nouveau')}</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute end-0 top-11 z-30 w-60 animate-pop-in rounded-xl border border-border bg-surface p-1.5 shadow-(--shadow-pop)"
        >
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
            {t('Créer un document')}
          </p>
          {CREATE.map((entry) => (
            <Link
              key={entry.type}
              role="menuitem"
              href={`/documents/new?type=${entry.type}`}
              onClick={() => setOpen(false)}
              className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink hover:bg-surface-muted"
            >
              <Icon name={entry.icon} className="text-ink-muted" />
              {t(entry.label)}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface PaletteEntry {
  id: string;
  label: string;
  hint: string;
  icon: IconName;
  href: string;
}

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const posEnabled = usePosSettings().enabled;
  const t = useT();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      // The input is mounted in this same commit; wait a frame for focus to stick.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const entries = useMemo<PaletteEntry[]>(() => {
    const pages = NAV.flatMap((section) =>
      section.items.filter((item) => posEnabled || !item.pos).map((item) => ({
        id: item.href,
        label: t(item.label),
        hint: t(section.group),
        icon: item.icon,
        href: item.href,
      })),
    );
    const creates = CREATE.map((entry) => ({
      id: `new-${entry.type}`,
      label: `${t('Nouveau')} ${t(entry.label).toLowerCase()}`,
      hint: t('Créer'),
      icon: 'plus' as IconName,
      href: `/documents/new?type=${entry.type}`,
    }));
    const needle = query.trim().toLowerCase();
    const matches = [...pages, ...creates].filter(
      (entry) => !needle || `${entry.label} ${entry.hint}`.toLowerCase().includes(needle),
    );
    if (needle) {
      matches.unshift({
        id: 'search-docs',
        label: t('Rechercher « {q} » dans les documents', { q: query.trim() }),
        hint: t('Recherche'),
        icon: 'search',
        href: `/documents?search=${encodeURIComponent(query.trim())}`,
      });
    }
    return matches;
  }, [query, t, posEnabled]);

  useEffect(() => setCursor(0), [query]);

  if (!open) return null;

  function go(entry: PaletteEntry | undefined) {
    if (!entry) return;
    onClose();
    router.push(entry.href);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-start justify-center bg-ink/45 p-4 pt-[12vh] backdrop-blur-[3px]"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('Recherche rapide')}
        className="w-full max-w-xl animate-pop-in overflow-hidden rounded-2xl border border-border bg-surface shadow-(--shadow-pop)"
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Icon name="search" className="size-5 text-ink-subtle" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setCursor((value) => Math.min(value + 1, entries.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setCursor((value) => Math.max(value - 1, 0));
              } else if (event.key === 'Enter') go(entries[cursor]);
            }}
            placeholder={t('Aller à une page, créer, chercher un document…')}
            className="h-14 flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink-subtle focus:outline-none"
          />
          <kbd className="rounded border border-border bg-surface-muted px-1.5 py-0.5 font-sans text-[11px] text-ink-muted">
            {t('Échap')}
          </kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-2">
          {entries.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-ink-muted">{t('Aucun résultat')}</li>
          )}
          {entries.map((entry, index) => (
            <li key={entry.id}>
              <button
                type="button"
                onMouseMove={() => setCursor(index)}
                onClick={() => go(entry)}
                className={clsx(
                  'flex h-10 w-full items-center gap-3 rounded-lg px-3 text-start text-sm',
                  index === cursor ? 'bg-brand-soft text-brand' : 'text-ink',
                )}
              >
                <Icon name={entry.icon} className={index === cursor ? '' : 'text-ink-muted'} />
                <span className="flex-1 truncate">{entry.label}</span>
                <span className="text-xs text-ink-subtle">{entry.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function LanguageSwitcher() {
  const t = useT();
  const locale = useLocale();

  async function change(next: string) {
    if (next === locale) return;
    await fetch(`/api/auth/locale?locale=${next}`, { method: 'POST' });
    // Full reload: <html lang dir> and every formatter follow the cookie.
    window.location.reload();
  }

  return (
    <div className="mb-2 flex items-center gap-1 rounded-xl bg-side-raised p-1" role="group" aria-label={t('Langue')}>
      {LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => void change(code)}
          aria-pressed={code === locale}
          title={LOCALE_NAMES[code]}
          className={clsx(
            'h-7 flex-1 rounded-lg text-xs font-semibold transition',
            code === locale ? 'bg-brand text-white' : 'text-side-muted hover:text-side-ink',
          )}
        >
          {code}
        </button>
      ))}
    </div>
  );
}
