import { Body, Controller, Get, HttpCode, Injectable, Module, NotFoundException, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import type { CookieOptions, Request, Response } from 'express';
import { z } from 'zod';
import { AllowPendingPasswordChange, AuthUser, CurrentUser, Public } from '../common/auth';
import { AuditService } from '../common/common.module';
import { ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';

export const REFRESH_COOKIE = 'erp_rt';
const REUSE_GRACE_MS = 30_000;

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(10, 'Use at least 10 characters').max(200),
  })
  .refine((v) => v.currentPassword !== v.newPassword, { message: 'New password must be different', path: ['newPassword'] });

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Always run bcrypt so response time doesn't reveal whether the email exists.
    const valid = await bcrypt.compare(password, user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
    if (!user || !user.isActive || !valid) throw new UnauthorizedException('Invalid email or password');
    await this.audit.log(user.id, 'login', 'User', user.id);
    return this.issue(user, userAgent);
  }

  /** Rotates the refresh token. Presenting an already-rotated token revokes every session for that user. */
  async refresh(token: string | undefined, userAgent?: string) {
    if (!token) throw new UnauthorizedException('No session');
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    if (!row) throw new UnauthorizedException('Session expired');
    if (row.revokedAt) {
      // Two tabs refreshing at once is normal; a stale token used much later suggests theft.
      if (Date.now() - row.revokedAt.getTime() > REUSE_GRACE_MS) {
        await this.revokeAll(row.userId);
        await this.audit.log(row.userId, 'refresh-token-reuse', 'User', row.userId);
      }
      throw new UnauthorizedException('Session expired');
    }
    if (row.expiresAt < new Date() || !row.user.isActive) throw new UnauthorizedException('Session expired');
    return this.issue(row.user, userAgent, row.id);
  }

  async logout(token: string | undefined) {
    if (!token) return;
    await this.prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException();
    return this.publicUser(user);
  }

  async changePassword(userId: string, current: string, next: string, userAgent?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(current, user.passwordHash))) throw new UnauthorizedException('Current password is incorrect');
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(next, 10), mustChangePassword: false },
    });
    await this.revokeAll(userId);
    await this.audit.log(userId, 'change-password', 'User', userId);
    return this.issue(updated, userAgent);
  }

  cookieOptions(expires?: Date): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get('COOKIE_SECURE') === 'true',
      sameSite: 'lax',
      path: '/api/auth',
      expires,
    };
  }

  private revokeAll(userId: string) {
    return this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private async issue(user: User, userAgent?: string, replacesId?: string) {
    const refreshToken = randomBytes(48).toString('base64url');
    const days = Number(this.config.get('REFRESH_TOKEN_DAYS', 7));
    const row = await this.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now() + days * 86_400_000), userAgent: userAgent?.slice(0, 200) },
    });
    if (replacesId) {
      await this.prisma.refreshToken.update({ where: { id: replacesId }, data: { revokedAt: new Date(), replacedById: row.id } });
    }
    const payload: AuthUser = { sub: user.id, email: user.email, name: user.name, role: user.role, mcp: user.mustChangePassword || undefined };
    return { accessToken: await this.jwt.signAsync(payload), refreshToken, expiresAt: row.expiresAt, user: this.publicUser(user) };
  }

  private publicUser(u: User) {
    return { id: u.id, email: u.email, name: u.name, role: u.role, mustChangePassword: u.mustChangePassword };
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private respond(res: Response, session: { accessToken: string; refreshToken: string; expiresAt: Date; user: unknown }) {
    res.cookie(REFRESH_COOKIE, session.refreshToken, this.auth.cookieOptions(session.expiresAt));
    return { accessToken: session.accessToken, user: session.user };
  }

  @Public()
  @Throttle({ default: { limit: () => Number(process.env.LOGIN_RATE_LIMIT ?? 10), ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.login(body.email, body.password, req.headers['user-agent']));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      return this.respond(res, await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], req.headers['user-agent']));
    } catch (e) {
      res.clearCookie(REFRESH_COOKIE, this.auth.cookieOptions());
      throw e;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, this.auth.cookieOptions());
  }

  @AllowPendingPasswordChange()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.sub);
  }

  @AllowPendingPasswordChange()
  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.changePassword(user.sub, body.currentPassword, body.newPassword, req.headers['user-agent']));
  }
}

@Module({
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
