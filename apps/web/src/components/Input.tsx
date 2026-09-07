import { Input as HeroUIInput, type InputProps as HeroUIInputProps } from '@heroui/react';

export type InputProps = HeroUIInputProps;

/**
 * Shared application input. Fields use HeroUI's primary variant by default;
 * cards, modals and popovers must opt into the secondary variant explicitly.
 */
export function Input({ variant = 'primary', ...props }: InputProps) {
  return <HeroUIInput {...props} variant={variant} />;
}
