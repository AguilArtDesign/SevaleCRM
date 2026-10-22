# SevaleCRM

CRM modular para gestionar usuarios, inventario e integraciones de Sevale. El proyecto reemplazará gradualmente el CRM actual sin interrumpirlo.

## Stack base

- React, Vite y TypeScript
- NestJS con Fastify y Better Auth
- npm workspaces
- MySQL/MariaDB mediante Prisma (se configura en una fase posterior)

## Requisitos

- Node.js 24 LTS (`>=24.15 <25`)
- npm 11
- XAMPP con MySQL/MariaDB para las fases que requieren persistencia

## Instalación

```bash
npm install
Copy-Item .env.example .env
npm run dev
```

La interfaz queda disponible en `http://localhost:5173` y la API en `http://localhost:3000`. El endpoint inicial de salud es `GET /api/health`.

## Base de datos local

1. Iniciar MySQL desde XAMPP.
2. Crear la base de datos `sevale_crm`.
3. Configurar `DATABASE_URL` en `.env`, por ejemplo para una instalación local sin contraseña:

```env
DATABASE_URL="mysql://root:@127.0.0.1:3306/sevale_crm"
```

No reutilizar esta configuración en producción ni versionar `.env`.

Para preparar el cliente, aplicar migraciones y ejecutar el seed inicial:

```bash
npm run prisma:generate
npm run prisma:migrate -- --name nombre_de_la_migracion
npm run prisma:seed
```

El seed crea o normaliza el administrador configurado mediante `INITIAL_ADMIN_EMAIL`. Si `INITIAL_ADMIN_PASSWORD` contiene entre 8 y 128 caracteres y todavía no existe una credencial, la contraseña se procesa mediante el hash seguro de Better Auth. El seed puede ejecutarse repetidamente sin duplicar registros.

## Autenticación local

Configurar en `.env`:

