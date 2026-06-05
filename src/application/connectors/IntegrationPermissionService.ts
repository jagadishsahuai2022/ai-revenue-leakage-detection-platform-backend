// ─────────────────────────────────────────────────────────────────────────────
// Integration Permission Scopes Service
//
// Enforces permission scopes on ProviderConnection operations.
// Scopes: READ_ONLY, READ_WRITE, BILLING_ACCESS, ADMIN
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from '@prisma/client';
import { AppError } from '../../shared/errors/AppError';

/**
 * Available integration permission scopes.
 */
export enum IntegrationScope {
  READ_ONLY = 'READ_ONLY',
  READ_WRITE = 'READ_WRITE',
  BILLING_ACCESS = 'BILLING_ACCESS',
  ADMIN = 'ADMIN',
}

/**
 * Maps operations to required permission scopes.
 */
const OPERATION_SCOPES: Record<string, IntegrationScope[]> = {
  // Read operations
  FETCH_TRANSACTIONS: [IntegrationScope.READ_ONLY, IntegrationScope.READ_WRITE, IntegrationScope.ADMIN],
  FETCH_SUBSCRIPTIONS: [IntegrationScope.READ_ONLY, IntegrationScope.READ_WRITE, IntegrationScope.ADMIN],
  VIEW_LOGS: [IntegrationScope.READ_ONLY, IntegrationScope.READ_WRITE, IntegrationScope.ADMIN],
  VIEW_HEALTH: [IntegrationScope.READ_ONLY, IntegrationScope.READ_WRITE, IntegrationScope.ADMIN],

  // Write operations
  TRIGGER_SYNC: [IntegrationScope.READ_WRITE, IntegrationScope.ADMIN],
  WRITE_DATA: [IntegrationScope.READ_WRITE, IntegrationScope.ADMIN],

  // Billing operations
  BILLING_SYNC: [IntegrationScope.BILLING_ACCESS, IntegrationScope.ADMIN],
  INVOICE_ACCESS: [IntegrationScope.BILLING_ACCESS, IntegrationScope.ADMIN],

  // Admin operations
  CONNECT_PROVIDER: [IntegrationScope.ADMIN],
  DISCONNECT_PROVIDER: [IntegrationScope.ADMIN],
  ROTATE_CREDENTIALS: [IntegrationScope.ADMIN],
  UPDATE_PERMISSIONS: [IntegrationScope.ADMIN],
};

export class IntegrationPermissionService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Check if a connection has the required permission for an operation.
   * Throws AppError.forbidden if permission is denied.
   */
  async enforcePermission(
    connectionId: string,
    operation: string,
  ): Promise<void> {
    const requiredScopes = OPERATION_SCOPES[operation];
    if (!requiredScopes) {
      // Unknown operation — default to ADMIN required
      throw AppError.forbidden(
        `Unknown operation "${operation}". Permission denied.`,
      );
    }

    const connection = await this.prisma.providerConnection.findUniqueOrThrow({
      where: { id: connectionId },
      select: { permissions: true },
    });

    const permissions = this.parsePermissions(connection.permissions);

    // ADMIN scope grants all permissions
    if (permissions.includes(IntegrationScope.ADMIN)) {
      return;
    }

    const hasPermission = requiredScopes.some((scope) =>
      permissions.includes(scope),
    );

    if (!hasPermission) {
      throw AppError.forbidden(
        `Insufficient permissions for operation "${operation}". ` +
          `Required: ${requiredScopes.join(' or ')}. ` +
          `Current: ${permissions.join(', ') || 'none'}`,
      );
    }
  }

  /**
   * Check if a connection has a specific scope (non-throwing).
   */
  async hasPermission(
    connectionId: string,
    operation: string,
  ): Promise<boolean> {
    try {
      await this.enforcePermission(connectionId, operation);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Update permissions for a connection.
   */
  async updatePermissions(
    connectionId: string,
    permissions: IntegrationScope[],
  ): Promise<void> {
    // Validate scopes
    const validScopes = Object.values(IntegrationScope);
    for (const scope of permissions) {
      if (!validScopes.includes(scope)) {
        throw AppError.badRequest(`Invalid permission scope: ${scope}`);
      }
    }

    await this.prisma.providerConnection.update({
      where: { id: connectionId },
      data: { permissions: permissions as unknown as string[] },
    });
  }

  /**
   * Get current permissions for a connection.
   */
  async getPermissions(connectionId: string): Promise<IntegrationScope[]> {
    const connection = await this.prisma.providerConnection.findUniqueOrThrow({
      where: { id: connectionId },
      select: { permissions: true },
    });

    return this.parsePermissions(connection.permissions);
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  private parsePermissions(raw: unknown): IntegrationScope[] {
    if (Array.isArray(raw)) {
      return raw.filter((s): s is IntegrationScope =>
        Object.values(IntegrationScope).includes(s as IntegrationScope),
      );
    }
    return [];
  }
}
