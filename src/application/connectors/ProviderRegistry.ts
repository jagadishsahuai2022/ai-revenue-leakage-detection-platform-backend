import { PrismaClient, IntegrationProvider } from "@prisma/client";

import { RevenueProvider } from "../../domain/connectors";
import { StripeAdapter } from "../../infrastructure/connectors/stripe/StripeAdapter";
import { GithubAdapter } from "../../infrastructure/connectors/github/GithubAdapter";
import { ShopifyAdapter } from "../../infrastructure/connectors/shopify/ShopifyAdapter";
import { SquareAdapter } from "../../infrastructure/connectors/square/SquareAdapter";
import { AppError } from "../../shared/errors/AppError";

/**
 * Lazily-initialised registry that maps every `IntegrationProvider` enum
 * value to its concrete `RevenueProvider` adapter.
 *
 * Adapters are created once per `ProviderRegistry` instance (singleton-by-
 * default in ConnectorEngine). The registry is intentionally not a global
 * singleton so that tests can pass an isolated `PrismaClient`.
 *
 * ## Adding a new provider
 * 1. Create an adapter in `src/infrastructure/connectors/<name>/`
 * 2. Import it here and add an entry to `buildRegistry`.
 * 3. Update the `IntegrationProvider` Prisma enum if also adding to the DB.
 */
export class ProviderRegistry {
  private readonly adapters: Map<IntegrationProvider, RevenueProvider>;

  constructor(prisma: PrismaClient) {
    this.adapters = ProviderRegistry.buildRegistry(prisma);
  }

  /**
   * Retrieve the adapter for the given provider.
   *
   * @throws `AppError.badRequest` if the provider is not supported.
   */
  resolve(provider: IntegrationProvider): RevenueProvider {
    const adapter = this.adapters.get(provider);

    if (!adapter) {
      throw AppError.badRequest(
        `Provider "${provider}" is not supported by the ConnectorEngine. ` +
          `Supported providers: ${[...this.adapters.keys()].join(", ")}`,
      );
    }

    return adapter;
  }

  /** Returns all registered provider IDs */
  supportedProviders(): IntegrationProvider[] {
    return [...this.adapters.keys()];
  }

  // ── private ────────────────────────────────────────────────────────────────

  private static buildRegistry(
    prisma: PrismaClient,
  ): Map<IntegrationProvider, RevenueProvider> {
    const registry = new Map<IntegrationProvider, RevenueProvider>();

    registry.set(IntegrationProvider.STRIPE, new StripeAdapter(prisma));
    registry.set(IntegrationProvider.GITHUB, new GithubAdapter(prisma));
    registry.set(IntegrationProvider.SHOPIFY, new ShopifyAdapter(prisma));
    registry.set(IntegrationProvider.SQUARE, new SquareAdapter(prisma));
    // SLACK / CUSTOM adapters can be added here when implemented

    return registry;
  }
}
