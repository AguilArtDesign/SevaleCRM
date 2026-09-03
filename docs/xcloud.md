# Despliegue en xCloud

Esta guía prepara una única aplicación Node.js: NestJS expone la API, Socket.IO y el bundle compilado de React desde el mismo dominio. No se necesita un servidor Vite en producción.

## Configuración de la aplicación

Configurar el proyecto de xCloud con el directorio de trabajo en la raíz del repositorio.

```text
Node.js:        24.16.0
npm:            11.x
Build command:  npm ci && npm run build
Start command:  npm run start
Health check:   /api/health
```

El proceso debe recibir el puerto de xCloud mediante `PORT`. El servidor escucha en `0.0.0.0`. `.nvmrc`, `.node-version` y `engines` fijan la misma versión mayor de Node.

## Dominio y proxy

La configuración recomendada utiliza un único dominio HTTPS para frontend, API y Socket.IO:

```text
FRONTEND_URL=https://crm.example.com
BETTER_AUTH_URL=https://crm.example.com
```

En esta topología `VITE_API_URL` puede quedar vacío: el frontend usa su propio origen. Si API y frontend se separan posteriormente, `VITE_API_URL` debe contener la URL pública de la API durante el build y CORS debe revisarse antes de desplegar.

Usar `TRUST_PROXY=true` únicamente cuando xCloud sea el único punto de entrada y reemplace las cabeceras del cliente. De lo contrario mantener `false`.

## Variables de entorno

Todas se configuran en xCloud; no crear ni subir `.env` de producción.

El archivo `.env.production.example` contiene únicamente placeholders y sirve como checklist. No debe renombrarse y completarse dentro del repositorio; los valores reales se cargan directamente en el panel de variables de xCloud.

| Variable                                                       | Requerida             | Uso                                                  |
| -------------------------------------------------------------- | --------------------- | ---------------------------------------------------- |
| `NODE_ENV=production`                                          | Sí                    | Activa cookies seguras y validaciones de producción. |
| `PORT`                                                         | Sí                    | Puerto asignado por la plataforma.                   |
| `TRUST_PROXY`                                                  | Sí                    | Confianza explícita en el proxy inverso.             |
| `FRONTEND_URL`                                                 | Sí                    | Origen HTTPS autorizado.                             |
| `BETTER_AUTH_URL`                                              | Sí                    | URL HTTPS pública de autenticación.                  |
| `DATABASE_URL`                                                 | Sí                    | Conexión MySQL de producción con contraseña.         |
| `BETTER_AUTH_SECRET`                                           | Sí                    | Secreto aleatorio de al menos 32 caracteres.         |
| `VITE_TURNSTILE_SITE_KEY`                                      | Sí                    | Clave pública real incluida durante el build.        |
| `TURNSTILE_SECRET_KEY`                                         | Sí                    | Clave privada real, solo backend.                    |
| `SMTP_HOST`                                                    | Sí                    | Servidor de correo para OTP.                         |
| `SMTP_PORT`                                                    | Sí                    | Puerto SMTP.                                         |
| `SMTP_SECURE`                                                  | Sí                    | `false` para STARTTLS/587; `true` para TLS/465.      |
| `SMTP_USER`                                                    | Sí                    | Usuario SMTP.                                        |
| `SMTP_PASSWORD`                                                | Sí                    | Credencial SMTP privada.                             |
| `SMTP_FROM`                                                    | Sí                    | Remitente de los códigos OTP.                        |
| `SIIGO_API_URL`                                                | Sí                    | Base HTTPS de Siigo.                                 |
| `SIIGO_USERNAME`                                               | Sí                    | Usuario de autenticación Siigo.                      |
| `SIIGO_ACCESS_KEY`                                             | Sí                    | Credencial privada Siigo.                            |
| `SIIGO_PARTNER_ID`                                             | Sí                    | Identificador requerido por Siigo.                   |
| `SERATUS_API_URL`                                              | Sí                    | Base HTTPS de WooCommerce Seratus.                   |
| `WOOCOMMERCE_SERATUS_CK`                                       | Sí                    | Consumer key privada.                                |
| `WOOCOMMERCE_SERATUS_CS`                                       | Sí                    | Consumer secret privado.                             |
| `PALI_API_URL`                                                 | Sí                    | Base HTTPS de WooCommerce Pali.                      |
| `WOOCOMMERCE_PALI_CK`                                          | Sí                    | Consumer key privada.                                |
| `WOOCOMMERCE_PALI_CS`                                          | Sí                    | Consumer secret privado.                             |
| `N8N_API_KEY`                                                  | Sí                    | API key aleatoria de al menos 32 caracteres.         |
| `INITIAL_ADMIN_EMAIL`                                          | Solo seed inicial     | Correo del administrador inicial.                    |
| `INITIAL_ADMIN_PASSWORD`                                       | Opcional y temporal   | Contraseña inicial; retirarla después del seed.      |
| `VITE_API_URL`                                                 | No en un solo dominio | URL pública de API para una topología separada.      |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD` | No                    | Reservadas; V1 no utiliza Redis.                     |

No usar las credenciales de prueba de Turnstile en producción. El backend rechaza el arranque si detecta claves de prueba, HTTP, SMTP incompleto, integraciones incompletas o secretos principales débiles.

### Gmail SMTP

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
```

Con el puerto 587, `SMTP_SECURE=false` inicia la conexión normal y exige STARTTLS antes de autenticar. `SMTP_PASSWORD` debe ser una contraseña de aplicación de Google, no la contraseña habitual. La cuenta debe tener verificación en dos pasos y `SMTP_FROM` debe ser el mismo buzón o un alias autorizado. Las comillas son opcionales en xCloud y nunca deben formar parte de una credencial.

## Migraciones

Las migraciones no forman parte del comando de arranque. Antes de aplicarlas:

1. crear un respaldo verificable de MySQL;
2. revisar en Git los archivos nuevos de `prisma/migrations`;
3. comprobar que no contienen pérdidas de datos no autorizadas;
4. ejecutar manualmente, una sola vez por versión:

```bash
npm run prisma:migrate:deploy
```

Para el primer despliegue, ejecutar el seed idempotente después de las migraciones:

```bash
npm run prisma:seed
```

Nunca ejecutar `prisma migrate reset`, `prisma migrate dev` ni `DROP DATABASE` en producción. Un fallo de migración debe detener el despliegue y revisarse; no debe resolverse borrando datos.

## Secuencia de publicación

1. Configurar dominio, HTTPS y variables en xCloud.
2. Crear y verificar el respaldo de MySQL.
3. Ejecutar `npm ci && npm run build`.
4. Revisar y ejecutar `npm run prisma:migrate:deploy` manualmente.
5. En el primer despliegue, ejecutar `npm run prisma:seed` y retirar `INITIAL_ADMIN_PASSWORD` si se utilizó.
6. Iniciar con `npm run start`.
7. Comprobar `/api/health`, login, Socket.IO y una lectura de inventario.
8. Mantener el CRM WordPress y los webhooks actuales activos durante la transición.

El despliegue no debe continuar mientras `npm audit` siga reportando la versión vulnerable de MariaDB fijada por Prisma, salvo que exista una actualización estable compatible o una aceptación formal y documentada del riesgo.
