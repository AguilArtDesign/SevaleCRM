import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Alert, Button, Label, Modal, Switch, TextField } from '@heroui/react';
import { FloppyDisk, Xmark } from '@gravity-ui/icons';
import {
  getCustomerColombiaCities,
  getCustomerColombiaStates,
  getCustomerCountries,
  getCustomerWooStates,
} from '@sevale/shared';
import { createAgreementSchema } from '@sevale/validation';
import { Input } from '../components/Input';
import { PhoneInput } from '../components/PhoneInput';
import { CustomerAutocomplete } from '../customers/CustomerAutocomplete';
import { AgreementRequestError, agreementsApi, type AgreementRecord } from './api';
import { AgreementLogoField } from './AgreementLogoField';
import { messageFrom } from './presentation';

type FormValue = {
  companyName: string;
  nit: string;
  country: string;
  region: string;
  cityCode: string;
  cityName: string;
  postalCode: string;
  addressLine1: string;
  addressLine2: string;
  contactName: string;
  contactPosition: string;
  contactEmail: string;
  contactPhone: string;
  validUntil: string;
  logoUrl: string;
  description: string;
  active: boolean;
};

const emptyValue: FormValue = {
  companyName: '',
  nit: '',
  country: 'CO',
  region: '',
  cityCode: '',
  cityName: '',
  postalCode: '',
  addressLine1: '',
  addressLine2: '',
  contactName: '',
  contactPosition: '',
  contactEmail: '',
  contactPhone: '',
  validUntil: '',
  logoUrl: '',
  description: '',
  active: true,
};

function initialValue(agreement: AgreementRecord | null): FormValue {
  if (!agreement) return emptyValue;
  return {
    companyName: agreement.companyName,
    nit: agreement.nit ?? '',
    country: agreement.country || 'CO',
    region: agreement.region ?? '',
    cityCode: agreement.cityCode ?? '',
    // Fuera de Colombia la API devuelve el texto guardado sin resolverlo, así que sirve tal cual.
    cityName: agreement.cityName ?? '',
    postalCode: agreement.postalCode ?? '',
    addressLine1: agreement.addressLine1 ?? '',
    addressLine2: agreement.addressLine2 ?? '',
    contactName: agreement.contactName ?? '',
    contactPosition: agreement.contactPosition ?? '',
    contactEmail: agreement.contactEmail ?? '',
    contactPhone: agreement.contactPhone ?? '',
    validUntil: agreement.validUntil ?? '',
    logoUrl: agreement.logoUrl ?? '',
    description: agreement.description ?? '',
    active: agreement.active,
  };
}

// Los convenios son de cualquier país del catálogo de Clientes; Colombia solo decide qué catálogo
// de regiones y ciudades se usa.
const colombiaStates = getCustomerColombiaStates().map((state) => ({
  id: state.code,
  name: state.name,
}));

