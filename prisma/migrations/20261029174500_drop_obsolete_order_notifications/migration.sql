-- Los avisos de sincronización, envío, cotización y operación completada dejaron de generarse: son
-- movimientos que ya quedan en la actividad del pedido, con su autor y su resultado, y repetirlos en
-- la campana no añadía nada. Igual pasa con los de cliente editado o sincronizado: de un cliente solo
-- se avisa el alta. Las filas que ya existían seguirían apareciendo en la campana, así que se
-- eliminan una sola vez junto con el cambio. Los avisos de inventario no se tocan.
DELETE FROM `notifications`
WHERE `type` IN (
  'ORDER_OPERATION_COMPLETED',
  'ORDER_SHIPMENT_UPDATED',
  'ORDER_SYNC_PARTIAL',
  'ORDER_SIIGO_QUOTATION_CREATED',
  'ORDER_SIIGO_QUOTATION_ERROR',
  'ORDER_WOO_RECEIVED_PALI',
  'ORDER_WOO_RECEIVED_SERATUS',
  'ORDER_SYNC_ERROR_PALI',
  'ORDER_SYNC_ERROR_SERATUS',
  'ORDER_SYNC_RECOVERED_PALI',
  'ORDER_SYNC_RECOVERED_SERATUS',
  'CUSTOMER_UPDATED',
  'CUSTOMER_RETRY_SUCCEEDED'
);

-- Los avisos de alta anteriores llevaban el resultado de las integraciones en un segundo renglón,
-- que es justo lo que ya no se avisa. Los nuevos son de una sola línea, así que se distinguen.
DELETE FROM `notifications`
WHERE `type` = 'CUSTOMER_CREATED' AND `message` LIKE '%\n%';

-- Los títulos anteriores nombraban la acción ("Cliente creado", "Nueva operación"). Los avisos que se
-- siguen generando usan un título fijo, así que el historial se lee igual que los nuevos.
UPDATE `notifications` SET `title` = 'Nuevo Cliente'
WHERE `type` = 'CUSTOMER_CREATED' AND `title` = 'Cliente creado';

UPDATE `notifications` SET `title` = 'Nuevo Pedido'
WHERE `type` = 'ORDER_OPERATION_CREATED' AND `title` = 'Nueva operación';
