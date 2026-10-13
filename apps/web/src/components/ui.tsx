'use client';

import clsx from 'clsx';
import Link from 'next/link';
import {
  Children,
  Fragment,
  createContext,
  useContext,
  isValidElement,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { useT } from '@/lib/i18n/provider';
import { Icon } from './icons';

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type ButtonSize = 'sm' | 'md';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand text-white shadow-sm hover:bg-brand-strong active:translate-y-px disabled:bg-brand/50 dark:text-canvas',
  secondary:
    'bg-surface text-ink border border-border-strong shadow-sm hover:bg-surface-muted active:translate-y-px',
  ghost: 'text-ink-muted hover:bg-surface-muted hover:text-ink',
  danger: 'bg-danger text-white shadow-sm hover:opacity-90 active:translate-y-px dark:text-canvas',
  subtle: 'bg-brand-soft text-brand hover:bg-brand-soft/70',
};

/** Shared by <Button> and <LinkButton> so a link that looks like a button is identical to one. */
export function buttonClasses(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md') {
  return clsx(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
    'disabled:cursor-not-allowed disabled:opacity-60',
    size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-4 text-sm',
    BUTTON_VARIANTS[variant],
  );
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(buttonClasses(variant, size), className)}
    >
      {loading && <Spinner className="size-3.5" />}
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  variant = 'secondary',
  size = 'md',
  className,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={clsx(buttonClasses(variant, size), className)}>
      {children}
    </Link>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={clsx(
        'inline-flex size-8 items-center justify-center rounded-lg text-ink-muted transition',
        'hover:bg-surface-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export function Card({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={clsx(
        'rounded-card border border-border bg-surface shadow-(--shadow-card)',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
      <div className="min-w-0">
        <h2 className="font-display truncate text-base font-semibold tracking-tight text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="font-display text-[28px] font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badges — the three orthogonal document statuses
// ---------------------------------------------------------------------------

export type BadgeTone = 'neutral' | 'info' | 'progress' | 'success' | 'danger';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted text-ink-muted',
  info: 'bg-info-soft text-info',
  progress: 'bg-warning-soft text-warning',
  success: 'bg-positive-soft text-positive',
  danger: 'bg-danger-soft text-danger',
};

const DOT_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-ink-subtle',
  info: 'bg-info',
  progress: 'bg-warning',
  success: 'bg-positive',
  danger: 'bg-danger',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium leading-4',
        BADGE_TONES[tone],
        className,
      )}
    >
      <span className={clsx('size-1.5 rounded-full', DOT_TONES[tone])} aria-hidden />
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={clsx('block', className)}>
      {label && (
        <span className="mb-1.5 block text-xs font-medium text-ink-muted">
          {label}
          {required && <span className="text-danger"> *</span>}
        </span>
      )}
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-ink-subtle">{hint}</span>
      ) : null}
    </label>
  );
}

const CONTROL =
  'h-9 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm text-ink shadow-sm transition ' +
  'placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/20 ' +
  'disabled:bg-surface-muted disabled:text-ink-muted';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={clsx(CONTROL, className)} />;
}

export function NumberInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      inputMode="decimal"
      {...rest}
      className={clsx(CONTROL, 'tabular text-end', className)}
    />
  );
}

interface FlatOption {
  value: string;
  label: string;
  disabled: boolean;
}

/** Flattens <option> children (fragments, arrays, mapped lists) into plain data. */
function flattenOptions(children: ReactNode, out: FlatOption[] = []): FlatOption[] {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as { value?: unknown; disabled?: boolean; children?: ReactNode };
    if (child.type === Fragment || child.type === 'optgroup') {
      flattenOptions(props.children, out);
    } else if (child.type === 'option') {
      const label = Children.toArray(props.children).join('');
      out.push({
        value: props.value === undefined ? label : String(props.value),
        label,
        disabled: Boolean(props.disabled),
      });
    }
  });
  return out;
}

/**
 * Drop-in replacement for a native <select> that is always searchable.
 * Keeps the native API (`value`, `onChange(event)`, <option> children) so every
 * existing call site gets a type-to-filter dropdown without changes.
 */
