import { Alert, Avatar, Button } from '@heroui/react';
import { Pencil } from '@gravity-ui/icons';
import { Chip } from '../components/Chip';
import type { AgreementCommentRecord, AgreementRecord, AgreementTaskRecord } from './api';
import { AgreementComments } from './AgreementComments';
import { AgreementTasks } from './AgreementTasks';
import { AgreementStatusChip, formatAddress, messageFrom } from './presentation';

type SectionState<T> = {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
};

function statusColor(active: boolean) {
  return active ? 'success' : 'default';
}

export function AgreementDetail({
  agreement,
  comments,
  tasks,
  assignees,
  canUpdate,
  canComment,
  onEdit,
  onChanged,
}: {
  agreement: AgreementRecord;
  comments: SectionState<AgreementCommentRecord[]>;
  tasks: SectionState<AgreementTaskRecord[]>;
  assignees: Array<{ id: string; name: string }>;
  canUpdate: boolean;
  canComment: boolean;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const address = formatAddress(agreement);
  return (
    <div className="customer-detail agreement-detail">
      <section className="customer-detail-identity">
        <Avatar size="md" className="customer-detail-avatar agreement-detail-avatar">
          <Avatar.Fallback>{agreement.companyName.slice(0, 2).toUpperCase()}</Avatar.Fallback>
        </Avatar>
        <div>
          <strong>{agreement.companyName}</strong>
          <span>{agreement.nit ? `NIT ${agreement.nit}` : 'Sin NIT registrado'}</span>
        </div>
        <Chip color={statusColor(agreement.active)}>
          {agreement.active ? 'Activo' : 'Inactivo'}
        </Chip>
      </section>

      <section className="customer-detail-section">
        <div className="agreement-section-heading">
          <h3>Información de la empresa</h3>
          {canUpdate && (
            <Button size="sm" variant="secondary" onPress={onEdit}>
              <Pencil width={14} height={14} />
              Editar
            </Button>
          )}
        </div>
        <dl>
          <div>
            <dt>NIT</dt>
            <dd>{agreement.nit ?? '--'}</dd>
          </div>
          <div>
            <dt>Estado</dt>
            <dd>
              <AgreementStatusChip active={agreement.active} />
            </dd>
          </div>
          <div className="customer-detail-address">
            <dt>Dirección</dt>
            <dd>{address}</dd>
          </div>
          {agreement.description && (
            <div>
              <dt>Descripción</dt>
              <dd>{agreement.description}</dd>
            </div>
          )}
          <div>
            <dt>Creado por</dt>
            <dd>
              {agreement.createdBy
                ? `${agreement.createdBy.name} · ${agreement.createdAt.slice(0, 10)}`
                : 'Usuario eliminado'}
            </dd>
          </div>
        </dl>
      </section>

      <section className="customer-detail-section">
        <h3>Contacto principal</h3>
        <dl>
          <div>
            <dt>Nombre</dt>
            <dd>{agreement.contactName ?? '--'}</dd>
          </div>
          <div>
            <dt>Cargo</dt>
            <dd>{agreement.contactPosition ?? '--'}</dd>
          </div>
          <div>
            <dt>Correo</dt>
            <dd>{agreement.contactEmail ?? '--'}</dd>
          </div>
          <div>
            <dt>Teléfono</dt>
            <dd>{agreement.contactPhone ?? '--'}</dd>
          </div>
        </dl>
      </section>

      <section className="customer-detail-section">
        <h3>Resumen</h3>
        <div className="customer-orders-summary">
          <article className="customer-orders-stat">
            <span>Tareas pendientes</span>
            <strong>{agreement.pendingTasks}</strong>
          </article>
          <article className="customer-orders-stat">
            <span>Comentarios</span>
            <strong>{agreement.commentsCount}</strong>
          </article>
        </div>
      </section>

      <AgreementComments
        agreementId={agreement.id}
        comments={comments.data ?? []}
        isPending={comments.isPending}
        isError={comments.isError}
        error={comments.error}
        canComment={canComment}
        onChanged={onChanged}
      />

      <AgreementTasks
        agreementId={agreement.id}
        tasks={tasks.data ?? []}
        isPending={tasks.isPending}
        isError={tasks.isError}
        error={tasks.error}
        assignees={assignees}
        canUpdate={canUpdate}
        onChanged={onChanged}
      />
    </div>
  );
}

export function AgreementDetailError({ error }: { error: unknown }) {
  return (
    <Alert status="danger">
      <Alert.Content>
        <Alert.Description>{messageFrom(error)}</Alert.Description>
      </Alert.Content>
    </Alert>
  );
}
