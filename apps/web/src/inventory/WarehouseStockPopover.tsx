import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Popover, Skeleton } from '@heroui/react';
import { Boxes3 } from '@gravity-ui/icons';
import { inventoryApi, type ProductWarehouseStock } from './api';

const quantityFormat = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });

function WarehouseList({ warehouses }: { warehouses: ProductWarehouseStock[] }) {
  const total = warehouses.reduce((sum, warehouse) => sum + warehouse.quantity, 0);
  return (
    <>
      <dl className="inventory-warehouses-list">
        {warehouses.map((warehouse) => (
          <div key={warehouse.id}>
            <dt title={warehouse.name}>{warehouse.name}</dt>
            <dd>
              {quantityFormat.format(warehouse.quantity)}{' '}
              {warehouse.quantity === 1 ? 'unidad' : 'unidades'}
            </dd>
          </div>
        ))}
      </dl>
      <div className="inventory-warehouses-total">
        <span>Total</span>
        <span>
          {quantityFormat.format(total)} {total === 1 ? 'unidad' : 'unidades'}
        </span>
      </div>
    </>
  );
}

/**
 * Desglose informativo de bodegas en la columna Stock. Lee el snapshot guardado y solo consulta
 * Siigo la primera vez, cuando el producto todavía no tiene bodegas. El endpoint persiste ese
 * primer resultado y las lecturas posteriores salen de la base; no se invalida el listado para
 * que el popover no se cierre mientras llega la respuesta. n8n refresca el snapshot.
 */
export function WarehouseStockPopover({
  productId,
  productName,
  storedWarehouses,
}: {
  productId: number;
  productName: string;
  storedWarehouses: ProductWarehouseStock[] | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const stored = storedWarehouses ?? null;
  const query = useQuery({
    queryKey: ['product-warehouses', productId],
    queryFn: () => inventoryApi.refreshWarehouses(productId),
    // Solo se solicita al endpoint si el producto nunca cargó el desglose. El endpoint, a su
    // vez, devuelve el snapshot de la base sin llamar a Siigo cuando ya existe.
    enabled: isOpen && stored === null,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const warehouses = stored ?? query.data?.warehouses ?? [];

  return (
    <Popover isOpen={isOpen} onOpenChange={setIsOpen}>
      <Button
        className="inventory-warehouses-trigger"
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={`Ver bodegas del stock de ${productName}`}
      >
        <Boxes3 width={16} height={16} />
      </Button>
      <Popover.Content
        placement="bottom start"
        className="shell-popover inventory-warehouses-popover"
      >
        <Popover.Dialog aria-label="Desglose de stock por bodega">
          {stored === null && query.isError ? (
            <div className="inventory-warehouses-feedback">
              <span className="inventory-warehouses-error">
                {query.error?.message || 'No pudimos consultar las bodegas en Siigo.'}
              </span>
              <Button
                size="sm"
                variant="secondary"
                isPending={query.isFetching}
                onPress={() => void query.refetch()}
              >
                Reintentar
              </Button>
              {warehouses.length > 0 && (
                <div className="inventory-warehouses-stale">
                  <span className="inventory-warehouses-note">Último dato guardado</span>
                  <WarehouseList warehouses={warehouses} />
                </div>
              )}
            </div>
          ) : stored === null && query.isPending && warehouses.length === 0 ? (
            <div className="inventory-warehouses-skeleton" aria-label="Consultando bodegas">
              <Skeleton className="inventory-warehouses-skeleton-line" />
              <Skeleton className="inventory-warehouses-skeleton-line" />
              <Skeleton className="inventory-warehouses-skeleton-line" />
            </div>
          ) : warehouses.length === 0 ? (
            <span className="inventory-warehouses-empty">Sin bodegas con stock.</span>
          ) : (
            <div className="inventory-warehouses-content">
              <WarehouseList warehouses={warehouses} />
            </div>
          )}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
