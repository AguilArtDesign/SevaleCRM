import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Modal, Spinner, Toast, Typography } from '@heroui/react';
import { ArrowDownToLine, ArrowUpFromLine, File as FileIcon, Xmark } from '@gravity-ui/icons';
import { Input } from '../components/Input';
import { prospectsApi, type ProspectImportIssue, type ProspectImportPreview } from './api';
import { splitCsvBatches, type CsvBatch } from './csv-batches';

/**
 * Un archivo de convenios puede traer cientos de miles de filas (200.000 rondan los 23 MB). El
 * archivo se procesa por lotes para no enviar un cuerpo enorme ni bloquear la interfaz.
 */
const MAX_FILE_BYTES = 60_000_000;
const MAX_REPORTED_ISSUES = 50;

type Progress = { phase: 'validating' | 'importing'; current: number; total: number };

/**
 * Resumen en español con concordancia completa: el verbo y el sustantivo cambian con el número, así
 * que «1 prospecto» se lee «Se agregará 1 prospecto» y no «Se agregarán 1 prospectos».
 */
function importSummaryText(newProspects: number, duplicates: number) {
  const added =
    newProspects === 1 ? 'Se agregará 1 prospecto' : `Se agregarán ${newProspects} prospectos`;
  if (duplicates === 0) return `${added}.`;
  const omitted =
    duplicates === 1 ? 'se omitirá 1 que ya existe' : `se omitirán ${duplicates} que ya existen`;
  return `${added} y ${omitted}.`;
}

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function ImportSummary({ preview }: { preview: ProspectImportPreview }) {
  return (
    <div className="product-import-preview">
      <div className="product-import-summary" aria-label="Resumen de la importación">
        <div>
          <span>Filas</span>
          <strong>{preview.totalRows.toLocaleString('es-CO')}</strong>
        </div>
        <div>
          <span>Nuevos</span>
          <strong>{preview.newProspects.toLocaleString('es-CO')}</strong>
        </div>
        <div>
          <span>Ya existen</span>
          <strong>{preview.duplicates.toLocaleString('es-CO')}</strong>
        </div>
      </div>

      {preview.errorCount > 0 ? (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Title>El archivo necesita correcciones</Alert.Title>
            <Alert.Description>
              {`Hay ${plural(preview.errorCount, 'fila con datos inválidos', 'filas con datos inválidos')}.`}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : preview.newProspects === 0 ? (
        <Alert status="warning">
          <Alert.Content>
            <Alert.Title>Nada nuevo por importar</Alert.Title>
            <Alert.Description>
              Todos los prospectos del archivo ya existen en el CRM.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : (
        <Alert status="success">
          <Alert.Content>
            <Alert.Title>Archivo listo para importar</Alert.Title>
            <Alert.Description>
              {importSummaryText(preview.newProspects, preview.duplicates)}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {preview.errors.length > 0 && (
        <div className="product-import-issues">
          {preview.errors.map((issue, index) => (
            <p key={`${issue.row}-${issue.field}-${index}`}>
              <strong>Fila {issue.row}:</strong> {issue.message}
            </p>
          ))}
          {preview.errorCount > preview.errors.length && (
            <p>Se muestran solamente los primeros {preview.errors.length} problemas.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function ProspectImportModal({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  // Permite abortar el recorrido de lotes si el modal se cierra a mitad de camino.
  const cancelledRef = useRef(false);
  const [fileName, setFileName] = useState('');
  const [batches, setBatches] = useState<CsvBatch[]>([]);
  const [preview, setPreview] = useState<ProspectImportPreview | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [fileError, setFileError] = useState('');
  const isBusy = progress !== null;

  const reset = () => {
    setFileName('');
    setBatches([]);
    setPreview(null);
    setProgress(null);
    setFileError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen) {
      cancelledRef.current = true;
      reset();
    }
    onOpenChange(nextOpen);
  };

  const selectFile = async (file?: File) => {
    cancelledRef.current = true;
    reset();
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setFileError('Selecciona un archivo con extensión .csv.');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setFileError(
        `El archivo supera el tamaño máximo permitido de ${MAX_FILE_BYTES / 1_000_000} MB.`,
      );
      return;
    }

    let text: string;
    try {
      text = await file.text();
    } catch {
      setFileError('No pudimos leer el archivo seleccionado.');
      return;
    }

    const parts = splitCsvBatches(text);
    if (parts.length === 0 || parts[0]?.rows === 0) {
      setFileError('El archivo no contiene prospectos.');
      return;
    }

    cancelledRef.current = false;
    setFileName(file.name);
    setBatches(parts);
    await validate(parts);
  };

  /** Valida todos los lotes antes de importar: si algo falla, no se inserta ninguna fila. */
  const validate = async (parts: CsvBatch[]) => {
    setProgress({ phase: 'validating', current: 0, total: parts.length });
    setPreview(null);
    const aggregated: ProspectImportPreview = {
      totalRows: 0,
      validRows: 0,
      newProspects: 0,
      duplicates: 0,
      errorCount: 0,
      errors: [],
      canImport: false,
    };
    let consumedRows = 0;

    try {
      for (let index = 0; index < parts.length; index += 1) {
        if (cancelledRef.current) return;
        setProgress({ phase: 'validating', current: index + 1, total: parts.length });
        const batch = parts[index]!;
        const result = await prospectsApi.previewImport(batch.csv);
        aggregated.totalRows += result.totalRows;
        aggregated.validRows += result.validRows;
        aggregated.newProspects += result.newProspects;
        aggregated.duplicates += result.duplicates;
        aggregated.errorCount += result.errorCount;
        // Los números de fila del lote se desplazan para que coincidan con el archivo original.
        for (const issue of result.errors) {
          if (aggregated.errors.length < MAX_REPORTED_ISSUES) {
            aggregated.errors.push({ ...issue, row: issue.row + consumedRows });
          }
        }
        consumedRows += batch.rows;

        // Un convenio o un país inexistente invalida el archivo completo: no tiene sentido recorrer
        // 200.000 filas más para repetir el mismo mensaje.
        if (
          result.errors.some(
            (issue: ProspectImportIssue) => issue.field === 'convenio' || issue.field === 'pais',
          )
        )
          break;
      }
    } catch (error) {
      if (!cancelledRef.current) {
        setFileError(error instanceof Error ? error.message : 'No pudimos validar el archivo.');
      }
      return;
    } finally {
      if (!cancelledRef.current) setProgress(null);
    }

    if (cancelledRef.current) return;
    aggregated.canImport = aggregated.errorCount === 0;
    setPreview(aggregated);
  };

  const runImport = async () => {
    setFileError('');
    setProgress({ phase: 'importing', current: 0, total: batches.length });
    let imported = 0;
    let duplicates = 0;

    try {
      for (let index = 0; index < batches.length; index += 1) {
        if (cancelledRef.current) return;
        setProgress({ phase: 'importing', current: index + 1, total: batches.length });
        const result = await prospectsApi.importProspects(batches[index]!.csv);
        imported += result.imported;
        duplicates += result.duplicates;
        // Refresca la tabla a mitad de camino para que el avance sea visible con archivos grandes.
        if (index % 5 === 0) await queryClient.invalidateQueries({ queryKey: ['prospects'] });
      }
    } catch (error) {
      if (!cancelledRef.current) {
        setFileError(error instanceof Error ? error.message : 'No pudimos importar el archivo.');
      }
      return;
    } finally {
      if (!cancelledRef.current) setProgress(null);
    }

    if (cancelledRef.current) return;
    await queryClient.invalidateQueries({ queryKey: ['prospects'] });
    const omitted = duplicates
      ? ` y ${plural(duplicates, 'existente omitido', 'existentes omitidos')}`
      : '';
    Toast.toast.success('Importación completada', {
      description: `${plural(imported, 'prospecto importado', 'prospectos importados')}${omitted}.`,
    });
    changeOpen(false);
  };

  const downloadTemplate = async () => {
    try {
      const { template } = await prospectsApi.importStatus();
      const url = URL.createObjectURL(new Blob([template], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'plantilla-prospectos.csv';
      link.click();
      // Revocar en el mismo tick cancela la descarga en algunos navegadores: el blob debe seguir
      // vivo hasta que el navegador lo haya leído.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'No pudimos generar la plantilla.');
    }
  };

  const progressValue = progress ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <Modal isOpen={isOpen} onOpenChange={changeOpen}>
      <Modal.Backdrop>
        <Modal.Container size="md" placement="center" scroll="inside">
          {/* Reutiliza los estilos del modal de importación de Inventario: mismo patrón visual. */}
          <Modal.Dialog className="product-import-modal">
            <Modal.Header>
              <div>
                <Modal.Heading>Importar prospectos</Modal.Heading>
                <Typography.Paragraph color="muted" size="sm">
                  Revisa el archivo antes de agregarlo al panel
                </Typography.Paragraph>
              </div>
              <Modal.CloseTrigger aria-label="Cerrar">
                <Xmark width={18} height={18} />
              </Modal.CloseTrigger>
            </Modal.Header>

            <Modal.Body>
              <Input
                ref={inputRef}
                className="product-import-file-input"
                type="file"
                accept=".csv,text/csv"
                disabled={isBusy}
                onChange={(event) => void selectFile(event.target.files?.[0])}
              />
              <button
                className="product-import-dropzone"
                type="button"
                disabled={isBusy}
                onClick={() => inputRef.current?.click()}
              >
                <FileIcon width={24} height={24} />
                <span>
                  <strong>{fileName || 'Seleccionar archivo CSV'}</strong>
                  <small>Máximo {MAX_FILE_BYTES / 1_000_000} MB</small>
                </span>
              </button>

              <div className="prospect-import-template">
                <Typography.Paragraph color="muted" size="sm">
                  ¿No tienes el archivo?
                </Typography.Paragraph>
                <button
                  className="prospect-import-template-link"
                  type="button"
                  disabled={isBusy}
                  onClick={() => void downloadTemplate()}
                >
                  <ArrowDownToLine width={16} height={16} />
                  Descargar plantilla
                </button>
              </div>

              {progress && (
                <div className="prospect-import-progress" aria-live="polite">
                  <div className="prospect-import-progress-label">
                    <Spinner size="sm" />
                    <span>
                      {progress.phase === 'validating' ? 'Validando' : 'Importando'} lote{' '}
                      {progress.current} de {progress.total}
                    </span>
                    <strong>{progressValue}%</strong>
                  </div>
                  <div
                    className="prospect-import-progress-track"
                    role="progressbar"
                    aria-valuenow={progressValue}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="prospect-import-progress-bar"
                      style={{ width: `${progressValue}%` }}
                    />
                  </div>
                </div>
              )}

              {fileError && (
                <Alert status="danger">
                  <Alert.Content>
                    <Alert.Description>{fileError}</Alert.Description>
                  </Alert.Content>
                </Alert>
              )}

              {preview && <ImportSummary preview={preview} />}
            </Modal.Body>

            <Modal.Footer>
              <Button variant="secondary" isDisabled={isBusy} onPress={() => changeOpen(false)}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                isPending={progress?.phase === 'importing'}
                isDisabled={isBusy || !preview?.canImport || preview.newProspects === 0}
                onPress={() => void runImport()}
              >
                {({ isPending }) => (
                  <>
                    {isPending ? (
                      <Spinner color="current" size="sm" />
                    ) : (
                      <ArrowUpFromLine width={17} height={17} />
                    )}
                    {isPending ? 'Importando' : 'Importar prospectos'}
                  </>
                )}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
