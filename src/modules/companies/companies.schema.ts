import { z } from 'zod';

export const UpdateCompanySchema = z.object({
  name: z.string().min(2).max(100).optional(),
  domain: z.string().optional().nullable(),
  logoUrl: z.string().url().optional().nullable(),
  billingEmail: z.string().email().optional(),
  settings: z.record(z.unknown()).optional(),
});

export type UpdateCompanyInput = z.infer<typeof UpdateCompanySchema>;
