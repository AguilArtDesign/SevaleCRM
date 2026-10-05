import { useEffect, useState } from 'react';
import { formatPhoneInternationalLazy } from '@sevale/shared';

/**
 * Teléfono listo para mostrar, con la agrupación de su país: las tiendas lo guardan pegado
 * (`+573044251788`) y el CRM lo muestra espaciado (`+57 304 4251788`).
 *
 * El formateo depende de una librería que pesa lo suyo, así que se carga cuando aparece un teléfono
 * en pantalla y no al arrancar la aplicación. Hasta que llega, se muestra el valor tal como viene del
 * pedido, que ya es legible; si no se puede interpretar, se queda ese mismo valor.
 */
export function useFormattedPhone(phone: string | null, country: string | null): string | null {
  const [formatted, setFormatted] = useState(phone);

  useEffect(() => {
    let active = true;
    setFormatted(phone);

    if (!phone || !country) return () => undefined;

    void formatPhoneInternationalLazy(phone, country)
      .then((value) => {
        if (active && value) setFormatted(value);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [country, phone]);

  return formatted;
}
