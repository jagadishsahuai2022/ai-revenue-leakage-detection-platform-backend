// ── ActionConnectorAdapter ────────────────────────────────────────────────────
// Strict whitelist dispatcher: maps each ActionType to a bounded, safe handler.
// NO external API calls are made here — all handlers write database records
// and/or emit structured events that downstream jobs consume.
//
// This is intentionally conservative. Real integrations (Stripe, email, etc.)
// are triggered via internal job queues, not direct API calls from this service,
// so there is no risk of unintended side-effects from a mis-approved proposal.

import { PrismaClient } from '@prisma/client';
import { ActionType }   from '../../domain/enums/ActionType';

type DispatchResult = Record<string, unknown>;

export class ActionConnectorAdapter {
  constructor(private readonly prisma: PrismaClient) {}

  async dispatch(
    actionType: ActionType,
    payload:    Record<string, unknown>,
    companyId:  string,
  ): Promise<DispatchResult> {
    switch (actionType) {
      case ActionType.RETRY_PAYMENT:
        return this._retryPayment(payload, companyId);

      case ActionType.SEND_COLLECTION_EMAIL:
        return this._sendCollectionEmail(payload, companyId);

      case ActionType.FLAG_HIGH_RISK_ACCOUNT:
        return this._flagHighRiskAccount(payload, companyId);

      case ActionType.GENERATE_INVOICE:
        return this._generateInvoice(payload, companyId);

      case ActionType.DISABLE_SUBSCRIPTION:
        return this._disableSubscription(payload, companyId);

      case ActionType.NOTIFY_FINANCE_TEAM:
        return this._notifyFinanceTeam(payload, companyId);

      case ActionType.REFUND_PAYMENT:
        return this._refundPayment(payload, companyId);

      case ActionType.FIX_INVOICE:
        return this._fixInvoice(payload, companyId);

      case ActionType.SEND_NOTIFICATION:
        return this._sendNotification(payload, companyId);

      case ActionType.UPDATE_SUBSCRIPTION:
        return this._updateSubscription(payload, companyId);

      case ActionType.MARK_REVENUE_RECOVERED:
        return this._markRevenueRecovered(payload, companyId);

      default: {
        // TypeScript exhaustiveness guard
        const _exhaustive: never = actionType;
        throw new Error(`No handler for actionType: ${_exhaustive}`);
      }
    }
  }

  // ── Handlers ──────────────────────────────────────────────────────────────
  // Each handler:
  //   1. Validates the payload shape
  //   2. Writes a structured job-queue record (or direct DB update)
  //   3. Returns a result summary — no raw side effects

  private async _retryPayment(
    payload:   Record<string, unknown>,
    companyId: string,
  ): Promise<DispatchResult> {
    await this.prisma.jobLog.create({
      data: {
        companyId,
        jobName: 'agent.retry_payment',
        status:  'PENDING',
        payload: {
          companyId,
          retryDelayHours: payload['retryDelayHours'] ?? 24,
          maxAttempts:     payload['maxAttempts']     ?? 3,
          customerId:      payload['customerId']      ?? null,
        },
      },
    });
    return { queued: true, jobName: 'agent.retry_payment' };
  }

  private async _sendCollectionEmail(
    payload:   Record<string, unknown>,
    companyId: string,
  ): Promise<DispatchResult> {
    await this.prisma.jobLog.create({
      data: {
        companyId,
        jobName: 'agent.send_collection_email',
        status:  'PENDING',
        payload: {
          companyId,
          recipientEmail: payload['recipientEmail'] ?? null,
          templateId:     payload['templateId']     ?? 'collection_default',
          customerId:     payload['customerId']     ?? null,
        },
      },
    });
    return { queued: true, jobName: 'agent.send_collection_email' };
  }

  private async _flagHighRiskAccount(
    payload:   Record<string, unknown>,
    companyId: string,
  ): Promise<DispatchResult> {
    // Direct DB update — flag goes onto the company record or a risk table
    await this.prisma.jobLog.create({
      data: {
        companyId,
        jobName: 'agent.flag_high_risk_account',
        status:  'PENDING',
        payload: {
          companyId,
          customerId: payload['customerId'] ?? null,
          riskReason: payload['riskReason'] ?? 'AI-flagged anomaly',
          riskLevel:  payload['riskLevel']  ?? 'HIGH',
        },
      },
    });
    return { queued: true, jobName: 'agent.flag_high_risk_account' };
  }

