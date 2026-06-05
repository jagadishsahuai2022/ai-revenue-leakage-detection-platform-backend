# RevSecureCloud Frontend — Enterprise Governance Integration (v3.0)

## Context

The RevSecureCloud backend has been upgraded with 11 enterprise governance layers (v3.0). The frontend app needs to be updated to consume the new API contracts. This document is a **single comprehensive Copilot prompt** for all required frontend changes.

---

## Scope of Required Frontend Changes

1. Updated response envelope (all responses now include `requestId` and `timestamp`)
2. `X-Request-Id` response header capture for error correlation
3. `X-Idempotency-Key` request header for mutation safety
4. Rate limit error handling (HTTP 429 `RATE_LIMITED`)
5. Double-approval workflow UI for high-risk agent actions
6. AI Policy Engine verdict display (`ALLOW` / `REQUIRE_APPROVAL` / `DENY`)
7. AI Safety verdict display (`SAFE` / `WARNING` / `BLOCKED`)
8. Updated error display (show `requestId` in error UI for support)

---

## COPILOT PROMPT START

````
You are an expert frontend engineer working on RevSecureCloud, a multi-tenant B2B SaaS revenue intelligence platform. The backend API has been upgraded with enterprise governance features. Apply ALL of the following changes comprehensively across the frontend codebase.

---

## CHANGE 1: Update the API Client to handle the new response envelope

Every API response now includes `requestId` (UUID-v4) and `timestamp` (ISO 8601):

```typescript
// Updated ApiResponse type
interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  code?: string;
  requestId: string;         // NEW — always present
  timestamp: string;         // NEW — always present
  retryAfter?: number;       // Present on 429 rate limit errors
}
````

**Action:** Update all TypeScript API response types, Axios/fetch interceptors, and Zod schemas to include `requestId` and `timestamp`.

---

## CHANGE 2: Capture X-Request-Id from response headers

The backend sets `X-Request-Id` on every response header. This value should be:

- Stored in the error state alongside the error message
- Displayed in the UI error component as a copyable "Request ID" field
- Logged to the browser console on all API errors

```typescript
// In your Axios response interceptor
axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestId =
      error.response?.headers["x-request-id"] ??
      error.response?.data?.requestId ??
      "unknown";

    // Store for error display
    const enhancedError = {
      ...error,
      requestId,
      message: error.response?.data?.error ?? error.message,
      code: error.response?.data?.code,
    };

    console.error("[API Error]", { requestId, ...enhancedError });
    return Promise.reject(enhancedError);
  },
);
```

**Action:** Update all error display components to show a copyable "Request ID" field:

```tsx
{
  error && (
    <ErrorAlert>
      <p>{error.message}</p>
      {error.requestId && (
        <p className="text-xs text-muted-foreground">
          Request ID: <CopyableText value={error.requestId} />
        </p>
      )}
    </ErrorAlert>
  );
}
```

---

## CHANGE 3: Add X-Idempotency-Key header for mutation requests

For all `POST`, `PUT`, and `PATCH` requests that could cause side effects if executed twice (agent execution, AI analysis, revenue creation), generate and send an idempotency key.

**Idempotency key strategy:**

- Generate a `crypto.randomUUID()` per logical user action
- Attach as `X-Idempotency-Key` request header
- Persist the key (e.g., in React state or a ref) per form submission session
- On network retry, reuse the **same** key (this is the point — prevents double execution)
- Generate a **new** key only when the user intentionally retries after success

```typescript
// Hook: useIdempotencyKey
function useIdempotencyKey() {
  const keyRef = useRef<string | null>(null);

  const getKey = () => {
    if (!keyRef.current) {
      keyRef.current = crypto.randomUUID();
    }
    return keyRef.current;
  };

  const resetKey = () => {
    keyRef.current = null;
  };

  return { getKey, resetKey };
}
```

**Add to API client as an optional header:**

```typescript
// In mutation functions — pass idempotencyKey when handling mutations
async function executeProposal(proposalId: string, idempotencyKey: string) {
  return apiClient.post(
    `/api/v1/agent/proposals/${proposalId}/execute`,
    {},
    { headers: { "X-Idempotency-Key": idempotencyKey } },
  );
}

