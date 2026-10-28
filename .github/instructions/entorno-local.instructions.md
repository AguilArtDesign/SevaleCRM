---
description: El entorno de desarrollo local. Se aplica a cualquier tarea, porque cualquier tarea puede tumbarlo.
applyTo: '**'
---

# Entorno local

## Dejarlo funcionando al terminar

El usuario trabaja en el navegador mientras iteramos. Si al terminar el entorno queda a medias, tiene que cerrar la consola, relanzar `npm run dev`, esperar a la API y volver a iniciar sesión. Se pierde la sesión y el contexto de lo que estaba mirando.

**Al terminar cualquier bloque de cambios, comprobar que los dos servidores responden antes de escribir el resumen.** No basta con que el código compile.

| Servicio   | Puerto | Cómo levantarlo   |
| ---------- | ------ | ----------------- |
| API (Nest) | 3000   | `npm run dev:api` |
| Web (Vite) | 5173   | `npm run dev:web` |

Comprobación rápida:

```powershell
Invoke-WebRequest -Uri 'http://localhost:3000/api/health' -UseBasicParsing -TimeoutSec 5
Get-NetTCPConnection -State Listen -LocalPort 5173
```

La API responde `{"status":"ok","service":"sevale-crm-api"}`.

## Antes de dar por bueno el entorno

1. Los dos puertos escuchan.
2. `/api/health` responde 200.
3. La sesión sigue viva y una pantalla con datos carga sin error.

Si el front muestra «Usuario / Sesión activa» en lugar del nombre real, o «No pudimos cargar…», la API está caída aunque el puerto 5173 funcione.

## Qué tumba el entorno, y qué hacer

- **`npm run build`** detiene la API en modo watch. Después hay que levantarla otra vez.
- **`npm run start:prod`** ocupa el puerto 3000 con el build compilado. Solo para comprobar un arranque real, y **debe detenerse y sustituirse** por el watcher al terminar.
- **`Stop-Process` sobre el puerto 3000** para liberar el puerto en las pruebas. Es la causa más habitual de dejar el entorno caído.
- **`npm ci`** borra `node_modules` y falla si hay archivos en uso por los servidores. Si hay que reinstalar, detener primero los servidores y volver a levantarlos.

## Levantar los dos a la vez

```powershell
npm run dev
```

Compila `@sevale/shared` y arranca web y API con `concurrently`. Es lo que usa el usuario cuando no hay nada corriendo.

## Regla

Antes de escribir el resumen final de una tarea, verificar los tres puntos de «Antes de dar por bueno el entorno». Si algo está caído, levantarlo y **comprobarlo de nuevo**. No anunciar que todo quedó bien sin esa comprobación.

Si se detuvo un servidor para probar algo, decirlo no es suficiente: hay que dejarlo arriba.
