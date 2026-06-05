import { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.service';
import { LoginSchema, RefreshSchema, RegisterSchema } from './auth.schema';
import { AppError } from '../../shared/errors/AppError';
import { successResponse, createdResponse } from '../../shared/utils/response';
import { env } from '../../config/env';

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  async register(request: FastifyRequest, reply: FastifyReply) {
    const input = RegisterSchema.parse(request.body);
    const result = await this.authService.register(input);
    return reply.status(201).send(createdResponse(result, 'Account created'));
  }

  async login(request: FastifyRequest, reply: FastifyReply) {
    const input = LoginSchema.parse(request.body);
    const ip = request.ip;
    const result = await this.authService.login(input, ip);
    return reply.send(successResponse(result, 'Login successful'));
  }

  async refresh(request: FastifyRequest, reply: FastifyReply) {
    const { refreshToken } = RefreshSchema.parse(request.body);
    const tokens = await this.authService.refreshTokens(refreshToken);
    return reply.send(successResponse(tokens));
  }

  async logout(request: FastifyRequest, reply: FastifyReply) {
    const { refreshToken } = RefreshSchema.parse(request.body);
    await this.authService.logout(refreshToken);
    return reply.status(204).send();
  }

  async me(request: FastifyRequest, reply: FastifyReply) {
    const user = await request.server.prisma.user.findUnique({
      where: { id: request.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatarUrl: true,
        companyId: true,
        emailVerified: true,
        lastLoginAt: true,
        company: { select: { id: true, name: true, slug: true, plan: true, subscriptionStatus: true } },
      },
    });
    if (!user) throw AppError.notFound('User');
    return reply.send(successResponse(user));
  }

  async githubRedirect(_request: FastifyRequest, reply: FastifyReply) {
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
    url.searchParams.set('redirect_uri', env.GITHUB_CALLBACK_URL);
    url.searchParams.set('scope', 'user:email read:user');
    return reply.redirect(url.toString());
  }

  async githubCallback(
    request: FastifyRequest<{ Querystring: { code?: string; error?: string } }>,
    reply: FastifyReply,
  ) {
    const { code, error } = request.query;
    if (error || !code) throw AppError.unauthorized('GitHub OAuth denied or failed');

    const result = await this.authService.githubCallback(code);
    // Redirect to frontend with tokens (or use a one-time code exchange pattern)
    const redirectUrl = new URL(`${env.FRONTEND_URL}/auth/callback`);
    redirectUrl.searchParams.set('access_token', result.tokens.accessToken);
    redirectUrl.searchParams.set('refresh_token', result.tokens.refreshToken);
    redirectUrl.searchParams.set('is_new', String(result.isNew));
    return reply.redirect(redirectUrl.toString());
  }
}