- `BETTER_AUTH_SECRET`: secreto aleatorio de al menos 32 caracteres.
- `BETTER_AUTH_URL`: URL pública de la API; localmente `http://localhost:3000`.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` y `SMTP_FROM`: necesarios para entregar códigos OTP.
- `VITE_TURNSTILE_SITE_KEY` y `TURNSTILE_SECRET_KEY`: claves correspondientes de Cloudflare Turnstile.

En desarrollo, si Turnstile no está configurado, la aplicación utiliza exclusivamente las claves públicas de prueba oficiales de Cloudflare. Producción exige claves reales mediante variables de entorno y no inicia si falta la clave secreta.

No existe registro público. Los usuarios deben estar previamente creados y activos. El código OTP contiene seis dígitos, expira a los cinco minutos, se almacena mediante hash, es de un solo uso y limita intentos y reenvíos.

Si SMTP no está configurado durante el desarrollo local, el último código OTP se guarda en `.tmp/latest-otp.txt` para facilitar las pruebas. El archivo está excluido de Git y cada reenvío reemplaza su contenido. En producción no existe esta alternativa y el servicio de correo es obligatorio.

Para Gmail se utiliza `smtp.gmail.com`, puerto `587` y `SMTP_SECURE=false`; Nodemailer exige STARTTLS en producción. `SMTP_PASSWORD` debe ser una contraseña de aplicación de Google, no la contraseña normal de la cuenta, y `SMTP_FROM` debe contener un remitente autorizado y no vacío.

## Usuarios, roles y permisos

La ruta `/users` está disponible únicamente para administradores. Desde allí se pueden buscar, crear, editar, activar y desactivar cuentas, y asignar los roles `ADMIN`, `COMMERCIAL` o `LOGISTICS`. Cada cuenta guarda un `seller_id` de Siigo obligatorio y único por usuario, que identifica a la persona como vendedor en las integraciones; la columna existe en la base de datos como opcional para no bloquear altas previas, pero la API exige el valor al crear y al editar. Los usuarios nuevos acceden mediante el código OTP enviado a su correo; crear una cuenta no genera una contraseña.

El control de acceso no depende solo de la interfaz: la API aplica un mapa RBAC centralizado. También impide que un administrador cambie su propio rol o se desactive, conserva al menos un administrador activo y revoca las sesiones de una cuenta cuando cambia su rol o estado.

## Panel principal

Después de iniciar sesión, el CRM abre `/inventory` dentro del shell administrativo. La navegación incluye Inventario y Pedidos para todos los usuarios, Cupones cuando la cuenta tiene el permiso `coupons.read`, Clientes para `ADMIN` y `COMMERCIAL`, y Usuarios solo para `ADMIN`. El shell incorpora navegación responsive, cabecera contextual, selector de tema, campana de notificaciones y menú de sesión.

## Inventario local

La ruta `/inventory` consulta los productos almacenados en la base de datos local mediante `GET /api/products`. Incluye búsqueda por nombre, SKU Siigo o SKU WooCommerce; filtros por tienda y estado; paginación; tabla responsive y detalle comparativo entre los datos de Siigo y WooCommerce. La interfaz contempla estados de carga, error y ausencia de resultados.

El listado y el detalle siempre leen la tabla local. Las conexiones externas se activan únicamente cuando un administrador abre el flujo de vinculación y busca un SKU.

## Vinculación de productos

El botón **Vincular producto**, visible solo para administradores, consulta `GET /api/products/link-preview?sku=SKU`. La API comprueba primero que el SKU no esté vinculado, después exige que exista en Siigo y exactamente en una de las tiendas Seratus o Pali. La vista previa devuelve solamente los campos normalizados necesarios para comparar nombre, imagen, SKU, precios, stock, tienda y estado.

`POST /api/products` vuelve a ejecutar esas comprobaciones antes de insertar el producto. Bloquea datos incompletos, respuestas con otro SKU, productos ausentes, coincidencias en ambas tiendas y duplicados. La operación escribe únicamente en la base de datos del CRM; las integraciones externas continúan siendo de solo lectura, salvo la autenticación requerida para renovar el token de Siigo.

## Importación de productos

La importación de inventario está detrás de `PRODUCT_IMPORT_ENABLED`, una variable independiente de la de prospectos para poder apagar una sin la otra. Con el valor `false` los tres endpoints (`GET /api/products/import/status`, `POST /api/products/import/preview` y `POST /api/products/import`) responden `404` con el código `PRODUCT_IMPORT_DISABLED`, y el botón **Importar CSV** desaparece del panel.

El archivo exige catorce columnas con un orden fijo, porque refleja la unión de Siigo y WooCommerce y no lo escribe una persona.

## Importación de prospectos

La importación de prospectos se controla con `PROSPECT_IMPORT_ENABLED`, separada de `PRODUCT_IMPORT_ENABLED` para poder retirar una sin tocar la otra. Cuando vale `false`, los endpoints `/api/prospects/import/*` responden `404` con `PROSPECT_IMPORT_DISABLED` y el botón **Importar CSV** no se renderiza. La comprobación se hace en el backend: ocultar el botón es una consecuencia, no la protección.

A diferencia de Inventario, el CSV de prospectos lo arma una persona en Excel, así que los encabezados se reconocen **por nombre y en cualquier orden**. Se aceptan alias razonables (`correo`/`email`, `celular`/`telefono`/`movil`, `documento`/`cedula`/`nit`, `pais`/`country`, `convenio`/`programa`) y las columnas desconocidas se ignoran. Las columnas admitidas son `nombre`, `apellido`, `empresa`, `tipo_documento`, `documento`, `correo`, `telefono`, `pais` y `convenio`; el modal ofrece descargar una plantilla con ese formato, servida por la API para que el archivo descargado y el que se valida no puedan desincronizarse.

Las columnas `pais` y `convenio` existen para no tener que completar miles de fichas una por una después de importar. Ambas se resuelven **por nombre** contra su catálogo, sin una segunda lista que mantener y sin distinguir mayúsculas ni tildes:

- `pais` usa el mismo catálogo que alimenta el selector de país de los formularios y guarda el código resultante (`Colombia` → `CO`). `resolveCustomerCountryByName` vive en `@sevale/shared`, junto a los demás resolutores de ubicación.
- `convenio` usa el catálogo de Convenios y guarda el `agreementId`.

Si alguno de los dos nombres no existe, la importación se rechaza y se indica cuál falta, en lugar de dejar los prospectos sin la clasificación que les da sentido. El aviso se emite **una sola vez por nombre**, aunque afecte a todas las filas. Una celda vacía deja el campo sin definir, que es el caso de la plantilla.

### Archivos grandes

Una base de convenio puede traer cientos de miles de filas: 194.000 rondan los 22 MB, muy por encima del cuerpo que acepta la API. El modal divide el archivo en lotes de tamaño adaptativo (según la longitud media de las filas) y los envía en secuencia, mostrando el avance lote a lote. La validación recorre todos los lotes **antes** de insertar nada, de modo que un error en cualquier fila impide la importación completa; en el servidor, las consultas de duplicados y los `INSERT` también se parten en trozos para no superar `max_allowed_packet`.

El flujo es de dos pasos: `POST /api/prospects/import/preview` devuelve el resumen (filas, nuevas, ya existentes, errores por fila) y `POST /api/prospects/import` inserta. Cada fila se valida con el **mismo** `createProspectSchema` que el alta manual y se normaliza con `prepareImportedProspect`, que reutiliza las reglas de teléfono, correo, nombre visible y ubicación. Un archivo con errores se rechaza completo con `422 PROSPECT_IMPORT_INVALID`; no hay importación parcial silenciosa.

El tipo de documento es el único campo que no se guarda tal como llega: el CRM almacena el **código de Siigo** (`13` para cédula, `31` para NIT, `41` para pasaporte) porque es lo que exige la sincronización con Siigo y WooCommerce. En el archivo se escribe el **nombre tal como aparece en el selector de tipo de documento** (`Cédula de ciudadanía`, `NIT`, `Pasaporte`…), y `resolveCustomerDocumentType` lo traduce al código usando la misma tabla que alimenta ese selector, sin una segunda lista que mantener. Un valor que no está en el catálogo se rechaza en la vista previa indicando la columna, en lugar de guardar un tipo que rompería la conversión a Cliente.

Los duplicados se detectan por **documento** o, cuando la fila no trae documento, por **correo**. El teléfono queda fuera a propósito: no identifica a una persona y una base de convenio repite números con frecuencia, así que usarlo como clave descartaría registros legítimos. La comparación se hace contra la base y dentro del propio archivo, y las filas repetidas se **omiten** en lugar de bloquear: el resumen indica cuántas se agregarán y cuántas ya existen. Volver a subir el mismo archivo no crea filas repetidas.

## Integraciones de lectura

La API encapsula consultas externas de solo lectura a Siigo, WooCommerce Seratus y WooCommerce Pali. Todas las credenciales permanecen en variables de entorno del backend; React nunca consulta directamente a los proveedores ni recibe sus credenciales.

WooCommerce utiliza `WOOCOMMERCE_SERATUS_CK`, `WOOCOMMERCE_SERATUS_CS`, `WOOCOMMERCE_PALI_CK` y `WOOCOMMERCE_PALI_CS`.

La búsqueda de cliente que alimenta el formulario de Clientes usa un endpoint propio de cada tienda y se hace por la pareja (tipo, número), que es la identidad real del cliente: `GET /wp-json/sevale/v1/customer/crm?billing_type_document=13&billing_identification=13832081`. La respuesta trae `customers[]` con todas las coincidencias, además de `count` y `ambiguous`: si hay más de una, el CRM no vincula a ninguna y lo informa en el formulario para corregir los duplicados en la tienda. El CRM sigue aceptando el contrato anterior (objeto plano con `customer_id`) mientras una tienda no tenga desplegada la versión nueva. Se autentica con `WOOCOMMERCE_USERNAME` (el mismo usuario de WordPress en ambas tiendas) y la contraseña de cada una, `SERATUS_PASSWORD` o `PALI_PASSWORD`. Son credenciales independientes de las CK/CS de la REST API de WooCommerce. La URL se resuelve contra el origen de `SERATUS_API_URL` o `PALI_API_URL`, porque ese endpoint vive fuera del namespace `wc/v3`. Las tres variables son obligatorias en producción.

Rutas disponibles para usuarios con permiso de lectura de inventario:

```text
GET /api/integrations/siigo/products?sku=SKU
GET /api/integrations/woocommerce/seratus/products?sku=SKU
GET /api/integrations/woocommerce/pali/products?sku=SKU
```

Siigo obtiene el token mediante `SIIGO_USERNAME` y `SIIGO_ACCESS_KEY`, lo guarda en `integration_tokens` y lo reutiliza mientras esté vigente. Si el token vence o Siigo rechaza una consulta, la API renueva el token una sola vez, lo persiste y repite transparentemente la petición. Las renovaciones simultáneas se agrupan en una única solicitud de autenticación dentro de la instancia NestJS.

Las consultas devuelven únicamente datos normalizados y nunca el payload completo del proveedor.

## Webhook interno de n8n

n8n puede actualizar los datos conocidos de Siigo mediante:

```http
POST /api/integrations/siigo/product
Authorization: Bearer {N8N_API_KEY}
Content-Type: application/json
```

El payload aceptado es estricto y normalizado:

```json
{
  "siigo_id": "f32f68f9-3e9c-49a3-b096-dad028aac0bc",
  "sku": "18002",
  "siigo_price_cop": 45000,
  "siigo_price_usd": 30,
  "siigo_stock": 116
}
```

La API busca el enlace por `siigo_id`, comprueba que el SKU coincida, actualiza exclusivamente precio COP, precio USD y stock de Siigo, registra `last_check_at` y recalcula `sync_status` contra los valores WooCommerce almacenados. La respuesta incluye únicamente el producto normalizado y los cambios reales detectados. No se modifican las tiendas externas.

`N8N_API_KEY` debe existir solo en el entorno del backend y en la credencial correspondiente de n8n. Este endpoint no utiliza sesiones de usuario.

## Actualizaciones en tiempo real

El CRM mantiene una conexión Socket.IO únicamente mientras existe una sesión autenticada. El servidor valida la cookie de Better Auth y el estado activo de la cuenta antes de aceptar el socket; las conexiones anónimas o de usuarios desactivados son rechazadas.

Eventos disponibles:

```text
product.created
product.updated
product.stock.updated
product.price.updated
product.sync.status_changed
notification.created
```

La creación de un enlace emite `product.created`. Las actualizaciones recibidas desde n8n emiten `product.updated` y los eventos específicos correspondientes a los cambios reales. En el frontend, esos avisos invalidan las consultas de TanStack Query para que REST vuelva a cargar el estado vigente. Cada notificación persistida emite además `notification.created`.

## Notificaciones

La campana del panel muestra el número de notificaciones pendientes y permite alternar entre leídas y no leídas, marcar una como leída o marcar todas. El estado de lectura se almacena por usuario en `notification_reads`, por lo que la acción de una cuenta no afecta a las demás.

Rutas autenticadas:

```text
GET   /api/notifications?status=unread|read|all&page=1&pageSize=20
PATCH /api/notifications/:id/read
PATCH /api/notifications/read-all
```

La vinculación de un producto crea una notificación. Las actualizaciones de n8n crean notificaciones separadas para cambios reales de stock, precio y estado de sincronización. Si los valores recibidos son idénticos, solo se actualiza `last_check_at`: no se genera una notificación falsa. Después de persistir cada notificación, Socket.IO emite `notification.created` y los usuarios conectados reciben un toast HeroUI.

## Pedidos y cupones

La ruta `/orders` está disponible para cualquier usuario autenticado y `/coupons` exige el permiso `coupons.read`; `/customers` queda limitada a `ADMIN` y `COMMERCIAL`. Crear o editar una operación requiere `orders.create` o `orders.update`, completarla requiere `orders.complete` y la logística actualiza el envío con `orders.shipping.update`.

Una operación se compone de un cliente, uno o más productos y las condiciones comerciales (moneda, método de pago, método de envío y, opcionalmente, un cupón). Cada operación se divide en un pedido por tienda (`SERATUS` y `PALI`) y los totales se consolidan a partir de esas filas.

### Regla del precio manual

El comercial puede modificar el precio unitario de un producto, pero ese precio **solo puede bajar**: puede volver a subir hasta igualar el valor original del producto, nunca superarlo. El valor de referencia es `wooPriceCop` o `wooPriceUsd` según la moneda de la operación.

La API aplica el límite en `prepareItem`, la única puerta de entrada de precios, así que cubre tanto la creación como la edición de una operación pendiente. Un valor superior se rechaza con `400` y el código `ORDER_ITEM_PRICE_EXCEEDS_ORIGINAL`:

```json
{
  "success": false,
  "error": {
    "code": "ORDER_ITEM_PRICE_EXCEEDS_ORIGINAL",
    "message": "El precio de Producto de Ejemplo no puede superar su valor original de 127000.00."
  }
}
```

El formulario replica el límite para avisar antes de enviar, pero la API es la fuente de verdad: un precio nunca se acepta solo porque el navegador lo permita. El campo de precio admite únicamente números enteros; no se capturan centavos.

### Regla de la moneda

La moneda se elige al crear la operación y queda fija: representa los importes que ya se enviaron a
las tiendas y a Siigo, así que reinterpretarla al editar sería un error de datos. El formulario
deshabilita el selector cuando se está editando y la API rechaza el intento con `409` y el código
`ORDER_CURRENCY_LOCKED`:

```json
{
  "success": false,
  "error": {
    "code": "ORDER_CURRENCY_LOCKED",
    "message": "La moneda de la operación no se puede cambiar después de crearla."
  }
}
```

El umbral de envío depende de la moneda, así que una operación que necesite USD debe crearse en USD
desde el principio.

### Regla del envío

La logística solo puede asignar datos de envío cuando la operación está completada. El menú de acciones oculta la opción **Envío** para cualquier otro estado, y la API rechaza la asignación con `409` y el código `SHIPMENT_NOT_ALLOWED`:

```json
{
  "success": false,
  "error": {
    "code": "SHIPMENT_NOT_ALLOWED",
    "message": "La operación debe estar completada para asignar información de envío."
  }
}
```

### Regla del cupón

Un producto cuyo precio fue modificado a la baja **queda excluido de la base del cupón**, mientras que los productos sin modificar sí lo reciben. Si un producto cuesta 127.000 y el comercial lo deja en 100.000, ese producto no participa del descuento aunque la operación tenga un cupón aplicado.

El descuento se calcula por tienda sobre la suma de los productos elegibles y luego se consolida, de modo que un producto modificado en una tienda no altera la base del cupón de la otra. El catálogo de tipos de cupón se limita a porcentaje (`percent`) y vive en `packages/shared/src/coupon-types.json`.

El código, el tipo y el importe del cupón se guardan como snapshot en la operación: editar o eliminar el cupón después no modifica los pedidos ya creados. La relación con la operación es `onDelete: SetNull`, de modo que el histórico sobrevive al borrado del cupón.

### Sincronización de cupones con Seratus y Pali

El CRM es la fuente principal de los cupones. Crear o editar un cupón **solo** modifica el registro local: el envío a las tiendas es una acción explícita, `POST /api/coupons/:id/sync`, disponible en el menú de acciones de cada fila y protegida por el permiso `coupons.sync`.

La sincronización usa `POST {SERATUS_API_URL}/coupons` y `POST {PALI_API_URL}/coupons`, o `PUT /coupons/{id}` cuando el cupón ya tiene identificador externo. Así el mismo botón recupera una sincronización parcial anterior: las tiendas con identificador se actualizan y solo las que no lo tienen crean el cupón. El borrado sí actúa sobre las tiendas y usa `DELETE /coupons/{id}?force=true` en ambas.

Los datos se mapean a `code`, `description`, `discount_type`, `amount`, `date_expires`, `individual_use`, `exclude_sale_items`, `usage_limit` y `usage_limit_per_user`. El tipo de descuento se envía tal como está almacenado, sin codificarlo. La caducidad se guarda como fecha de calendario a las 23:59:59 UTC y se recompone en la zona horaria del sitio, que es la que espera WooCommerce.

Las dos tiendas son sincronizaciones independientes: cada identificador se persiste en `seratus_coupon_id` o `pali_coupon_id` en cuanto la tienda confirma, aunque la otra falle. Un fallo de WooCommerce no revierte el cupón local ni pierde el identificador ya obtenido.

El campo `sync_status` resume el resultado y es lo que muestra la columna Sincronización: `SYNCED` cuando ambas tiendas quedaron al día, `PARTIAL` cuando solo una, `ERROR` cuando fallaron las dos y `PENDING` mientras el cupón no se haya enviado o tenga cambios locales posteriores. Toda edición devuelve el cupón a `PENDING`, porque los identificadores externos por sí solos no permiten distinguir «pendiente» de «error»: si ambas tiendas fallan, ningún identificador se guarda y sin este campo el cupón parecería recién creado.

El resultado de cada intento se conserva en `last_sync_at` y en `seratus_last_error_code`, `seratus_last_error_message`, `pali_last_error_code` y `pali_last_error_message`, que guardan la causa por tienda y se limpian cuando esa tienda vuelve a responder. La API entrega ese detalle **solo a `ADMIN`** —el resto de los roles lo recibe en `null`, igual que el diagnóstico de las integraciones de Clientes— y el panel lo muestra en un diagnóstico que se abre desde el menú de la fila cuando el cupón quedó `PARTIAL` o `ERROR`, y que además se abre solo si una acción falla durante la sesión de un administrador. Un error interno que no venga de WooCommerce conserva su mensaje en lugar de un texto genérico, porque sin la causa un fallo de sincronización no es diagnosticable.

En los campos opcionales, «sin restricción» no se expresa igual en todos: la caducidad se envía como cadena vacía, porque su campo es de tipo texto y WooCommerce la normaliza a «sin expiración» con `StringUtil::is_null_or_empty`. Los límites de uso son enteros y WordPress rechaza la cadena vacía con `400 Invalid parameter(s): usage_limit`, mientras que un `null` es ignorado por el controlador y no borraría nada; por eso se envía `0`, que es el mismo valor que guarda el panel de WooCommerce al dejar el campo vacío y que su validación interpreta como «sin límite». De ese modo, quitar una fecha o un límite desde el CRM también lo quita en las tiendas.

El borrado se propaga a las dos tiendas **antes** de eliminar el registro local. Si una tienda falla, el cupón se conserva con su identificador para poder reintentar, y la API responde `409` con el código `COUPON_DELETE_INCOMPLETE` junto con el detalle por tienda en `error.details`. Un `404` de la tienda no cuenta como fallo: significa que el cupón ya no existe allí (por ejemplo, si se borró a mano) y la eliminación se da por hecha, de modo que el registro no queda atascado. Así nunca queda un cupón vigente en WooCommerce sin forma de localizarlo, y la columna Sincronización del panel resume el estado del cupón en ambas tiendas.

Como el precio manual nunca puede superar el valor original, toda modificación es por definición una baja: `price_modified` es verdadero exactamente en los productos que quedan fuera de la base del cupón. `npm run test:orders` verifica ese límite exacto, el rechazo por excederlo y la exclusión del cupón.

## Sistema visual

El panel utiliza HeroUI, Inter y Gravity UI Icons. Las superficies administrativas deben ser planas: no utilizar degradados en fondos ni componentes.

## Scripts

```bash
npm run dev
npm run dev:web
npm run dev:api
npm run build
npm run start
npm run lint
npm run typecheck
npm run format:check
npm run test:auth
npm run test:users
npm run test:products
npm run test:integrations
npm run test:siigo-token
npm run test:product-link
npm run test:product-import
npm run test:prospects:import
npm run test:n8n
npm run test:realtime
npm run test:notifications
npm run test:security
npm run test:exposure
npm run test:smoke
npm run check:release
npm run check:siigo-auth
```

Los scripts `prisma:*` administran el esquema, el cliente, las migraciones y el seed de Prisma.

## Hardening de V1

La API limita cada origen a 300 solicitudes por minuto y Better Auth aplica límites más estrictos al login y al envío/verificación de OTP. Las cookies de sesión son `HttpOnly`, `SameSite=Lax` y, en producción, `Secure`. Las sesiones vencen después de 2 horas sin actividad y tienen una duración absoluta máxima de 8 horas; el frontend avisa dos minutos antes del cierre por inactividad y sincroniza la actividad entre pestañas. CORS y Socket.IO aceptan únicamente `FRONTEND_URL`; las respuestas HTTP incorporan cabeceras defensivas y los errores no controlados no exponen trazas, consultas, rutas internas ni configuración.

El arranque valida con Zod la configuración esencial. En producción exige HTTPS, un secreto de autenticación de al menos 32 caracteres, SMTP completo y una credencial real de Turnstile; las credenciales de prueba son rechazadas. `TRUST_PROXY` debe permanecer en `false` salvo que la API esté detrás de un proxy inverso confiable que reemplace las cabeceras del cliente.

`npm run test:security` comprueba la política CORS, las cabeceras, el formato seguro de errores, que `.env` esté ignorado y que ningún valor secreto configurado aparezca en el código o bundle frontend. Debe ejecutarse después del build para inspeccionar `apps/web/dist`.

La auditoría de dependencias actualizó Nodemailer a la versión corregida. Prisma 7.10.0 aún fija `mariadb@3.4.5` y utiliza `deepmerge-ts@7.1.5`; npm reporta avisos sin actualización estable compatible del adaptador/CLI. El primero queda limitado a la conexión de base de datos definida por el servidor y el segundo al tooling de Prisma, sin entrada HTTP. Deben actualizarse tan pronto Prisma publique una versión estable corregida.

## Producción

El despliegue utiliza un único proceso NestJS que sirve la API, Socket.IO y el bundle React compilado. La configuración exacta está en [Despliegue en xCloud](docs/xcloud.md).

```text
Node.js:        24.16.0
Build command:  npm ci && npm run build
Start command:  npm run start
Migraciones:    npm run prisma:migrate:deploy (automático en el despliegue)
Health check:   /api/health
```

El script de despliegue ejecuta las migraciones en cada publicación, así que se aplican solas y no queda un paso manual pendiente. Como se ejecutan de forma automática, la revisión de los archivos nuevos de `prisma/migrations` ocurre antes de integrar el cambio, no durante el despliegue.

Las migraciones siguen sin formar parte del comando de arranque y ningún secreto se almacena en Git. El despliegue automático continúa desautorizado hasta que sea solicitado expresamente.
