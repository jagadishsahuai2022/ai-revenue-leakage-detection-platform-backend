// ─────────────────────────────────────────────────────────────────────────────
// OAuth Token Refresh Service
//
// Automatically detects expired OAuth tokens on ProviderConnection records,
// refreshes them using the provider's token endpoint, and updates the
// connection. Supports retry with exponential backoff.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient, IntegrationProvider } from "@prisma/client";
import {
  encryptCredential,
  decryptCredential,
} from "../../shared/utils/credential-encryption";
import { AppError } from "../../shared/errors/AppError";
import { sleepWithJitter } from "../../shared/utils/jitter";

/** Buffer before actual expiry to trigger proactive refresh (5 minutes). */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/** Maximum number of refresh attempts before marking connection as ERROR. */
const MAX_REFRESH_RETRIES = 3;

/** Provider-specific OAuth token endpoint configuration. */
interface OAuthEndpoint {
  tokenUrl: string;
  /** Additional form fields required by the provider */
  extraParams?: Record<string, string>;
}

const OAUTH_ENDPOINTS: Partial<Record<IntegrationProvider, OAuthEndpoint>> = {
  GITHUB: {
    tokenUrl: "https://github.com/login/oauth/access_token",
  },
  STRIPE: {
    tokenUrl: "https://connect.stripe.com/oauth/token",
  },
  SLACK: {
    tokenUrl: "https://slack.com/api/oauth.v2.access",
  },
};

export interface TokenRefreshResult {
  refreshed: boolean;
  accessToken?: string;
  expiresAt?: Date;
  error?: string;
}

export class TokenRefreshService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Check if a connection's token is expired or about to expire.
   */
  isTokenExpired(expiresAt: Date | null): boolean {
    if (!expiresAt) return false; // No expiry means non-expiring token (e.g. API key)
    return new Date().getTime() >= expiresAt.getTime() - EXPIRY_BUFFER_MS;
  }

  /**
   * Get a valid access token for a connection, refreshing if necessary.
   * Returns the decrypted access token ready for use.
   */
  async getValidToken(connectionId: string): Promise<string> {
    const connection = await this.prisma.providerConnection.findUniqueOrThrow({
      where: { id: connectionId },
    });

    // If token not expired, decrypt and return
    if (!this.isTokenExpired(connection.expiresAt)) {
      if (!connection.accessToken) {
        throw AppError.badRequest("Connection has no access token configured");
      }
      return decryptCredential(connection.accessToken);
    }

    // Token expired – attempt refresh
    const result = await this.refreshToken(connectionId);
    if (!result.refreshed || !result.accessToken) {
      throw AppError.badRequest(
        `Token refresh failed for connection ${connectionId}: ${result.error ?? "unknown error"}`,
      );
    }

    return result.accessToken;
  }

  /**
   * Refresh the OAuth token for a ProviderConnection.
   * Decrypts the stored refresh token, calls the provider's token endpoint,
   * encrypts and stores the new tokens.
   */
  async refreshToken(connectionId: string): Promise<TokenRefreshResult> {
    const connection = await this.prisma.providerConnection.findUniqueOrThrow({
      where: { id: connectionId },
    });

    if (!connection.refreshToken) {
      return {
        refreshed: false,
        error: "No refresh token available for this connection",
      };
    }

    const endpoint = OAUTH_ENDPOINTS[connection.provider];
    if (!endpoint) {
      return {
        refreshed: false,
        error: `OAuth refresh not supported for provider ${connection.provider}`,
      };
    }

    const decryptedRefreshToken = decryptCredential(connection.refreshToken);

    // Decrypt client secret from connection config if available
    let clientId = "";
    let clientSecret = "";
    try {
      const config = connection.encryptedConfig as Record<string, string>;
      clientId = config.clientId ?? "";
      clientSecret = connection.clientSecret
        ? decryptCredential(connection.clientSecret)
        : "";
    } catch {
      // Config may not have client credentials
    }

    let lastError: string | undefined;

    for (let attempt = 0; attempt < MAX_REFRESH_RETRIES; attempt++) {
      try {
        const body = new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: decryptedRefreshToken,
          ...(clientId ? { client_id: clientId } : {}),
          ...(clientSecret ? { client_secret: clientSecret } : {}),
          ...(endpoint.extraParams ?? {}),
        });

        const response = await fetch(endpoint.tokenUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: body.toString(),
        });

        if (!response.ok) {
          const errorText = await response.text();
          lastError = `HTTP ${response.status}: ${errorText}`;

          // If 4xx, don't retry — credentials are invalid
          if (response.status >= 400 && response.status < 500) {
            await this.markConnectionError(connectionId, lastError);
            return { refreshed: false, error: lastError };
          }

          // Equal-jitter exponential backoff for 5xx errors
          await sleepWithJitter(attempt, 1_000, 30_000);
          continue;
        }

        const tokenData = (await response.json()) as {
          access_token: string;
          refresh_token?: string;
          expires_in?: number;
          scope?: string;
        };

        const newExpiresAt = tokenData.expires_in
          ? new Date(Date.now() + tokenData.expires_in * 1000)
          : null;

        // Encrypt and store new tokens
        await this.prisma.providerConnection.update({
          where: { id: connectionId },
          data: {
            accessToken: encryptCredential(tokenData.access_token),
            ...(tokenData.refresh_token
              ? { refreshToken: encryptCredential(tokenData.refresh_token) }
              : {}),
            expiresAt: newExpiresAt,
            ...(tokenData.scope ? { scopes: tokenData.scope } : {}),
            status: "ACTIVE",
          },
        });

        return {
          refreshed: true,
          accessToken: tokenData.access_token,
          expiresAt: newExpiresAt ?? undefined,
        };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        await sleepWithJitter(attempt, 1_000, 30_000);
      }
    }

    // All retries exhausted
    await this.markConnectionError(
      connectionId,
      lastError ?? "Token refresh failed",
    );
    return { refreshed: false, error: lastError };
  }

  /**
   * Scan all connections for a company and refresh any expired tokens.
   */
  async refreshExpiredTokens(companyId: string): Promise<TokenRefreshResult[]> {
    const connections = await this.prisma.providerConnection.findMany({
      where: {
        companyId,
        status: "ACTIVE",
        refreshToken: { not: null },
        expiresAt: { not: null },
      },
    });

    const results: TokenRefreshResult[] = [];

    for (const conn of connections) {
      if (this.isTokenExpired(conn.expiresAt)) {
        const result = await this.refreshToken(conn.id);
        results.push(result);
      }
    }

    return results;
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  private async markConnectionError(
    connectionId: string,
    error: string,
  ): Promise<void> {
    await this.prisma.providerConnection.update({
      where: { id: connectionId },
      data: { status: "ERROR" },
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
