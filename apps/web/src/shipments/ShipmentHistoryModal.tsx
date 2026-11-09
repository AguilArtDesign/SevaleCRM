import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Modal, Spinner, TextField } from '@heroui/react';
import { PaperPlane } from '@gravity-ui/icons';
import { resolveShipmentStatus } from '@sevale/shared';
import { hasPermission } from '@sevale/permissions';
import { Chip } from '../components/Chip';
import { Textarea } from '../components/Textarea';
import { formattedDate } from '../orders/presentation';
import { useCurrentUser } from '../users/useCurrentUser';
import { shipmentsApi } from './api';

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'No pudimos completar la solicitud.';
}

/**
 * Bitácora del envío. Es el sitio donde logística deja la novedad —«dirección errada», «reprogramado
 * para el lunes»— sin tocar la guía ni el estado, que se cambian asignando el envío.
 *
 * El comentario cuelga del envío, así que solo se ofrece cuando la guía ya existe: una operación sin
 * despachar no tiene novedades que contar.
 */
export function ShipmentHistoryModal({
  operationId,
  onClose,
}: {
  operationId: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  // Escribir la novedad es una escritura sobre el envío: mismo permiso que asignar la guía.
  const canComment = Boolean(user && hasPermission(user.role, 'orders.shipping.update'));
  const [note, setNote] = useState('');

  const historyQuery = useQuery({
    queryKey: ['shipments', 'history', operationId],
    queryFn: () => shipmentsApi.history(operationId),
  });
  const history = historyQuery.data;
  const shipment = history?.shipment ?? null;

  const addNote = useMutation({
    mutationFn: (value: string) => shipmentsApi.addNote(operationId, value),
    onSuccess: async () => {
      setNote('');
      // El panel muestra la última novedad en su columna, así que también hay que refrescarlo.
      await queryClient.invalidateQueries({ queryKey: ['shipments'] });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = note.trim();
    if (!value || addNote.isPending) return;
    addNote.mutate(value);
  };

  return (
    <Modal isOpen onOpenChange={(open) => !open && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="md" placement="center" scroll="inside">
          <Modal.Dialog className="shipment-history-modal">
            <Modal.CloseTrigger aria-label="Cerrar novedades del envío" />
            <Modal.Header>
              <div>
                <Modal.Heading>Novedades del envío</Modal.Heading>
                <p>{history?.operationCode ?? 'Cargando envío…'}</p>
              </div>
            </Modal.Header>
            <Modal.Body>
              {historyQuery.isPending ? (
                <div className="orders-empty">
                  <Spinner />
                  <span>Cargando novedades…</span>
                </div>
              ) : historyQuery.isError ? (
                <Alert status="danger">
                  <Alert.Content>
                    <Alert.Title>No pudimos cargar las novedades</Alert.Title>
                    <Alert.Description>{messageFrom(historyQuery.error)}</Alert.Description>
                  </Alert.Content>
                </Alert>
              ) : (
                <div className="shipment-detail">
                  <dl>
                    <div>
                      <dt>Transportadora</dt>
                      <dd>{shipment?.carrier || 'Sin asignar'}</dd>
                    </div>
                    <div>
                      <dt>Número de guía</dt>
                      <dd>{shipment?.trackingNumber || 'Sin asignar'}</dd>
                    </div>
                    <div>
                      <dt>Estado</dt>
                      <dd>
                        {shipment?.status
                          ? resolveShipmentStatus(shipment.status).label
                          : 'Sin asignar'}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}

              {!historyQuery.isPending && !historyQuery.isError && !shipment && (
                <p className="shipment-history-empty">
                  Asigna la guía para poder registrar novedades de este envío.
                </p>
              )}

              {shipment && shipment.events.length === 0 && (
                <p className="shipment-history-empty">Todavía no hay novedades registradas.</p>
              )}

              {shipment && shipment.events.length > 0 && (
                <div className="shipment-history">
                  {shipment.events.map((event) => (
                    <div key={event.id}>
                      <Chip color={resolveShipmentStatus(event.status).color}>
                        {resolveShipmentStatus(event.status).label}
                      </Chip>
                      {event.note && <p className="shipment-history-note">{event.note}</p>}
                      <small>
                        {formattedDate(event.createdAt)}
                        {event.author ? ` · ${event.author}` : ''}
                      </small>
                    </div>
                  ))}
                </div>
              )}

              {addNote.isError && (
                <Alert status="danger">
                  <Alert.Content>
                    <Alert.Description>{messageFrom(addNote.error)}</Alert.Description>
                  </Alert.Content>
                </Alert>
              )}
            </Modal.Body>
            {canComment && shipment && (
              <Modal.Footer>
                <form className="shipment-note-form" onSubmit={submit}>
                  <TextField className="shipment-note-field">
                    <Textarea
                      aria-label="Nueva novedad del envío"
                      variant="secondary"
                      placeholder="Qué pasó con el envío…"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                    />
                  </TextField>
                  <Button
                    type="submit"
                    variant="primary"
                    isIconOnly
                    isPending={addNote.isPending}
                    isDisabled={!note.trim() || addNote.isPending}
                    aria-label="Agregar novedad"
                  >
                    <PaperPlane width={16} height={16} />
                  </Button>
                </form>
              </Modal.Footer>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
