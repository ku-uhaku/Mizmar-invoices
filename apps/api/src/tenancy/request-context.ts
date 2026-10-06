import type { AppAbility, Role } from '@mizmar/core';

/**
 * Everything a handler needs to know about who is calling and which legal
 * entity they are acting in. Built once by the auth guard and attached to the
 * request, so no service ever re-derives it or forgets to scope a query.
 */
export interface RequestContext {
  userId: string;
  email: string;
  fullName: string;
  membershipId: string;
  organizationId: string;
  organizationName: string;
  role: Role;
  /** Every company this member may act in. */
  companyIds: string[];
  /** The company this request is acting in, from `x-company-id` or the default. */
  companyId: string;
  ability: AppAbility;
}

export interface RequestWithContext {
  ctx?: RequestContext;
}