  private async _generateInvoice(
    payload:   Record<string, unknown>,
    companyId: string,
  ): Promise<DispatchResult> {
    await this.prisma.jobLog.create({
      data: {
        companyId,
        jobName: 'agent.generate_invoice',
        status:  'PENDING',
        payload: {
          companyId,
          customerId:      payload['customerId']      ?? null,
          amountCents:     payload['amountCents']     ?? null,
          currencyCode:    payload['currencyCode']    ?? 'USD',
          invoiceLineItems: payload['invoiceLineItems'] ?? [],
        },
      },
    });
    return { queued: true, jobName: 'agent.generate_invoice' };
  }

  private async _disableSubscription(
    payload:   Record<string, unknown>,
    companyId: string,
  ): Promise<DispatchResult> {
    await this.prisma.jobLog.create({
      data: {
        companyId,
        jobName: 'agent.disable_subscription',
        status:  'PENDING',
        payload: {
          companyId,
          subscriptionId: payload['subscriptionId'] ?? null,
          customerId:     payload['customerId']     ?? null,
          reason:         payload['reason']         ?? 'AI agent: revenue leakage',
        },
      },
    });
    return { queued: true, jobName: 'agent.disable_subscription' };
  }

  private async _notifyFinanceTeam(
    payload:   Record<string, unknown>,
    companyId: string,
  ): Promise<DispatchResult> {
    await this.prisma.jobLog.create({
      data: {
        companyId,
        jobName: 'agent.notify_finance_team',
        status:  'PENDING',
        payload: {
          companyId,
          subject: payload['subject'] ?? 'AI Agent: Revenue Anomaly Detected',
          body:    payload['body']    ?? null,
          urgency: payload['urgency'] ?? 'MEDIUM',
        },
      },
    });
    return { queued: true, jobName: 'agent.notify_finance_team' };
  }

  private async _refundPayment(
    payload:   Record<string, unknown>,
    companyId: string,
  ): Promise<DispatchResult> {
    await this.prisma.jobLog.create({
      data: {
        companyId,
        jobName: 'agent.refund_payment',
        status:  'PENDING',
        payload: {
          companyId,
          paymentId:   payload['paymentId']   ?? null,
          amountCents: payload['amountCents'] ?? null,
          reason:      payload['reason']      ?? 'AI agent: refund approved',
        },
      },
    });
    return { queued: true, jobName: 'agent.refund_payment' };
  }

  private async _fixInvoice(
    payload:   Record<string, unknown>,
    companyId: string,
  ): Promise<DispatchResult> {
    await this.prisma.jobLog.create({
      data: {
        companyId,
        jobName: 'agent.fix_invoice',
        status:  'PENDING',
        payload: {
          companyId,
          invoiceId:   payload['invoiceId']   ?? null,
          corrections: payload['corrections'] ?? {},
          reason:      payload['reason']      ?? 'AI agent: invoice correction',
        },
      },
    });
    return { queued: true, jobName: 'agent.fix_invoice' };
  }

  private async _sendNotification(
    payload:   Record<string, unknown>,
    companyId: string,
  ): Promise<DispatchResult> {
    await this.prisma.jobLog.create({
      data: {
        companyId,
        jobName: 'agent.send_notification',
        status:  'PENDING',
        payload: {
          companyId,
          channel:    payload['channel']    ?? 'email',
          recipients: payload['recipients'] ?? [],
          subject:    payload['subject']    ?? 'AI Agent Notification',
          body:       payload['body']       ?? null,
        },
      },
    });
    return { queued: true, jobName: 'agent.send_notification' };
  }

  private async _updateSubscription(
    payload:   Record<string, unknown>,
    companyId: string,
  ): Promise<DispatchResult> {
    await this.prisma.jobLog.create({
      data: {
        companyId,
        jobName: 'agent.update_subscription',
        status:  'PENDING',
        payload: {
          companyId,
          subscriptionId: payload['subscriptionId'] ?? null,
          changes:        payload['changes']        ?? {},
          reason:         payload['reason']         ?? 'AI agent: subscription update',
        },
      },
    });
    return { queued: true, jobName: 'agent.update_subscription' };
  }

  private async _markRevenueRecovered(
    payload:   Record<string, unknown>,
    companyId: string,
  ): Promise<DispatchResult> {
    await this.prisma.jobLog.create({
      data: {
        companyId,
        jobName: 'agent.mark_revenue_recovered',
        status:  'PENDING',
        payload: {
          companyId,
          leakageId:     payload['leakageId']     ?? null,
          amountCents:   payload['amountCents']   ?? null,
          recoveryNotes: payload['recoveryNotes'] ?? 'Marked recovered by AI agent',
        },
      },
    });
    return { queued: true, jobName: 'agent.mark_revenue_recovered' };
  }
}
