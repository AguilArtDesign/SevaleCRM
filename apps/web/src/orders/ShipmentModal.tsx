import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Label, ListBox, Modal, Spinner, TextField } from '@heroui/react';
import { Car } from '@gravity-ui/icons';
import { isShipmentStatusCode, shipmentStatusCatalog } from '@sevale/shared';
import type { UpdateShipmentInput } from '@sevale/validation';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import type { OrderDetailRecord } from './api';

/**
 * Asignación del envío. Lo usan el panel de Pedidos y el de Envíos, así que espera el detalle ya
 * cargado: mientras no llegue muestra el cargador, no un formulario vacío que parecería listo.
 */
export function ShipmentModal({
  isOpen,
  order,
  isSubmitting,
  serverError,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  order: OrderDetailRecord | undefined;
  isSubmitting: boolean;
  serverError: string;
  onClose: () => void;
  onSubmit: (input: UpdateShipmentInput) => Promise<void>;
}) {
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    setCarrier(order?.shipment?.carrier ?? '');
    setTrackingNumber(order?.shipment?.trackingNumber ?? '');
    setStatus(order?.shipment?.status ?? '');
    setNote('');
  }, [order]);

  /**
   * El estado era texto libre, así que en la base puede haber valores que no son del catálogo
   * («En camino»). Se ofrecen como opción extra para no borrar lo que escribió logística.
   */
  const legacyStatus = status && !isShipmentStatusCode(status) ? status : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit({ carrier, trackingNumber, status, note: note || null });
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="md" placement="center" scroll="inside">
          <Modal.Dialog className="shipment-modal">
            <Modal.CloseTrigger aria-label="Cerrar envío" />
            <form onSubmit={submit}>
              <Modal.Header>
                <div>
                  <Modal.Heading>
                    {order?.shipment ? 'Actualizar envío' : 'Asignar envío'}
                  </Modal.Heading>
                  <p>{order?.operationCode ?? 'Cargando pedido…'}</p>
                </div>
              </Modal.Header>
              <Modal.Body>
                {serverError && (
                  <Alert status="danger">
                    <Alert.Content>
                      <Alert.Description>{serverError}</Alert.Description>
                    </Alert.Content>
                  </Alert>
                )}
                {!order ? (
                  <div className="orders-empty">
                    <Spinner />
                    <span>Cargando envío…</span>
                  </div>
                ) : (
                  <div className="shipment-form-grid">
                    <TextField isRequired name="carrier">
                      <Label>Transportadora</Label>
                      <Input
                        variant="secondary"
                        value={carrier}
                        onChange={(event) => setCarrier(event.target.value)}
                        maxLength={191}
                      />
                    </TextField>
                    <TextField isRequired name="trackingNumber">
                      <Label>Número de guía</Label>
                      <Input
                        variant="secondary"
                        value={trackingNumber}
                        onChange={(event) => setTrackingNumber(event.target.value)}
                        maxLength={191}
                      />
                    </TextField>
                    <div className="customer-field">
                      <Label>Estado</Label>
                      <Select
                        aria-label="Estado del envío"
                        value={status || null}
                        placeholder="Seleccionar estado"
                        variant="secondary"
                        onChange={(value) => setStatus(value === null ? '' : String(value))}
                      >
                        <Select.Trigger>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            {legacyStatus && (
                              <ListBox.Item key={legacyStatus} id={legacyStatus}>
                                {legacyStatus}
                              </ListBox.Item>
                            )}
                            {shipmentStatusCatalog.map((entry) => (
                              <ListBox.Item key={entry.code} id={entry.code}>
                                {entry.label}
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    </div>
                    <TextField name="note">
                      <Label>Nota</Label>
                      <Input
                        variant="secondary"
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        maxLength={2_000}
                      />
                    </TextField>
                  </div>
                )}
              </Modal.Body>
              <Modal.Footer>
                <Button variant="tertiary" onPress={onClose} isDisabled={isSubmitting}>
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  isDisabled={!order}
                  isPending={isSubmitting}
                >
                  {({ isPending }) => (
                    <>
                      {isPending ? <Spinner color="current" size="sm" /> : <Car width={17} />}
                      {isPending ? 'Guardando' : 'Guardar envío'}
                    </>
                  )}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
