import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Label, Modal, Spinner, TextField } from '@heroui/react';
import { Car } from '@gravity-ui/icons';
import type { UpdateShipmentInput } from '@sevale/validation';
import { Input } from '../components/Input';
import type { OrderDetailRecord } from './api';

export function ShipmentModal({
  isOpen,
  order,
  isSubmitting,
  serverError,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  order: OrderDetailRecord;
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
    setCarrier(order.shipment?.carrier ?? '');
    setTrackingNumber(order.shipment?.trackingNumber ?? '');
    setStatus(order.shipment?.status ?? '');
    setNote('');
  }, [order]);

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
                    {order.shipment ? 'Actualizar envío' : 'Asignar envío'}
                  </Modal.Heading>
                  <p>{order.operationCode}</p>
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
                  <TextField isRequired name="status">
                    <Label>Estado</Label>
                    <Input
                      variant="secondary"
                      value={status}
                      onChange={(event) => setStatus(event.target.value)}
                      maxLength={100}
                    />
                  </TextField>
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
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" onPress={onClose} isDisabled={isSubmitting}>
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" isPending={isSubmitting}>
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
