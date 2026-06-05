import { z } from 'zod';

export const UpdateUserSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  avatarUrl: z.string().url().nullable().optional(),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

export const InviteUserSchema = z.object({
  email: z.string().email().toLowerCase(),
  name: z.string().min(2).max(100),
  role: z.enum(['COMPANY_ADMIN', 'ANALYST', 'VIEWER']),
});

export const UpdateRoleSchema = z.object({
  role: z.enum(['COMPANY_ADMIN', 'ANALYST', 'VIEWER']),
});

export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
export type InviteUserInput = z.infer<typeof InviteUserSchema>;
