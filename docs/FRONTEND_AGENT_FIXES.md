# Frontend Fixes — AI Agent (Phase 4)

**Date:** 2026-03-05  
**Status:** Backend verified & tested — all changes below are frontend-only  
**Applies to:** `PHASE4_FRONTEND_IMPLEMENTATION.md` reference code

---

## 🚀 Major Backend Improvement (v2)

**Problem:** The original per-actionType dedup was too aggressive — it limited the system to max 6 PROPOSED proposals total (one per actionType). This meant:

- 1st AI call → 3-4 proposals created ✅
- 2nd AI call → 1-2 proposals created (diminishing returns) ⚠️
- 3rd AI call → 0 proposals created (all 6 types exhausted) ❌

**Each AI call costs money, but returned less and less value.**

**Solution:** **Payload-aware deduplication**

- Changed from blocking duplicate **actionTypes** to blocking duplicate **actions**
- Now allows multiple proposals of the same actionType as long as they target different scenarios (different payloads)
- Example: 3 different `RETRY_PAYMENT` proposals targeting "high-value customers", "at-risk churners", and "dormant accounts"

**Result:**

- Each AI call now returns 4-10+ meaningful proposals (risk-driven, see AI prompt)
- Better ROI: justifies the LLM API cost
- More actionable proposals for admins to review
- Dedup signature: `actionType::payloadHash` prevents only exact duplicates

---

## Backend Changes Summary (v2 Improvement)

**What changed:**

1. **AgentPlannerService.ts** — changed dedup from `existingTypes.has(actionType)` to `existingSignatures.has(signature)`
2. **Added `_proposalSignature()` helper** — computes unique signature as `actionType::payloadHash`
3. **AgentAIClient.ts** — updated prompt to explicitly allow multiple proposals of same actionType if targeting different segments/scenarios
4. **Example output** — prompt now shows HIGH-risk example with 4+ proposals including 2 `RETRY_PAYMENT` targeting different customer segments

**Frontend impact:**

- ✅ No breaking changes — response shape is identical
- ✅ `totalCreated` will now typically be 4-10+ instead of 1-3 on subsequent calls
- ✅ `existingCount` accurately reflects previously-created proposals
- ✅ UI benefits: more proposals to review per AI call = better value

**Testing recommended:**

1. Click "Generate Agent Suggestions" on a HIGH-risk insight
2. Verify you get 4-7 proposals (some may share the same actionType but have different `payload` fields)
3. Click again — instead of getting 0-1 new proposals, you should get 3-5+ new ones with varied payloads
4. Inspect proposal payloads — you should see differentiation like `{ segment: "high_value" }` vs `{ segment: "at_risk" }`

---

## Summary of Issues

| #   | Issue                                                                  | Severity | Root Cause                                                                                                                                                  |
| --- | ---------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | "Could not generate proposals" shown even when proposals already exist | HIGH     | `plan()` returns `proposals: []` when all actionTypes are already PROPOSED (dedup). Frontend only checks `proposals.length`, doesn't check `existingCount`. |
| 2   | `PlanRequest` type missing `context` field                             | HIGH     | Backend now accepts `{ context?: string }` for standalone agent-dashboard flow (no `insightId` needed).                                                     |
| 3   | `PlanResult` type missing `existingCount` field                        | HIGH     | Backend now returns `existingCount: number` so frontend can distinguish "AI returned nothing" vs "all types already exist".                                 |
| 4   | `plan()` composable returns `ActionProposal[]` instead of `PlanResult` | MEDIUM   | The composable discards `totalCreated` and `existingCount` — callers can't differentiate zero-new-proposals scenarios.                                      |
| 5   | `executeProposal()` API call sends no body                             | LOW      | Must send `{}` (empty JSON body) because the global body parser rejects bodyless POSTs with 500.                                                            |
| 6   | Backend route table missing `POST /proposals/cleanup`                  | INFO     | New admin endpoint to remove duplicate PROPOSED proposals.                                                                                                  |

---

## Fix 1 — Update TypeScript Types (`src/types/agent.ts`)

### 1a. Update `PlanRequest`

```diff
  export interface PlanRequest {
-   insightId: string;
+   insightId?: string;
+   context?: string;
    modelId?: string;
  }
```

**Why:** Backend now accepts **either** `insightId` or `context` (at least one required). When user clicks "Generate" on an insight detail page, send `insightId`. When using the standalone agent dashboard, send `context`.

### 1b. Update `PlanResult`

```diff
  export interface PlanResult {
    insightId: string;
    proposals: ActionProposal[];
    totalCreated: number;
+   existingCount: number;
  }
```