async function runAIAnalysis(params: AIRunParams, idempotencyKey: string) {
  return apiClient.post("/api/v1/ai/run", params, {
    headers: { "X-Idempotency-Key": idempotencyKey },
  });
}
```

**Mutations that MUST use idempotency keys:**

- `POST /api/v1/agent/proposals/:id/execute`
- `POST /api/v1/ai/run`
- `POST /api/v1/revenue` (create revenue record)
- `POST /api/v1/agent/plan`
- `POST /api/v1/agent/proposals/:id/approve`

---

## CHANGE 4: Handle Rate Limit errors (HTTP 429)

The API returns HTTP 429 when a company exceeds its plan rate limit:

```json
{
  "success": false,
  "error": "Rate limit exceeded",
  "code": "RATE_LIMITED",
  "retryAfter": 30,
  "requestId": "...",
  "timestamp": "..."
}
```

**Action:** Add a dedicated handler in the Axios/fetch error interceptor:

```typescript
if (error.response?.status === 429) {
  const retryAfter = error.response.data?.retryAfter ?? 60;

  // Show a toast or inline notice
  toast.warning(
    `You've reached your plan's request limit. Please wait ${retryAfter} seconds or upgrade your plan.`,
    { duration: retryAfter * 1000, id: "rate-limit" },
  );

  // Optionally: implement automatic retry with countdown
  return new Promise((resolve) => {
    setTimeout(
      () => resolve(axiosInstance.request(error.config)),
      retryAfter * 1000,
    );
  });
}
```

**UI guidance:**

- Display a plan upgrade CTA if `RATE_LIMITED` error appears repeatedly
- Show a countdown timer: _"Please wait 30 seconds..."_
- Disable the triggering button for `retryAfter` seconds to prevent hammering

---

## CHANGE 5: Double-Approval Workflow UI

When executing an agent proposal, the response may be HTTP **202** (not 200) with:

```json
{
  "success": true,
  "data": {
    "status": "APPROVAL_REQUIRED",
    "approvalId": "cmmXXX...",
    "message": "This action requires double approval from two different administrators"
  }
}
```

**Action:** Add a complete double-approval flow to the Agent Proposals UI.

### State diagram to implement:

```
User clicks "Execute"
  │
  ├─→ 200 OK → Show success toast + update proposal status to EXECUTED
  │
  └─→ 202 APPROVAL_REQUIRED
        │
        └─→ Show "Approval Required" modal/panel
              │ Display: approvalId, current status, approvers
              │
              ├─→ [PENDING_FIRST_APPROVAL]
              │     → Show "Approve (Step 1 of 2)" button for any COMPANY_ADMIN
              │     → Current user clicks Approve
              │         POST /api/v1/agent/approvals/:approvalId/approve
              │
              ├─→ [PENDING_SECOND_APPROVAL]
              │     → Show "Waiting for second approval" badge
              │     → Notify another COMPANY_ADMIN (e.g., email notification pending)
              │     → Different admin logs in, sees "Approve (Step 2 of 2)" button
              │     → Second admin clicks Approve
              │
              ├─→ [FULLY_APPROVED]
              │     → Show "Fully Approved — Execute Now" button
              │     → User clicks to execute (re-call execute endpoint)
              │
              └─→ [REJECTED]
                    → Show "Approval Rejected" badge
                    → Proposal returns to APPROVED status for re-evaluation
```

### Component structure to create/update:

```typescript
// ApprovalStatusBadge component
type ApprovalStatus =
  | "PENDING_FIRST_APPROVAL"
  | "PENDING_SECOND_APPROVAL"
  | "FULLY_APPROVED"
  | "REJECTED";

const statusConfig: Record<ApprovalStatus, { label: string; variant: string }> =
  {
    PENDING_FIRST_APPROVAL: {
      label: "Awaiting 1st Approval",
      variant: "warning",
    },
    PENDING_SECOND_APPROVAL: {
      label: "Awaiting 2nd Approval",
      variant: "warning",
    },
    FULLY_APPROVED: { label: "Fully Approved", variant: "success" },
    REJECTED: { label: "Rejected", variant: "destructive" },
  };

// ApprovalPanel component props
interface ApprovalPanelProps {
  approvalId: string;
  proposalId: string;
  currentUserId: string;
}
```

### New API calls needed:

```typescript
// Get approval status
GET /api/v1/agent/approvals/:approvalId
→ returns ActionApproval { id, status, approver1Id, approver2Id, ... }

// Submit approval step
POST /api/v1/agent/approvals/:approvalId/approve
body: {}

