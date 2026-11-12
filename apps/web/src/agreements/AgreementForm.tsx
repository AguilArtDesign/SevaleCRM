import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Calendar,
  DateField,
  DatePicker,
  Label,
  Modal,
  Switch,
  TextField,
} from '@heroui/react';
import { parseDate, type CalendarDate } from '@internationalized/date';
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
import { Textarea } from '../components/Textarea';
import { CustomerAutocomplete } from '../customers/CustomerAutocomplete';
import { AgreementRequestError, agreementsApi, type AgreementRecord } from './api';
import { AgreementLogoField } from './AgreementLogoField';
import { messageFrom } from './presentation';
import { useCurrentUser } from '../users/useCurrentUser';

type FormValue = {
  companyName: string;
  legalName: string;
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
  contactLandline: string;
  contactExtension: string;
  validUntil: string;
  logoUrl: string;
  description: string;
  active: boolean;
};

const emptyValue: FormValue = {
  companyName: '',
  legalName: '',
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
  contactLandline: '',
  contactExtension: '',
  validUntil: '',
  logoUrl: '',
  description: '',
  active: true,
};

function initialValue(agreement: AgreementRecord | null): FormValue {
  if (!agreement) return emptyValue;
  return {
    companyName: agreement.companyName,
    legalName: agreement.legalName ?? '',
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
    contactLandline: agreement.contactLandline ?? '',
    contactExtension: agreement.contactExtension ?? '',
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
 * La fecha de vigencia se escribe en un calendario, no a mano. Los dos formatos conviven: el
 * formulario guarda `YYYY-MM-DD` y el `DatePicker` trabaja con `CalendarDate`.
 */
function dateValue(value: string): CalendarDate | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return parseDate(value);
}

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
  // El logo es una decisión de marca: solo el administrador lo sube o lo cambia.
  const { user } = useCurrentUser();
  const canManageLogo = user?.role === 'ADMIN';

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

  // El mismo manejador sirve para `input` y para `textarea`: en los dos casos el valor es el texto.
  const text =
    (key: keyof FormValue) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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
      legalName: value.legalName,
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
      contactLandline: value.contactLandline,
      contactExtension: value.contactExtension,
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
                  : 'Ingresa los datos de la empresa y su contacto.'}
              </p>
            </div>
          </Modal.Header>
          <form className="agreement-form" onSubmit={(event) => void submit(event)} noValidate>
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
                {/* Solo el administrador decide el logo: es la imagen de marca del convenio. */}
                {canManageLogo && (
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
                )}
                <div className="customer-form-grid">
                  <TextField isRequired>
                    <Label>Nombre comercial</Label>
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
                    <Label>Razón social</Label>
                    <Input
                      variant="secondary"
                      placeholder="Universidad XYZ S.A.S."
                      value={value.legalName}
                      onChange={text('legalName')}
                    />
                    {errors.legalName && (
                      <span className="agreement-field-error">{errors.legalName}</span>
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
                  <DatePicker
                    value={dateValue(value.validUntil)}
                    onChange={(date) =>
                      setValue((current) => ({
                        ...current,
                        validUntil: date ? date.toString() : '',
                      }))
                    }
                  >
                    <Label>Fecha de vigencia</Label>
                    <DateField.Group fullWidth variant="secondary">
                      <DateField.Input>
                        {(segment) => <DateField.Segment segment={segment} />}
                      </DateField.Input>
                      <DateField.Suffix>
                        {/* El disparador va dentro del grupo, como en el resto del CRM: el botón
                            envuelve los campos y el foco se queda en los segmentos. */}
                        <DatePicker.Trigger>
                          <DatePicker.TriggerIndicator />
                        </DatePicker.Trigger>
                      </DateField.Suffix>
                    </DateField.Group>
                    <DatePicker.Popover>
                      <Calendar aria-label="Fecha de vigencia">
                        <Calendar.Header>
                          <Calendar.YearPickerTrigger>
                            <Calendar.YearPickerTriggerHeading />
                            <Calendar.YearPickerTriggerIndicator />
                          </Calendar.YearPickerTrigger>
                          <Calendar.NavButton slot="previous" />
                          <Calendar.NavButton slot="next" />
                        </Calendar.Header>
                        <Calendar.Grid>
                          <Calendar.GridHeader>
                            {(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}
                          </Calendar.GridHeader>
                          <Calendar.GridBody>
                            {(date) => <Calendar.Cell date={date} />}
                          </Calendar.GridBody>
                        </Calendar.Grid>
                        <Calendar.YearPickerGrid>
                          <Calendar.YearPickerGridBody>
                            {({ year }) => <Calendar.YearPickerCell year={year} />}
                          </Calendar.YearPickerGridBody>
                        </Calendar.YearPickerGrid>
                      </Calendar>
                    </DatePicker.Popover>
                  </DatePicker>
                  {errors.validUntil && (
                    <span className="agreement-field-error">{errors.validUntil}</span>
                  )}
                  {/* Activo ocupa las dos columnas: es un interruptor, no un campo que compita en
                      una mitad con otro dato. */}
                  <div className="customer-vat-control customer-field-full">
                    <div>
                      <strong>Activo</strong>
                      <span>Activar o desactivar este convenio</span>
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
                  {/* La descripción es un párrafo, no una línea: en el alta crece con el texto. En
                      edición se conserva el campo de siempre. */}
                  {isEdit ? (
                    <TextField className="customer-field-full">
                      <Label>Descripción</Label>
                      <Input
                        variant="secondary"
                        placeholder="Condiciones del convenio, alcance, beneficios…"
                        value={value.description}
                        onChange={text('description')}
                      />
                    </TextField>
                  ) : (
                    <TextField className="customer-field-full agreement-description-field">
                      <Label>Descripción</Label>
                      <Textarea
                        aria-label="Descripción"
                        variant="secondary"
                        placeholder="Condiciones del convenio, alcance, beneficios…"
                        value={value.description}
                        onChange={text('description')}
                      />
                    </TextField>
                  )}
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
                  <TextField className="customer-field-full">
                    <Label>Dirección</Label>
                    <Input
                      variant="secondary"
                      placeholder="Nombre de la calle y número de la casa"
                      value={value.addressLine1}
                      onChange={text('addressLine1')}
                    />
                  </TextField>
                  {/* El complemento no lleva etiqueta visible: se lee como la segunda línea de la
                      misma dirección. El nombre accesible va en el `TextField`, que es quien lo
                      reclama a react-aria. */}
                  <TextField
                    className="customer-field-full"
                    aria-label="Complemento de la dirección"
                  >
                    <Input
                      variant="secondary"
                      placeholder="Complemento: barrio, torre, oficina…"
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
                  {/* Una línea fija con extensión no cabe en E.164, así que se guardan como se
                      escriben, sin pasar por el normalizador del móvil. */}
                  <TextField>
                    <Label>Teléfono fijo</Label>
                    <Input
                      variant="secondary"
                      placeholder="601 555 0134"
                      value={value.contactLandline}
                      onChange={text('contactLandline')}
                    />
                    {errors.contactLandline && (
                      <span className="agreement-field-error">{errors.contactLandline}</span>
                    )}
                  </TextField>
                  <TextField>
                    <Label>Extensión</Label>
                    <Input
                      variant="secondary"
                      placeholder="210"
                      value={value.contactExtension}
                      onChange={text('contactExtension')}
                    />
                    {errors.contactExtension && (
                      <span className="agreement-field-error">{errors.contactExtension}</span>
                    )}
                  </TextField>
                </div>
              </section>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={isSubmitting} onPress={onClose}>
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
