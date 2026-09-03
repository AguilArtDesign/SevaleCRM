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

La ruta `/users` está disponible únicamente para administradores. Desde allí se pueden buscar, crear, editar, activar y desactivar cuentas, y asignar los roles `ADMIN`, `COMMERCIAL` o `LOGISTICS`. Los usuarios nuevos acceden mediante el código OTP enviado a su correo; crear una cuenta no genera una contraseña.

El control de acceso no depende solo de la interfaz: la API aplica un mapa RBAC centralizado. También impide que un administrador cambie su propio rol o se desactive, conserva al menos un administrador activo y revoca las sesiones de una cuenta cuando cambia su rol o estado.

## Panel principal

Después de iniciar sesión, el CRM abre `/inventory` dentro del shell administrativo. La navegación incluye únicamente Inventario y, para usuarios con rol `ADMIN`, Usuarios (`/users`). El shell incorpora navegación responsive, cabecera contextual, selector de tema, campana de notificaciones y menú de sesión. El centro persistente de notificaciones se incorporará en una fase posterior.

## Inventario local

La ruta `/inventory` consulta los productos almacenados en la base de datos local mediante `GET /api/products`. Incluye búsqueda por nombre, SKU Siigo o SKU WooCommerce; filtros por tienda y estado; paginación; tabla responsive y detalle comparativo entre los datos de Siigo y WooCommerce. La interfaz contempla estados de carga, error y ausencia de resultados.

El listado y el detalle siempre leen la tabla local. Las conexiones externas se activan únicamente cuando un administrador abre el flujo de vinculación y busca un SKU.

## Vinculación de productos

El botón **Vincular producto**, visible solo para administradores, consulta `GET /api/products/link-preview?sku=SKU`. La API comprueba primero que el SKU no esté vinculado, después exige que exista en Siigo y exactamente en una de las tiendas Seratus o Pali. La vista previa devuelve solamente los campos normalizados necesarios para comparar nombre, imagen, SKU, precios, stock, tienda y estado.

`POST /api/products` vuelve a ejecutar esas comprobaciones antes de insertar el producto. Bloquea datos incompletos, respuestas con otro SKU, productos ausentes, coincidencias en ambas tiendas y duplicados. La operación escribe únicamente en la base de datos del CRM; las integraciones externas continúan siendo de solo lectura, salvo la autenticación requerida para renovar el token de Siigo.

## Integraciones de lectura

La API encapsula consultas externas de solo lectura a Siigo, WooCommerce Seratus y WooCommerce Pali. Todas las credenciales permanecen en variables de entorno del backend; React nunca consulta directamente a los proveedores ni recibe sus credenciales.

WooCommerce utiliza `WOOCOMMERCE_SERATUS_CK`, `WOOCOMMERCE_SERATUS_CS`, `WOOCOMMERCE_PALI_CK` y `WOOCOMMERCE_PALI_CS`.

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

La API limita cada origen a 300 solicitudes por minuto y Better Auth aplica límites más estrictos al login y al envío/verificación de OTP. Las cookies de sesión son `HttpOnly`, `SameSite=Lax` y, en producción, `Secure`. CORS y Socket.IO aceptan únicamente `FRONTEND_URL`; las respuestas HTTP incorporan cabeceras defensivas y los errores no controlados no exponen trazas, consultas, rutas internas ni configuración.

El arranque valida con Zod la configuración esencial. En producción exige HTTPS, un secreto de autenticación de al menos 32 caracteres, SMTP completo y una credencial real de Turnstile; las credenciales de prueba son rechazadas. `TRUST_PROXY` debe permanecer en `false` salvo que la API esté detrás de un proxy inverso confiable que reemplace las cabeceras del cliente.

`npm run test:security` comprueba la política CORS, las cabeceras, el formato seguro de errores, que `.env` esté ignorado y que ningún valor secreto configurado aparezca en el código o bundle frontend. Debe ejecutarse después del build para inspeccionar `apps/web/dist`.

La auditoría de dependencias actualizó Nodemailer a la versión corregida. Prisma 7.10.0 aún fija `mariadb@3.4.5` y utiliza `deepmerge-ts@7.1.5`; npm reporta avisos sin actualización estable compatible del adaptador/CLI. El primero queda limitado a la conexión de base de datos definida por el servidor y el segundo al tooling de Prisma, sin entrada HTTP. Deben actualizarse tan pronto Prisma publique una versión estable corregida.

## Producción

El despliegue utiliza un único proceso NestJS que sirve la API, Socket.IO y el bundle React compilado. La configuración exacta está en [Despliegue en xCloud](docs/xcloud.md).

```text
Node.js:        24.16.0
Build command:  npm ci && npm run build
Start command:  npm run start
Migraciones:    npm run prisma:migrate:deploy (paso manual y revisado)
Health check:   /api/health
```

No se ejecutan migraciones desde el comando de arranque ni se almacena ningún secreto en Git. El despliegue automático continúa desautorizado hasta que sea solicitado expresamente.
