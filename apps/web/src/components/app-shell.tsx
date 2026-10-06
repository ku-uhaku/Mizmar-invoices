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

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Document type, when the entry is a filtered view of /documents. */
  type?: string;
}

const NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: 'Pilotage',
    items: [{ href: '/dashboard', label: 'Tableau de bord', icon: 'dashboard' }],
  },
  {
    group: 'Ventes',
    items: [
      { href: '/documents?type=DEVIS', label: 'Devis', icon: 'quote', type: 'DEVIS' },
      { href: '/documents?type=SALES_ORDER', label: 'Bons de commande', icon: 'order', type: 'SALES_ORDER' },
      { href: '/documents?type=DELIVERY_NOTE', label: 'Bons de livraison', icon: 'truck', type: 'DELIVERY_NOTE' },
      { href: '/documents?type=SALES_INVOICE', label: 'Factures', icon: 'invoice', type: 'SALES_INVOICE' },
      { href: '/documents?type=CREDIT_NOTE', label: 'Avoirs', icon: 'credit', type: 'CREDIT_NOTE' },
    ],
  },
  {
    group: 'Achats',
    items: [
      { href: '/documents?type=PURCHASE_ORDER', label: 'Commandes fournisseur', icon: 'cart', type: 'PURCHASE_ORDER' },
      { href: '/documents?type=GOODS_RECEIPT', label: 'Bons de réception', icon: 'download', type: 'GOODS_RECEIPT' },
      { href: '/documents?type=PURCHASE_INVOICE', label: "Factures d'achat", icon: 'invoice', type: 'PURCHASE_INVOICE' },
    ],
  },
  {
    group: 'Données',
    items: [
      { href: '/stock', label: 'Stock', icon: 'box' },
      { href: '/stock/warehouses', label: 'Entrepôts', icon: 'warehouse' },
      { href: '/stock/transfers', label: 'Transferts', icon: 'truck' },
      { href: '/stock/counts', label: 'Inventaires', icon: 'order' },
      { href: '/catalog', label: 'Catalogue', icon: 'tag' },
      { href: '/contacts', label: 'Clients & fournisseurs', icon: 'users' },
      { href: '/payments', label: 'Paiements', icon: 'credit' },
    ],
  },
  {
    group: 'Paramètres',
    items: [{ href: '/settings', label: 'Paramètres', icon: 'layout' }],
  },
];

const CREATE: Array<{ type: string; label: string; icon: IconName }> = [
  { type: 'DEVIS', label: 'Devis', icon: 'quote' },
  { type: 'SALES_INVOICE', label: 'Facture', icon: 'invoice' },
  { type: 'SALES_ORDER', label: 'Bon de commande', icon: 'order' },
  { type: 'DELIVERY_NOTE', label: 'Bon de livraison', icon: 'truck' },
  { type: 'PURCHASE_ORDER', label: 'Commande fournisseur', icon: 'cart' },
];

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

  const companies = session.data?.companies ?? [];
  const active = companies.find((company) => company.id === companyId) ?? companies[0];

  return (
    <div className="flex min-h-screen">
      <aside
        className={clsx(
          'fixed inset-y-0 z-40 flex w-65 shrink-0 flex-col bg-side text-side-ink transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full lg:rtl:translate-x-0',
        )}
      >
        <div className="flex items-center gap-3 px-5 pb-4 pt-5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-brand text-base font-bold text-white shadow-sm">
            M
          </div>
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

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4 pt-2" aria-label={t('Navigation principale')}>
          {NAV.map((section) => (
            <div key={section.group}>
              <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-side-muted/80">
                {t(section.group)}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const base = item.href.split('?')[0]!;
                  // Several entries share /documents and differ only by type,
                  // so the query has to participate in the active check.
                  const isActive = item.type
                    ? pathname === base && item.type === searchParams.get('type')
                    : base === '/stock'
                      ? pathname === base
                      : pathname === base || pathname.startsWith(`${base}/`);

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
            </div>
          ))}
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

      <div className="flex min-w-0 flex-1 flex-col">
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

        <main className="mx-auto w-full max-w-350 min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">
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
      section.items.map((item) => ({
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
  }, [query, t]);

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
