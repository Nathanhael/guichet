import { z } from 'zod';

// ── Labels ──────────────────────────────────────────────
export const labelCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50, 'Max 50 characters').transform(s => s.trim()),
  color: z.string().min(1, 'Color is required'),
});

// ── Canned Responses ────────────────────────────────────
export const cannedResponseCreateSchema = z.object({
  title: z.string().min(1, 'Title is required').max(100, 'Max 100 characters'),
  body: z.string().min(1, 'Body is required').max(5000, 'Max 5000 characters'),
  dept: z.string().optional(),
  shortcut: z.string().max(50, 'Max 50 characters').optional(),
});

// ── Knowledge Base ──────────────────────────────────────
export const kbArticleCreateSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Max 200 characters'),
  body: z.string().min(1, 'Body is required').max(50000, 'Max 50000 characters'),
  dept: z.string().optional(),
  tags: z.string().optional(),
  slug: z.string().max(80, 'Max 80 characters').regex(/^[a-z0-9-]*$/, 'Lowercase letters, numbers, and hyphens only').optional().or(z.literal('')),
  published: z.boolean().optional(),
});

// ── Webhooks ────────────────────────────────────────────
export const webhookCreateSchema = z.object({
  url: z.string().url('Must be a valid URL').max(2000, 'Max 2000 characters'),
  events: z.array(z.string()).min(1, 'Select at least one event'),
  description: z.string().max(200, 'Max 200 characters').optional(),
});

// ── Departments ─────────────────────────────────────────
export const departmentSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Max 100 characters'),
  description: z.string().max(500, 'Max 500 characters').optional().or(z.literal('')),
});

// ── Validation helper ───────────────────────────────────
export type FieldErrors = Record<string, string>;

/**
 * Validate data against a Zod schema, returning field-level errors.
 * Returns null if valid, or a Record<fieldName, errorMessage> if invalid.
 */
export function validateForm<T>(schema: z.ZodType<T>, data: unknown): FieldErrors | null {
  const result = schema.safeParse(data);
  if (result.success) return null;

  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path.join('.');
    if (!errors[field]) errors[field] = issue.message;
  }
  return errors;
}
