# Phase 4 – AI Agent (Action-Taking) MVP

## Complete Frontend Implementation Guide

**Stack:** Node.js · TypeScript · **Vue 3** (Composition API, `<script setup>`)  
**Backend base URL:** `http://localhost:3000` (dev) / your prod domain  
**API prefix:** `/api/v1`  
**Date implemented:** 2026-03-03

---

## Table of Contents

1. [Overview & Principles](#1-overview--principles)
2. [TypeScript Types](#2-typescript-types)
3. [API SDK (`agentApi.ts`)](#3-api-sdk-agentapits)
4. [Vue Composable (`useAgentProposals.ts`)](#4-vue-composable-useagentproposalsts)
5. [Component: Proposal List (`ProposalList.vue`)](#5-component-proposal-list-proposallistvue)
6. [Component: Proposal Detail + Approval Modal (`ProposalDetailModal.vue`)](#6-component-proposal-detail--approval-modal-proposaldetailmodalvue)
7. [Component: Execution Logs (`ExecutionLogs.vue`)](#7-component-execution-logs-executionlogsvue)
8. [Component: Agent Plan Button (`AgentPlanButton.vue`)](#8-component-agent-plan-button-agentplanbuttonvue)
9. [View: Agent Dashboard (`AgentView.vue`)](#9-view-agent-dashboard-agentviewvue)
10. [UI / UX Rules](#10-ui--ux-rules)
11. [Error Handling Reference](#11-error-handling-reference)
12. [File Structure Checklist](#12-file-structure-checklist)

---

## 1. Overview & Principles

```
Insight  →  [Plan]  →  Proposals (PROPOSED)
                            ↓ Admin reviews
                       [Approve] / [Reject]
                            ↓ Admin triggers
                         [Execute]
                            ↓
                  Immutable Execution Log
```

- **Human-in-the-loop only.** The backend never auto-executes. Every proposal starts PROPOSED and requires explicit APPROVED → Execute steps.
- **Tenant isolation.** The backend resolves `companyId` from the JWT — never send it from the frontend.
- **Whitelist.** Only 6 action types exist (see types below). No free-form actions.
- **Policy enforcement is server-side.** The frontend should mirror the rules for UX feedback but must not rely on them for security.

---

## 2. TypeScript Types

Create `src/types/agent.ts`:

```typescript
// ── Enums ─────────────────────────────────────────────────────────────────────

export type ActionType =
  | "RETRY_PAYMENT"
  | "SEND_COLLECTION_EMAIL"
  | "FLAG_HIGH_RISK_ACCOUNT"
  | "GENERATE_INVOICE"
  | "DISABLE_SUBSCRIPTION"
  | "NOTIFY_FINANCE_TEAM";

export type ProposalStatus =
  | "PROPOSED"
  | "APPROVED"
  | "REJECTED"
  | "EXECUTED"
  | "FAILED"
  | "CANCELLED";

export type ExecutionLogStatus = "SUCCESS" | "FAILED" | "SKIPPED";

// ── Domain objects ────────────────────────────────────────────────────────────

export interface ActionProposal {
  id: string;
  companyId: string;
  insightId: string;
  actionType: ActionType;
  priorityScore: number; // 0–100
  confidenceScore: number; // 0.0–1.0
  estimatedImpact: number; // USD
  payload: Record<string, unknown>;
  rationale: string | null;
  status: ProposalStatus;
  requiresApproval: boolean;
  approvedBy: string | null; // userId
  approvedAt: string | null; // ISO date
  executedAt: string | null; // ISO date
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionLog {
  id: string;
  companyId: string;
  proposalId: string;
  executionType: ActionType;
  payload: unknown;
  result: unknown;
  status: ExecutionLogStatus;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string;
}

// ── Request / Response shapes ─────────────────────────────────────────────────

export interface PlanRequest {
  insightId: string;
  modelId?: string; // e.g. "groq/llama-3.1-8b-instant"
}

export interface PlanResult {
  insightId: string;
  proposals: ActionProposal[];
  totalCreated: number;
}

export interface ListProposalsQuery {
  status?: ProposalStatus;
  insightId?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedProposals {
  items: ActionProposal[];
  total: number;
  page: number;
  limit: number;
}

export interface ApproveRequest {
  notes?: string;
}

export interface RejectRequest {
  reason: string;
}

export interface ExecuteResult {
  proposal: ActionProposal;
  log: ExecutionLog;
}

// ── API envelope ──────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
  code?: string;
}
```

---

## 3. API SDK (`agentApi.ts`)

Create `src/api/agentApi.ts`. Drop-in for any `fetch`-based project; swap `getAuthToken()` with your auth store function.

```typescript
import type {
  PlanRequest,
  PlanResult,
  ListProposalsQuery,
  PaginatedProposals,
  ActionProposal,
  ApproveRequest,
  RejectRequest,
  ExecuteResult,
  ExecutionLog,
  ApiResponse,
} from "../types/agent";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
const PREFIX = "/api/v1/agent";

// ── Replace with your auth token getter ───────────────────────────────────────
function getAuthToken(): string {
  return localStorage.getItem("accessToken") ?? "";
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  const url = new URL(`${BASE}${PREFIX}${path}`);

  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined) url.searchParams.set(k, String(v));
    });
  }

  const res = await fetch(url.toString(), {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAuthToken()}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json: ApiResponse<T> = await res.json();

  if (!res.ok || !json.success) {
    const err = new Error(json.error ?? `HTTP ${res.status}`);
    (err as any).code = json.code;
    (err as any).status = res.status;
    throw err;
  }

  return json.data;
}

// ── Exported API functions ────────────────────────────────────────────────────

/**
 * Ask the AI agent to generate action proposals for an insight.
 * Requires COMPANY_ADMIN role.
 */
export function planForInsight(body: PlanRequest): Promise<PlanResult> {
  return request<PlanResult>("POST", "/plan", body);
}

/**
 * List proposals for the current company.
 * Filterable by status / insightId.
 */
export function listProposals(
  query?: ListProposalsQuery,
): Promise<PaginatedProposals> {
  return request<PaginatedProposals>(
    "GET",
    "/proposals",
    undefined,
    query as any,
  );
}

/**
 * Approve a proposal. Requires COMPANY_ADMIN.
 */
export function approveProposal(
  id: string,
  body?: ApproveRequest,
): Promise<ActionProposal> {
  return request<ActionProposal>(
    "POST",
    `/proposals/${id}/approve`,
    body ?? {},
  );
}

/**
 * Reject a proposal. Requires COMPANY_ADMIN.
 */
export function rejectProposal(
  id: string,
  body: RejectRequest,
): Promise<ActionProposal> {
  return request<ActionProposal>("POST", `/proposals/${id}/reject`, body);
}

/**
 * Execute an APPROVED proposal. Requires COMPANY_ADMIN.
 * Server dispatches action to internal job queue — no direct external call.
 */
export function executeProposal(id: string): Promise<ExecuteResult> {
  return request<ExecuteResult>("POST", `/proposals/${id}/execute`);
}

/**
 * Get execution history for a proposal.
 */
export function getExecutionLogs(proposalId: string): Promise<ExecutionLog[]> {
  return request<ExecutionLog[]>(
    "GET",
    `/proposals/${proposalId}/execution-logs`,
  );
}
```

---

## 4. Vue Composable (`useAgentProposals.ts`)

Create `src/composables/useAgentProposals.ts`:

```typescript
import { ref } from "vue";
import {
  listProposals,
  approveProposal,
  rejectProposal,
  executeProposal,
  planForInsight,
  getExecutionLogs,
} from "../api/agentApi";
import type {
  ActionProposal,
  ExecutionLog,
  PaginatedProposals,
  ListProposalsQuery,
  PlanRequest,
  ApproveRequest,
  RejectRequest,
} from "../types/agent";

export function useAgentProposals() {
  const proposals = ref<ActionProposal[]>([]);
  const pagination = ref({ total: 0, page: 1, limit: 20 });
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load(query?: ListProposalsQuery) {
    loading.value = true;
    error.value = null;
    try {
      const data: PaginatedProposals = await listProposals(query);
      proposals.value = data.items;
      pagination.value = {
        total: data.total,
        page: data.page,
        limit: data.limit,
      };
    } catch (e: any) {
      error.value = e.message;
    } finally {
      loading.value = false;
    }
  }

  async function plan(req: PlanRequest): Promise<ActionProposal[]> {
    loading.value = true;
    error.value = null;
    try {
      const result = await planForInsight(req);
      // prepend new proposals into list
      proposals.value = [...result.proposals, ...proposals.value];
      return result.proposals;
    } catch (e: any) {
      error.value = e.message;
      return [];
    } finally {
      loading.value = false;
    }
  }

  async function approve(id: string, body?: ApproveRequest) {
    const updated = await approveProposal(id, body);
    proposals.value = proposals.value.map((p) => (p.id === id ? updated : p));
    return updated;
  }

  async function reject(id: string, body: RejectRequest) {
    const updated = await rejectProposal(id, body);
    proposals.value = proposals.value.map((p) => (p.id === id ? updated : p));
    return updated;
  }

  async function execute(id: string) {
    const result = await executeProposal(id);
    proposals.value = proposals.value.map((p) =>
      p.id === id ? result.proposal : p,
    );
    return result;
  }

  function fetchLogs(proposalId: string): Promise<ExecutionLog[]> {
    return getExecutionLogs(proposalId);
  }

  return {
    proposals,
    pagination,
    loading,
    error,
    load,
    plan,
    approve,
    reject,
    execute,
    fetchLogs,
  };
}
```

---

## 5. Component: Proposal List (`ProposalList.vue`)

Create `src/components/agent/ProposalList.vue`:

```vue
<script setup lang="ts">
import { onMounted, watch } from "vue";
import { useAgentProposals } from "../../composables/useAgentProposals";
import type { ActionProposal, ProposalStatus } from "../../types/agent";

const props = defineProps<{
  insightId?: string;
  isAdmin: boolean;
}>();

const emit = defineEmits<{
  (e: "select", proposal: ActionProposal): void;
}>();

const STATUS_BADGE: Record<ProposalStatus, string> = {
  PROPOSED: "bg-yellow-100 text-yellow-800",
  APPROVED: "bg-blue-100   text-blue-800",
  REJECTED: "bg-red-100    text-red-800",
  EXECUTED: "bg-green-100  text-green-800",
  FAILED: "bg-red-200    text-red-900",
  CANCELLED: "bg-gray-100   text-gray-600",
};

const ACTION_LABELS: Record<string, string> = {
  RETRY_PAYMENT: "💳 Retry Payment",
  SEND_COLLECTION_EMAIL: "📧 Collection Email",
  FLAG_HIGH_RISK_ACCOUNT: "🚩 Flag High Risk",
  GENERATE_INVOICE: "🧾 Generate Invoice",
  DISABLE_SUBSCRIPTION: "🔴 Disable Subscription",
  NOTIFY_FINANCE_TEAM: "🔔 Notify Finance",
};

function confidenceColour(v: number): string {
  return v >= 0.7
    ? "text-green-700"
    : v >= 0.6
      ? "text-yellow-700"
      : "text-red-600";
}

const { proposals, loading, error, load } = useAgentProposals();

onMounted(() => load({ insightId: props.insightId, page: 1, limit: 20 }));
watch(
  () => props.insightId,
  (id) => load({ insightId: id, page: 1, limit: 20 }),
);
</script>

<template>
  <p v-if="loading" class="text-gray-500 py-4">Loading proposals…</p>
  <p v-else-if="error" class="text-red-600 py-4">Error: {{ error }}</p>
  <p v-else-if="!proposals.length" class="text-gray-400 py-4 italic">
    No proposals yet. Click <strong>Generate Agent Suggestions</strong> on an
    insight.
  </p>

  <div v-else class="overflow-x-auto">
    <table class="min-w-full divide-y divide-gray-200 text-sm">
      <thead class="bg-gray-50">
        <tr>
          <th
            v-for="h in [
              'Action',
              'Priority',
              'Confidence',
              'Est. Impact',
              'Status',
              '',
            ]"
            :key="h"
            class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
          >
            {{ h }}
          </th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100 bg-white">
        <tr
          v-for="p in proposals"
          :key="p.id"
          class="hover:bg-gray-50 cursor-pointer"
          @click="emit('select', p)"
        >
          <td class="px-4 py-3 font-medium text-gray-900">
            {{ ACTION_LABELS[p.actionType] ?? p.actionType }}
          </td>
          <td class="px-4 py-3 text-gray-700">
            {{ Math.round(p.priorityScore) }}
          </td>
          <td class="px-4 py-3">
            <span
              :class="[
                'font-mono text-sm font-semibold',
                confidenceColour(p.confidenceScore),
              ]"
              title="Confidence score (≥0.6 = eligible, ≥0.7 = high)"
            >
              {{ Math.round(p.confidenceScore * 100) }}%
              <span
                v-if="p.confidenceScore < 0.6"
                class="ml-1 text-xs text-red-500"
                >(below threshold)</span
              >
            </span>
          </td>
          <td class="px-4 py-3 text-gray-700">
            ${{
              p.estimatedImpact.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })
            }}
          </td>
          <td class="px-4 py-3">
            <span
              :class="[
                'inline-block rounded-full px-2 py-0.5 text-xs font-semibold',
                STATUS_BADGE[p.status],
              ]"
            >
              {{ p.status }}
            </span>
          </td>
          <td class="px-4 py-3 text-right">
            <button
              v-if="isAdmin && p.status === 'PROPOSED'"
              class="text-xs text-blue-600 hover:underline"
              @click.stop="emit('select', p)"
            >
              Review →
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
```

---

## 6. Component: Proposal Detail + Approval Modal (`ProposalDetailModal.vue`)

Create `src/components/agent/ProposalDetailModal.vue`:

```vue
<script setup lang="ts">
import { ref, computed } from "vue";
import { useAgentProposals } from "../../composables/useAgentProposals";
import ExecutionLogs from "./ExecutionLogs.vue";
import type { ActionProposal } from "../../types/agent";

const props = defineProps<{
  proposal: ActionProposal;
  isAdmin: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "updated", proposal: ActionProposal): void;
}>();

const { approve, reject, execute } = useAgentProposals();

const localProposal = ref<ActionProposal>({ ...props.proposal });
const notes = ref("");
const rejectReason = ref("");
const showReject = ref(false);
const showLogs = ref(false);
const busy = ref(false);
const err = ref<string | null>(null);

// ── Policy mirror (UX only — server also enforces) ────────────────────────────
const canExecute = computed(
  () =>
    localProposal.value.status === "APPROVED" &&
    localProposal.value.confidenceScore >= 0.6 &&
    localProposal.value.estimatedImpact >= 100,
);

async function handleApprove() {
  busy.value = true;
  err.value = null;
  try {
    const updated = await approve(localProposal.value.id, {
      notes: notes.value || undefined,
    });
    localProposal.value = updated;
    emit("updated", updated);
  } catch (e: any) {
    err.value = e.message;
  } finally {
    busy.value = false;
  }
}

async function handleReject() {
  if (!rejectReason.value.trim()) {
    err.value = "Rejection reason is required.";
    return;
  }
  busy.value = true;
  err.value = null;
  try {
    const updated = await reject(localProposal.value.id, {
      reason: rejectReason.value,
    });
    localProposal.value = updated;
    emit("updated", updated);
    showReject.value = false;
  } catch (e: any) {
    err.value = e.message;
  } finally {
    busy.value = false;
  }
}

async function handleExecute() {
  if (
    !confirm(
      `This will queue "${localProposal.value.actionType}" for execution.\n\nEstimated impact: $${localProposal.value.estimatedImpact.toFixed(2)}\n\nContinue?`,
    )
  )
    return;
  busy.value = true;
  err.value = null;
  try {
    const result = await execute(localProposal.value.id);
    localProposal.value = result.proposal;
    emit("updated", result.proposal);
  } catch (e: any) {
    err.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    @click.self="emit('close')"
  >
    <div
      class="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6"
    >
      <!-- Header -->
      <div class="flex items-start justify-between mb-4">
        <div>
          <h2 class="text-lg font-bold text-gray-900">
            {{ localProposal.actionType }}
          </h2>
          <p class="text-xs text-gray-400 mt-0.5">ID: {{ localProposal.id }}</p>
        </div>
        <button
          class="text-gray-400 hover:text-gray-600 text-xl leading-none"
          @click="emit('close')"
        >
          &times;
        </button>
      </div>

      <!-- Error -->
      <div
        v-if="err"
        class="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700"
      >
        {{ err }}
      </div>

      <!-- Status timeline -->
      <div class="mb-4 flex items-center gap-3 text-xs text-gray-500">
        <span
          >Created:
          {{ new Date(localProposal.createdAt).toLocaleString() }}</span
        >
        <span v-if="localProposal.approvedAt"
          >› Approved:
          {{ new Date(localProposal.approvedAt).toLocaleString() }}</span
        >
        <span v-if="localProposal.executedAt"
          >› Executed:
          {{ new Date(localProposal.executedAt).toLocaleString() }}</span
        >
      </div>

      <!-- Scores -->
      <div class="grid grid-cols-3 gap-3 mb-4">
        <div class="rounded-lg bg-gray-50 p-3 text-center">
          <p class="text-xs text-gray-500 mb-1">Priority</p>
          <p class="font-bold text-gray-900">
            {{ Math.round(localProposal.priorityScore) }} / 100
          </p>
        </div>
        <div class="rounded-lg bg-gray-50 p-3 text-center">
          <p class="text-xs text-gray-500 mb-1">Confidence</p>
          <p class="font-bold text-gray-900">
            {{ Math.round(localProposal.confidenceScore * 100) }}%
          </p>
          <p
            v-if="localProposal.confidenceScore < 0.6"
            class="text-xs text-red-500 mt-1"
          >
            Below 0.6 — cannot execute
          </p>
        </div>
        <div class="rounded-lg bg-gray-50 p-3 text-center">
          <p class="text-xs text-gray-500 mb-1">Est. Impact</p>
          <p class="font-bold text-gray-900">
            ${{
              localProposal.estimatedImpact.toLocaleString("en-US", {
                minimumFractionDigits: 2,
              })
            }}
          </p>
          <p
            v-if="localProposal.estimatedImpact < 100"
            class="text-xs text-red-500 mt-1"
          >
            Below $100 minimum
          </p>
        </div>
      </div>

      <!-- Rationale -->
      <div
        v-if="localProposal.rationale"
        class="mb-4 rounded-lg bg-blue-50 border border-blue-100 p-3 text-sm text-blue-800"
      >
        <strong>AI Rationale:</strong> {{ localProposal.rationale }}
      </div>

      <!-- Payload -->
      <details class="mb-4">
        <summary
          class="cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900"
        >
          Execution Payload ▾
        </summary>
        <pre class="mt-2 rounded bg-gray-100 p-3 text-xs overflow-x-auto">{{
          JSON.stringify(localProposal.payload, null, 2)
        }}</pre>
      </details>

      <!-- Admin actions -->
      <div v-if="isAdmin" class="border-t pt-4 space-y-3">
        <!-- PROPOSED state -->
        <template v-if="localProposal.status === 'PROPOSED'">
          <textarea
            v-model="notes"
            class="w-full rounded border border-gray-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            rows="2"
            placeholder="Approval notes (optional)"
          />
          <div class="flex gap-2">
            <button
              class="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              :disabled="busy"
              @click="handleApprove"
            >
              {{ busy ? "Approving…" : "✓ Approve" }}
            </button>
            <button
              class="flex-1 rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
              :disabled="busy"
              @click="showReject = !showReject"
            >
              ✕ Reject
            </button>
          </div>
          <div v-if="showReject" class="space-y-2">
            <textarea
              v-model="rejectReason"
              class="w-full rounded border border-red-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
              rows="2"
              placeholder="Rejection reason (required)"
            />
            <button
              class="w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              :disabled="busy || !rejectReason.trim()"
              @click="handleReject"
            >
              {{ busy ? "Rejecting…" : "Confirm Rejection" }}
            </button>
          </div>
        </template>

        <!-- APPROVED state -->
        <div v-else-if="localProposal.status === 'APPROVED'">
          <p v-if="!canExecute" class="text-xs text-red-500 mb-2">
            Cannot execute: confidence
            {{ Math.round(localProposal.confidenceScore * 100) }}% (min 60%) or
            impact ${{ localProposal.estimatedImpact.toFixed(2) }} (min $100).
          </p>
          <button
            class="w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-40"
            :disabled="!canExecute || busy"
            @click="handleExecute"
          >
            {{ busy ? "Queuing execution…" : "▶ Execute Action" }}
          </button>
        </div>
      </div>

      <!-- Execution logs -->
      <div
        v-if="
          localProposal.status === 'EXECUTED' ||
          localProposal.status === 'FAILED'
        "
        class="mt-4 border-t pt-4"
      >
        <button
          class="text-sm text-blue-600 hover:underline"
          @click="showLogs = !showLogs"
        >
          {{ showLogs ? "Hide" : "Show" }} Execution Logs
        </button>
        <ExecutionLogs v-if="showLogs" :proposal-id="localProposal.id" />
      </div>
    </div>
  </div>
</template>
```

---

## 7. Component: Execution Logs (`ExecutionLogs.vue`)

Create `src/components/agent/ExecutionLogs.vue`:

```vue
<script setup lang="ts">
import { ref, onMounted } from "vue";
import { getExecutionLogs } from "../../api/agentApi";
import type { ExecutionLog } from "../../types/agent";

const props = defineProps<{ proposalId: string }>();

const logs = ref<ExecutionLog[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    logs.value = await getExecutionLogs(props.proposalId);
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <p v-if="loading" class="text-sm text-gray-400 mt-3">Loading logs…</p>
  <p v-else-if="error" class="text-sm text-red-500 mt-3">Error: {{ error }}</p>
  <p v-else-if="!logs.length" class="text-sm text-gray-400 mt-3 italic">
    No execution logs found.
  </p>

  <div v-else class="mt-3 space-y-3">
    <div
      v-for="log in logs"
      :key="log.id"
      :class="[
        'rounded-lg border p-3 text-sm',
        log.status === 'SUCCESS'
          ? 'border-green-200 bg-green-50'
          : 'border-red-200 bg-red-50',
      ]"
    >
      <div class="flex justify-between items-center mb-1">
        <span
          :class="[
            'font-semibold',
            log.status === 'SUCCESS' ? 'text-green-700' : 'text-red-700',
          ]"
        >
          {{ log.status }}
        </span>
        <span class="text-xs text-gray-400">{{
          new Date(log.createdAt).toLocaleString()
        }}</span>
      </div>
      <p v-if="log.errorMessage" class="text-red-600 text-xs mt-1">
        {{ log.errorMessage }}
      </p>
      <p v-if="log.durationMs !== null" class="text-gray-500 text-xs mt-1">
        Duration: {{ log.durationMs }}ms
      </p>
      <details v-if="log.result" class="mt-2">
        <summary class="cursor-pointer text-xs text-gray-500">Result ▾</summary>
        <pre class="mt-1 rounded bg-gray-100 p-2 text-xs overflow-x-auto">{{
          JSON.stringify(log.result, null, 2)
        }}</pre>
      </details>
    </div>
  </div>
</template>
```

---

## 8. Component: Agent Plan Button (`AgentPlanButton.vue`)

Place this inside an **Insight detail** view to trigger planning on demand.

Create `src/components/agent/AgentPlanButton.vue`:

```vue
<script setup lang="ts">
import { ref } from "vue";
import { useAgentProposals } from "../../composables/useAgentProposals";

const props = defineProps<{
  insightId: string;
}>();

const emit = defineEmits<{
  (e: "proposals-ready", count: number): void;
}>();

const { plan } = useAgentProposals();
const busy = ref(false);
const error = ref<string | null>(null);

async function handlePlan() {
  busy.value = true;
  error.value = null;
  try {
    const proposals = await plan({ insightId: props.insightId });
    if (!proposals.length) {
      error.value =
        "The AI agent could not generate proposals for this insight.";
    } else {
      emit("proposals-ready", proposals.length);
    }
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <button
      class="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
      :disabled="busy"
      @click="handlePlan"
    >
      {{
        busy ? "⏳ Generating suggestions…" : "🤖 Generate Agent Suggestions"
      }}
    </button>
    <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>
  </div>
</template>
```

---

## 9. View: Agent Dashboard (`AgentView.vue`)

Standalone full view — accessible at e.g. `/agent` in your Vue Router.

Create `src/views/AgentView.vue`:

```vue
<script setup lang="ts">
import { ref } from "vue";
import ProposalList from "../components/agent/ProposalList.vue";
import ProposalDetailModal from "../components/agent/ProposalDetailModal.vue";
import type { ActionProposal, ProposalStatus } from "../types/agent";

// Replace with your auth composable / Pinia store
const IS_ADMIN = true;

const statusFilter = ref<ProposalStatus | "">("");
const selectedProposal = ref<ActionProposal | null>(null);

const STATUS_FILTERS: Array<{ label: string; value: ProposalStatus | "" }> = [
  { label: "All", value: "" },
  { label: "Proposed", value: "PROPOSED" },
  { label: "Approved", value: "APPROVED" },
  { label: "Executed", value: "EXECUTED" },
  { label: "Failed", value: "FAILED" },
  { label: "Rejected", value: "REJECTED" },
];

function onUpdated(updated: ActionProposal) {
  if (selectedProposal.value?.id === updated.id) {
    selectedProposal.value = updated;
  }
}
</script>

<template>
  <div class="max-w-5xl mx-auto px-4 py-8">
    <!-- Page header -->
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-gray-900">
        AI Agent — Action Proposals
      </h1>
      <p class="text-gray-500 mt-1">
        Review, approve, and execute AI-generated revenue recovery actions. All
        actions require manual approval before execution.
      </p>
    </div>

    <!-- Status filter tabs -->
    <div class="flex gap-2 mb-6 flex-wrap">
      <button
        v-for="f in STATUS_FILTERS"
        :key="f.value"
        :class="[
          'rounded-full px-3 py-1 text-xs font-semibold border transition-colors',
          statusFilter === f.value
            ? 'bg-indigo-600 border-indigo-600 text-white'
            : 'border-gray-200 text-gray-600 hover:border-indigo-300',
        ]"
        @click="statusFilter = f.value"
      >
        {{ f.label }}
      </button>
    </div>

    <!-- Proposal table -->
    <div
      class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden"
    >
      <ProposalList :is-admin="IS_ADMIN" @select="selectedProposal = $event" />
    </div>

    <!-- Detail / approval modal -->
    <ProposalDetailModal
      v-if="selectedProposal"
      :proposal="selectedProposal"
      :is-admin="IS_ADMIN"
      @close="selectedProposal = null"
      @updated="onUpdated"
    />
  </div>
</template>
```

---

## 10. UI / UX Rules

### Confidence score display

| Range       | Colour    | Label                            |
| ----------- | --------- | -------------------------------- |
| ≥ 0.70      | 🟢 Green  | High confidence                  |
| 0.60 – 0.69 | 🟡 Yellow | Meets minimum                    |
| < 0.60      | 🔴 Red    | Below threshold — cannot execute |

### Execution eligibility (client-side mirror of server policy)

```typescript
const canExecute = (p: ActionProposal) =>
  p.status === "APPROVED" &&
  p.confidenceScore >= 0.6 &&
  p.estimatedImpact >= 100;
```

> The server re-validates — this is UX only.

### Status badge colours

```
PROPOSED  → yellow
APPROVED  → blue
EXECUTED  → green
FAILED    → red (darker)
REJECTED  → red
CANCELLED → grey
```

### Action type display labels

```typescript
const ACTION_LABELS: Record<ActionType, string> = {
  RETRY_PAYMENT: "💳 Retry Payment",
  SEND_COLLECTION_EMAIL: "📧 Collection Email",
  FLAG_HIGH_RISK_ACCOUNT: "🚩 Flag High-Risk Account",
  GENERATE_INVOICE: "🧾 Generate Invoice",
  DISABLE_SUBSCRIPTION: "🔴 Disable Subscription",
  NOTIFY_FINANCE_TEAM: "🔔 Notify Finance Team",
};
```

### Execute confirmation

Always show a `window.confirm` (or a custom modal) before calling `executeProposal()`. Include the action type, estimated impact, and the warning that it queues a real job.

---

## 11. Error Handling Reference

| HTTP status | `code` field     | Frontend action                           |
| ----------- | ---------------- | ----------------------------------------- |
| 400         | `BAD_REQUEST`    | Show field-level error inline             |
| 400         | (policy)         | Show violation message from `error` field |
| 401         | `UNAUTHORIZED`   | Redirect to login                         |
| 403         | `FORBIDDEN`      | Show "Insufficient permissions" toast     |
| 404         | `NOT_FOUND`      | Show "Proposal not found" and reload list |
| 429         | `RATE_LIMITED`   | Show retry-after and backoff              |
| 500         | `INTERNAL_ERROR` | Show generic error + suggestion to retry  |

Error payloads from the backend follow this shape:

```json
{
  "success": false,
  "error": "Cannot approve a proposal in status \"APPROVED\".",
  "code": "BAD_REQUEST"
}
```

---

## 12. File Structure Checklist

```
src/
├── types/
│   └── agent.ts                         ← Step 2 — copy-paste directly
├── api/
│   └── agentApi.ts                      ← Step 3 — update getAuthToken()
├── composables/
│   └── useAgentProposals.ts             ← Step 4
├── components/
│   └── agent/
│       ├── ProposalList.vue              ← Step 5
│       ├── ProposalDetailModal.vue       ← Step 6
│       ├── ExecutionLogs.vue             ← Step 7
│       └── AgentPlanButton.vue           ← Step 8
└── views/
    └── AgentView.vue                    ← Step 9 — register route: /agent
```

---

## Quick Wire-Up (Vue Router)

```typescript
// src/router/index.ts  (Vue Router 4)
import { createRouter, createWebHistory } from "vue-router";
import AgentView from "../views/AgentView.vue";

const routes = [
  // ...your existing routes
  { path: "/agent", component: AgentView },
];

export default createRouter({ history: createWebHistory(), routes });
```

To embed the Plan button inside an Insight detail view:

```vue
<script setup lang="ts">
import AgentPlanButton from "../components/agent/AgentPlanButton.vue";
import ProposalList from "../components/agent/ProposalList.vue";
import { ref } from "vue";
import type { ActionProposal } from "../types/agent";

const props = defineProps<{ insightId: string; isAdmin: boolean }>();
const selectedProposal = ref<ActionProposal | null>(null);

function onProposalsReady(count: number) {
  // e.g. use your toast library: toast.success(`${count} proposal(s) generated`)
  console.log(`${count} proposal(s) generated`);
}
</script>

<template>
  <AgentPlanButton
    :insight-id="insightId"
    @proposals-ready="onProposalsReady"
  />

  <ProposalList
    :insight-id="insightId"
    :is-admin="isAdmin"
    @select="selectedProposal = $event"
  />
</template>
```

---

## Backend Route Summary (quick reference)

| Method | Path                                         | Auth          | Description                            |
| ------ | -------------------------------------------- | ------------- | -------------------------------------- |
| `POST` | `/api/v1/agent/plan`                         | COMPANY_ADMIN | Generate proposals for an insight      |
| `GET`  | `/api/v1/agent/proposals`                    | Any authed    | List proposals (paginated, filterable) |
| `POST` | `/api/v1/agent/proposals/:id/approve`        | COMPANY_ADMIN | Approve a proposal                     |
| `POST` | `/api/v1/agent/proposals/:id/reject`         | COMPANY_ADMIN | Reject a proposal                      |
| `POST` | `/api/v1/agent/proposals/:id/execute`        | COMPANY_ADMIN | Execute an approved proposal           |
| `GET`  | `/api/v1/agent/proposals/:id/execution-logs` | Any authed    | Get execution history                  |

> All routes validate the JWT and resolve `companyId` server-side. Never send `companyId` from the frontend.
