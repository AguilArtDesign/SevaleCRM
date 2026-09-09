import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Modal, Spinner, Toast, Typography } from '@heroui/react';
import { ArrowUpFromLine, File as FileIcon, Xmark } from '@gravity-ui/icons';
import { Input } from '../components/Input';
import { inventoryApi, type ProductImportPreview } from './api';

const MAX_CSV_BYTES = 800_000;

function ImportSummary({ preview }: { preview: ProductImportPreview }) {
  const issues = [...preview.errors, ...preview.conflicts];
  return (
    <div className="product-import-preview">
      <div className="product-import-summary" aria-label="Resumen de la importación">
        <div>
          <span>Filas</span>
          <strong>{preview.totalRows.toLocaleString('es-CO')}</strong>
        </div>
        <div>
          <span>Nuevos</span>
          <strong>{preview.newProducts.toLocaleString('es-CO')}</strong>
        </div>
        <div>
          <span>Ya existentes</span>
          <strong>{preview.existingProducts.toLocaleString('es-CO')}</strong>
        </div>
      </div>

      {preview.canImport ? (
        <Alert status="success">
          <Alert.Content>
            <Alert.Title>Archivo listo para importar</Alert.Title>
            <Alert.Description>
              Los productos existentes se omitirán y no se sobrescribirá información del CRM.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Title>El archivo necesita correcciones</Alert.Title>
            <Alert.Description>
              {preview.errorCount} errores y {preview.conflictCount} conflictos encontrados.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {issues.length > 0 && (
        <div className="product-import-issues">
          {issues.map((issue, index) => (
            <p key={`${issue.row}-${issue.field}-${index}`}>
              <strong>Fila {issue.row}:</strong> {issue.message}
            </p>
          ))}
          {preview.errorCount + preview.conflictCount > issues.length && (
            <p>Se muestran solamente los primeros {issues.length} problemas.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function ProductImportModal({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [csv, setCsv] = useState('');
  const [fileError, setFileError] = useState('');
  const previewMutation = useMutation({ mutationFn: inventoryApi.previewImport });
  const importMutation = useMutation({
    mutationFn: inventoryApi.importProducts,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      Toast.toast.success('Importación completada', {
        description: `${result.imported.toLocaleString('es-CO')} productos importados y ${result.skipped.toLocaleString('es-CO')} existentes omitidos.`,
      });
      changeOpen(false);
    },
  });

  const reset = () => {
    setFileName('');
    setCsv('');
    setFileError('');
    previewMutation.reset();
    importMutation.reset();
    if (inputRef.current) inputRef.current.value = '';
  };

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const selectFile = async (file?: File) => {
    reset();
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setFileError('Selecciona un archivo con extensión .csv.');
      return;
    }
    if (file.size > MAX_CSV_BYTES) {
      setFileError('El archivo supera el tamaño máximo permitido de 800 KB.');
      return;
    }
    try {
      const content = await file.text();
      setFileName(file.name);
      setCsv(content);
      previewMutation.mutate(content);
    } catch {
      setFileError('No pudimos leer el archivo seleccionado.');
    }
  };

  const isBusy = previewMutation.isPending || importMutation.isPending;

  return (
    <Modal isOpen={isOpen} onOpenChange={changeOpen}>
      <Modal.Backdrop>
        <Modal.Container size="md" placement="center" scroll="inside">
          <Modal.Dialog className="product-import-modal">
            <Modal.Header>
              <div>
                <Modal.Heading>Importar productos</Modal.Heading>
                <Typography.Paragraph color="muted" size="sm">
                  Revisa el archivo antes de agregarlo al inventario
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
                  <small>Máximo 800 KB</small>
                </span>
              </button>

              {fileError && (
                <Alert status="danger">
                  <Alert.Content>
                    <Alert.Description>{fileError}</Alert.Description>
                  </Alert.Content>
                </Alert>
              )}

              {previewMutation.isPending && (
                <div className="product-import-loading">
                  <Spinner size="sm" />
                  <span>Validando productos</span>
                </div>
              )}
              {previewMutation.isError && (
                <Alert status="danger">
                  <Alert.Content>
                    <Alert.Title>No pudimos validar el archivo</Alert.Title>
                    <Alert.Description>{previewMutation.error.message}</Alert.Description>
                  </Alert.Content>
                </Alert>
              )}
              {previewMutation.data && <ImportSummary preview={previewMutation.data} />}
              {importMutation.isError && (
                <Alert status="danger">
                  <Alert.Content>
                    <Alert.Title>No pudimos importar los productos</Alert.Title>
                    <Alert.Description>{importMutation.error.message}</Alert.Description>
                  </Alert.Content>
                </Alert>
              )}
            </Modal.Body>

            <Modal.Footer>
              <Button variant="secondary" isDisabled={isBusy} onPress={() => changeOpen(false)}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                isPending={importMutation.isPending}
                isDisabled={!csv || !previewMutation.data?.canImport || previewMutation.isPending}
                onPress={() => importMutation.mutate(csv)}
              >
                {({ isPending }) => (
                  <>
                    {isPending ? (
                      <Spinner color="current" size="sm" />
                    ) : (
                      <ArrowUpFromLine width={17} height={17} />
                    )}
                    {isPending ? 'Importando' : 'Importar productos'}
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
