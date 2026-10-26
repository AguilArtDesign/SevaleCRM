import { useEffect, useRef } from 'react';
import { TextArea as HeroUITextArea, type TextAreaRootProps } from '@heroui/react';

export type TextareaProps = Omit<TextAreaRootProps, 'rows'>;

const MIN_HEIGHT = 38;
/** Tope del crecimiento: más allá, el campo scrollea por dentro en vez de empujar el chat. */
const MAX_HEIGHT = 320;

/**
 * Textarea que crece con el contenido en lugar de scrollear por dentro: en un campo de una sola
 * línea, un texto largo se desplaza a la derecha y deja de verse el principio. Aquí el alto se
 * recalcula en cada cambio, con un tope para que un mensaje enorme no empuje la conversación fuera
 * de la pantalla; solo al alcanzarlo aparece scroll interno.
 *
 * `resize` se desactiva a propósito: el tamaño lo decide el contenido, no el ratón, así que la
 * altura nunca queda en un estado que el texto no justifique.
 */
export function Textarea({ value, onChange, ...props }: TextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = () => {
    const element = ref.current;
    if (!element) return;
    // Se reinicia antes de medir: `scrollHeight` incluye el alto actual y crecería sin límite.
    element.style.height = 'auto';
    const next = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, element.scrollHeight));
    element.style.height = `${next}px`;
    element.style.overflowY = element.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  };

  // El valor también cambia desde fuera (al enviar se vacía el campo), no solo al teclear.
  useEffect(resize, [value]);

  return (
    <HeroUITextArea
      {...props}
      ref={ref}
      rows={1}
      value={value}
      onChange={(event) => {
        resize();
        onChange?.(event);
      }}
    />
  );
}
