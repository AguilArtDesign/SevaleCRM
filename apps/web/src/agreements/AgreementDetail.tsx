import type { ReactNode } from 'react';
import { useState } from 'react';
import { Alert, Button, Card, Tabs } from '@heroui/react';
import { Pencil } from '@gravity-ui/icons';
import { customerCountryFlagPath } from '@sevale/shared';
import { Chip } from '../components/Chip';
import type {
  AgreementCommentRecord,
  AgreementCustomerRecord,
  AgreementRecord,
  AgreementTaskRecord,
} from './api';
import { AgreementComments } from './AgreementComments';
import { AgreementCustomers } from './AgreementCustomers';
import { AgreementTasks } from './AgreementTasks';
import { AgreementStatusChip, formatAddress, messageFrom, validityLabel } from './presentation';

type SectionState<T> = {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
};

/** Fila de la ficha de datos. `dt`/`dd` mantienen el significado aunque la forma sea una card. */
function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="agreement-info-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function AgreementDetail({
  agreement,
  comments,
  tasks,
  customers,
  assignees,
  canUpdate,
  canComment,
  canDeleteComments,
  canDeleteTasks,
  canReadProspects,
  currentUserId,
  onEdit,
  onChanged,
}: {
  agreement: AgreementRecord;
  comments: SectionState<AgreementCommentRecord[]>;
  tasks: SectionState<AgreementTaskRecord[]>;
  customers: SectionState<AgreementCustomerRecord[]>;
  assignees: Array<{ id: string; name: string }>;
  canUpdate: boolean;
  canComment: boolean;
  /** Limpieza de contenido de prueba, reservada al administrador. */
  canDeleteComments: boolean;
  canDeleteTasks: boolean;
  canReadProspects: boolean;
  /** Id del usuario en sesión, para alinear sus mensajes en el chat de seguimiento. */
  currentUserId: string | null;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const address = formatAddress(agreement);
  const validity = validityLabel(agreement.validUntil);
  const customersTotal = customers.data?.length ?? 0;
  // La pestaña vive aquí y no en el `defaultSelectedKey`: al guardar un comentario o una tarea se
  // refrescan los datos y el árbol se vuelve a renderizar, y con un valor por defecto el usuario
  // saltaba a «Tareas» en mitad de su trabajo.
  const [activeTab, setActiveTab] = useState('tasks');

  return (
    <div className="agreement-detail">
      <Card className="agreement-hero">
        <Card.Content className="agreement-hero-content">
          <div className="agreement-hero-identity">
            {agreement.logoUrl ? (
              <span className="agreement-detail-logo" aria-hidden="true">
                <img src={agreement.logoUrl} alt="" />
              </span>
            ) : (
              <span className="agreement-logo agreement-logo--lg" aria-hidden="true">
                {agreement.companyName.slice(0, 2).toUpperCase()}
              </span>
            )}
            <div className="agreement-hero-text">
              <strong>{agreement.companyName}</strong>
              <span>{agreement.nit ? `NIT ${agreement.nit}` : 'Sin NIT registrado'}</span>
            </div>
          </div>

          <div className="agreement-hero-meta">
            <span className="agreement-hero-country">
              <img src={customerCountryFlagPath(agreement.country)} alt="" />
              {agreement.countryName ?? agreement.country}
            </span>
            <AgreementStatusChip active={agreement.active} />
            {agreement.validUntil && (
              <span
                className={
                  validity.expired
                    ? 'agreement-validity agreement-validity--expired'
                    : 'agreement-validity'
                }
              >
                {validity.expired ? 'Vencido' : `Vigencia: ${validity.label}`}
              </span>
            )}
            {canUpdate && (
              <Button size="sm" variant="secondary" onPress={onEdit}>
                <Pencil width={14} height={14} />
                Editar
              </Button>
            )}
          </div>
        </Card.Content>
      </Card>

      <div className="agreement-detail-columns">
        {/* Izquierda: los datos de la empresa y su contacto, que son de lectura. */}
        <div className="agreement-detail-column">
          <Card className="agreement-info-card">
            <Card.Header>
              <Card.Title>Información de la empresa</Card.Title>
            </Card.Header>
            <Card.Content>
              <dl className="agreement-info-list">
                <InfoRow label="NIT">{agreement.nit ?? '--'}</InfoRow>
                <InfoRow label="País">
                  <span className="agreement-hero-country">
                    <img src={customerCountryFlagPath(agreement.country)} alt="" />
                    {agreement.countryName ?? agreement.country}
                  </span>
                </InfoRow>
                <InfoRow label="Estado">
                  <AgreementStatusChip active={agreement.active} />
                </InfoRow>
                <InfoRow label="Vigencia">
                  {validity.expired ? (
                    <span className="agreement-validity agreement-validity--expired">
                      {validity.label}
                    </span>
                  ) : (
                    <>
                      {validity.label}
                      {agreement.validUntil && (
                        <span className="agreement-validity-date">
                          {' '}
                          · hasta {agreement.validUntil}
                        </span>
                      )}
                    </>
                  )}
                </InfoRow>
                <InfoRow label="Dirección">{address}</InfoRow>
                {agreement.description && (
                  <InfoRow label="Descripción">{agreement.description}</InfoRow>
                )}
                <InfoRow label="Creado por">
                  {agreement.createdBy
                    ? `${agreement.createdBy.name} · ${agreement.createdAt.slice(0, 10)}`
                    : 'Usuario eliminado'}
                </InfoRow>
              </dl>
            </Card.Content>
          </Card>

          <Card className="agreement-info-card">
            <Card.Header>
              <Card.Title>Contacto principal</Card.Title>
            </Card.Header>
            <Card.Content>
              <dl className="agreement-info-list">
                <InfoRow label="Nombre">{agreement.contactName ?? '--'}</InfoRow>
                <InfoRow label="Cargo">{agreement.contactPosition ?? '--'}</InfoRow>
                <InfoRow label="Correo">{agreement.contactEmail ?? '--'}</InfoRow>
                <InfoRow label="Teléfono">{agreement.contactPhone ?? '--'}</InfoRow>
              </dl>
            </Card.Content>
          </Card>
        </div>

        {/* Derecha: el trabajo del día a día. Las pestañas van fuera del contenido para que se lean
            como navegación de la ficha; solo el seguimiento vive dentro de una card, porque es una
            conversación y necesita un límite visual propio. */}
        <div className="agreement-detail-column agreement-detail-column--activity">
          <Tabs
            className="agreement-tabs"
            selectedKey={activeTab}
            onSelectionChange={(key) => setActiveTab(String(key))}
          >
            <Tabs.ListContainer>
              <Tabs.List aria-label="Actividad del convenio">
                <Tabs.Tab id="tasks">
                  Tareas
                  {/* Solo se muestra cuando hay trabajo pendiente: un 0 no aporta y la pestaña sin
                      contador ya comunica que no queda nada por hacer. */}
                  {agreement.pendingTasks > 0 && (
                    <Chip color="warning">{agreement.pendingTasks}</Chip>
                  )}
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="comments">
                  Seguimiento
                  <Chip>{agreement.commentsCount}</Chip>
                  <Tabs.Indicator />
                </Tabs.Tab>
                {canReadProspects && (
                  <Tabs.Tab id="customers">
                    Clientes
                    <Chip>{customersTotal}</Chip>
                    <Tabs.Indicator />
                  </Tabs.Tab>
                )}
              </Tabs.List>
            </Tabs.ListContainer>

            <Tabs.Panel className="agreement-tab-panel" id="tasks">
              <AgreementTasks
                agreementId={agreement.id}
                tasks={tasks.data ?? []}
                isPending={tasks.isPending}
                isError={tasks.isError}
                error={tasks.error}
                assignees={assignees}
                canUpdate={canUpdate}
                canDelete={canDeleteTasks}
                onChanged={onChanged}
              />
            </Tabs.Panel>

            <Tabs.Panel className="agreement-tab-panel" id="comments">
              <Card className="agreement-chat-card">
                <AgreementComments
                  agreementId={agreement.id}
                  comments={comments.data ?? []}
                  isPending={comments.isPending}
                  isError={comments.isError}
                  error={comments.error}
                  canComment={canComment}
                  canDelete={canDeleteComments}
                  currentUserId={currentUserId}
                  onChanged={onChanged}
                />
              </Card>
            </Tabs.Panel>

            {canReadProspects && (
              <Tabs.Panel className="agreement-tab-panel" id="customers">
                <AgreementCustomers
                  customers={customers.data ?? []}
                  isPending={customers.isPending}
                  isError={customers.isError}
                  error={customers.error}
                />
              </Tabs.Panel>
            )}
          </Tabs>
        </div>
      </div>
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
