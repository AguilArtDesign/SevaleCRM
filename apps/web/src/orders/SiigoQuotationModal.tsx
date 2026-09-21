import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Label, Modal, Spinner, TextField } from '@heroui/react';
import { FileText } from '@gravity-ui/icons';
import type { CreateSiigoQuotationInput } from '@sevale/validation';
import { Input } from '../components/Input';
import type { OrderDetailRecord } from './api';

export function SiigoQuotationModal({
  isOpen,
  order,
  isSubmitting,
  serverError,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  order: OrderDetailRecord;
  isSubmitting: boolean;
  serverError: string;
  onClose: () => void;
  onSubmit: (input: CreateSiigoQuotationInput) => Promise<void>;
}) {
  const [exchangeRate, setExchangeRate] = useState('');

  useEffect(() => {
    setExchangeRate(order.siigoQuotation?.exchangeRate ?? '');
  }, [order]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit(order.currency === 'USD' ? { exchangeRate: Number(exchangeRate) } : {});
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="sm" placement="center" scroll="inside">
          <Modal.Dialog className="siigo-quotation-modal">
            <Modal.CloseTrigger aria-label="Cerrar cotización" />
            <form onSubmit={submit}>
              <Modal.Header>
                <div>
                  <Modal.Heading>
                    {order.siigoQuotation?.status === 'ERROR'
                      ? 'Reintentar cotización'
                      : 'Crear cotización en Siigo'}
                  </Modal.Heading>
                  <p>{order.operationCode} · Todos los productos de la operación</p>
                </div>
              </Modal.Header>
              <Modal.Body>
                {serverError && (
                  <Alert status="danger">
                    <Alert.Content>
                      <Alert.Description>{serverError}</Alert.Description>
                    </Alert.Content>
                  </Alert>
                )}
                {order.siigoQuotation?.errorMessage && (
                  <Alert status="warning">
                    <Alert.Content>
                      <Alert.Description>{order.siigoQuotation.errorMessage}</Alert.Description>
                    </Alert.Content>
                  </Alert>
                )}
                <p>
                  La cotización reunirá los productos de Seratus y Pali en un único documento de
                  Siigo.
                </p>
                {order.currency === 'USD' && (
                  <TextField isRequired name="exchangeRate">
                    <Label>Tasa de cambio a COP</Label>
                    <Input
                      variant="secondary"
                      type="number"
                      min="0.000001"
                      max="999999999.999999"
                      step="0.000001"
                      value={exchangeRate}
                      onChange={(event) => setExchangeRate(event.target.value)}
                    />
                  </TextField>
                )}
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" onPress={onClose} isDisabled={isSubmitting}>
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" isPending={isSubmitting}>
                  {({ isPending }) => (
                    <>
                      {isPending ? <Spinner color="current" size="sm" /> : <FileText width={17} />}
                      {isPending ? 'Creando' : 'Crear cotización'}
                    </>
                  )}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
