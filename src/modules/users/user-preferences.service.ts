import { PrismaClient } from '@prisma/client';
import { AppError } from '../../shared/errors/AppError';

// ── Valid themes ──────────────────────────────────────────────────────────────

export const VALID_THEMES = ['slate', 'ocean', 'forest', 'rose', 'amber'] as const;
export type ThemeId = (typeof VALID_THEMES)[number];

export interface UserPreferences {
  theme: ThemeId;
}

const DEFAULTS: UserPreferences = { theme: 'slate' };

// ── Service functions ─────────────────────────────────────────────────────────

export async function getUserPreferences(
  prisma: PrismaClient,
  userId: string,
): Promise<UserPreferences> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { preferences: true },
  });
  if (!user) throw AppError.notFound('User');

  const stored = (user.preferences ?? {}) as Partial<UserPreferences>;
  return { ...DEFAULTS, ...stored };
}

export async function updateUserPreferences(
  prisma: PrismaClient,
  userId: string,
  data: Partial<UserPreferences>,
): Promise<UserPreferences> {
  if (data.theme !== undefined && !VALID_THEMES.includes(data.theme as ThemeId)) {
    throw AppError.badRequest(`Invalid theme: "${data.theme}". Valid values: ${VALID_THEMES.join(', ')}`);
  }

  const current = await getUserPreferences(prisma, userId);
  const updated: UserPreferences = { ...current, ...data };

  await prisma.user.update({
    where: { id: userId },
    data: { preferences: updated as object },
  });

  return updated;
}
