import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Label, Modal, Switch, TextField } from '@heroui/react';
import { FloppyDisk, Xmark } from '@gravity-ui/icons';
import { getCustomerColombiaCities, getCustomerColombiaStates } from '@sevale/shared';
import { createAgreementSchema } from '@sevale/validation';
import { Input } from '../components/Input';
import { CustomerAutocomplete } from '../customers/CustomerAutocomplete';
import { AgreementRequestError, type AgreementRecord } from './api';
import { messageFrom } from './presentation';

type FormValue = {
  companyName: string;
  nit: string;
  region: string;
  cityCode: string;
  postalCode: string;
  addressLine1: string;
  addressLine2: string;
  contactName: string;
  contactPosition: string;
  contactEmail: string;
  contactPhone: string;
  description: string;
  active: boolean;
};

const emptyValue: FormValue = {
  companyName: '',
  nit: '',
  region: '',
  cityCode: '',
  postalCode: '',
  addressLine1: '',
  addressLine2: '',
  contactName: '',
  contactPosition: '',
  contactEmail: '',
  contactPhone: '',
  description: '',
  active: true,
};

function initialValue(agreement: AgreementRecord | null): FormValue {
  if (!agreement) return emptyValue;
  return {
    companyName: agreement.companyName,
    nit: agreement.nit ?? '',
    region: agreement.region ?? '',
    cityCode: agreement.cityCode ?? '',
    postalCode: agreement.postalCode ?? '',
    addressLine1: agreement.addressLine1 ?? '',
    addressLine2: agreement.addressLine2 ?? '',
    contactName: agreement.contactName ?? '',
    contactPosition: agreement.contactPosition ?? '',
    contactEmail: agreement.contactEmail ?? '',
    contactPhone: agreement.contactPhone ?? '',
    description: agreement.description ?? '',
    active: agreement.active,
  };
}

// Los convenios son solo de Colombia, así que el país no se pregunta: el catálogo ya es el de CO.
const colombiaStates = getCustomerColombiaStates().map((state) => ({
  id: state.code,
  name: state.name,
}));

