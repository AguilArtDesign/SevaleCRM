import type { ReactNode } from 'react';
import { CircleExclamation, CircleInfo } from '@gravity-ui/icons';

/**
 * Aviso de una operación que falló o que conviene mirar antes de continuar. El `Alert` de HeroUI
 * pinta el fondo con la superficie y el texto en gris, así que dentro de un modal —que ya es de
 * superficie— el mensaje se perdía; aquí se tiñe con el color del estado y se lee de un vistazo.
 */
export function PointsFeedback({
  tone = 'danger',
  children,
}: {
  tone?: 'danger' | 'warning';
  children: ReactNode;
}) {
  const Icon = tone === 'danger' ? CircleExclamation : CircleInfo;
  return (
    <div className="points-feedback" data-tone={tone} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon aria-hidden="true" width={18} height={18} />
      <p>{children}</p>
    </div>
  );
}
