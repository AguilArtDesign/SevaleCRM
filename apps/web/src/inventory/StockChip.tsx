import { TriangleExclamation } from '@gravity-ui/icons';
import { Chip } from '../components/Chip';

/**
 * Unidades disponibles junto al nombre de la fuente. Va en la cabecera del panel porque describe el
 * total de un vistazo, y no como una columna más entre las monedas.
 *
 * Toma el color del panel que lo contiene (`--source-bg` / `--source-text`), así que el de Siigo es
 * azul y el de cada tienda el suyo: con el fondo por defecto se perdía sobre el degradado.
 *
 * En WooCommerce la diferencia con Siigo se marca dentro del mismo chip: el stock es lo que más se
 * desincroniza y el aviso tiene que verse sin comparar cifra por cifra.
 */
export function StockChip({
  stock,
  hasMismatch = false,
}: {
  stock: number | null;
  hasMismatch?: boolean;
}) {
  return (
    <Chip className="product-source-stock-chip">
      <span className="product-source-stock">
        {stock === null
          ? 'Sin dato'
          : `${stock.toLocaleString('es-CO')} ${stock === 1 ? 'unidad' : 'unidades'}`}
        {hasMismatch && (
          <TriangleExclamation
            className="product-source-mismatch-icon"
            width={13}
            height={13}
            role="img"
            aria-label="No coincide con Siigo"
          />
        )}
      </span>
    </Chip>
  );
}
