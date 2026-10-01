import { Modal, Spinner } from '@heroui/react';
import type { OrderDetailRecord } from './api';

/**
 * Envío en solo lectura, para quien no lo asigna. Es provisional: falta el diseño definitivo, así
 * que por ahora solo muestra los datos que cargó logística o el aviso de que todavía no existen.
 */
export function ShipmentViewModal({
  isOpen,
  order,
  onClose,
}: {
  isOpen: boolean;
  order: OrderDetailRecord | undefined;
  onClose: () => void;
}) {
  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="md" placement="center" scroll="inside">
          <Modal.Dialog className="shipment-view-modal">
            <Modal.CloseTrigger aria-label="Cerrar envío" />
            <Modal.Header>
              <div>
                <Modal.Heading>Envío</Modal.Heading>
                <p>{order?.operationCode ?? 'Cargando pedido…'}</p>
              </div>
            </Modal.Header>
            <Modal.Body>
              {!order ? (
                <div className="orders-empty">
                  <Spinner />
                  <span>Cargando envío…</span>
                </div>
              ) : order.shipment ? (
                <div className="shipment-detail">
                  <dl>
                    <div>
                      <dt>Transportadora</dt>
                      <dd>{order.shipment.carrier}</dd>
                    </div>
                    <div>
                      <dt>Número de guía</dt>
                      <dd>{order.shipment.trackingNumber}</dd>
                    </div>
                    <div>
                      <dt>Estado</dt>
                      <dd>{order.shipment.status}</dd>
                    </div>
                  </dl>
                </div>
              ) : (
                <p>
                  Logistica aun no ha asignado los datos de envio (Temporal hasta que decida el
                  diseño)
                </p>
              )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
