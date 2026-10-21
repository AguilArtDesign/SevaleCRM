import type { ComponentProps } from 'react';
import { Chip as HeroUIChip } from '@heroui/react';

export type ChipProps = Omit<ComponentProps<typeof HeroUIChip>, 'size' | 'variant'>;

/**
 * Shared application chip. Keep status and category chips visually consistent
 * by fixing the compact size and soft HeroUI variant in one place.
 */
export function Chip(props: ChipProps) {
  return <HeroUIChip {...props} size="sm" variant="soft" />;
}
