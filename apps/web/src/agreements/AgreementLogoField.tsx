import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button } from '@heroui/react';
import { ArrowUpFromLine, TrashBin, Xmark } from '@gravity-ui/icons';
import { Input } from '../components/Input';
import { agreementsApi } from './api';

const ACCEPTED = ['image/svg+xml', 'image/webp'];
const FALLBACK_MAX_BYTES = 500_000;

/**
 * El archivo no se sube al elegirlo: se guarda en memoria y se sube al guardar el convenio. Así, si
 * la persona cancela el formulario, nunca llegó a existir nada en el bucket y no hay huérfanos que
 * limpiar. La previsualización usa un blob local, sin tocar la red.
 */
export function AgreementLogoField({
  url,
  file,
  onSelect,
  onClear,
  error,
  disabled,
}: {
  /** URL del logo ya guardado, si existe. */
  url: string;
  /** Archivo elegido y aún no subido. Tiene prioridad sobre `url` en la previsualización. */
  file: File | null;
  onSelect: (file: File) => void;
  /** Quita el logo: borra el archivo elegido o marca el guardado para eliminarse. */
  onClear: () => void;
  error?: string;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState('');
  const [preview, setPreview] = useState('');

  // El estado del almacenamiento se consulta una vez: sin credenciales de R2 el campo se explica en
  // lugar de ofrecer un botón que fallaría al usarlo.
  const statusQuery = useQuery({
    queryKey: ['agreement-logo-status'],
    queryFn: agreementsApi.logoStatus,
    staleTime: 5 * 60_000,
  });
  const maxBytes = statusQuery.data?.maxBytes ?? FALLBACK_MAX_BYTES;
  const enabled = statusQuery.data?.enabled ?? false;

  // El blob se revoca al cambiar de archivo para no retener memoria con imágenes que ya no se ven.
  useEffect(() => {
    if (!file) {
      setPreview('');
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const source = preview || url;
  const shownError = localError || error || '';

  const pick = (next?: File) => {
    setLocalError('');
    if (!next) return;
    if (!ACCEPTED.includes(next.type)) {
      setLocalError('El logo debe ser SVG o WebP.');
      return;
    }
    if (next.size > maxBytes) {
      setLocalError(`El logo supera el máximo de ${Math.round(maxBytes / 1000)} KB.`);
      return;
    }
    onSelect(next);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="agreement-logo-field">
      <span className="agreement-logo-label">Logo</span>
      <div className="agreement-logo-row">
        <div className="agreement-logo-preview">
          {source ? (
            <img src={source} alt="Logo del convenio" />
          ) : (
            <span aria-hidden="true">SVG</span>
          )}
        </div>
        <div className="agreement-logo-actions">
          <Input
            ref={inputRef}
            className="agreement-logo-input"
            type="file"
            accept=".svg,.webp,image/svg+xml,image/webp"
            aria-label="Archivo de logo"
            disabled={disabled || !enabled}
            onChange={(event) => pick(event.target.files?.[0])}
          />
          <Button
            variant="secondary"
            isDisabled={disabled || !enabled}
            onPress={() => inputRef.current?.click()}
          >
            <ArrowUpFromLine width={16} height={16} />
            {source ? 'Cambiar logo' : 'Subir logo'}
          </Button>
          {source && (
            <Button variant="danger-soft" isDisabled={disabled} onPress={onClear}>
              <TrashBin width={16} height={16} />
              Quitar
            </Button>
          )}
          <span className="agreement-logo-hint">
            SVG o WebP, máximo {Math.round(maxBytes / 1000)} KB. Se sube al guardar.
          </span>
        </div>
      </div>
      {statusQuery.isSuccess && !enabled && (
        <Alert status="warning">
          <Alert.Content>
            <Alert.Description>
              La subida de logos no está configurada. Define R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
              R2_SECRET_ACCESS_KEY, R2_BUCKET y R2_PUBLIC_URL en el servidor.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      {shownError && (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Description>
              <Xmark width={14} height={14} /> {shownError}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}
    </div>
  );
}
