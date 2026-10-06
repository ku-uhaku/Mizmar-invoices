import { settingsSchemas } from '@mizmar/contracts';
import type { TemplateConfigBody } from './types';

/**
 * The config a company starts with.
 *
 * Derived by parsing an empty object through the contract schema, so the
 * defaults live in exactly one place: adding a knob to the schema with a
 * default immediately makes it available here with no second list to update.
 */
export const DEFAULT_TEMPLATE_CONFIG: TemplateConfigBody =
  settingsSchemas.templateConfigBody.parse({});

/** Deep-merge a partial config over the defaults, for stored configs. */
export function withDefaults(partial: unknown): TemplateConfigBody {
  return settingsSchemas.templateConfigBody.parse(partial ?? {});
}
