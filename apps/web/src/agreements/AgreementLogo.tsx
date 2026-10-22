/**
 * Miniatura del logo del convenio. Cuando no hay logo se muestran las iniciales de la empresa, para
 * que la columna no quede con huecos y el nombre siga alineado entre filas con y sin imagen.
 */
export function AgreementLogo({
  src,
  name,
  size = 'sm',
}: {
  src: string | null;
  name: string;
  size?: 'sm' | 'md';
}) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join('') || '?';

  return (
    <span className={`agreement-logo agreement-logo--${size}`} aria-hidden="true">
      {src ? <img src={src} alt="" loading="lazy" /> : <span>{initials}</span>}
    </span>
  );
}