// Reject
POST /api/v1/agent/approvals/:approvalId/reject
body: { reason?: string }
```

**UX rules to enforce:**

- A user CANNOT approve twice: if `approver1Id === currentUserId`, hide the approve button for step 2
- Show the `requestId` in the approval audit trail
- Poll approval status every 5 seconds while `PENDING_SECOND_APPROVAL` (or use WebSocket if available)

---

## CHANGE 6: AI Policy Engine Verdict Display

When `POST /agent/proposals/:id/execute` returns HTTP **403** with `code: POLICY_DENY`:

```json
{
  "success": false,
  "error": "Action blocked by policy rule: no-bulk-delete",
  "code": "POLICY_DENY",
  "data": {
    "rule": "no-bulk-delete",
    "verdict": "DENY"
  }
}
```

**Action:** Update the Execute button handler:

```typescript
const handleExecute = async (proposalId: string) => {
  try {
    const res = await executeProposal(proposalId, idempotencyKey.getKey());

    if (res.status === 200) {
      toast.success("Proposal executed successfully");
      idempotencyKey.resetKey();
      refreshProposals();
    } else if (res.status === 202) {
      // Double-approval required
      setApprovalRequired({ approvalId: res.data.data.approvalId });
    }
  } catch (error) {
    if (error.code === "POLICY_DENY") {
      toast.error(`Action blocked: ${error.data?.rule ?? "policy violation"}`, {
        description:
          "This action violates a governance policy. Contact your administrator.",
      });
    } else if (error.status === 400) {
      toast.error("Proposal must be approved before execution");
    } else {
      toast.error(error.message ?? "Execution failed");
    }
  }
};
```

**UI additions:**

- Add a "Policy" badge on proposals that have been blocked (status `POLICY_DENIED`)
- Show policy rule name in the blocked state tooltip
- For `REQUIRE_APPROVAL` actions, show a "Requires Admin Approval" badge on the proposal card

---

## CHANGE 7: AI Safety Verdict Display

AI Insight responses and `/api/v1/ai/run` results may include a `safetyVerdict` field:

```typescript
interface AIInsight {
  // ... existing fields
  safetyVerdict?: "SAFE" | "WARNING" | "BLOCKED";
  safetyFlags?: {
    isHallucination?: boolean;
    isPromptInjection?: boolean;
    isPolicyViolation?: boolean;
  };
}
```

**Action:** Add safety verdict indicators to the AI Insights UI:

```tsx
// AIInsightCard — add safety badge
{
  insight.safetyVerdict && insight.safetyVerdict !== "SAFE" && (
    <SafetyVerdictBadge
      verdict={insight.safetyVerdict}
      flags={insight.safetyFlags}
    />
  );
}

// SafetyVerdictBadge component
const SafetyVerdictBadge = ({ verdict, flags }) => {
  if (verdict === "BLOCKED") {
    return (
      <Badge
        variant="destructive"
        title="AI response was blocked due to safety concerns"
      >
        ⚠ AI Output Blocked
      </Badge>
    );
  }
  if (verdict === "WARNING") {
    return (
      <Badge
        variant="warning"
        title="Review AI output carefully — possible uncertainty detected"
      >
        ⚠ Review Carefully
      </Badge>
    );
  }
  return null;
};
```

**UX rules:**

- `BLOCKED` insights should show a full warning panel: _"This AI analysis was blocked for safety reasons. The content may contain unreliable information."_
- `WARNING` insights should show a subtle advisory banner at the top of the insight view
- `SAFE` (default) — no badge needed

---

## CHANGE 8: General Error Handler Improvements

Update the global error handler / error boundary to:

1. Always display `requestId` in error UI for support tickets
2. Include `code` machine code for developer debugging
3. Handle the new enterprise error codes:

```typescript
const enterpriseErrorMessages: Record<string, string> = {
  RATE_LIMITED: "Request limit exceeded. Please wait before trying again.",
  POLICY_DENY: "This action is blocked by a governance policy.",
  DUPLICATE_REQUEST: "This request has already been processed (idempotency).",
  APPROVAL_REQUIRED: "This action requires admin approval.",
  TENANT_VIOLATION: "Access denied — tenant isolation violation.",
  QUOTA_EXCEEDED: "AI quota exhausted. Upgrade your plan for more runs.",
};

