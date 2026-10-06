import { Platform } from 'react-native';

/**
 * One palette, mirroring the web app's tokens so the two products look like
 * one system. Warehouse phones live in bright daylight and dim stockrooms, so
 * contrast is deliberately high.
 */
export const colors = {
  canvas: '#F6F7F9',
  surface: '#FFFFFF',
  surfaceMuted: '#F3F4F6',
  border: '#E5E7EB',
  borderStrong: '#D1D5DB',

  ink: '#111827',
  inkMuted: '#6B7280',
  inkSubtle: '#9CA3AF',

  brand: '#4F46E5',
  brandStrong: '#4338CA',
  brandSoft: '#EEF2FF',

  positive: '#047857',
  positiveSoft: '#ECFDF5',
  warning: '#B45309',
  warningSoft: '#FFFBEB',
  danger: '#B91C1C',
  dangerSoft: '#FEF2F2',
  info: '#1D4ED8',
  infoSoft: '#EFF6FF',

  white: '#FFFFFF',
} as const;

export const spacing = (units: number): number => units * 4;

export const radius = { sm: 6, md: 10, lg: 14, pill: 999 } as const;

export const typography = {
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
} as const;

export const shadow = Platform.select({
  ios: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  android: { elevation: 2 },
  default: {},
});
