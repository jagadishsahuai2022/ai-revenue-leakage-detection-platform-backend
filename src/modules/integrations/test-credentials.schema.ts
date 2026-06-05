import { z } from 'zod';

/**
 * PUT /integrations/test-credentials/:providerId
 *
 * `credentials` must be a flat object with 1–10 string/boolean/number values.
 * `label` and `isActive` are optional.
 */
export const upsertTestCredentialSchema = z.object({
  label: z
    .string()
    .min(1, 'label must not be empty')
    .max(100, 'label must be 100 chars or fewer')
    .optional(),

  credentials: z
    .record(z.union([z.string(), z.number(), z.boolean()]))
    .refine((c) => Object.keys(c).length >= 1, {
      message: 'credentials must contain at least one key',
    })
    .refine((c) => Object.keys(c).length <= 10, {
      message: 'credentials may contain at most 10 keys',
    }),

  isActive: z.boolean().optional(),
});

export type UpsertTestCredentialInput = z.infer<typeof upsertTestCredentialSchema>;
