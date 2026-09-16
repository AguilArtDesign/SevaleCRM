import { useEffect, useRef } from 'react';
import intlTelInput, { type Iso2, type Iti } from 'intl-tel-input';
import { es } from 'intl-tel-input/locale';
import 'intl-tel-input/styles';

const HERO_UI_COUNTRY_CHECK = `
  <svg
    aria-hidden="true"
    data-slot="list-box-item-indicator--checkmark"
    fill="none"
    role="presentation"
    stroke="currentColor"
    stroke-dasharray="22"
    stroke-dashoffset="44"
    stroke-linecap="round"
    stroke-linejoin="round"
    stroke-width="2"
    viewBox="0 0 17 18"
  >
    <polyline points="1 9 7 14 15 4"></polyline>
  </svg>
`;

function supportedCountry(country: string): Iso2 {
  const iso2 = country.trim().toLowerCase();
  return (intlTelInput.getAllCountries().some((item) => item.iso2 === iso2) ? iso2 : 'co') as Iso2;
}

function applyHeroUiCountryCheck(input: HTMLInputElement) {
  const check = input.closest('.iti')?.querySelector<HTMLElement>('.iti__country-check');
  if (!check || check.querySelector('[data-slot="list-box-item-indicator--checkmark"]')) return;

  check.innerHTML = HERO_UI_COUNTRY_CHECK;
}

export function PhoneInput({
  value,
  country,
  onChange,
}: {
  value: string;
  country: string;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const instanceRef = useRef<Iti | null>(null);
  const utilsReadyRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const instance = intlTelInput(input, {
      initialCountry: supportedCountry(country),
      countryNameLocale: 'es',
      uiTranslations: es,
      strictMode: true,
      formatAsYouType: true,
      loadUtils: () => import('intl-tel-input/utils'),
    });
    instanceRef.current = instance;
    if (value) instance.setNumber(value);
    applyHeroUiCountryCheck(input);

    const syncValue = () =>
      onChangeRef.current(
        utilsReadyRef.current ? instance.getNumber() || input.value : input.value,
      );
    const syncCountry = () => {
      applyHeroUiCountryCheck(input);
      syncValue();
    };
    input.addEventListener('input', syncValue);
    input.addEventListener('countrychange', syncCountry);
    void instance.promise.then(() => {
      if (instanceRef.current !== instance) return;
      utilsReadyRef.current = true;
      if (input.value) syncValue();
    });
    return () => {
      input.removeEventListener('input', syncValue);
      input.removeEventListener('countrychange', syncCountry);
      instance.destroy();
      instanceRef.current = null;
      utilsReadyRef.current = false;
    };
  }, []);

  useEffect(() => {
    instanceRef.current?.setSelectedCountry(supportedCountry(country));
    if (inputRef.current) applyHeroUiCountryCheck(inputRef.current);
  }, [country]);

  useEffect(() => {
    const instance = instanceRef.current;
    if (instance && value !== inputRef.current?.value) instance.setNumber(value);
  }, [value]);

  return (
    // intl-tel-input necesita envolver y controlar directamente un input HTML.
    // eslint-disable-next-line no-restricted-syntax
    <input
      ref={inputRef}
      className="customer-phone-input"
      type="tel"
      name="phone"
      autoComplete="tel"
      aria-label="Teléfono"
    />
  );
}