export function Select({
  className,
  children,
  value,
  onChange,
  disabled,
  name,
  id,
  'aria-label': ariaLabel,
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const rootRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const options = flattenOptions(children);
  const current = String(value ?? '');
  const selected = options.find((option) => option.value === current) ?? null;
  const needle = term.trim().toLowerCase();
  const items = options.filter((option) => !needle || option.label.toLowerCase().includes(needle));

  useEffect(() => setHighlighted(0), [needle, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    inputRef.current?.focus();
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function close() {
    setOpen(false);
    setTerm('');
  }

  function pick(option: FlatOption) {
    if (option.disabled) return;
    const target = { value: option.value, name: name ?? '' };
    onChange?.({ target, currentTarget: target } as unknown as ChangeEvent<HTMLSelectElement>);
    close();
  }

  function onKeyDown(event: ReactKeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((index) => Math.min(index + 1, items.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = items[highlighted];
      if (option) pick(option);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      close();
    }
  }

  return (
    <span ref={rootRef} className="relative block">
      <button
        type="button"
        id={id}
        disabled={disabled}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((state) => !state)}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'Enter')) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={clsx(CONTROL, 'flex items-center pe-9 text-start', className)}
      >
        <span className={clsx('truncate', !selected?.label && 'text-ink-subtle')}>
          {selected?.label || '—'}
        </span>
      </button>
      <Icon
        name="chevronDown"
        className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle"
      />

      {open && (
        <div className="absolute z-40 mt-1 w-full min-w-48 rounded-xl border border-border bg-surface p-1 shadow-(--shadow-pop)">
          <div className="relative p-1">
            <input
              ref={inputRef}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t('Rechercher…')}
              className="h-8 w-full rounded-lg border border-border-strong bg-surface px-3 pe-8 text-sm text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/20"
            />
            <Icon
              name="search"
              className="pointer-events-none absolute end-4 top-1/2 size-3.5 -translate-y-1/2 text-ink-subtle"
            />
          </div>
          <ul role="listbox" className="max-h-64 overflow-y-auto">
            {items.length === 0 && (
              <li className="px-3 py-3 text-center text-sm text-ink-muted">{t('Aucun résultat')}</li>
            )}
            {items.map((option, index) => (
              <li key={option.value} role="option" aria-selected={option.value === current}>
                <button
                  type="button"
                  disabled={option.disabled}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => pick(option)}
                  className={clsx(
                    'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm disabled:opacity-40',
                    index === highlighted ? 'bg-brand-soft' : 'hover:bg-surface-muted',
                    option.value === current ? 'font-semibold text-brand' : 'text-ink',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label || '—'}</span>
                  {option.value === current && <Icon name="check" className="size-4" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={clsx(CONTROL, 'h-auto min-h-20 py-2', className)} />;
}

export function Checkbox({
  label,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={clsx('flex cursor-pointer items-center gap-2 text-sm text-ink', className)}>
      <input
        type="checkbox"
        {...rest}
        className="size-4 rounded border-border-strong text-brand focus:ring-brand/30"
      />
      <span>{label}</span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={clsx('w-full border-collapse text-sm', className)}>{children}</table>
    </div>
  );
}

export function Th({
  children,
  numeric,
  className,
}: {
  children?: ReactNode;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <th
      className={clsx(
        'border-b border-border bg-surface-muted/60 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted first:rounded-ss-lg last:rounded-se-lg',
        numeric ? 'text-end' : 'text-start',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  numeric,
  className,
  ...rest
}: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      {...rest}
      className={clsx(
        'border-b border-border/70 px-4 py-3 align-top text-ink',
        numeric && 'tabular text-end whitespace-nowrap',
        className,
      )}
    >
      {children}
    </td>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon = 'file',
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: import('./icons').IconName;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-14 text-center">
      <div className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
        <Icon name={icon} className="size-5" />
      </div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description && <p className="max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2.5 text-sm text-danger"
    >
      <Icon name="alert" className="mt-0.5 size-4" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

const DialogContext = createContext<{ close: () => void }>({ close: () => undefined });
export const useDialog = () => useContext(DialogContext);

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Keep the page behind from scrolling under the dialog.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' };

  return (
    <DialogContext.Provider value={{ close: onClose }}>
      <div
        className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center overflow-y-auto bg-ink/45 p-0 backdrop-blur-[3px] sm:items-start sm:p-4 sm:pt-[8vh]"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          className={clsx(
            'w-full animate-pop-in rounded-t-2xl border border-border bg-surface shadow-(--shadow-pop) sm:rounded-card',
            widths[width],
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>
              {description && <p className="mt-0.5 text-xs text-ink-muted">{description}</p>}
            </div>
            <IconButton label={t('Fermer')} onClick={onClose} className="-me-2 -mt-1">
              <Icon name="x" />
            </IconButton>
          </div>
          <div className="max-h-[68vh] overflow-y-auto px-5 py-5">{children}</div>
          {footer && (
            <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-muted/50 px-5 py-3.5 sm:rounded-b-card">
              {footer}
            </div>
          )}
        </div>
      </div>
    </DialogContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton h-4', className)} aria-hidden />;
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  const t = useT();
  return (
    <div className="divide-y divide-border/70" role="status" aria-label={t('Chargement')}>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-6 px-4 py-4">
          {Array.from({ length: cols }, (_, col) => (
            <Skeleton key={col} className={col === 0 ? 'h-4 w-28' : 'h-4 flex-1'} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filtering & navigation
// ---------------------------------------------------------------------------

export function SearchInput({
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <div className={clsx('relative', className)}>
      <Icon
        name="search"
        className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle"
      />
      <input {...rest} type="search" className={clsx(CONTROL, 'ps-9')} />
    </div>
  );
}

/** A row of mutually exclusive options; the quickest filter for a short list. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: ReactNode; count?: number }>;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={clsx(
        'no-scrollbar inline-flex max-w-full gap-0.5 overflow-x-auto rounded-xl bg-surface-muted p-1',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={clsx(
              'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium transition',
              active
                ? 'bg-surface text-ink shadow-sm'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span className="tabular rounded-full bg-border px-1.5 text-[11px] text-ink-muted">
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={clsx(
        'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition',
        active
          ? 'border-brand/40 bg-brand-soft text-brand'
          : 'border-border-strong bg-surface text-ink-muted shadow-sm hover:bg-surface-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

export function Avatar({ name, className }: { name?: string; className?: string }) {
  const initials = (name ?? '?')
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span
      className={clsx(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand',
        className,
      )}
      aria-hidden
    >
      {initials}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

const STAT_TONES = {
  neutral: 'bg-brand-soft text-brand',
  danger: 'bg-danger-soft text-danger',
  progress: 'bg-warning-soft text-warning',
  success: 'bg-positive-soft text-positive',
} as const;

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: import('./icons').IconName;
  tone?: keyof typeof STAT_TONES;
  href?: string;
}) {
  const body = (
    <Card className={clsx('h-full p-4 sm:p-5', href && 'transition hover:border-border-strong hover:shadow-md')}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-ink-muted sm:text-[13px]">{label}</p>
        <span className={clsx('hidden size-8 items-center justify-center rounded-lg sm:flex', STAT_TONES[tone])}>
          <Icon name={icon} />
        </span>
      </div>
      <p className="tabular font-display mt-2 text-xl font-semibold leading-none tracking-tight text-ink sm:mt-3 sm:text-[28px]">
        {value}
      </p>
      {hint && <p className="mt-2 text-xs text-ink-muted">{hint}</p>}
    </Card>
  );
  return href ? (
    <Link href={href} className="block rounded-card focus-visible:outline-2 focus-visible:outline-brand">
      {body}
    </Link>
  ) : (
    body
  );
}

// ---------------------------------------------------------------------------
// Toasts — transient confirmation without a dialog
// ---------------------------------------------------------------------------

interface ToastItem {
  id: number;
  tone: 'success' | 'error' | 'info';
  message: string;
}

let toasts: ToastItem[] = [];
let toastId = 0;
const toastListeners = new Set<() => void>();

function emitToasts(next: ToastItem[]) {
  toasts = next;
  toastListeners.forEach((listener) => listener());
}

function pushToast(tone: ToastItem['tone'], message: string) {
  const id = ++toastId;
  emitToasts([...toasts, { id, tone, message }]);
  setTimeout(() => emitToasts(toasts.filter((item) => item.id !== id)), tone === 'error' ? 6000 : 3500);
}

export const toast = {
  success: (message: string) => pushToast('success', message),
  error: (message: string) => pushToast('error', message),
  info: (message: string) => pushToast('info', message),
};

export function ToastHost() {
  const items = useSyncExternalStore(
    (listener) => {
      toastListeners.add(listener);
      return () => toastListeners.delete(listener);
    },
    () => toasts,
    () => toasts,
  );

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className="pointer-events-auto flex animate-slide-up items-center gap-2.5 rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-canvas shadow-(--shadow-pop)"
        >
          <Icon
            name={item.tone === 'error' ? 'alert' : item.tone === 'success' ? 'check' : 'info'}
            className={clsx(
              'size-4',
              item.tone === 'error' ? 'text-danger' : item.tone === 'success' ? 'text-positive' : 'text-info',
            )}
          />
          {item.message}
        </div>
      ))}
    </div>
  );
}
