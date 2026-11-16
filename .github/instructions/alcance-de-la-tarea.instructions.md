---
description: Cuándo se puede escribir código y cuándo solo hay que diagnosticar y proponer. Se aplica a cualquier tarea.
applyTo: '**'
---

# Alcance de la tarea

## Planear no es implementar

El usuario trabaja en español y suele abrir un tema con «te pongo en contexto», «planeamos una solución», «necesito hacer un cambio» o «analiza esto». Esas frases **no** autorizan a editar archivos: piden diagnóstico y propuesta.

Antes de la primera edición, decir qué archivos se van a tocar y por qué, y esperar. El silencio, un diagnóstico claro o un bug evidente no son autorización.

### Correcto

```
El payload que llegó al CRM trae 2 metadatos; el pedido en la tienda tiene 7.
Todo apunta al filter de n8n. ¿Lo ajustamos ahí o prefieres que lo cubra el CRM?
```

### Incorrecto

```
[Detecta el problema y reescribe 6 archivos sin preguntar]
```

## Buscar fuera del repo antes de escribir TypeScript

Muchos fallos viven en n8n, en los plugins de WooCommerce o en Siigo, no en el CRM. Si el dato que falta **existe en el origen** y se pierde en el camino, el arreglo es en el camino.

Antes de tocar código, descartar:

1. **¿El dato llegó mal o no llegó?** Comparar el payload de origen con el que entró al CRM. Una diferencia entre ambos es un mapeo, no un bug de lógica.
2. **¿Quién recorta el dato?** Si un intermediario (n8n, un transformador, una lista blanca) filtra campos, el arreglo va ahí.
3. **¿El arreglo en el repo es un parche de algo que se arregla en un solo sitio?** Si sí, proponer el arreglo del origen primero.

### Ejemplo real

Un pedido creado en el CRM se duplicó al llegar su webhook. `n8n` construía `meta_data` con una lista blanca de dos claves y descartaba el vínculo con la operación. El arreglo fueron cinco cadenas en un arreglo de n8n, no el código defensivo que se llegó a escribir en el CRM.

## No acumular cambios especulativos

Un cambio «por si acaso» en el CRM porque el origen está mal es deuda: más código que mantener y una causa real sin arreglar. Primero el origen. Si después se quiere una red de seguridad, se decide aparte y con su propio alcance.
