import { useState } from 'react';
import { Alert, Button, Spinner, TextField, toast } from '@heroui/react';
import { PaperPlane } from '@gravity-ui/icons';
import { Input } from '../components/Input';
import { agreementsApi, type AgreementCommentRecord } from './api';
import { commentStamp, messageFrom } from './presentation';

/**
 * Historial de lo hablado con la empresa. Es inmutable por diseño: no hay editar ni eliminar, ni
 * siquiera para el administrador, así que aquí solo se lee y se agrega.
 */
export function AgreementComments({
  agreementId,
  comments,
  isPending,
  isError,
  error,
  canComment,
  onChanged,
}: {
  agreementId: number;
  comments: AgreementCommentRecord[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  canComment: boolean;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  return (
    <section className="customer-detail-section agreement-section">
      <h3>Comentarios</h3>
      {isPending ? (
        <div className="customers-empty">
          <Spinner />
          <span>Cargando comentarios…</span>
        </div>
      ) : isError ? (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Description>{messageFrom(error)}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : comments.length === 0 ? (
        <p className="agreement-empty">Todavía no hay comentarios en este convenio.</p>
      ) : (
        <ol className="agreement-comments">
          {comments.map((comment) => (
            <li key={comment.id} className="agreement-comment">
              <span className="agreement-comment-meta">
                {commentStamp(comment.createdAt, comment.author?.name ?? null)}
              </span>
              <p>{comment.comment}</p>
            </li>
          ))}
        </ol>
      )}
      {canComment && (
        <div className="agreement-comment-form">
          <TextField className="agreement-comment-field">
            <Input
              aria-label="Nuevo comentario"
              variant="secondary"
              placeholder="Escribe lo que se habló con la empresa…"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
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
    </section>
  );
}