**Why:** Backend now returns `existingCount` — the number of already-existing PROPOSED proposals for this insight. This lets the frontend tell the user "4 proposals already exist" instead of showing an error.

### 1c. Add `CleanupResult` type (optional — for cleanup button)

```typescript
export interface CleanupResult {
  deleted: number;
  message: string;
}
```

---

## Fix 2 — Update API SDK (`src/api/agentApi.ts`)

### 2a. Fix `executeProposal` — send empty body

The backend's global body parser (raw-body for Stripe webhooks) throws a 500 if no JSON body is sent on POST requests. Ensure all POST calls send at least `{}`.

```diff
  export function executeProposal(id: string): Promise<ExecuteResult> {
-   return request<ExecuteResult>("POST", `/proposals/${id}/execute`);
+   return request<ExecuteResult>("POST", `/proposals/${id}/execute`, {});
  }
```

### 2b. Add cleanup API function (optional)

```typescript
/**
 * Remove duplicate PROPOSED proposals (keeps newest per actionType).
 * Requires COMPANY_ADMIN.
 */
export function cleanupDuplicateProposals(): Promise<CleanupResult> {
  return request<CleanupResult>("POST", "/proposals/cleanup", {});
}
```

### 2c. Fix `request()` body handling

Ensure body is always stringified when present (even empty `{}`):

```typescript
// In request() function — current code should already handle this,
// but verify the body nullish check:
body: body !== undefined ? JSON.stringify(body) : undefined,
```

---

## Fix 3 — Update Composable (`src/composables/useAgentProposals.ts`)

### 3a. Change `plan()` return type from `ActionProposal[]` to `PlanResult`

This is the **critical fix**. The composable currently discards the metadata the backend sends:

**Before (broken):**

```typescript
async function plan(req: PlanRequest): Promise<ActionProposal[]> {
  loading.value = true;
  error.value = null;
  try {
    const result = await planForInsight(req);
    proposals.value = [...result.proposals, ...proposals.value];
    return result.proposals; // ← discards totalCreated & existingCount
  } catch (e: any) {
    error.value = e.message;
    return [];
  } finally {
    loading.value = false;
  }
}
```

**After (fixed):**

```typescript
async function plan(req: PlanRequest): Promise<PlanResult> {
  loading.value = true;
  error.value = null;
  try {
    const result = await planForInsight(req);
    // Prepend new proposals (if any) into the reactive list
    if (result.proposals.length > 0) {
      proposals.value = [...result.proposals, ...proposals.value];
    }
    return result; // ← full PlanResult with all metadata
  } catch (e: any) {
    error.value = e.message;
    // Return a safe fallback so callers can still check fields
    return {
      insightId: req.insightId ?? "",
      proposals: [],
      totalCreated: 0,
      existingCount: 0,
    };
  } finally {
    loading.value = false;
  }
}
```

### 3b. (Optional) Add cleanup function

```typescript
async function cleanup(): Promise<CleanupResult> {
  loading.value = true;
  error.value = null;
  try {
    const result = await cleanupDuplicateProposals();
    // After cleanup, reload the current view
    await load();
    return result;
  } catch (e: any) {
    error.value = e.message;
    return { deleted: 0, message: e.message };
  } finally {
    loading.value = false;
  }
}

// Add to the return object:
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
  cleanup, // ← new
};
```

---

## Fix 4 — Update `AgentPlanButton.vue`

This is the component that triggers plan generation. It must handle 3 possible outcomes:

**Before (broken):**

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

**After (fixed):**

```vue
<script setup lang="ts">
import { ref } from "vue";
import { useAgentProposals } from "../../composables/useAgentProposals";

const props = defineProps<{
  insightId: string;
}>();

const emit = defineEmits<{
  (e: "proposals-ready", count: number): void;
  (e: "proposals-exist", count: number): void;
}>();

const { plan } = useAgentProposals();
const busy = ref(false);
const error = ref<string | null>(null);
const info = ref<string | null>(null);

async function handlePlan() {
  busy.value = true;
  error.value = null;
  info.value = null;
  try {
    const result = await plan({ insightId: props.insightId });

    if (result.totalCreated > 0) {
      // New proposals were created
      emit("proposals-ready", result.totalCreated);
    } else if (result.existingCount > 0) {
      // No new proposals, but existing ones cover all action types
      info.value =
        `${result.existingCount} action proposal(s) already exist for this insight. ` +
        `Approve, reject, or execute existing proposals to allow new ones.`;
      emit("proposals-exist", result.existingCount);
    } else {
      // AI genuinely returned nothing
      error.value =
        "The AI agent could not generate proposals for this insight. Please try again.";
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
    <p v-if="info" class="mt-2 text-sm text-blue-600">{{ info }}</p>
  </div>
</template>
```

