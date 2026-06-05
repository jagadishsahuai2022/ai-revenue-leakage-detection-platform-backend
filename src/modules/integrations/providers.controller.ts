import { FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";
import { successResponse } from "../../shared/utils/response";

// ── Static provider catalog ────────────────────────────────────────────────
const PROVIDER_CATALOG = [
  {
    id: "STRIPE",
    providerKey: "STRIPE",
    name: "Stripe",
    description: "Payment processing, subscriptions and invoicing",
    category: "payments",
    tags: ["Webhook", "API Key"],
    comingSoon: false,
    iconKey: "stripe",
  },
  {
    id: "GITHUB",
    providerKey: "GITHUB",
    name: "GitHub",
    description: "Source control and developer collaboration platform",
    category: "development",
    tags: ["OAuth"],
    comingSoon: false,
    iconKey: "github",
  },
  {
    id: "SLACK",
    providerKey: "SLACK",
    name: "Slack",
    description: "Team messaging and revenue alert notifications",
    category: "communication",
    tags: ["Webhook", "OAuth"],
    comingSoon: false,
    iconKey: "slack",
  },
  {
    id: "SQUARE",
    providerKey: "SQUARE",
    name: "Square",
    description: "Payments, POS and commerce platform",
    category: "payments",
    tags: ["Webhook", "API Key"],
    comingSoon: false,
    iconKey: "square",
  },
  {
    id: "PAYPAL",
    providerKey: null,
    name: "PayPal",
    description: "Global payments and subscriptions",
    category: "payments",
    tags: ["Webhook"],
    comingSoon: true,
    iconKey: "paypal",
  },
  {
    id: "QUICKBOOKS",
    providerKey: null,
    name: "QuickBooks",
    description: "Accounting, invoicing and financial reporting",
    category: "accounting",
    tags: ["OAuth"],
    comingSoon: true,
    iconKey: "quickbooks",
  },
  {
    id: "SHOPIFY",
    providerKey: "SHOPIFY",
    name: "Shopify",
    description: "E-commerce platform with order and payment tracking",
    category: "payments",
    tags: ["Webhook", "API Key"],
    comingSoon: false,
    iconKey: "shopify",
  },
  {
    id: "XERO",
    providerKey: "XERO",
    name: "Xero",
    description: "Cloud accounting, invoicing and bank reconciliation",
    category: "accounting",
    tags: ["OAuth"],
    comingSoon: true,
    iconKey: "xero",
  },
] as const;

export class ProvidersController {
  constructor(private readonly prisma: PrismaClient) {}

  async listProviders(request: FastifyRequest, reply: FastifyReply) {
    const companyId = request.companyId;

    // Fetch built-in integration records, custom providers, and icon data in parallel
    const [integrations, customProviders, iconRows] = await Promise.all([
      this.prisma.integration.findMany({
        where: { companyId },
        select: {
          provider: true,
          status: true,
          lastSyncAt: true,
          errorMessage: true,
        },
      }),
      this.prisma.customProvider.findMany({
        where: { companyId },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.providerIcon.findMany({
        select: { key: true, iconBg: true, iconSvgPath: true },
      }),
    ]);

    const integrationMap = new Map(
      integrations.map((i) => [i.provider as string, i]),
    );
    const iconMap = new Map(iconRows.map((r) => [r.key, r]));

    // Built-in providers enriched with icon data from DB
    const builtInProviders = PROVIDER_CATALOG.map((p) => {
      const integration = p.providerKey
        ? integrationMap.get(p.providerKey)
        : undefined;
      const icon = iconMap.get(p.iconKey) ?? {
        iconBg: "#6b7280",
        iconSvgPath: "",
      };

      return {
        id: p.id,
        name: p.name,
        description: p.description,
        category: p.category,
        tags: [...p.tags],
        comingSoon: p.comingSoon,
        isCustom: false,
        iconBg: icon.iconBg,
        iconSvgPath: icon.iconSvgPath,
        iconPresetKey: p.iconKey,
        connected: !!integration && integration.status === "ACTIVE",
        status: integration?.status ?? null,
        lastSyncAt: integration?.lastSyncAt ?? null,
        errorMessage: integration?.errorMessage ?? null,
        supportsWebhook: p.tags.includes("Webhook" as never),
        supportsManualSync: !p.comingSoon,
      };
    });

    // Custom providers
    const customList = customProviders.map((cp) => ({
      id: cp.id,
      name: cp.name,
      description: cp.description,
      category: "custom",
      tags: cp.webhookSupport ? ["Webhook"] : [],
      comingSoon: false,
      isCustom: true,
      iconBg: cp.iconBg,
      iconSvgPath: cp.iconSvgPath,
      iconPresetKey: cp.iconPresetKey,
      connected: cp.status === "CONNECTED",
      status: cp.status,
      lastSyncAt: null,
      errorMessage: null,
      supportsWebhook: cp.webhookSupport,
      supportsManualSync: true,
    }));

    return reply.send(successResponse([...builtInProviders, ...customList]));
  }

  async getProviderStatus(
    request: FastifyRequest<{ Params: { provider: string } }>,
    reply: FastifyReply,
  ) {
    const companyId = request.companyId;
    const providerParam = request.params.provider.toUpperCase();

    const catalogEntry = PROVIDER_CATALOG.find((p) => p.id === providerParam);
    if (!catalogEntry) {
      return reply.status(404).send({
        success: false,
        message: `Provider "${providerParam}" not found`,
      });
    }

    const iconRow = await this.prisma.providerIcon.findUnique({
      where: { key: (catalogEntry as any).iconKey },
      select: { iconBg: true, iconSvgPath: true },
    });
    const icon = iconRow ?? { iconBg: "#6b7280", iconSvgPath: "" };

    if (!catalogEntry.providerKey) {
      return reply.send(
        successResponse({
          id: catalogEntry.id,
          name: catalogEntry.name,
          comingSoon: true,
          isCustom: false,
          iconBg: icon.iconBg,
          iconSvgPath: icon.iconSvgPath,
          iconPresetKey: (catalogEntry as any).iconKey,
          connected: false,
          status: null,
        }),
      );
    }

    const integration = await this.prisma.integration.findFirst({
      where: { companyId, provider: catalogEntry.providerKey as any },
      select: {
        id: true,
        status: true,
        lastSyncAt: true,
        errorMessage: true,
        externalId: true,
        config: true,
      },
    });

    return reply.send(
      successResponse({
        id: catalogEntry.id,
        name: catalogEntry.name,
        comingSoon: false,
        isCustom: false,
        iconBg: icon.iconBg,
        iconSvgPath: icon.iconSvgPath,
        iconPresetKey: (catalogEntry as any).iconKey,
        connected: !!integration && integration.status === "ACTIVE",
        status: integration?.status ?? null,
        lastSyncAt: integration?.lastSyncAt ?? null,
        errorMessage: integration?.errorMessage ?? null,
        integration: integration ?? null,
      }),
    );
  }
}
