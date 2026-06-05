import { z } from 'zod';
import { VALID_PRESET_KEYS } from './provider-icons.constants';

const fieldSchema = z.object({
  key: z.string().min(1).max(50),
  label: z.string().min(1).max(100),
  placeholder: z.string().max(200).optional(),
  secret: z.boolean().optional().default(false),
});

export const createCustomProviderSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(300).optional().default(''),
  iconBg: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'iconBg must be a 6-digit hex colour, e.g. #4f46e5')
    .optional()
    .default('#6b7280'),
  iconSvgPath: z.string().max(8000).optional().default(''),
  iconPresetKey: z
    .string()
    .max(50)
    .refine(
      (v) => v === '' || VALID_PRESET_KEYS.has(v),
      (v) => ({ message: `"${v}" is not a valid preset key` }),
    )
    .optional()
    .default(''),
  authType: z.enum(['api_key', 'bearer', 'oauth2_pkce']).default('api_key'),
  baseUrl: z.string().url('baseUrl must be a valid URL').max(500).optional(),
  fields: z
    .array(fieldSchema)
    .min(1, 'At least one field is required')
    .max(5, 'Maximum 5 fields allowed'),
  webhookSupport: z.boolean().optional().default(false),
});

export type CreateCustomProviderInput = z.infer<typeof createCustomProviderSchema>;
