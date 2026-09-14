import { useEffect, useRef } from 'react';
import intlTelInput, { type Iso2, type Iti } from 'intl-tel-input';
import 'intl-tel-input/styles';

function supportedCountry(country: string): Iso2 {
  const iso2 = country.trim().toLowerCase();
  return (intlTelInput.getAllCountries().some((item) => item.iso2 === iso2) ? iso2 : 'co') as Iso2;
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
      strictMode: true,
      formatAsYouType: true,
      loadUtils: () => import('intl-tel-input/utils'),
    });
    instanceRef.current = instance;
    if (value) instance.setNumber(value);

    const syncValue = () =>
      onChangeRef.current(
        utilsReadyRef.current ? instance.getNumber() || input.value : input.value,
      );
    input.addEventListener('input', syncValue);
    input.addEventListener('countrychange', syncValue);
    void instance.promise.then(() => {
      if (instanceRef.current !== instance) return;
      utilsReadyRef.current = true;
      if (input.value) syncValue();
    });
    return () => {
      input.removeEventListener('input', syncValue);
      input.removeEventListener('countrychange', syncValue);
      instance.destroy();
      instanceRef.current = null;
      utilsReadyRef.current = false;
    };
  }, []);

  useEffect(() => {
    instanceRef.current?.setSelectedCountry(supportedCountry(country));
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