function getErrorMessage(code?: string, fallback?: string): string {
  if (code && enterpriseErrorMessages[code]) {
    return enterpriseErrorMessages[code];
  }
  return fallback ?? "An unexpected error occurred.";
}
```

---

## CHANGE 9: CORS Header Allowance

Ensure the frontend's API client sends these headers (they are whitelisted by the backend CORS config):

- `Authorization` (existing)
- `Content-Type` (existing)
- `X-Idempotency-Key` ← NEW
- `X-Request-Id` ← NEW (optional, for client-generated tracing)

If you use a proxy (e.g., Next.js API routes or Vite proxy), ensure these custom headers are forwarded.

---

## CHANGE 10: TypeScript Type Definitions

Create or update `src/types/api.ts` with all enterprise types:

```typescript
// Base response wrapper
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  code?: string;
  requestId: string;
  timestamp: string;
  retryAfter?: number;
}

// AI Safety
export type SafetyVerdict = "SAFE" | "WARNING" | "BLOCKED";
export interface SafetyFlags {
  isHallucination?: boolean;
  isPromptInjection?: boolean;
  isPolicyViolation?: boolean;
}

// Policy Engine
export type PolicyVerdict = "ALLOW" | "REQUIRE_APPROVAL" | "DENY";
export interface PolicyContext {
  rule?: string;
  verdict: PolicyVerdict;
}

// Double Approval
export type ApprovalStatus =
  | "PENDING_FIRST_APPROVAL"
  | "PENDING_SECOND_APPROVAL"
  | "FULLY_APPROVED"
  | "REJECTED";

export interface ActionApproval {
  id: string;
  actionId: string;
  status: ApprovalStatus;
  approver1Id: string | null;
  approver2Id: string | null;
  approver1ApprovedAt: string | null;
  approver2ApprovedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Rate limit
export interface RateLimitError {
  code: "RATE_LIMITED";
  retryAfter: number;
  requestId: string;
}

// Machine error codes
export type ErrorCode =
  | "RATE_LIMITED"
  | "POLICY_DENY"
  | "DUPLICATE_REQUEST"
  | "APPROVAL_REQUIRED"
  | "TENANT_VIOLATION"
  | "QUOTA_EXCEEDED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR";
```

---

## Summary of Files to Create / Update

| File                                        | Action | Change                                                                                                |
| ------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| `src/types/api.ts`                          | Update | Add enterprise types (ApiResponse with requestId, SafetyVerdict, PolicyVerdict, ApprovalStatus, etc.) |
| `src/lib/api-client.ts`                     | Update | Axios interceptors for requestId capture, rate limit handling, idempotency key support                |
| `src/hooks/useIdempotencyKey.ts`            | Create | Hook for per-action idempotency key management                                                        |
| `src/components/ui/ErrorAlert.tsx`          | Update | Add copyable `requestId` field to all error displays                                                  |
| `src/components/ui/SafetyVerdictBadge.tsx`  | Create | AI safety verdict badge (WARNING / BLOCKED)                                                           |
| `src/components/ui/ApprovalStatusBadge.tsx` | Create | Double-approval status badge                                                                          |
| `src/components/agent/ApprovalPanel.tsx`    | Create | Full double-approval workflow UI component                                                            |
| `src/components/agent/ProposalCard.tsx`     | Update | Add policy verdict badge + approval status + execute handler                                          |
| `src/components/ai/InsightCard.tsx`         | Update | Add safety verdict badge to AI insight cards                                                          |
| `src/components/ai/InsightDetail.tsx`       | Update | Add safety advisory banner for WARNING/BLOCKED                                                        |
| `src/lib/error-messages.ts`                 | Create | Map enterprise error codes to user-friendly messages                                                  |

---

## Testing Checklist (Post-Implementation)

- [ ] All API error responses show `requestId` in the UI as a copyable field
- [ ] `X-Idempotency-Key` header is sent on: agent execute, AI run, revenue create, agent plan
- [ ] Clicking execute twice rapidly does NOT create two executions (idempotency works)
- [ ] `429 RATE_LIMITED` shows a countdown toast with `retryAfter` seconds
- [ ] Agent execute that triggers double-approval shows the `ApprovalPanel` component
- [ ] Same user attempting to approve both steps sees the button disabled on step 2
- [ ] `POLICY_DENY` response shows a clear "blocked by policy" error toast
- [ ] AI insights with `safetyVerdict: WARNING` show the advisory banner
- [ ] AI insights with `safetyVerdict: BLOCKED` show the blocked warning panel
- [ ] TypeScript compiles with 0 errors after all type updates

```

---

*This prompt was generated for RevSecureCloud backend v3.0.0 — Enterprise Governance edition.*
*Technical reference: `docs/KT_TECHNICAL.md` v3.0.0 | Functional reference: `docs/KT_FUNCTIONAL.md` v3.0.0*
```
