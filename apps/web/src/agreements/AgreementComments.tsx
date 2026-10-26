import { useState } from 'react';
import { Alert, AlertDialog, Avatar, Button, Spinner, TextField, toast } from '@heroui/react';
import { PaperPlane, TrashBin } from '@gravity-ui/icons';
import { Textarea } from '../components/Textarea';
import { userAvatarGradient } from '../users/presentation';
import { agreementsApi, type AgreementCommentRecord } from './api';
import { chatDay, chatTime, messageFrom } from './presentation';

function initials(name: string | null): string {
  if (!name) return '?';
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

/**
 * Historial de lo hablado con la empresa, presentado como una conversación: cada intervención lleva
 * quién la escribió y cuándo, y el historial se lee de arriba abajo en orden cronológico.
 *
 * El seguimiento es historial y no se edita. Borrar existe solo para el administrador, mientras el
 * módulo se define: sirve para limpiar las pruebas y desaparece al retirar el permiso.
 */
export function AgreementComments({
  agreementId,
  comments,
  isPending,
  isError,
  error,
  canComment,
  canDelete,
  currentUserId,
  onChanged,
}: {
  agreementId: number;
  comments: AgreementCommentRecord[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  canComment: boolean;
  /** Solo el administrador puede borrar; el comercial únicamente escribe. */
  canDelete: boolean;
  /** Id del usuario en sesión: sus mensajes van a la derecha del chat. */
  currentUserId: string | null;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AgreementCommentRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const submit = async () => {
    const comment = draft.trim();
    if (!comment || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await agreementsApi.addComment(agreementId, { comment });
      setDraft('');
      onChanged();
    } catch (submitError) {
      toast.danger('No pudimos guardar el comentario.', {
        description: messageFrom(submitError),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    try {
      await agreementsApi.deleteComment(agreementId, deleteTarget.id);
      setDeleteTarget(null);
      onChanged();
      toast.success('Comentario eliminado.');
    } catch (deleteError) {
      toast.danger('No pudimos eliminar el comentario.', {
        description: messageFrom(deleteError),
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const confirmClear = async () => {
    if (isClearing) return;
    setIsClearing(true);
    try {
      const { removed } = await agreementsApi.clearComments(agreementId);
      setClearOpen(false);
      onChanged();
      toast.success(
        removed === 0 ? 'El seguimiento ya estaba vacío.' : `Se borraron ${removed} comentarios.`,
      );
    } catch (clearError) {
      toast.danger('No pudimos vaciar el seguimiento.', {
        description: messageFrom(clearError),
      });
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="agreement-chat">
      {canDelete && comments.length > 0 && (
        <div className="agreement-chat-toolbar">
          <Button size="sm" variant="ghost" onPress={() => setClearOpen(true)}>
            <TrashBin width={14} height={14} />
            Vaciar seguimiento
          </Button>
        </div>
      )}

      <div className="agreement-chat-scroll">
        {isPending ? (
          <div className="customers-empty">
            <Spinner />
            <span>Cargando seguimiento…</span>
          </div>
        ) : isError ? (
          <Alert status="danger">
            <Alert.Content>
              <Alert.Description>{messageFrom(error)}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : comments.length === 0 ? (
          <p className="agreement-empty">Todavía no hay seguimiento en este convenio.</p>
        ) : (
          <ol className="agreement-chat-list">
            {comments.map((comment) => {
              const authorName = comment.author?.name ?? null;
              const authorId = comment.author?.id ?? null;
              // El propio mensaje va a la derecha: es la seña de identidad de un chat.
              const isOwn = currentUserId !== null && authorId === currentUserId;
              return (
                <li
                  key={comment.id}
                  className={
                    isOwn ? 'agreement-chat-item agreement-chat-item--own' : 'agreement-chat-item'
                  }
                >
                  <Avatar size="sm" className="agreement-chat-avatar">
                    <Avatar.Fallback
                      className="user-avatar-fallback"
                      style={userAvatarGradient(authorId ?? authorName ?? 'SevaleCRM')}
                    >
                      {initials(authorName)}
                    </Avatar.Fallback>
                  </Avatar>
                  <div className="agreement-chat-bubble">
                    {/* El nombre solo se repite en los mensajes ajenos: en el propio, la posición ya
                        dice quién escribió. */}
                    {!isOwn && (
                      <span className="agreement-chat-author">
                        {authorName ?? 'Usuario eliminado'}
                      </span>
                    )}
                    <p>{comment.comment}</p>
                    <span className="agreement-chat-time">
                      {chatDay(comment.createdAt)} · {chatTime(comment.createdAt)}
                    </span>
                  </div>
                  {canDelete && (
                    <Button
                      className="agreement-chat-delete"
                      size="sm"
                      variant="ghost"
                      isIconOnly
                      isDisabled={isDeleting || isClearing}
                      aria-label={`Eliminar el comentario de ${authorName ?? 'usuario eliminado'}`}
                      onPress={() => setDeleteTarget(comment)}
                    >
                      <TrashBin width={13} height={13} />
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {canComment && (
        <div className="agreement-comment-form">
          <TextField className="agreement-comment-field">
            <Textarea
              aria-label="Nuevo comentario"
              variant="secondary"
              placeholder="Escribe lo que se habló con la empresa…"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Enter envía y Mayús+Enter hace salto de línea, como en un chat.
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
          </TextField>
          <Button
            variant="primary"
            isIconOnly
            isPending={isSubmitting}
            isDisabled={!draft.trim() || isSubmitting}
            aria-label="Agregar comentario"
            onPress={() => void submit()}
          >
            <PaperPlane width={16} height={16} />
          </Button>
        </div>
      )}

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
                <AlertDialog.Heading>¿Eliminar el comentario?</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p>Esta intervención del seguimiento se borrará y no se podrá recuperar.</p>
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

      <AlertDialog
        isOpen={clearOpen}
        onOpenChange={(open) => {
          if (!open && !isClearing) setClearOpen(false);
        }}
      >
        <AlertDialog.Backdrop>
          <AlertDialog.Container size="sm">
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger">
                  <TrashBin width={20} height={20} />
                </AlertDialog.Icon>
                <AlertDialog.Heading>¿Vaciar todo el seguimiento?</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p>
                  Se borrarán los <strong>{comments.length}</strong> comentarios de este convenio,
                  incluidos los de otros usuarios. No se podrá recuperar.
                </p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button variant="ghost" isDisabled={isClearing} onPress={() => setClearOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  variant="danger"
                  isPending={isClearing}
                  isDisabled={isClearing}
                  onPress={() => void confirmClear()}
                >
                  Vaciar
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </div>
  );
}
