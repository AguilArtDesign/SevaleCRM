import { useQuery } from '@tanstack/react-query';
import { inventoryApi, type ProductRefreshJob } from './api';

/** Una sola clave: la pestaña global y el botón del inventario comparten el mismo job. */
export const productRefreshJobQueryKey = ['product-refresh', 'latest'] as const;

export function isRefreshJobActive(job: ProductRefreshJob | null | undefined): boolean {
  return job?.status === 'PENDING' || job?.status === 'RUNNING';
}

/**
 * El último barrido de Siigo. Solo consulta mientras hay uno activo: si el job terminó, la pestaña
 * conserva el resumen sin seguir pidiendo el estado cada segundo.
 */
export function useLatestProductRefreshJob(enabled = true) {
  return useQuery({
    queryKey: productRefreshJobQueryKey,
    queryFn: async () => (await inventoryApi.latestRefreshJob()).job,
    enabled,
    refetchInterval: (query) => (isRefreshJobActive(query.state.data) ? 1_000 : false),
  });
}
