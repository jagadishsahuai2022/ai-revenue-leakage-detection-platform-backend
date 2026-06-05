import { z } from 'zod';

export const RegisterSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(128),
  companyName: z.string().min(2).max(100),
  companySlug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
});

export const LoginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const ForgotPasswordSchema = z.object({
  email: z.string().email().toLowerCase(),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type RefreshInput = z.infer<typeof RefreshSchema>;
