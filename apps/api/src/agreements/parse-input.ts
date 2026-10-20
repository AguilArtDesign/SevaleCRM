import { BadRequestException } from '@nestjs/common';
import type { ZodType } from 'zod';

/** Igual que en el resto de controladores: el primer error del esquema viaja como VALIDATION_ERROR. */
export function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new BadRequestException({
    success: false,
    error: {
      code: 'VALIDATION_ERROR',
      message: result.error.issues[0]?.message || 'Los datos enviados no son válidos.',
    },
  });
}
