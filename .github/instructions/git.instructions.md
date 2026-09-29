---
description: Reglas de Git del repositorio. Se aplican a cualquier tarea que modifique archivos.
applyTo: '**'
---

# Reglas de Git

## Nunca commitear ni pushear sin autorización explícita

Crear un commit o enviarlo al remoto solo cuando el usuario lo autorice en esa misma conversación. El silencio, una tarea terminada o un cambio ya validado **no** son autorización.

Al terminar un cambio:

1. Dejarlo en el árbol de trabajo, sin commitear.
2. Validarlo con `npm run format:check`, `npm run lint`, `npm run typecheck` y `npm run build`.
3. Preguntar si se debe commitear, y esperar la respuesta.

### Correcto

```
Cambio aplicado y validado. Queda en el árbol de trabajo.
¿Hago el commit? ¿Lo envío al remoto?
```

### Incorrecto

```
Cambio aplicado y validado. Hice el commit y lo subí a main.
```

Antes de ejecutar `git commit` o `git push`, confirmar que el usuario lo pidió de forma explícita en el mensaje actual. Frases como «antes el commit y push quedó, pero ten en cuenta esto para los próximos» o «no es necesario» no autorizan nada.

## Alcance

- La autorización cubre solo el commit o el push que se autorizó. No se extiende a cambios posteriores ni a otras ramas.
- Si el usuario autoriza el commit pero no el push, ejecutar solo el commit.
- Si pide separar en varios commits, proponer la división antes de ejecutarla.

## Reglas relacionadas vigentes

- No usar `--amend` sobre commits ya enviados al remoto sin pedirlo.
- No usar `git push --force` ni `--no-verify`.
- El despliegue automático sigue desautorizado hasta que se solicite expresamente (ver `README.md`).
- Nunca incluir secretos ni el contenido de `.env` en un commit. Los archivos de `Instruccion no subir a GIT/` están excluidos por `.gitignore` y no deben subirse.
