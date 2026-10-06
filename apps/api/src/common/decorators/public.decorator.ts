import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'mizmar:isPublic';

/** Opt a route out of authentication (login, refresh, health). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
