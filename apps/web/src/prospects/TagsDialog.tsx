import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Label, Modal, Spinner, Switch, TextField, toast } from '@heroui/react';
import { Plus, Xmark } from '@gravity-ui/icons';
import { Input } from '../components/Input';
import { ProspectRequestError, prospectsApi } from './api';
import { messageFrom } from './presentation';

/**
 * Catálogo de etiquetas. Solo el administrador lo edita (`tags.manage`); el comercial se limita a
 * asignar las existentes desde el formulario del prospecto.
 */
export function TagsDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const tagsQuery = useQuery({
    queryKey: ['tags'],
    queryFn: () => prospectsApi.tags(),
    enabled: isOpen,
  });

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setError('');
  }, [isOpen]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['tags'] });

  const createTag = useMutation({
    mutationFn: (value: string) => prospectsApi.createTag({ name: value, active: true }),
    onSuccess: () => {
      setName('');
      setError('');
      void refresh();
      toast.success('Etiqueta creada.');
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ProspectRequestError && mutationError.code === 'TAG_NAME_TAKEN'
          ? 'Ya existe una etiqueta con ese nombre.'
          : messageFrom(mutationError),
      );
    },
  });

  const updateTag = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      prospectsApi.updateTag(id, { active }),
    onSuccess: () => void refresh(),
    onError: (mutationError) => setError(messageFrom(mutationError)),
  });

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
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim()) createTag.mutate(name.trim());
            }}
            noValidate
          >
            <Modal.Body className="customer-form-body">
              {error && (
                <Alert status="danger">
                  <Alert.Content>
                    <Alert.Description>{error}</Alert.Description>
                  </Alert.Content>
                </Alert>
              )}
              <TextField>
                <Label>Nueva etiqueta</Label>
                <div className="prospect-tag-create">
                  <Input
                    variant="secondary"
                    placeholder="MAYORISTA"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    isPending={createTag.isPending}
                    isDisabled={!name.trim()}
                  >
                    <Plus width={15} height={15} />
                    Agregar
                  </Button>
                </div>
              </TextField>

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
                      <div>
                        <strong>{tag.name}</strong>
                        <span>
                          {tag.active ? 'Disponible' : 'Inactiva'} · {tag._count?.prospects ?? 0}{' '}
                          prospectos
                        </span>
                      </div>
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
          </form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
