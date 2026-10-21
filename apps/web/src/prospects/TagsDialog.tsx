import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Label, Modal, Spinner, Switch, toast } from '@heroui/react';
import { Check, Pencil, Plus, Xmark } from '@gravity-ui/icons';
import { Input } from '../components/Input';
import { ProspectRequestError, prospectsApi, type TagRecord } from './api';
import { messageFrom } from './presentation';
import { TagChip } from './TagChip';
import { defaultTagColor, TagColorPicker } from './TagColorPicker';

type TagDraft = { name: string; color: string };

const emptyDraft: TagDraft = { name: '', color: defaultTagColor };

function draftFrom(tag: TagRecord): TagDraft {
  return { name: tag.name, color: tag.color ?? defaultTagColor };
}

/**
 * Catálogo de etiquetas. Solo el administrador lo edita (`tags.manage`); el comercial se limita a
 * asignar las existentes desde el formulario del prospecto.
 *
 * Cada etiqueta se renombra y recolorea en la misma fila: el lápiz la convierte en un formulario y
 * guarda nombre y color juntos para no dejar estados intermedios.
 */
export function TagsDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<TagDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<TagDraft>(emptyDraft);
  const [error, setError] = useState('');

  const tagsQuery = useQuery({
    queryKey: ['tags'],
    queryFn: () => prospectsApi.tags(),
    enabled: isOpen,
  });

  useEffect(() => {
    if (!isOpen) return;
    setDraft(emptyDraft);
    setEditingId(null);
    setError('');
  }, [isOpen]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['tags'] });

  const tagErrorMessage = (mutationError: unknown) =>
    mutationError instanceof ProspectRequestError && mutationError.code === 'TAG_NAME_TAKEN'
      ? 'Ya existe una etiqueta con ese nombre.'
      : messageFrom(mutationError);

  const createTag = useMutation({
    mutationFn: (value: TagDraft) =>
      prospectsApi.createTag({ name: value.name.trim(), color: value.color, active: true }),
    onSuccess: () => {
      setDraft(emptyDraft);
      setError('');
      void refresh();
      toast.success('Etiqueta creada.');
    },
    onError: (mutationError) => setError(tagErrorMessage(mutationError)),
  });

  const updateTag = useMutation({
    mutationFn: ({ id, ...changes }: { id: number } & Partial<TagDraft> & { active?: boolean }) =>
      prospectsApi.updateTag(id, changes),
    onSuccess: () => {
      setEditingId(null);
      setError('');
      void refresh();
    },
    onError: (mutationError) => setError(tagErrorMessage(mutationError)),
  });

  const submitCreate = () => {
    if (!draft.name.trim()) return;
    createTag.mutate(draft);
  };

  const submitEdit = (id: number) => {
    if (!editDraft.name.trim()) return;
    updateTag.mutate({ id, name: editDraft.name.trim(), color: editDraft.color });
  };

  const tags = tagsQuery.data ?? [];

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Modal.Container size="md" placement="center" scroll="inside">
        <Modal.Dialog className="customer-form-modal prospect-tags-modal">
          <Modal.CloseTrigger aria-label="Cerrar etiquetas">
            <Xmark width={16} height={16} />
          </Modal.CloseTrigger>
          <Modal.Header>
            <div>
              <Modal.Heading>Etiquetas</Modal.Heading>
              <p>Clasifican prospectos y se usan como filtro en el listado.</p>
            </div>
          </Modal.Header>
          <Modal.Body className="customer-form-body">
            {error && (
              <Alert status="danger">
                <Alert.Content>
                  <Alert.Description>{error}</Alert.Description>
                </Alert.Content>
              </Alert>
            )}
            <div className="prospect-tag-create-block">
              <Label>Nueva etiqueta</Label>
              <form
                className="prospect-tag-create"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitCreate();
                }}
                noValidate
              >
                <TagColorPicker
                  value={draft.color}
                  onChange={(color) => setDraft((current) => ({ ...current, color }))}
                />
                <Input
                  variant="secondary"
                  aria-label="Nombre de la nueva etiqueta"
                  placeholder="Nombre de etiqueta"
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, name: event.target.value }))
                  }
                />
                <Button
                  type="submit"
                  variant="primary"
                  isPending={createTag.isPending}
                  isDisabled={!draft.name.trim()}
                >
                  <Plus width={15} height={15} />
                  Agregar
                </Button>
              </form>
            </div>

            {tagsQuery.isPending ? (
              <div className="customers-empty">
                <Spinner />
                <span>Cargando etiquetas…</span>
              </div>
            ) : tags.length === 0 ? (
              <p className="prospect-tags-empty">Todavía no hay etiquetas en el catálogo.</p>
            ) : (
              <ul className="prospect-tag-list">
                {tags.map((tag) => (
                  <li key={tag.id}>
                    {editingId === tag.id ? (
                      <form
                        className="prospect-tag-editor"
                        onSubmit={(event) => {
                          event.preventDefault();
                          submitEdit(tag.id);
                        }}
                        noValidate
                      >
                        <TagColorPicker
                          value={editDraft.color}
                          onChange={(color) => setEditDraft((current) => ({ ...current, color }))}
                        />
                        <Input
                          variant="secondary"
                          aria-label={`Nombre de la etiqueta ${tag.name}`}
                          placeholder="Nombre de etiqueta"
                          value={editDraft.name}
                          onChange={(event) =>
                            setEditDraft((current) => ({ ...current, name: event.target.value }))
                          }
                        />
                        <div className="prospect-tag-row-actions">
                          <Button
                            type="submit"
                            variant="primary"
                            isIconOnly
                            aria-label={`Guardar la etiqueta ${tag.name}`}
                            isPending={updateTag.isPending}
                            isDisabled={!editDraft.name.trim()}
                          >
                            <Check width={15} height={15} />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            isIconOnly
                            aria-label="Cancelar la edición"
                            onPress={() => {
                              setEditingId(null);
                              setError('');
                            }}
                          >
                            <Xmark width={15} height={15} />
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <div className="prospect-tag-info">
                          <TagChip tag={tag} />
                          <span>
                            {tag.active ? 'Disponible' : 'Inactiva'} · {tag._count?.prospects ?? 0}{' '}
                            prospectos
                          </span>
                        </div>
                        <div className="prospect-tag-row-actions">
                          <Button
                            type="button"
                            variant="ghost"
                            isIconOnly
                            aria-label={`Editar la etiqueta ${tag.name}`}
                            onPress={() => {
                              setEditDraft(draftFrom(tag));
                              setEditingId(tag.id);
                              setError('');
                            }}
                          >
                            <Pencil width={15} height={15} />
                          </Button>
                          <Switch
                            aria-label={`Etiqueta ${tag.name} activa`}
                            isSelected={tag.active}
                            onChange={(active) => updateTag.mutate({ id: tag.id, active })}
                          >
                            <Switch.Content>
                              <Switch.Control>
                                <Switch.Thumb />
                              </Switch.Control>
                            </Switch.Content>
                          </Switch>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" onPress={onClose}>
              Cerrar
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
