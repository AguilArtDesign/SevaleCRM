/**
 * Imagen que sustituye al producto cuando la tienda no tiene foto o la URL externa falla. Vive en
 * `public/status/` porque ya se usaba para la miniatura de los pedidos.
 */
export const productImageFallback = '/status/fallback.webp';

/**
 * Foto del producto con respaldo. Las URLs vienen de WooCommerce y pueden responder con error, así
 * que un `onError` cambia a la imagen de respaldo; la marca en `dataset` evita un bucle si el propio
 * respaldo fallara.
 */
export function ProductImage({
  src,
  className,
  loading,
}: {
  src?: string | null;
  className?: string;
  loading?: 'lazy' | 'eager';
}) {
  return (
    <img
      className={className}
      src={src || productImageFallback}
      alt=""
      loading={loading}
      onError={(event) => {
        const image = event.currentTarget;
        if (image.dataset.fallback === 'true') return;
        image.dataset.fallback = 'true';
        image.src = productImageFallback;
      }}
    />
  );
}
