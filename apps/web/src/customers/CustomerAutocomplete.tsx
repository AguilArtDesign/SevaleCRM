import { Autocomplete, EmptyState, Label, ListBox, SearchField, useFilter } from '@heroui/react';

export type CustomerAutocompleteOption = {
  id: string;
  name: string;
};

export function CustomerAutocomplete({
  ariaLabel,
  label,
  placeholder,
  searchPlaceholder,
  value,
  options,
  isDisabled = false,
  onChange,
}: {
  ariaLabel: string;
  label?: string;
  placeholder: string;
  searchPlaceholder: string;
  value: string;
  options: CustomerAutocompleteOption[];
  isDisabled?: boolean;
  onChange: (value: string) => void;
}) {
  const { contains } = useFilter({ sensitivity: 'base' });

  return (
    <Autocomplete
      allowsEmptyCollection
      aria-label={ariaLabel}
      className="customer-autocomplete"
      fullWidth
      isDisabled={isDisabled}
      placeholder={placeholder}
      value={value || null}
      variant="secondary"
      onChange={(selected) => onChange(selected === null ? '' : String(selected))}
    >
      {label && <Label>{label}</Label>}
      <Autocomplete.Trigger>
        <Autocomplete.Value />
        <Autocomplete.Indicator />
      </Autocomplete.Trigger>
      <Autocomplete.Popover className="customer-autocomplete-popover">
        <Autocomplete.Filter filter={contains}>
          <SearchField autoFocus aria-label={searchPlaceholder} variant="secondary">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder={searchPlaceholder} />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <ListBox
            renderEmptyState={() => (
              <EmptyState className="customer-autocomplete-empty">
                No encontramos resultados
              </EmptyState>
            )}
          >
            {options.map((option) => (
              <ListBox.Item key={option.id} id={option.id} textValue={option.name}>
                {option.name}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Autocomplete.Filter>
      </Autocomplete.Popover>
    </Autocomplete>
  );
}
