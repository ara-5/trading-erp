import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';

export interface AuthUser {
  sub: string;
  email: string;
  name: string;
  role: Role;
  /** Must change password before using anything else. */
  mcp?: boolean;
}

export const IS_PUBLIC = 'isPublic';
const ROLES = 'roles';
const ALLOW_PENDING_PASSWORD = 'allowPendingPassword';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restrict a controller or route to these roles. ADMIN always passes. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** Route stays reachable while the user still has to change their password. */
export const AllowPendingPasswordChange = () => SetMetadata(ALLOW_PENDING_PASSWORD, true);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException();

    let user: AuthUser;
    try {
      user = await this.jwt.verifyAsync<AuthUser>(token);
    } catch {
      throw new UnauthorizedException();
    }
    req.user = user;

    if (user.mcp && !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD, targets)) {
      throw new ForbiddenException('You must change your password before continuing');
    }
    if (process.env.DEMO_MODE === 'true' && !SAFE_METHODS.has(req.method)) {
      throw new ForbiddenException('This is a read-only demo — changes are disabled');
    }

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles?.length && user.role !== Role.ADMIN && !roles.includes(user.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
