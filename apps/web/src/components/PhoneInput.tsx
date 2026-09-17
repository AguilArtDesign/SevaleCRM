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

function applyHeroUiCountryArrow(input: HTMLInputElement) {
  const arrow = input.closest('.iti')?.querySelector<HTMLElement>('.iti__arrow');
  if (!arrow || arrow.matches('[data-slot="autocomplete-default-indicator"]')) return;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('data-slot', 'autocomplete-default-indicator');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('height', '16');
  svg.setAttribute('role', 'presentation');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('class', 'iti__arrow customer-phone-country-indicator');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('clip-rule', 'evenodd');
  path.setAttribute(
    'd',
    'M2.97 5.47a.75.75 0 0 1 1.06 0L8 9.44l3.97-3.97a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 0 1 0-1.06',
  );
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('fill-rule', 'evenodd');
  svg.appendChild(path);
  arrow.replaceWith(svg);
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
    applyHeroUiCountryArrow(input);

    const syncValue = () =>
      onChangeRef.current(
        utilsReadyRef.current ? instance.getNumber() || input.value : input.value,
      );
    const syncCountry = () => {
      applyHeroUiCountryCheck(input);
      applyHeroUiCountryArrow(input);
      syncValue();
    };
    const closeCountrySelectorFromOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      const container = input.closest('.iti');
      const selector = container?.querySelector('.iti__country-selector');
      const trigger = container?.querySelector('.iti__selected-country');
      if (!selector || selector.contains(event.target) || trigger?.contains(event.target)) return;

      instance.closeCountrySelector();
    };
    input.addEventListener('input', syncValue);
    input.addEventListener('countrychange', syncCountry);
    document.addEventListener('pointerdown', closeCountrySelectorFromOutside, true);
    void instance.promise.then(() => {
      if (instanceRef.current !== instance) return;
      utilsReadyRef.current = true;
      if (input.value) syncValue();
    });
    return () => {
      input.removeEventListener('input', syncValue);
      input.removeEventListener('countrychange', syncCountry);
      document.removeEventListener('pointerdown', closeCountrySelectorFromOutside, true);
      instance.destroy();
      instanceRef.current = null;
      utilsReadyRef.current = false;
    };
  }, []);

  useEffect(() => {
    instanceRef.current?.setSelectedCountry(supportedCountry(country));
    if (inputRef.current) {
      applyHeroUiCountryCheck(inputRef.current);
      applyHeroUiCountryArrow(inputRef.current);
    }
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
