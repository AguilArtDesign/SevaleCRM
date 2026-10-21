import { Alert, Button, Spinner } from '@heroui/react';
import { ArrowUpRightFromSquare, PaperPlane } from '@gravity-ui/icons';
import { Chip } from '../components/Chip';
import type { ProspectRecord } from './api';
import { TagChip } from './TagChip';
import {
  dateOnly,
  dateTime,
  formatProspectAddress,
  messageFrom,
  missingFieldsText,
  prospectSourceMeta,
  prospectStatusMeta,
} from './presentation';

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value || '--'}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="customer-detail-section prospect-detail-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

/**
 * Ficha del prospecto. Es corta a propósito: si empieza a necesitar comentarios o tareas, deja de
 * ser un prospecto y pasa a Clientes, que es donde vive esa información.
 */
export function ProspectDetail({
  prospect,
  isLoading,
  error,
  canConvert,
  isConverting,
  onConvert,
  onOpenCustomer,
}: {
  prospect: ProspectRecord | null;
  isLoading: boolean;
  error: unknown;
  canConvert: boolean;
  isConverting: boolean;
  onConvert: () => void;
  onOpenCustomer: (customerId: number) => void;
}) {
  if (isLoading) {
    return (
      <div className="customers-empty">
        <Spinner />
        <span>Cargando prospecto…</span>
      </div>
    );
  }
  if (error) {
    return (
      <Alert status="danger">
        <Alert.Content>
          <Alert.Description>{messageFrom(error)}</Alert.Description>
        </Alert.Content>
      </Alert>
    );
  }
  if (!prospect) return null;

  const status = prospectStatusMeta[prospect.status];
  const converted = prospect.status === 'CONVERTED';

  return (
    <div className="customer-detail prospect-detail">
      <div className="customer-detail-identity">
        <div>
          <h3>{prospect.displayName}</h3>
          <Chip color={status.color}>{status.label}</Chip>
        </div>
      </div>

      <Section title="Contacto">
        <dl>
          <DetailRow label="Teléfono" value={prospect.phone} />
          <DetailRow label="Correo" value={prospect.email} />
          <DetailRow
            label="Documento"
            value={
              prospect.documentNumber
                ? [prospect.documentType, prospect.documentNumber, prospect.checkDigit]
                    .filter(Boolean)
                    .join(' ')
                : null
            }
          />
          <DetailRow label="Empresa" value={prospect.company} />
          <DetailRow label="Ubicación" value={formatProspectAddress(prospect)} />
        </dl>
      </Section>

      <Section title="Clasificación">
        <dl>
          <DetailRow label="Convenio" value={prospect.agreement?.companyName} />
          <DetailRow label="Origen" value={prospectSourceMeta[prospect.source]} />
          <DetailRow label="Comercial" value={prospect.assignedUser?.name ?? 'Sin asignar'} />
          <DetailRow label="Actualizado" value={dateTime(prospect.updatedAt)} />
        </dl>
        <div className="prospect-detail-tags">
          {prospect.tags.length === 0 ? (
            <span className="text-muted">Sin etiquetas</span>
          ) : (
            prospect.tags.map((tag) => <TagChip key={tag.id} tag={tag} />)
          )}
        </div>
      </Section>

      <Section title={converted ? 'Conversión' : 'Pasar a Clientes'}>
        {converted ? (
          <div className="prospect-conversion">
            <p>
              Convertido el <strong>{dateOnly(prospect.convertedAt)}</strong>.
            </p>
            {prospect.convertedCustomer ? (
              <Button
                variant="secondary"
                onPress={() => onOpenCustomer(prospect.convertedCustomer!.id)}
              >
                <ArrowUpRightFromSquare width={15} height={15} />
                Ver cliente
              </Button>
            ) : (
              <p className="text-muted">El cliente asociado ya no existe en el CRM.</p>
            )}
          </div>
        ) : (
          <div className="prospect-conversion">
            <p>
              {prospect.completeness.complete
                ? 'Tiene todos los datos que exige Clientes.'
                : `Faltan: ${missingFieldsText(prospect.completeness.missing)}.`}
            </p>
            {canConvert && (
              <Button variant="primary" isPending={isConverting} onPress={onConvert}>
                <PaperPlane width={15} height={15} />
                Convertir en cliente
              </Button>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
