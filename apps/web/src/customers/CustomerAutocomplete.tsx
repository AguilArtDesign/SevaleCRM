import { Autocomplete, EmptyState, Label, ListBox, SearchField, useFilter } from '@heroui/react';

export type CustomerAutocompleteOption = {
  id: string;
  name: string;
};

export function CustomerAutocomplete({
  ariaLabel,
  label,
  placeholder,
  value,
  options,
  clearOption,
  isDisabled = false,
  isInvalid = false,
  isRequired = false,
  onChange,
}: {
  ariaLabel: string;
  label?: string;
  placeholder: string;
  value: string;
  options: CustomerAutocompleteOption[];
  /**
   * Texto de la opción que deja el campo vacío. Sin ella un selector de un solo valor no se puede
   * deshacer: una vez elegido, no hay forma de volver a «sin nada».
   */
  clearOption?: string;
  isDisabled?: boolean;
  isInvalid?: boolean;
  isRequired?: boolean;
  onChange: (value: string) => void;
}) {
  const { contains } = useFilter({ sensitivity: 'base' });
  // La opción de vaciar es un elemento más de la lista: react-aria no permite deseleccionar en un
  // selector de un solo valor, así que el «sin nada» viaja con un identificador propio.
  const clearId = clearOption ? '__clear__' : null;

  return (
    <Autocomplete
      allowsEmptyCollection
      aria-label={ariaLabel}
      className="customer-autocomplete"
      fullWidth
      isDisabled={isDisabled}
      isInvalid={isInvalid}
      isRequired={isRequired}
      placeholder={placeholder}
      value={value || clearId}
      variant="secondary"
      onChange={(selected) =>
        onChange(selected === null || selected === clearId ? '' : String(selected))
      }
    >
      {label && <Label>{label}</Label>}
      <Autocomplete.Trigger>
        <Autocomplete.Value />
        <Autocomplete.Indicator />
      </Autocomplete.Trigger>
      <Autocomplete.Popover className="customer-autocomplete-popover">
        <Autocomplete.Filter filter={contains}>
          <SearchField autoFocus aria-label={`Buscar ${ariaLabel}`} variant="secondary">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Buscar" />
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
            {clearId && clearOption && (
              <ListBox.Item id={clearId} textValue={clearOption}>
                {clearOption}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            )}
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
