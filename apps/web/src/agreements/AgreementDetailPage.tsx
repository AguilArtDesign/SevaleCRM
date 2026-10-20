import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Spinner } from '@heroui/react';
import { ArrowLeft } from '@gravity-ui/icons';
import { hasPermission } from '@sevale/permissions';
import { useCurrentUser } from '../users/useCurrentUser';
import { agreementsApi } from './api';
import { AgreementDetail, AgreementDetailError } from './AgreementDetail';
import { AgreementForm } from './AgreementForm';

/**
 * Ficha del convenio como página propia: la información, los comentarios y las tareas no caben con
 * holgura en un drawer, y aquí el usuario puede quedarse trabajando en el convenio.
 */
export function AgreementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const role = user?.role;
  const canUpdate = Boolean(role && hasPermission(role, 'agreements.update'));
  const canComment = Boolean(role && hasPermission(role, 'agreements.comments.create'));

  const agreementId = Number(id);
  const isValidId = Number.isSafeInteger(agreementId) && agreementId > 0;

  const [formOpen, setFormOpen] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const detailQuery = useQuery({
    queryKey: ['agreements', 'detail', agreementId, refreshToken],
    queryFn: () => agreementsApi.detail(agreementId),
    enabled: isValidId,
  });

  const commentsQuery = useQuery({
    queryKey: ['agreements', 'comments', agreementId, refreshToken],
    queryFn: () => agreementsApi.comments(agreementId),
    enabled: isValidId,
  });

  const tasksQuery = useQuery({
    queryKey: ['agreements', 'tasks', agreementId, refreshToken],
    queryFn: () => agreementsApi.tasks(agreementId),
    enabled: isValidId,
  });

  const assigneesQuery = useQuery({
    queryKey: ['agreements', 'assignees'],
    queryFn: () => agreementsApi.assignees(),
    enabled: isValidId,
    staleTime: 5 * 60_000,
  });

  const refresh = () => {
    setRefreshToken((current) => current + 1);
    void queryClient.invalidateQueries({ queryKey: ['agreements'] });
  };

  const backToList = () => void navigate('/agreements');

  if (!isValidId) {
    return (
      <section className="agreements-detail-page">
        <Alert status="danger">
          <Alert.Content>
            <Alert.Description>El convenio solicitado no es válido.</Alert.Description>
          </Alert.Content>
        </Alert>
        <Button variant="secondary" onPress={backToList}>
          <ArrowLeft width={15} height={15} />
          Volver a convenios
        </Button>
      </section>
    );
  }

  return (
    <section className="agreements-detail-page">
      <header className="agreements-detail-heading">
        <Button variant="ghost" size="sm" onPress={backToList}>
          <ArrowLeft width={15} height={15} />
          Convenios
        </Button>
      </header>

      {detailQuery.isPending ? (
        <div className="customers-empty">
          <Spinner />
          <span>Cargando convenio…</span>
        </div>
      ) : detailQuery.isError ? (
        <>
          <AgreementDetailError error={detailQuery.error} />
          <Button variant="secondary" onPress={backToList}>
            <ArrowLeft width={15} height={15} />
            Volver a convenios
          </Button>
        </>
      ) : detailQuery.data ? (
        <AgreementDetail
          agreement={detailQuery.data}
          comments={{
            data: commentsQuery.data?.data,
            isPending: commentsQuery.isPending,
            isError: commentsQuery.isError,
            error: commentsQuery.error,
          }}
          tasks={{
            data: tasksQuery.data?.data,
            isPending: tasksQuery.isPending,
            isError: tasksQuery.isError,
            error: tasksQuery.error,
          }}
          assignees={assigneesQuery.data ?? []}
          canUpdate={canUpdate}
          canComment={canComment}
          onEdit={() => setFormOpen(true)}
          onChanged={refresh}
        />
      ) : null}

      <AgreementForm
        isOpen={formOpen}
        agreement={detailQuery.data ?? null}
        isSubmitting={false}
        onClose={() => setFormOpen(false)}
        onSubmit={async (value) => {
          if (!detailQuery.data) return;
          await agreementsApi.update(detailQuery.data.id, value);
          setFormOpen(false);
          refresh();
        }}
      />
    </section>
  );
}
