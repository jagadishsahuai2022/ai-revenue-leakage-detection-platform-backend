import { PrismaClient } from "@prisma/client";
import { FastifyInstance } from "fastify";
import axios from "axios";
import { AppError } from "../../shared/errors/AppError";
import {
  hashPassword,
  verifyPassword,
  generateSecureToken,
  hashToken,
} from "../../shared/utils/crypto";
import { env } from "../../config/env";
import type { LoginInput, RegisterInput } from "./auth.schema";
import type { JwtPayload } from "../../types";
import { createAuditLog } from "../audit/audit.service";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  avatarUrl: string | null;
  companyId: string;
  company: {
    id: string;
    name: string;
    slug: string;
    plan?: string;
    subscriptionStatus?: string;
  };
}

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly fastify: FastifyInstance,
  ) {}

  // ── Register ────────────────────────────────────────────────────────────────
  async register(
    input: RegisterInput,
  ): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    // Check company slug uniqueness
    const existingCompany = await this.prisma.company.findUnique({
      where: { slug: input.companySlug },
    });
    if (existingCompany) throw AppError.conflict("Company slug already taken");

    const passwordHash = await hashPassword(input.password);

    const company = await this.prisma.company.create({
      data: {
        name: input.companyName,
        slug: input.companySlug,
        billingEmail: input.email,
        users: {
          create: {
            email: input.email,
            name: input.name,
            passwordHash,
            role: "COMPANY_ADMIN",
            emailVerified: false,
          },
        },
      },
      include: { users: true },
    });

    const user = company.users[0]!;
    const tokens = await this.generateTokens(
      user.id,
      company.id,
      user.role as JwtPayload["role"],
      user.email,
    );

    return {
      user: this.formatUser(user, company),
      tokens,
    };
  }

  // ── Login ───────────────────────────────────────────────────────────────────
  async login(
    input: LoginInput,
    ipAddress?: string,
  ): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const user = await this.prisma.user.findFirst({
      where: { email: input.email, isActive: true },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            slug: true,
            plan: true,
            subscriptionStatus: true,
          },
        },
      },
    });

    if (!user) throw AppError.unauthorized("Invalid email or password");
    if (!user.passwordHash)
      throw AppError.unauthorized("Use social login for this account");

    const isValid = await verifyPassword(input.password, user.passwordHash);
    if (!isValid) throw AppError.unauthorized("Invalid email or password");

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.generateTokens(
      user.id,
      user.companyId,
      user.role as JwtPayload["role"],
      user.email,
    );

    // Fire-and-forget audit log — must never break the login flow
    createAuditLog(this.prisma, {
      companyId: user.companyId,
      actorId: user.id,
      actorEmail: user.email,
      actorName: user.name,
      action: "LOGIN",
      resourceType: "SESSION",
      detail: `User logged in from IP ${ipAddress ?? "unknown"}`,
      ipAddress: ipAddress ?? undefined,
    }).catch(() => {
      /* silent */
    });

    return {
      user: this.formatUser(user, user.company),
      tokens,
    };
  }

  // ── Refresh Token ───────────────────────────────────────────────────────────
  async refreshTokens(token: string): Promise<AuthTokens> {
    const tokenHash = hashToken(token);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: tokenHash },
      include: { user: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw AppError.unauthorized("Invalid or expired refresh token");
    }

    // Rotate: revoke old, issue new
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.generateTokens(
      stored.user.id,
      stored.user.companyId,
      stored.user.role as JwtPayload["role"],
      stored.user.email,
    );
  }

  // ── Logout ──────────────────────────────────────────────────────────────────
  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    await this.prisma.refreshToken
      .updateMany({
        where: { token: tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch(() => {}); // silent failure
  }

  // ── GitHub OAuth ─────────────────────────────────────────────────────────────
  async githubCallback(
    code: string,
  ): Promise<{ user: AuthUser; tokens: AuthTokens; isNew: boolean }> {
    // Exchange code for token
    const tokenRes = await axios.post<{ access_token: string }>(
      "https://github.com/login/oauth/access_token",
      {
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
      },
      { headers: { Accept: "application/json" } },
    );

    const accessToken = tokenRes.data.access_token;
    if (!accessToken) throw AppError.unauthorized("GitHub OAuth failed");

    // Fetch user profile
    const profileRes = await axios.get<{
      id: number;
      login: string;
      name: string | null;
      email: string | null;
      avatar_url: string;
    }>("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const profile = profileRes.data;
    const githubId = String(profile.id);

    // Fetch email if not public
    let email = profile.email;
    if (!email) {
      const emailRes = await axios.get<
        Array<{ email: string; primary: boolean; verified: boolean }>
      >("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      email = emailRes.data.find((e) => e.primary && e.verified)?.email ?? null;
    }

    if (!email)
      throw AppError.badRequest("GitHub account has no verified email");

    // Upsert user
    let isNew = false;
    let user = await this.prisma.user.findUnique({ where: { githubId } });

    if (!user) {
      // Check if email already registered
      user = await this.prisma.user.findFirst({ where: { email } });
      if (user) {
        // Link GitHub to existing account
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            githubId,
            githubUsername: profile.login,
            avatarUrl: profile.avatar_url,
          },
        });
      } else {
        isNew = true;
        // Create new company + user
        const slug = profile.login.toLowerCase().replace(/[^a-z0-9]/g, "-");
        const uniqueSlug = await this.uniquifySlug(slug);
        const company = await this.prisma.company.create({
          data: {
            name: profile.name ?? profile.login,
            slug: uniqueSlug,
            billingEmail: email,
            users: {
              create: {
                email,
                name: profile.name ?? profile.login,
                githubId,
                githubUsername: profile.login,
                avatarUrl: profile.avatar_url,
                role: "COMPANY_ADMIN",
                emailVerified: true,
              },
            },
          },
          include: { users: true },
        });
        user = company.users[0]!;
      }
    }

    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: user.companyId },
    });
    const tokens = await this.generateTokens(
      user.id,
      user.companyId,
      user.role as JwtPayload["role"],
      user.email,
    );

    return { user: this.formatUser(user, company), tokens, isNew };
  }

  // ── Internals ────────────────────────────────────────────────────────────────
  private async generateTokens(
    userId: string,
    companyId: string,
    role: JwtPayload["role"],
    email: string,
  ): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: userId, cid: companyId, role, email };

    const accessToken = this.fastify.jwt.sign(payload, {
      expiresIn: env.JWT_EXPIRES_IN,
    });

    // Store hashed refresh token
    const rawRefresh = generateSecureToken(40);
    const refreshHash = hashToken(rawRefresh);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.prisma.refreshToken.create({
      data: { userId, token: refreshHash, expiresAt },
    });

    return { accessToken, refreshToken: rawRefresh, expiresIn: 900 }; // 15 min
  }

  private formatUser(
    user: {
      id: string;
      email: string;
      name: string;
      role: string;
      companyId: string;
      avatarUrl: string | null;
      company?: {
        id: string;
        name: string;
        slug: string;
        plan?: string;
        subscriptionStatus?: string;
      };
    },
    companyRef?: {
      id: string;
      name: string;
      slug: string;
      plan?: string;
      subscriptionStatus?: string;
    },
  ): AuthUser {
    const companyObj = user.company ??
      companyRef ?? {
        id: user.companyId,
        name: "",
        slug: "",
      };

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatarUrl: user.avatarUrl,
      companyId: user.companyId,
      company: {
        id: companyObj.id,
        name: companyObj.name,
        slug: companyObj.slug,
        plan: companyObj.plan,
        subscriptionStatus: companyObj.subscriptionStatus,
      },
    };
  }

  private async uniquifySlug(base: string): Promise<string> {
    let slug = base;
    let i = 1;
    while (await this.prisma.company.findUnique({ where: { slug } })) {
      slug = `${base}-${i++}`;
    }
    return slug;
  }
}
