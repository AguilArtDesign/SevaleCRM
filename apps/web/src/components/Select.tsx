import { Select as HeroUISelect, type SelectProps as HeroUISelectProps } from '@heroui/react';

export type SelectProps<
  T extends object = object,
  M extends 'single' | 'multiple' = 'single',
> = HeroUISelectProps<T, M>;

/**
 * Shared application select. Fields use HeroUI's primary variant by default;
 * cards, modals and popovers must opt into the secondary variant explicitly.
 */
function SelectRoot<T extends object = object, M extends 'single' | 'multiple' = 'single'>({
  variant = 'primary',
  ...props
}: SelectProps<T, M>) {
  return <HeroUISelect<T, M> {...props} variant={variant} />;
}

SelectRoot.displayName = 'SevaleCRM.Select';

export const Select = Object.assign(SelectRoot, {
  Indicator: HeroUISelect.Indicator,
  Popover: HeroUISelect.Popover,
  Root: SelectRoot,
  Trigger: HeroUISelect.Trigger,
  Value: HeroUISelect.Value,
});