export function AgreementForm({
  isOpen,
  agreement,
  isSubmitting,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  agreement: AgreementRecord | null;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (value: FormValue) => Promise<void>;
}) {
  const [value, setValue] = useState<FormValue>(() => initialValue(agreement));
  const [errors, setErrors] = useState<Partial<Record<keyof FormValue, string>>>({});
  const [error, setError] = useState('');
  const isEdit = agreement !== null;

  useEffect(() => {
    if (!isOpen) return;
    setValue(initialValue(agreement));
    setErrors({});
    setError('');
  }, [agreement, isOpen]);

  const cities = value.region
    ? getCustomerColombiaCities(value.region).map((city) => ({ id: city.code, name: city.name }))
    : [];

  const text = (key: keyof FormValue) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setValue((current) => ({ ...current, [key]: event.target.value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const parsed = createAgreementSchema.safeParse({
      companyName: value.companyName,
      nit: value.nit,
      region: value.region,
      cityCode: value.cityCode,
      postalCode: value.postalCode,
      addressLine1: value.addressLine1,
      addressLine2: value.addressLine2,
      contactName: value.contactName,
      contactPosition: value.contactPosition,
      contactEmail: value.contactEmail,
      contactPhone: value.contactPhone,
      description: value.description,
      active: value.active,
    });
    if (!parsed.success) {
      const fieldErrors: Partial<Record<keyof FormValue, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field !== 'string') continue;
        if (!(field in emptyValue)) continue;
        const key = field as keyof FormValue;
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      setError(parsed.error.issues[0]?.message ?? '');
      return;
    }
    try {
      await onSubmit(value);
    } catch (submitError) {
      // El NIT repetido llega con su propio código: decirlo evita que el usuario busque el campo.
      setError(
        submitError instanceof AgreementRequestError && submitError.code === 'AGREEMENT_NIT_TAKEN'
          ? 'Ya existe un convenio con ese NIT.'
          : messageFrom(submitError),
      );
    }
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={(open) => !open && !isSubmitting && onClose()}>
      <Modal.Container size="lg" placement="center" scroll="inside">
        <Modal.Dialog className="agreement-form-modal">
          <Modal.CloseTrigger aria-label="Cerrar formulario">
            <Xmark width={16} height={16} />
          </Modal.CloseTrigger>
          <Modal.Header>
            <div>
              <Modal.Heading>{isEdit ? 'Editar convenio' : 'Crear convenio'}</Modal.Heading>
              <p>
                {isEdit
                  ? 'Actualiza los datos de la empresa y su contacto.'
                  : 'Solo el nombre de la empresa es obligatorio; el resto se puede completar después.'}
              </p>
            </div>
          </Modal.Header>
          <form className="agreement-form" onSubmit={(event) => void submit(event)}>
            <Modal.Body className="agreement-form-body">
              {error && (
                <Alert status="danger">
                  <Alert.Content>
                    <Alert.Description>{error}</Alert.Description>
                  </Alert.Content>
                </Alert>
              )}

              <section className="customer-form-section">
                <h3>Empresa</h3>
                <div className="customer-form-grid">
                  <TextField className="customer-field-full">
                    <Label>Empresa *</Label>
                    <Input
                      variant="secondary"
                      placeholder="Universidad XYZ"
                      value={value.companyName}
                      onChange={text('companyName')}
                    />
                    {errors.companyName && (
                      <span className="agreement-field-error">{errors.companyName}</span>
                    )}
                  </TextField>
                  <TextField>
                    <Label>NIT</Label>
                    <Input
                      variant="secondary"
                      placeholder="900123456-7"
                      value={value.nit}
                      onChange={text('nit')}
                    />
                    {errors.nit && <span className="agreement-field-error">{errors.nit}</span>}
                  </TextField>
                  <div className="customer-vat-control">
                    <div>
                      <strong>Activo</strong>
                      <span>Los inactivos se conservan y se pueden reactivar.</span>
                    </div>
                    <Switch
                      aria-label="Convenio activo"
                      isSelected={value.active}
                      onChange={(selected) =>
                        setValue((current) => ({ ...current, active: selected }))
                      }
                    >
                      <Switch.Content>
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                      </Switch.Content>
                    </Switch>
                  </div>
                  <TextField className="customer-field-full">
                    <Label>Descripción</Label>
                    <Input
                      variant="secondary"
                      placeholder="Condiciones del convenio, alcance, beneficios…"
                      value={value.description}
                      onChange={text('description')}
                    />
                  </TextField>
                </div>
              </section>

              <section className="customer-form-section">
                <h3>Ubicación</h3>
                <div className="customer-form-grid">
                  <CustomerAutocomplete
                    ariaLabel="Departamento"
                    label="Departamento"
                    placeholder="Seleccionar"
                    value={value.region}
                    options={colombiaStates}
                    onChange={(region) =>
                      // Cambiar de departamento invalida la ciudad elegida.
                      setValue((current) => ({ ...current, region, cityCode: '' }))
                    }
                  />
                  <CustomerAutocomplete
                    key={`agreement-city:${value.region}`}
                    ariaLabel="Ciudad"
                    label="Ciudad"
                    placeholder="Seleccionar"
                    value={value.cityCode}
                    options={cities}
                    isDisabled={!value.region}
                    onChange={(cityCode) => setValue((current) => ({ ...current, cityCode }))}
                  />
                  <TextField>
                    <Label>Código postal</Label>
                    <Input
                      variant="secondary"
                      value={value.postalCode}
                      onChange={text('postalCode')}
                    />
                  </TextField>
                  <TextField>
                    <Label>Dirección</Label>
                    <Input
                      variant="secondary"
                      placeholder="Nombre de la calle y número de la casa"
                      value={value.addressLine1}
                      onChange={text('addressLine1')}
                    />
                  </TextField>
                  <TextField className="customer-field-full">
                    <Label>Complemento</Label>
                    <Input
                      variant="secondary"
                      placeholder="Barrio, torre, oficina…"
                      value={value.addressLine2}
                      onChange={text('addressLine2')}
                    />
                  </TextField>
                </div>
              </section>

              <section className="customer-form-section">
                <h3>Contacto principal</h3>
                <div className="customer-form-grid">
                  <TextField>
                    <Label>Nombre</Label>
                    <Input
                      variant="secondary"
                      placeholder="Laura Gómez"
                      value={value.contactName}
                      onChange={text('contactName')}
                    />
                  </TextField>
                  <TextField>
                    <Label>Cargo</Label>
                    <Input
                      variant="secondary"
                      placeholder="Coordinadora de Bienestar"
                      value={value.contactPosition}
                      onChange={text('contactPosition')}
                    />
                  </TextField>
                  <TextField>
                    <Label>Correo</Label>
                    <Input
                      type="email"
                      variant="secondary"
                      placeholder="laura@universidad.edu.co"
                      value={value.contactEmail}
                      onChange={text('contactEmail')}
                    />
                    {errors.contactEmail && (
                      <span className="agreement-field-error">{errors.contactEmail}</span>
                    )}
                  </TextField>
                  <TextField>
                    <Label>Teléfono</Label>
                    <Input
                      variant="secondary"
                      placeholder="300 1234567"
                      value={value.contactPhone}
                      onChange={text('contactPhone')}
                    />
                    {errors.contactPhone && (
                      <span className="agreement-field-error">{errors.contactPhone}</span>
                    )}
                  </TextField>
                </div>
              </section>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" isDisabled={isSubmitting} onPress={onClose}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" isPending={isSubmitting}>
                <FloppyDisk width={15} height={15} />
                {isEdit ? 'Guardar cambios' : 'Crear convenio'}
              </Button>
            </Modal.Footer>
          </form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
