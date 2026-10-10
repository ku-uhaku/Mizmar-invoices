import { templateConfigBody, type TemplateConfigBody } from './settings';

export interface TemplatePreset {
  id: string;
  name: string;
  description: string;
  /** Swatches for the picker card: [primary, accent, background]. */
  swatch: [string, string, string];
  config: TemplateConfigBody;
}

/**
 * Starting designs for the configurator. Each is a partial config parsed
 * through the schema, so any knob a preset does not mention keeps its default
 * and a new schema field never breaks a preset.
 */
const define = (
  id: string,
  name: string,
  description: string,
  swatch: TemplatePreset['swatch'],
  partial: unknown,
): TemplatePreset => ({ id, name, description, swatch, config: templateConfigBody.parse(partial) });

export const TEMPLATE_PRESETS: TemplatePreset[] = [
  define('classic', 'Classique', 'Bleu marine, en-tête sobre, tableau rayé', ['#1E3A8A', '#2563EB', '#FFFFFF'], {}),

  define('modern', 'Moderne', 'Bandeau coloré, angles arrondis, vert profond', ['#0F766E', '#14B8A6', '#F0FDFA'], {
    branding: { headerLayout: 'BANNER', logoPosition: 'CENTER' },
    colors: {
      primary: '#0F766E',
      accent: '#14B8A6',
      tableHeaderBackground: '#0F766E',
      zebraBackground: '#F0FDFA',
      totalsBackground: '#CCFBF1',
      border: '#D1E7E4',
    },
    typography: { headingFont: 'Lato', bodyFont: 'Lato', headingScale: 1.8 },
    layout: { cornerRadiusPx: 10 },
  }),

  define('minimal', 'Minimal', 'Noir et blanc, sans fioritures, peu d’encre', ['#111827', '#6B7280', '#FFFFFF'], {
    branding: { headerLayout: 'MINIMAL' },
    colors: {
      primary: '#111827',
      accent: '#374151',
      tableHeaderBackground: '#FFFFFF',
      tableHeaderText: '#111827',
      zebraStriping: false,
      totalsBackground: '#FFFFFF',
      border: '#D1D5DB',
    },
    typography: { headingFont: 'Roboto', bodyFont: 'Roboto', baseSizePt: 9, headingScale: 1.4 },
    layout: { cornerRadiusPx: 0 },
    columns: { showSku: false, showLineDiscount: false },
  }),

  define('elegant', 'Élégant', 'Logo centré, serif, bordeaux et doré', ['#7F1D1D', '#B45309', '#FFFBEB'], {
    branding: { headerLayout: 'LOGO_CENTER', logoPosition: 'CENTER' },
    colors: {
      primary: '#7F1D1D',
      accent: '#B45309',
      tableHeaderBackground: '#7F1D1D',
      zebraBackground: '#FFFBEB',
      totalsBackground: '#FEF3C7',
      border: '#E7D9B8',
    },
    typography: { headingFont: 'Merriweather', bodyFont: 'Lato', headingScale: 1.7, lineHeight: 1.5 },
    layout: { cornerRadiusPx: 2 },
    content: { showSignatureZones: true },
  }),
];
