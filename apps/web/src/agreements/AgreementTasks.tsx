import { useState } from 'react';
import {
  Alert,
  AlertDialog,
  Button,
  Label,
  ListBox,
  Modal,
  Spinner,
  Table,
  TextField,
  toast,
} from '@heroui/react';
import {
  ArrowRotateRight,
  Check,
  PaperPlane,
  Pencil,
  Plus,
  TrashBin,
  Xmark,
} from '@gravity-ui/icons';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { Chip } from '../components/Chip';
import {
  agreementsApi,
  AgreementRequestError,
  type AgreementTaskRecord,
  type AgreementTaskStatus,
} from './api';
import { messageFrom, scheduledHint, scheduledLabel, taskStatusMeta } from './presentation';

type TaskFormValue = {
  title: string;
  description: string;
  scheduledAt: string;
  assignedUserId: string;
};

const emptyTask: TaskFormValue = {
  title: '',
  description: '',
  scheduledAt: '',
  assignedUserId: '',
};

/** `datetime-local` usa `YYYY-MM-DDTHH:mm`; el ISO completo sirve para precargar el campo. */
function localDateTimeValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

const statusFilters: Array<{ id: AgreementTaskStatus | 'ALL'; label: string }> = [
  { id: 'ALL', label: 'Todas' },
  { id: 'PENDING', label: 'Pendientes' },
  { id: 'COMPLETED', label: 'Completadas' },
  { id: 'CANCELLED', label: 'Canceladas' },
];

