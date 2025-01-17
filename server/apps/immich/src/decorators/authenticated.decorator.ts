import { IMMICH_API_KEY_NAME } from '@app/domain';
import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiQuery, ApiSecurity } from '@nestjs/swagger';

interface AuthenticatedOptions {
  admin?: boolean;
  isShared?: boolean;
}

export enum Metadata {
  AUTH_ROUTE = 'auth_route',
  ADMIN_ROUTE = 'admin_route',
  SHARED_ROUTE = 'shared_route',
}

export const Authenticated = (options: AuthenticatedOptions = {}) => {
  const decorators: MethodDecorator[] = [
    ApiBearerAuth(),
    ApiCookieAuth(),
    ApiSecurity(IMMICH_API_KEY_NAME),
    SetMetadata(Metadata.AUTH_ROUTE, true),
  ];

  if (options.admin) {
    decorators.push(SetMetadata(Metadata.ADMIN_ROUTE, true));
  }

  if (options.isShared) {
    decorators.push(SetMetadata(Metadata.SHARED_ROUTE, true));
    decorators.push(ApiQuery({ name: 'key', type: String, required: false }));
  }

  return applyDecorators(...decorators);
};
