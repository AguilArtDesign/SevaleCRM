import { Alert, Spinner, Table } from '@heroui/react';
import { Chip } from '../components/Chip';
import { prospectStatusMeta } from '../prospects/presentation';
import type { AgreementCustomerRecord } from './api';
import { messageFrom } from './presentation';

/**
 * Quiénes pertenecen al convenio: su pipeline de prospectos y los clientes que ya tienen el convenio
 * en su ficha. Cuando un prospecto se convierte deja de aparecer aquí como prospecto y vuelve como
 * cliente, así que nunca se lista dos veces la misma persona. El vínculo se cambia desde Clientes o
 * Prospectos, no desde aquí.
 */
export function AgreementCustomers({
  customers,
  isPending,
  isError,
  error,
}: {
  customers: AgreementCustomerRecord[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
}) {
  if (isPending) {
    return (
      <div className="customers-empty">
        <Spinner />
        <span>Cargando clientes del convenio…</span>
      </div>
    );
  }

  if (isError) {
    return (
      <Alert status="danger">
        <Alert.Content>
          <Alert.Description>{messageFrom(error)}</Alert.Description>
        </Alert.Content>
      </Alert>
    );
  }

  return (
    <Table className="agreement-customers-table">
      <Table.ScrollContainer>
        <Table.Content aria-label="Clientes del convenio">
          <Table.Header>
            <Table.Column isRowHeader>Cliente / Prospecto</Table.Column>
            <Table.Column>Documento</Table.Column>
            <Table.Column>Contacto</Table.Column>
            <Table.Column>Estado</Table.Column>
            <Table.Column>Alta</Table.Column>
          </Table.Header>
          <Table.Body
            renderEmptyState={() => (
              <div className="agreement-empty">
                Todavía no hay clientes ni prospectos vinculados a este convenio.
              </div>
            )}
          >
            {customers.map((row) => {
              const isCustomer = row.kind === 'CUSTOMER';
              const status = row.status
                ? prospectStatusMeta[row.status as keyof typeof prospectStatusMeta]
                : null;
              return (
                <Table.Row key={`${row.kind}-${row.id}`} id={`${row.kind}-${row.id}`}>
                  <Table.Cell>
                    <div className="agreement-task-cell">
                      <strong>{row.displayName}</strong>
                      {row.company && <span>{row.company}</span>}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="agreement-task-cell">
                      <span>{row.documentNumber ?? '--'}</span>
                      {row.documentType && <span>{row.documentType}</span>}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="agreement-task-cell">
                      <span>{row.email ?? '--'}</span>
                      {row.phone && <span>{row.phone}</span>}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    {isCustomer ? (
                      <Chip color="success">Cliente</Chip>
                    ) : status ? (
                      <Chip color={status.color}>{status.label}</Chip>
                    ) : (
                      row.status
                    )}
                  </Table.Cell>
                  <Table.Cell>{row.createdAt.slice(0, 10)}</Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}
