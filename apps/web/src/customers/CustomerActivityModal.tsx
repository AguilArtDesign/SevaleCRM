import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Modal, Spinner } from '@heroui/react';
import { ArrowRotateRight, Pencil, PersonPlus, TrashBin } from '@gravity-ui/icons';
import { Chip } from '../components/Chip';
import { Pagination } from '../components/Pagination';
import { customersApi, type CustomerEventChange, type CustomerEventRecord } from './api';

/** Etiquetas de los campos que la API compara al editar. */
const fieldLabels: Record<string, string> = {
  firstName: 'Nombre',
  lastName: 'Apellido',
  displayName: 'Nombre público',
  company: 'Empresa',
  documentType: 'Tipo de documento',
  documentNumber: 'Número de documento',
  checkDigit: 'Dígito de verificación',
  email: 'Correo',
  phone: 'Teléfono',
  country: 'País',
  region: 'Región/Provincia',
  cityCode: 'Código de ciudad',
  cityName: 'Ciudad',
  postalCode: 'Código postal',
  addressLine1: 'Dirección',
  addressLine2: 'Complemento de dirección',
  agreementId: 'Convenio',
  vatResponsible: 'Responsable de IVA',
  fiscalResponsibilities: 'Responsabilidades fiscales',
  active: 'Activo',
  createdByUserId: 'Autor del alta',
};

const providerLabels = {
  SIIGO: 'Siigo',
  SERATUS: 'Seratus',
  PALI: 'Pali',
} as const;

const actionMeta = {
  CREATED: { label: 'Creó el cliente', tone: 'success', Icon: PersonPlus },
  UPDATED: { label: 'Editó la ficha', tone: 'warning', Icon: Pencil },
  SYNCED: { label: 'Sincronizó', tone: 'neutral', Icon: ArrowRotateRight },
  DELETED: { label: 'Eliminó el cliente', tone: 'danger', Icon: TrashBin },
} as const;

const emptyValue = '—';

function dateTime(value: string) {
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

/**
 * Los valores llegan tal como se guardaron. Se muestran legibles: un `null` como guion y los
 * arreglos separados por comas, para que el cambio se lea sin abrir la ficha.
 */
function readable(value: unknown): string {
  if (value === null || value === undefined || value === '') return emptyValue;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (Array.isArray(value)) return value.length ? value.map(readable).join(', ') : emptyValue;
  if (typeof value === 'object') return JSON.stringify(value);
  return emptyValue;
}

function ChangeList({ changes }: { changes: CustomerEventChange[] }) {
  return (
    <ul className="customer-activity-changes">
      {changes.map((change) => (
        <li key={change.field}>
          <span className="customer-activity-field">
            {fieldLabels[change.field] ?? change.field}
          </span>
          <span className="customer-activity-from">{readable(change.from)}</span>
          <span className="customer-activity-arrow" aria-label="cambió a">
            →
          </span>
          <span className="customer-activity-to">{readable(change.to)}</span>
        </li>
      ))}
    </ul>
  );
}

function EventRow({ event }: { event: CustomerEventRecord }) {
  const meta = actionMeta[event.action];
  const actionLabel =
    event.action === 'SYNCED' && event.provider
      ? `${meta.label} con ${providerLabels[event.provider]}`
      : meta.label;
  return (
    <li className={`customer-activity-item customer-activity-item--${meta.tone}`}>
      <span className="customer-activity-marker" aria-hidden="true">
        <meta.Icon width={15} height={15} />
      </span>
      <div className="customer-activity-body">
        <div className="customer-activity-head">
          <strong>{event.actor?.name || 'Sistema'}</strong>
          <time dateTime={event.createdAt}>{dateTime(event.createdAt)}</time>
        </div>
        <div className="customer-activity-action">
          <span>{actionLabel}</span>
          {event.outcome && (
            <Chip color={event.outcome === 'SYNCED' ? 'success' : 'danger'}>
              {event.outcome === 'SYNCED' ? 'Correcta' : 'Con error'}
            </Chip>
          )}
          {event.origin === 'BACKFILL' && (
            <span
              className="customer-activity-flag"
              title="Dato reconstruido a partir de registros anteriores al historial"
            >
              Reconstruido
            </span>
          )}
        </div>
        {event.changes.length > 0 && <ChangeList changes={event.changes} />}
        {event.message && (
          <p
            className={`customer-activity-message${
              event.outcome === 'ERROR' ? '' : ' customer-activity-message--info'
            }`}
          >
            {event.message}
          </p>
        )}
      </div>
    </li>
  );
}

type CustomerActivityModalProps = {
  customer: { id: number; displayName: string } | null;
  onClose: () => void;
};

/**
 * Traza de responsabilidades de la ficha: quién la creó, quién cambió qué y qué sincronizaciones
 * se intentaron. Es solo de lectura; el endpoint exige el permiso `customers.activity.read`.
 */
export function CustomerActivityModal({ customer, onClose }: CustomerActivityModalProps) {
  const [page, setPage] = useState(1);
  const activityQuery = useQuery({
    queryKey: ['customers', 'activity', customer?.id, page],
    queryFn: () => customersApi.activity(customer?.id as number, page),
    enabled: customer !== null,
  });
  const result = activityQuery.data;

  return (
    <Modal.Backdrop
      isOpen={customer !== null}
      onOpenChange={(open) => {
        if (!open) {
          setPage(1);
          onClose();
        }
      }}
    >
      <Modal.Container size="lg" placement="center" scroll="inside">
        <Modal.Dialog className="customer-activity-modal">
          <Modal.CloseTrigger aria-label="Cerrar actividad" />
          <Modal.Header>
            <Modal.Heading>Actividad del cliente</Modal.Heading>
            <p>{customer?.displayName}</p>
          </Modal.Header>
          <Modal.Body>
            {activityQuery.isPending ? (
              <div className="customers-empty">
                <Spinner />
                <span>Cargando actividad…</span>
              </div>
            ) : activityQuery.isError ? (
              <Alert status="danger">
                <Alert.Content>
                  <Alert.Description>
                    {activityQuery.error instanceof Error
                      ? activityQuery.error.message
                      : 'No pudimos cargar la actividad del cliente.'}
                  </Alert.Description>
                </Alert.Content>
              </Alert>
            ) : !result || result.data.length === 0 ? (
              <div className="customers-empty">
                <span>
                  Todavía no hay movimientos registrados para este cliente. La traza empieza a
                  partir de la próxima creación, edición o sincronización.
                </span>
              </div>
            ) : (
              <ol className="customer-activity-list">
                {result.data.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </ol>
            )}
          </Modal.Body>
          {result && result.pagination.totalPages > 1 && (
            <Modal.Footer>
              <Pagination aria-label="Paginación de actividad">
                <Pagination.Content>
                  <Pagination.Item>
                    <Pagination.Previous
                      isDisabled={page <= 1 || activityQuery.isFetching}
                      onPress={() => setPage(page - 1)}
                    >
                      <Pagination.PreviousIcon />
                      Anterior
                    </Pagination.Previous>
                  </Pagination.Item>
                  <Pagination.Item>
                    <span className="customer-activity-page">
                      Página {page} de {result.pagination.totalPages}
                    </span>
                  </Pagination.Item>
                  <Pagination.Item>
                    <Pagination.Next
                      isDisabled={page >= result.pagination.totalPages || activityQuery.isFetching}
                      onPress={() => setPage(page + 1)}
                    >
                      Siguiente
                      <Pagination.NextIcon />
                    </Pagination.Next>
                  </Pagination.Item>
                </Pagination.Content>
              </Pagination>
            </Modal.Footer>
          )}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
