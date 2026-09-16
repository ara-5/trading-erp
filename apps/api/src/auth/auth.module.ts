import { BadRequestException, Body, Controller, Get, HttpCode, Injectable, Module, NotFoundException, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import type { CookieOptions, Request, Response } from 'express';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { z } from 'zod';
import { AllowPendingPasswordChange, AuthUser, CurrentUser, Public } from '../common/auth';
import { AuditService } from '../common/common.module';
import { ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';

export const REFRESH_COOKIE = 'erp_rt';
const REUSE_GRACE_MS = 30_000;
const TWO_FACTOR_ISSUER = 'Trading ERP';

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

const twoFactorCodeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') });
const twoFactorDisableSchema = z.object({ password: z.string().min(1) });
const twoFactorVerifySchema = z.object({ challenge: z.string().min(1), code: z.string().trim().min(6).max(20) });

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const normalizeRecoveryCode = (code: string) => code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

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
    if (user.twoFactorEnabled) {
      const challenge = await this.jwt.signAsync({ sub: user.id, purpose: '2fa-login' }, { expiresIn: '5m' });
      return { twoFactorRequired: true as const, challenge };
    }
    await this.audit.log(user.id, 'login', 'User', user.id);
    return { twoFactorRequired: false as const, session: await this.issue(user, userAgent) };
  }

  /** Second step of login when the account has 2FA enabled: exchanges the short-lived challenge + a TOTP/recovery code for a session. */
  async verifyTwoFactorLogin(challenge: string, code: string, userAgent?: string) {
    let payload: { sub: string; purpose: string };
    try {
      payload = await this.jwt.verifyAsync(challenge);
    } catch {
      throw new UnauthorizedException('This code has expired — please sign in again');
    }
    if (payload.purpose !== '2fa-login') throw new UnauthorizedException();
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive || !user.twoFactorEnabled) throw new UnauthorizedException();
    if (!(await this.consumeTwoFactorCode(user, code))) throw new UnauthorizedException('Invalid code');
    await this.audit.log(user.id, 'login-2fa', 'User', user.id);
    return this.issue(user, userAgent);
  }

  /** Starts 2FA enrollment: generates (but does not yet activate) a secret and returns a scannable QR code. */
  async setupTwoFactor(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const secret = authenticator.generateSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorSecret: secret, twoFactorEnabled: false, twoFactorRecoveryCodes: [] } });
    const otpauthUrl = authenticator.keyuri(user.email, TWO_FACTOR_ISSUER, secret);
    return { secret, otpauthUrl, qrCodeDataUrl: await QRCode.toDataURL(otpauthUrl) };
  }

  /** Confirms enrollment with one code from the authenticator app, then activates 2FA and issues one-time recovery codes. */
  async enableTwoFactor(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.twoFactorSecret) throw new BadRequestException('Start 2FA setup first');
    if (!authenticator.verify({ token: code, secret: user.twoFactorSecret })) throw new UnauthorizedException('Invalid code');
    const recoveryCodes = Array.from({ length: 8 }, () => randomBytes(5).toString('hex').toUpperCase().match(/.{1,4}/g)!.join('-'));
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true, twoFactorRecoveryCodes: recoveryCodes.map((c) => hashToken(normalizeRecoveryCode(c))) },
    });
    await this.audit.log(userId, '2fa-enabled', 'User', userId);
    return { recoveryCodes };
  }

  async disableTwoFactor(userId: string, password: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(password, user.passwordHash))) throw new UnauthorizedException('Current password is incorrect');
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorRecoveryCodes: [] } });
    await this.audit.log(userId, '2fa-disabled', 'User', userId);
  }

  /** Accepts either a live TOTP code or a single-use recovery code (consuming it). */
  private async consumeTwoFactorCode(user: User, code: string): Promise<boolean> {
    if (user.twoFactorSecret && /^\d{6}$/.test(code.trim()) && authenticator.verify({ token: code.trim(), secret: user.twoFactorSecret })) {
      return true;
    }
    const hashed = hashToken(normalizeRecoveryCode(code));
    if (!user.twoFactorRecoveryCodes.includes(hashed)) return false;
    await this.prisma.user.update({
      where: { id: user.id },
      data: { twoFactorRecoveryCodes: user.twoFactorRecoveryCodes.filter((c) => c !== hashed) },
    });
    return true;
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
    return { id: u.id, email: u.email, name: u.name, role: u.role, mustChangePassword: u.mustChangePassword, twoFactorEnabled: u.twoFactorEnabled };
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private respond(res: Response, session: { accessToken: string; refreshToken: string; expiresAt: Date; user: unknown }) {
    res.cookie(REFRESH_COOKIE, session.refreshToken, this.auth.cookieOptions(session.expiresAt));
    return { twoFactorRequired: false as const, accessToken: session.accessToken, user: session.user };
  }

  @Public()
  @Throttle({ default: { limit: () => Number(process.env.LOGIN_RATE_LIMIT ?? 10), ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(body.email, body.password, req.headers['user-agent']);
    if (result.twoFactorRequired) return { twoFactorRequired: true as const, challenge: result.challenge };
    return this.respond(res, result.session);
  }

  @Public()
  @Throttle({ default: { limit: () => Number(process.env.LOGIN_RATE_LIMIT ?? 10), ttl: 60_000 } })
  @Post('2fa/verify-login')
  @HttpCode(200)
  async verifyTwoFactorLogin(
    @Body(new ZodPipe(twoFactorVerifySchema)) body: z.infer<typeof twoFactorVerifySchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.verifyTwoFactorLogin(body.challenge, body.code, req.headers['user-agent']));
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

  @Post('2fa/setup')
  @HttpCode(200)
  setupTwoFactor(@CurrentUser() user: AuthUser) {
    return this.auth.setupTwoFactor(user.sub);
  }

  @Post('2fa/enable')
  @HttpCode(200)
  enableTwoFactor(@CurrentUser() user: AuthUser, @Body(new ZodPipe(twoFactorCodeSchema)) body: z.infer<typeof twoFactorCodeSchema>) {
    return this.auth.enableTwoFactor(user.sub, body.code);
  }

  @Post('2fa/disable')
  @HttpCode(204)
  disableTwoFactor(@CurrentUser() user: AuthUser, @Body(new ZodPipe(twoFactorDisableSchema)) body: z.infer<typeof twoFactorDisableSchema>) {
    return this.auth.disableTwoFactor(user.sub, body.password);
  }
}

@Module({
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