### Key Changes:

1. **New emit**: `proposals-exist` — parent can react (e.g. scroll to proposal list)
2. **`info` ref**: Shows blue informational message when proposals already exist
3. **3-way branch**: `totalCreated > 0` → success, `existingCount > 0` → info, else → error
4. `plan()` now returns `PlanResult` (not `ActionProposal[]`), so we access `result.totalCreated` and `result.existingCount`

---

## Fix 5 — Update `AgentView.vue` (standalone agent dashboard)

If the standalone agent view sends a plan request without an `insightId`, use `context` instead:

```diff
  async function handleGenerateProposals() {
    busy.value = true;
    error.value = null;
+   info.value = null;
    try {
-     const proposals = await plan({ insightId: selectedInsightId.value });
-     if (!proposals.length) {
-       error.value = "No proposals generated.";
-     }
+     const result = await plan(
+       selectedInsightId.value
+         ? { insightId: selectedInsightId.value }
+         : { context: "Analyze all revenue data and identify recovery actions" }
+     );
+
+     if (result.totalCreated > 0) {
+       // Reload the proposals list to show the new ones
+       await load({ page: 1, limit: 20 });
+     } else if (result.existingCount > 0) {
+       info.value =
+         `${result.existingCount} proposals already exist. ` +
+         `Review and act on existing proposals first.`;
+     } else {
+       error.value = "No proposals could be generated. Try running AI insights first.";
+     }
    } catch (e: any) {
      error.value = e.message;
    } finally {
      busy.value = false;
    }
  }
```

---

## Fix 6 — Handle `estimatedImpact` Display for Old Proposals

Some proposals created before the backend fix may still have `estimatedImpact: 0`. Update the `canExecute` logic and display:

### 6a. `ProposalDetailModal.vue` — show warning for zero-impact proposals

```diff
  const canExecute = computed(
    () =>
      localProposal.value.status === "APPROVED" &&
      localProposal.value.confidenceScore >= 0.6 &&
      localProposal.value.estimatedImpact >= 100,
  );
```

This stays the same. The `estimatedImpact >= 100` gate is correct. But add a user-facing explanation:

```vue
<!-- Inside the APPROVED state section -->
<div v-else-if="localProposal.status === 'APPROVED'">
  <p v-if="!canExecute" class="text-xs text-red-500 mb-2">
    <template v-if="localProposal.estimatedImpact < 100">
      Cannot execute: estimated impact is ${{ localProposal.estimatedImpact.toFixed(2) }}
      (minimum $100 required). This is a legacy proposal — reject it and
      re-generate to get an updated impact estimate.
    </template>
    <template v-else-if="localProposal.confidenceScore < 0.6">
      Cannot execute: confidence {{ Math.round(localProposal.confidenceScore * 100) }}%
      is below the 60% minimum threshold.
    </template>
  </p>
  <!-- ... execute button ... -->
</div>
```

---

## Fix 7 — (Optional) Add Cleanup Button

Add a small admin utility button to remove duplicate proposals. Place it in `AgentView.vue` or as a separate small component:

```vue
<script setup lang="ts">
import { ref } from "vue";
import { useAgentProposals } from "../../composables/useAgentProposals";

const { cleanup } = useAgentProposals();
const busy = ref(false);
const message = ref<string | null>(null);

async function handleCleanup() {
  if (
    !confirm(
      "Remove duplicate PROPOSED proposals? This keeps only the newest per action type.",
    )
  )
    return;
  busy.value = true;
  message.value = null;
  try {
    const result = await cleanup();
    message.value = result.message;
  } catch (e: any) {
    message.value = `Error: ${e.message}`;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="inline-flex items-center gap-2">
    <button
      class="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
      :disabled="busy"
      @click="handleCleanup"
    >
      {{ busy ? "Cleaning…" : "🧹 Deduplicate Proposals" }}
    </button>
    <span v-if="message" class="text-xs text-gray-500">{{ message }}</span>
  </div>
</template>
```

---

## Updated Backend Route Summary

| Method | Path                                         | Auth          | Description                                   |
| ------ | -------------------------------------------- | ------------- | --------------------------------------------- |
| `POST` | `/api/v1/agent/plan`                         | COMPANY_ADMIN | Generate proposals for an insight             |
| `GET`  | `/api/v1/agent/proposals`                    | Any authed    | List proposals (paginated, filterable)        |
| `POST` | `/api/v1/agent/proposals/:id/approve`        | COMPANY_ADMIN | Approve a proposal                            |
| `POST` | `/api/v1/agent/proposals/:id/reject`         | COMPANY_ADMIN | Reject a proposal                             |
| `POST` | `/api/v1/agent/proposals/:id/execute`        | COMPANY_ADMIN | Execute an approved proposal                  |
| `GET`  | `/api/v1/agent/proposals/:id/execution-logs` | Any authed    | Get execution history                         |
| `POST` | `/api/v1/agent/proposals/cleanup`            | COMPANY_ADMIN | **NEW** — Remove duplicate PROPOSED proposals |

