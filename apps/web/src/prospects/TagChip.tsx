import type { CSSProperties } from 'react';
import { Chip } from '../components/Chip';
import type { TagRecord } from './api';

/**
 * Etiqueta pintada con su color. El color se pasa como variable CSS y el tono del texto se mezcla
 * con el color de primer plano del tema, así un amarillo claro se oscurece en el tema claro y se
 * aclara en el oscuro sin tener que detectar el tema desde JavaScript.
 */
export function TagChip({ tag, className }: { tag: TagRecord; className?: string }) {
  if (!tag.color) {
    return (
      <Chip color="default" className={className}>
        {tag.name}
      </Chip>
    );
  }

  return (
    <Chip
      color="default"
      className={className ? `prospect-tag-chip ${className}` : 'prospect-tag-chip'}
      style={{ '--tag-color': tag.color } as CSSProperties}
    >
      {tag.name}
    </Chip>
  );
}

/** Punto de color para los listados que no llevan chip completo (selectores y filtros). */
export function TagColorDot({ color }: { color: string | null }) {
  if (!color) return null;
  return (
    <span
      className="prospect-tag-dot"
      style={{ '--tag-color': color } as CSSProperties}
      aria-hidden="true"
    />
  );
}