/**
 * La API no acepta multipart, así que la imagen viaja en base64 dentro del JSON. La conversión se
 * hace aquí, en el momento de guardar, no al elegir el archivo.
 */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('No pudimos leer el archivo.'));
        return;
      }
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('No pudimos leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

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
  // Archivo elegido pero aún no subido. Se sube al guardar, así cancelar no deja nada en el bucket.
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoError, setLogoError] = useState('');
  const isEdit = agreement !== null;

  useEffect(() => {
    if (!isOpen) return;
    setValue(initialValue(agreement));
    setErrors({});
    setError('');
    setLogoFile(null);
    setLogoError('');
  }, [agreement, isOpen]);

  const countries = useMemo(
    () => getCustomerCountries().map((country) => ({ id: country.code, name: country.name })),
    [],
  );
  const isColombia = value.country === 'CO';
  const states = useMemo(
    () =>
      isColombia
        ? colombiaStates
        : getCustomerWooStates(value.country).map((state) => ({
            id: state.code,
            name: state.name,
          })),
    [isColombia, value.country],
  );
  // Hay países sin catálogo de regiones: allí la región y la ciudad se escriben a mano.
  const hasRegionCatalog = isColombia || states.length > 0;
  const cities = useMemo(
    () =>
      isColombia && value.region
        ? getCustomerColombiaCities(value.region).map((city) => ({
            id: city.code,
            name: city.name,
          }))
        : [],
    [isColombia, value.region],
  );

  const text = (key: keyof FormValue) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setValue((current) => ({ ...current, [key]: event.target.value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setLogoError('');

    // La imagen se sube ahora, no al elegirla: si el usuario cancela, no hay objeto que borrar.
    let logoUrl = value.logoUrl;
    if (logoFile) {
      try {
        logoUrl = (await agreementsApi.uploadLogo(logoFile.type, await toBase64(logoFile))).url;
      } catch (uploadError) {
        setLogoError(
          uploadError instanceof Error ? uploadError.message : 'No pudimos subir el logo.',
        );
        return;
      }
    }

    const parsed = createAgreementSchema.safeParse({
      companyName: value.companyName,
      nit: value.nit,
      country: value.country,
      region: value.region,
      cityCode: value.cityCode,
      cityName: value.cityName,
      postalCode: value.postalCode,
      addressLine1: value.addressLine1,
      addressLine2: value.addressLine2,
      contactName: value.contactName,
      contactPosition: value.contactPosition,
      contactEmail: value.contactEmail,
      contactPhone: value.contactPhone,
      validUntil: value.validUntil,
      logoUrl,
      description: value.description,
      active: value.active,
    });
    if (!parsed.success) {
      // Se subió una imagen para nada: se descarta para no dejarla huérfana.
      if (logoUrl !== value.logoUrl) void agreementsApi.discardLogo(logoUrl).catch(() => undefined);
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
      await onSubmit({ ...value, logoUrl });
    } catch (submitError) {
      // La subida ya ocurrió y el convenio no se guardó: el objeto quedaría sin referencia.
      if (logoUrl !== value.logoUrl) void agreementsApi.discardLogo(logoUrl).catch(() => undefined);
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
                <AgreementLogoField
                  url={value.logoUrl}
                  file={logoFile}
                  onSelect={setLogoFile}
                  onClear={() => {
                    setLogoFile(null);
                    setValue((current) => ({ ...current, logoUrl: '' }));
                  }}
                  error={logoError}
                  disabled={isSubmitting}
                />
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
                  <TextField>
                    <Label>Fecha de vigencia</Label>
                    <Input
                      type="date"
                      variant="secondary"
                      value={value.validUntil}
                      onChange={text('validUntil')}
                    />
                    {errors.validUntil && (
                      <span className="agreement-field-error">{errors.validUntil}</span>
                    )}
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
                    ariaLabel="País"
                    label="País"
                    placeholder="Seleccionar"
                    value={value.country}
                    options={countries}
                    onChange={(country) =>
                      // Cambiar de país invalida la ubicación elegida: los catálogos no coinciden.
                      setValue((current) => ({
                        ...current,
                        country: country || 'CO',
                        region: '',
                        cityCode: '',
                        cityName: '',
                      }))
                    }
                  />
                  {hasRegionCatalog ? (
                    <CustomerAutocomplete
                      key={`agreement-region:${value.country}`}
                      ariaLabel={isColombia ? 'Departamento' : 'Región o provincia'}
                      label={isColombia ? 'Departamento' : 'Región / Provincia'}
                      placeholder="Seleccionar"
                      value={value.region}
                      options={states}
                      onChange={(region) =>
                        // Cambiar de región invalida la ciudad elegida.
                        setValue((current) => ({ ...current, region, cityCode: '' }))
                      }
                    />
                  ) : (
                    <TextField>
                      <Label>Región / Provincia</Label>
                      <Input
                        variant="secondary"
                        placeholder="Escribe la región o provincia"
                        value={value.region}
                        onChange={text('region')}
                      />
                    </TextField>
                  )}
                  {isColombia ? (
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
                  ) : (
                    <TextField>
                      <Label>Ciudad</Label>
                      <Input
                        variant="secondary"
                        placeholder="Escribe la ciudad"
                        value={value.cityName}
                        onChange={text('cityName')}
                      />
                    </TextField>
                  )}
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
                  <div className="customer-field">
                    <Label>Teléfono</Label>
                    <PhoneInput
                      country={value.country}
                      value={value.contactPhone}
                      onChange={(phone) => {
                        setValue((current) => ({ ...current, contactPhone: phone }));
                        setErrors((current) => ({ ...current, contactPhone: undefined }));
                      }}
                    />
                    {errors.contactPhone && (
                      <span className="agreement-field-error">{errors.contactPhone}</span>
                    )}
                  </div>
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