export function AgreementTasks({
  agreementId,
  tasks,
  isPending,
  isError,
  error,
  assignees,
  canUpdate,
  canDelete,
  onChanged,
}: {
  agreementId: number;
  tasks: AgreementTaskRecord[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  assignees: Array<{ id: string; name: string }>;
  canUpdate: boolean;
  /** Solo el administrador puede borrar: sirve para limpiar tareas de prueba. */
  canDelete: boolean;
  onChanged: () => void;
}) {
  const [statusFilter, setStatusFilter] = useState<AgreementTaskStatus | 'ALL'>('ALL');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AgreementTaskRecord | null>(null);
  const [value, setValue] = useState<TaskFormValue>(emptyTask);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AgreementTaskRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const visibleTasks =
    statusFilter === 'ALL' ? tasks : tasks.filter((task) => task.status === statusFilter);

  const openCreate = () => {
    setEditing(null);
    setValue(emptyTask);
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (task: AgreementTaskRecord) => {
    setEditing(task);
    setValue({
      title: task.title,
      description: task.description ?? '',
      scheduledAt: localDateTimeValue(task.scheduledAt),
      assignedUserId: task.assignedUser?.id ?? '',
    });
    setFormError('');
    setFormOpen(true);
  };

  const submit = async () => {
    const title = value.title.trim();
    if (!title) {
      setFormError('Escribe el título de la tarea.');
      return;
    }
    if (!value.scheduledAt) {
      setFormError('Selecciona la fecha y hora de la tarea.');
      return;
    }
    // `datetime-local` no trae huso: se convierte a ISO para que la API guarde el instante real.
    const scheduled = new Date(value.scheduledAt);
    if (Number.isNaN(scheduled.getTime())) {
      setFormError('Selecciona una fecha y hora válidas.');
      return;
    }
    setIsSubmitting(true);
    setFormError('');
    // El esquema de validación transforma la fecha a `Date`, así que se envía como instante y no
    // como el texto sin huso que devuelve `datetime-local`.
    const payload = {
      title,
      description: value.description,
      scheduledAt: scheduled,
      assignedUserId: value.assignedUserId || null,
    };
    try {
      if (editing) await agreementsApi.updateTask(agreementId, editing.id, payload);
      else await agreementsApi.addTask(agreementId, payload);
      setFormOpen(false);
      onChanged();
      toast.success(editing ? 'Tarea actualizada.' : 'Tarea creada.');
    } catch (submitError) {
      setFormError(
        submitError instanceof AgreementRequestError &&
          submitError.code === 'AGREEMENT_TASK_ASSIGNEE_NOT_FOUND'
          ? 'El usuario asignado ya no existe.'
          : messageFrom(submitError),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const changeStatus = async (
    task: AgreementTaskRecord,
    action: 'complete' | 'cancel' | 'reopen',
  ) => {
    if (busyId !== null) return;
    setBusyId(task.id);
    try {
      await agreementsApi.setTaskStatus(agreementId, task.id, action);
      onChanged();
    } catch (statusError) {
      toast.danger('No pudimos actualizar la tarea.', {
        description: messageFrom(statusError),
      });
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    try {
      await agreementsApi.deleteTask(agreementId, deleteTarget.id);
      setDeleteTarget(null);
      onChanged();
      toast.success('Tarea eliminada.');
    } catch (deleteError) {
      toast.danger('No pudimos eliminar la tarea.', {
        description: messageFrom(deleteError),
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="agreement-tab-body">
      <div className="agreement-task-toolbar">
        <Select
          aria-label="Filtrar tareas por estado"
          variant="secondary"
          selectedKey={statusFilter}
          onSelectionChange={(key) => setStatusFilter(String(key) as AgreementTaskStatus | 'ALL')}
        >
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {statusFilters.map((filter) => (
                <ListBox.Item key={filter.id} id={filter.id} textValue={filter.label}>
                  {filter.label}
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        {canUpdate && (
          <Button size="sm" variant="secondary" onPress={openCreate}>
            <Plus width={14} height={14} />
            Nueva tarea
          </Button>
        )}
      </div>

      {isPending ? (
        <div className="customers-empty">
          <Spinner />
          <span>Cargando tareas…</span>
        </div>
      ) : isError ? (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Description>{messageFrom(error)}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : (
        <Table className="agreement-tasks-table">
          <Table.ScrollContainer>
            <Table.Content aria-label="Tareas del convenio">
              <Table.Header>
                <Table.Column isRowHeader>Tarea</Table.Column>
                <Table.Column>Estado</Table.Column>
                <Table.Column>Programada</Table.Column>
                <Table.Column>Asignada a</Table.Column>
                {/* Sin encabezado: la columna solo aloja los botones de cada fila. */}
                {(canUpdate || canDelete) && (
                  <Table.Column className="agreement-tasks-actions-column" />
                )}
              </Table.Header>
              <Table.Body
                renderEmptyState={() => (
                  <div className="agreement-empty">
                    {tasks.length === 0
                      ? 'Este convenio todavía no tiene tareas.'
                      : 'No hay tareas con ese estado.'}
                  </div>
                )}
              >
                {visibleTasks.map((task) => (
                  <Table.Row key={task.id} id={task.id}>
                    <Table.Cell>
                      <div className="agreement-task-cell">
                        <strong>{task.title}</strong>
                        {task.description && <span>{task.description}</span>}
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <Chip color={taskStatusMeta[task.status].color}>
                        {taskStatusMeta[task.status].label}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="agreement-task-cell">
                        <span>{scheduledLabel(task.scheduledAt)}</span>
                        {scheduledHint(task.scheduledAt) && (
                          <span>{scheduledHint(task.scheduledAt)}</span>
                        )}
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      {task.assignedUser ? task.assignedUser.name : 'Sin asignar'}
                    </Table.Cell>
                    {canUpdate && (
                      <Table.Cell className="agreement-tasks-actions-cell">
                        <div className="agreement-task-actions">
                          {task.status === 'PENDING' && (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                isIconOnly
                                isDisabled={busyId !== null}
                                aria-label={`Editar ${task.title}`}
                                onPress={() => openEdit(task)}
                              >
                                <Pencil width={14} height={14} />
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                isIconOnly
                                isPending={busyId === task.id}
                                isDisabled={busyId !== null}
                                aria-label={`Completar ${task.title}`}
                                onPress={() => void changeStatus(task, 'complete')}
                              >
                                <Check width={14} height={14} />
                              </Button>
                            </>
                          )}
                          {task.status !== 'CANCELLED' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              isIconOnly
                              isDisabled={busyId !== null}
                              aria-label={`Cancelar ${task.title}`}
                              onPress={() => void changeStatus(task, 'cancel')}
                            >
                              <Xmark width={14} height={14} />
                            </Button>
                          )}
                          {task.status !== 'PENDING' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              isIconOnly
                              isDisabled={busyId !== null}
                              aria-label={`Reabrir ${task.title}`}
                              onPress={() => void changeStatus(task, 'reopen')}
                            >
                              <ArrowRotateRight width={14} height={14} />
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              size="sm"
                              variant="ghost"
                              isIconOnly
                              isDisabled={busyId !== null || isDeleting}
                              aria-label={`Eliminar ${task.title}`}
                              onPress={() => setDeleteTarget(task)}
                            >
                              <TrashBin width={14} height={14} />
                            </Button>
                          )}
                        </div>
                      </Table.Cell>
                    )}
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      )}

      <Modal.Backdrop
        isOpen={formOpen}
        onOpenChange={(open) => !open && !isSubmitting && setFormOpen(false)}
      >
        <Modal.Container size="md" placement="center">
          <Modal.Dialog className="agreement-task-modal">
            <Modal.CloseTrigger aria-label="Cerrar tarea">
              <Xmark width={16} height={16} />
            </Modal.CloseTrigger>
            <Modal.Header>
              <Modal.Heading>{editing ? 'Editar tarea' : 'Nueva tarea'}</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="agreement-task-body">
              {formError && (
                <Alert status="danger">
                  <Alert.Content>
                    <Alert.Description>{formError}</Alert.Description>
                  </Alert.Content>
                </Alert>
              )}
              <TextField>
                <Label>Título *</Label>
                <Input
                  variant="secondary"
                  placeholder="Llamar a Laura"
                  value={value.title}
                  onChange={(event) =>
                    setValue((current) => ({ ...current, title: event.target.value }))
                  }
                />
              </TextField>
              <TextField>
                <Label>Descripción</Label>
                <Input
                  variant="secondary"
                  placeholder="Confirmar la visita del viernes"
                  value={value.description}
                  onChange={(event) =>
                    setValue((current) => ({ ...current, description: event.target.value }))
                  }
                />
              </TextField>
              <TextField>
                <Label>Fecha y hora *</Label>
                <Input
                  type="datetime-local"
                  variant="secondary"
                  value={value.scheduledAt}
                  onChange={(event) =>
                    setValue((current) => ({ ...current, scheduledAt: event.target.value }))
                  }
                />
              </TextField>
              <div className="agreement-task-assignee">
                {/* Un `Label` fuera de un campo queda huérfano y React Aria avisa; el texto basta. */}
                <span className="agreement-task-assignee-label">Asignar a</span>
                <Select
                  aria-label="Asignar tarea"
                  variant="secondary"
                  placeholder="Sin asignar"
                  selectedKey={value.assignedUserId || 'NONE'}
                  onSelectionChange={(key) =>
                    setValue((current) => ({
                      ...current,
                      assignedUserId: String(key) === 'NONE' ? '' : String(key),
                    }))
                  }
                >
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id="NONE" textValue="Sin asignar">
                        Sin asignar
                      </ListBox.Item>
                      {assignees.map((user) => (
                        <ListBox.Item key={user.id} id={user.id} textValue={user.name}>
                          {user.name}
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" isDisabled={isSubmitting} onPress={() => setFormOpen(false)}>
                Cancelar
              </Button>
              <Button variant="primary" isPending={isSubmitting} onPress={() => void submit()}>
                <PaperPlane width={15} height={15} />
                {editing ? 'Guardar' : 'Crear tarea'}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      <AlertDialog
        isOpen={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setDeleteTarget(null);
        }}
      >
        <AlertDialog.Backdrop>
          <AlertDialog.Container size="sm">
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger">
                  <TrashBin width={20} height={20} />
                </AlertDialog.Icon>
                <AlertDialog.Heading>¿Eliminar la tarea?</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p>
                  Se borrará <strong>{deleteTarget?.title}</strong> y no se podrá recuperar. Para
                  conservar el rastro de que existió, cancélala en lugar de eliminarla.
                </p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button
                  variant="ghost"
                  isDisabled={isDeleting}
                  onPress={() => setDeleteTarget(null)}
                >
                  Cancelar
                </Button>
                <Button
                  variant="danger"
                  isPending={isDeleting}
                  isDisabled={isDeleting}
                  onPress={() => void confirmDelete()}
                >
                  Eliminar
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </div>
  );
}