---

## API Response Reference (verified via curl)

### POST /api/v1/agent/plan

**Request:**

```json
{ "insightId": "cmmbra2630007cwsusmyysa07" }
```

or (standalone flow):

```json
{ "context": "Analyze revenue data for recovery actions" }
```

**Response (201):**

```json
{
  "success": true,
  "data": {
    "insightId": "cmmbra2630007cwsusmyysa07",
    "proposals": [],
    "totalCreated": 0,
    "existingCount": 4
  },
  "message": "Created successfully"
}
```

### GET /api/v1/agent/proposals?page=1&limit=100

**Response (200):**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "cmmbrbt3j000gcwsu...",
        "companyId": "cmm6ldhtv0000t93v...",
        "insightId": "cmmbra2630007cwsu...",
        "actionType": "RETRY_PAYMENT",
        "priorityScore": 85,
        "confidenceScore": 0.82,
        "estimatedImpact": 1250.50,
        "payload": { ... },
        "rationale": "High-value failed payments detected...",
        "status": "PROPOSED",
        "requiresApproval": true,
        "approvedBy": null,
        "approvedAt": null,
        "executedAt": null,
        "createdAt": "2026-03-03T...",
        "updatedAt": "2026-03-03T..."
      }
    ],
    "total": 10,
    "page": 1,
    "limit": 100
  }
}
```

### POST /api/v1/agent/proposals/cleanup

**Request body (required — even if empty):**

```json
{}
```

**Response (200):**

```json
{
  "success": true,
  "data": {
    "deleted": 20,
    "message": "Removed 20 duplicate PROPOSED proposal(s)."
  }
}
```

---

## File Change Checklist

| #   | File                                           | Action                                                      | Priority |
| --- | ---------------------------------------------- | ----------------------------------------------------------- | -------- |
| 1   | `src/types/agent.ts`                           | Update `PlanRequest` + `PlanResult`, add `CleanupResult`    | **HIGH** |
| 2   | `src/api/agentApi.ts`                          | Fix `executeProposal` body, add `cleanupDuplicateProposals` | **HIGH** |
| 3   | `src/composables/useAgentProposals.ts`         | Change `plan()` return type + add `cleanup()`               | **HIGH** |
| 4   | `src/components/agent/AgentPlanButton.vue`     | 3-way result handling with `info` state                     | **HIGH** |
| 5   | `src/views/AgentView.vue`                      | Handle `context` flow + `existingCount`                     | MEDIUM   |
| 6   | `src/components/agent/ProposalDetailModal.vue` | Better messaging for `estimatedImpact < 100`                | LOW      |
| 7   | New: Cleanup button component (optional)       | Admin utility                                               | LOW      |

---

## Important Notes

1. **All POST requests must include a JSON body** — at minimum `{}`. The backend's global raw-body parser (for Stripe webhooks) rejects bodyless requests with a 500 error.

2. **Backend response envelope** — all responses follow `{ success: boolean, data: T, message?: string, error?: string, code?: string }`. The `data` field contains the actual payload.

3. **The `totalCreated` field** counts only proposals created in THIS plan call — not cumulative. After the first call creates 3 proposals, a second call returns `totalCreated: 0, existingCount: 3` if all action types are already PROPOSED.

4. **Dedup is payload-aware (IMPROVED in latest backend)** — The backend now allows multiple proposals of the same actionType as long as they have different payloads (targeting different customer segments, risk profiles, or scenarios). This maximizes value from each AI call. For example:
   - `RETRY_PAYMENT` for high-value customers (>$1000 MRR)
   - `RETRY_PAYMENT` for at-risk churners (3+ failures)
   - `RETRY_PAYMENT` for dormant accounts (90+ days inactive)

   All three are distinct proposals even though they share the same actionType. The dedup signature is computed as `actionType::payloadHash`, preventing only exact duplicates.

5. **Cost efficiency** — Each AI call now returns 4-10 meaningful proposals (depending on risk score) instead of being limited to 6 total. This justifies the LLM API cost and provides better ROI for customers.

6. **Old proposals with `estimatedImpact: 0`** — proposals created before the backend fix may have zero impact. New proposals are guaranteed `estimatedImpact >= 100`. Users can reject old zero-impact ones and re-generate.
