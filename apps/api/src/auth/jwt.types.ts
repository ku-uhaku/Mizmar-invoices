export interface AccessTokenPayload {
  /** User id. */
  sub: string;
  email: string;
  organizationId: string;
  membershipId: string;
}

export interface RefreshTokenPayload {
  sub: string;
  /** Id of the RefreshToken row, so rotation can revoke exactly this one. */
  jti: string;
}
