import { Gem } from '@gravity-ui/icons';

/**
 * Marcador de posición del módulo de fidelización. La entrada ya existe en el menú para reservar
 * el lugar en la navegación; cuando se implemente, esta página se sustituye por el panel real.
 */
export function PointsColombiaPage() {
  return (
    <section className="customers-layout">
      <header className="customers-heading">
        <div>
          <h2>Puntos Colombia</h2>
        </div>
      </header>

      <div className="coming-soon">
        <span className="coming-soon-icon" aria-hidden="true">
          <Gem width={22} height={22} />
        </span>
        <strong>Estamos preparando Puntos Colombia</strong>
        <p>
          Aquí podrás consultar los puntos acumulados por los clientes de cada convenio y el avance
          de la fidelización. El resto del CRM sigue funcionando con normalidad.
        </p>
      </div>
    </section>
  );
}
