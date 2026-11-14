import { z } from 'zod';

/** Lock a PDF with a password, or take a known password off (qpdf on the server). */
export const pdfPasswordRequestSchema = z.object({
  fileId: z.string().min(1).max(100),
  action: z.enum(['protect', 'unlock']),
  // qpdf gets its arguments one per line – line breaks would split the password.
  password: z
    .string()
    .min(1)
    .max(128)
    .refine((p) => !/[\r\n\0]/.test(p), 'no line breaks'),
});
export type PdfPasswordRequest = z.infer<typeof pdfPasswordRequestSchema>;
