import { useMemo, useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Description,
  Label,
  ListBox,
  Modal,
  Radio,
  RadioGroup,
  SearchField,
  Spinner,
  Switch,
  TextField,
} from '@heroui/react';
import { PersonPlus } from '@gravity-ui/icons';
import {
  createCustomerSchema,
  customerDocumentTypes,
  customerFiscalResponsibilities,
  type CreateCustomerInput,
} from '@sevale/validation';
import {
  getCustomerColombiaCities,
  getCustomerColombiaStates,
  getCustomerCountries,
  getCustomerWooStates,
  normalizePhoneE164,
  resolveCustomerCityName,
  resolveCustomerCountryName,
  resolveCustomerRegionName,
} from '@sevale/shared';
import { Input } from '../components/Input';
import { PhoneInput } from '../components/PhoneInput';
import { Select } from '../components/Select';
import { Chip } from '../components/Chip';
import {
  customersApi,
  type CustomerDraftAddress,
  type CustomerDraftConflicts,
  type CustomerIntegration,
  type CustomerRecord,
  type CustomerResolveResponse,
} from './api';
import { CustomerAutocomplete } from './CustomerAutocomplete';

type CustomerFormValue = Omit<CreateCustomerInput, 'documentType'> & {
  documentType: CreateCustomerInput['documentType'] | '';
};

type DocumentFieldErrors = Partial<Record<'documentType' | 'documentNumber', string>>;

const emptyCustomer: CustomerFormValue = {
  personType: 'PERSON',
  firstName: null,
  lastName: null,
  displayName: '',
  company: null,
  documentType: '',
  documentNumber: '',
  checkDigit: null,
  email: null,
  phone: null,
  country: null,
  region: null,
  cityCode: null,
  cityName: null,
  postalCode: null,
  addressLine1: null,
  addressLine2: null,
  vatResponsible: false,
  fiscalResponsibilities: ['R-99-PN'],
};

function initialValue(customer?: CustomerRecord | null): CustomerFormValue {
  if (!customer) return { ...emptyCustomer };
  return {
    personType: customer.personType,
    firstName: customer.firstName,
    lastName: customer.lastName,
    displayName: customer.displayName,
    company: customer.company,
    documentType: customer.documentType,
    documentNumber: customer.documentNumber,
    checkDigit: customer.checkDigit,
    email: customer.email,
    phone: customer.phone,
    country: customer.country,
    region: customer.region,
    cityCode: customer.cityCode,
    cityName: customer.cityName,
    postalCode: customer.postalCode,
    addressLine1: customer.addressLine1,
    addressLine2: customer.addressLine2,
    vatResponsible: customer.vatResponsible,
    fiscalResponsibilities: [customer.fiscalResponsibilities[0] ?? 'R-99-PN'],
  };
}

function formatAddress(address: CustomerDraftAddress): string {
  const lines = [address.addressLine1, address.addressLine2].filter(Boolean).join(', ');
  const city = resolveCustomerCityName(
    address.country,
    address.region,
    address.cityCode,
    address.cityName,
  );
  const region = resolveCustomerRegionName(address.country, address.region);
  const country = resolveCustomerCountryName(address.country);
  const location = [city, region, country].filter(Boolean).join(', ');
  return [lines, location].filter(Boolean).join(' — ');
}

const sourceLabels: Record<CustomerIntegration['provider'], string> = {
  SIIGO: 'Siigo',
  SERATUS: 'Seratus',
  PALI: 'Pali',
};

const documentTypeLabels = new Map<string, string>(
  customerDocumentTypes.map(({ value, label }) => [value, label] as const),
);

function CustomerSourceChips({ sources }: { sources: CustomerIntegration['provider'][] }) {
  const sourceSet = new Set(sources);
  const chips: Array<{ id: string; label: string; className: string }> = [];
  if (sourceSet.has('SIIGO')) {
    chips.push({ id: 'siigo', label: 'Siigo', className: 'customer-source-chip--siigo' });
  }
  if (sourceSet.has('SERATUS') && sourceSet.has('PALI')) {
    chips.push({
      id: 'woocommerce',
      label: 'WooCommerce',
      className: 'customer-source-chip--woocommerce',
    });
  } else {
    if (sourceSet.has('SERATUS')) {
      chips.push({ id: 'seratus', label: 'Seratus', className: 'customer-source-chip--seratus' });
    }
    if (sourceSet.has('PALI')) {
      chips.push({ id: 'pali', label: 'Pali', className: 'customer-source-chip--pali' });
    }
  }
  return (
    <span className="customer-source-chips">
      {chips.map((chip) => (
        <Chip key={chip.id} className={`customer-source-chip ${chip.className}`} color="default">
          {chip.label}
        </Chip>
      ))}
    </span>
  );
}

export function CustomerForm({
  isOpen,
  customer,
  isSubmitting,
  serverError,
  onClose,
  onOpenExisting,
  onSubmit,
}: {
  isOpen: boolean;
  customer?: CustomerRecord | null;
  isSubmitting: boolean;
  serverError: string;
  onClose: () => void;
  onOpenExisting: (customerId: number) => void;
  onSubmit: (value: CreateCustomerInput) => Promise<void>;
}) {
  const [value, setValue] = useState<CustomerFormValue>(() => initialValue(customer));
  const [error, setError] = useState('');
  const [documentErrors, setDocumentErrors] = useState<DocumentFieldErrors>({});
  const [lookupError, setLookupError] = useState('');
  const [lookupResult, setLookupResult] = useState<CustomerResolveResponse | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const countries = useMemo(() => getCustomerCountries(), []);
  const isColombia = value.country === 'CO';
  const states = useMemo(
    () =>
      value.country === 'CO'
        ? getCustomerColombiaStates()
        : getCustomerWooStates(value.country ?? ''),
    [value.country],
  );
  const hasPredefinedStates = states.length > 0;
  const cities = useMemo(
    () => (isColombia ? getCustomerColombiaCities(value.region ?? '') : []),
    [isColombia, value.region],
  );
  const isEdit = Boolean(customer);
  const hasUnresolvedConflict =
    !lookupResult?.existsLocally && Boolean(Object.keys(lookupResult?.conflicts ?? {}).length);
  const siigoDocumentTypeLabel =
    lookupResult && !lookupResult.existsLocally && lookupResult.documentTypeFromSiigo
      ? lookupResult.documentTypeFromSiigo === value.documentType
        ? null
        : (documentTypeLabels.get(lookupResult.documentTypeFromSiigo) ??
          lookupResult.documentTypeFromSiigo)
      : null;

  const clearConflict = (conflict: keyof CustomerDraftConflicts) =>
    setLookupResult((current) => {
      if (!current || current.existsLocally || !current.conflicts[conflict]) return current;
      const conflicts = { ...current.conflicts };
      delete conflicts[conflict];
      return { ...current, conflicts };
    });

  const text =
    (field: keyof CustomerFormValue, nullable = false, conflict?: keyof CustomerDraftConflicts) =>
    (event: { target: { value: string } }) => {
      setValue((current) => ({
        ...current,
        [field]: nullable ? event.target.value || null : event.target.value,
      }));
      if (conflict) clearConflict(conflict);
    };

  const changePersonType = (selected: string) => {
    const personType = selected as 'PERSON' | 'COMPANY';
    setValue((current) => ({
      ...current,
      personType,
      company: personType === 'COMPANY' ? current.company || current.displayName || null : null,
    }));
    clearConflict('name');
  };

  const changeDisplayName = (event: { target: { value: string } }) => {
    const displayName = event.target.value;
    setValue((current) => ({
      ...current,
      displayName,
      company:
        current.personType === 'COMPANY' &&
        (!current.company || current.company === current.displayName)
          ? displayName || null
          : current.company,
    }));
    clearConflict('name');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!isEdit && lookupResult?.identification !== value.documentNumber.trim()) {
      setError('Busca el cliente por tipo y número de documento antes de guardarlo.');
      return;
    }
    if (!isEdit && lookupResult?.existsLocally) {
      setError('Este cliente ya existe en el CRM. Abre su registro para editarlo.');
      return;
    }
    if (
      !isEdit &&
      lookupResult &&
      !lookupResult.existsLocally &&
      Object.keys(lookupResult.conflicts).length > 0
    ) {
      setError('Selecciona o edita los datos que presentan conflicto antes de crear el cliente.');
      return;
    }
    const parsed = createCustomerSchema.safeParse(value);
    if (!parsed.success) {
      const nextDocumentErrors: DocumentFieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (
          (field === 'documentType' || field === 'documentNumber') &&
          !nextDocumentErrors[field]
        ) {
          nextDocumentErrors[field] = issue.message;
        }
      }
      setDocumentErrors(nextDocumentErrors);
      const formIssue = parsed.error.issues.find(
        (issue) => issue.path[0] !== 'documentType' && issue.path[0] !== 'documentNumber',
      );
      setError(formIssue?.message ?? '');
      return;
    }
    const normalizedPhone = parsed.data.phone
      ? normalizePhoneE164(parsed.data.phone, parsed.data.country ?? '')
      : null;
    if (parsed.data.phone && !normalizedPhone) {
      setError('El teléfono no es válido para el país seleccionado.');
      return;
    }
    setError('');
    setDocumentErrors({});
    try {
      await onSubmit({ ...parsed.data, phone: normalizedPhone });
    } catch {
      // El padre presenta el error normalizado devuelto por la API.
    }
  };

  const changeDocument = (documentNumber: string) => {
    setLookupResult(null);
    setLookupError('');
    setDocumentErrors((current) => ({ ...current, documentNumber: undefined }));
    setValue((current) => ({ ...current, documentNumber }));
  };

  const lookupDocument = async () => {
    const identification = value.documentNumber.trim();
    const documentType = value.documentType;
    if (!documentType) {
      setLookupError('Selecciona el tipo de documento antes de buscar.');
      return;
    }
    if (!identification) {
      setLookupError('Ingresa el número de documento que deseas buscar.');
      return;
    }
    setLookupError('');
    setError('');
    setIsLookingUp(true);
    try {
      const result = await customersApi.resolve(identification, documentType);
      setLookupResult(result);
      if (!result.existsLocally && result.customer) {
        setValue((current) => ({
          ...result.customer!,
          country: current.country,
          region: current.region,
          cityCode: current.cityCode,
          cityName: current.cityName,
          documentType: result.customer!.documentType ?? '',
          fiscalResponsibilities: [result.customer!.fiscalResponsibilities[0] ?? 'R-99-PN'],
        }));
      }
    } catch (lookupFailure) {
      setLookupResult(null);
      setLookupError(
        lookupFailure instanceof Error
          ? lookupFailure.message
          : 'No pudimos buscar el cliente. Inténtalo nuevamente.',
      );
    } finally {
      setIsLookingUp(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="lg" placement="center" scroll="inside">
          <Modal.Dialog className="customer-form-modal">
            <Modal.CloseTrigger aria-label="Cerrar formulario" />
            <Modal.Header>
              <div>
                <Modal.Heading>{isEdit ? 'Editar cliente' : 'Crear cliente'}</Modal.Heading>
                <p>
                  {isEdit
                    ? 'Actualiza la información del cliente.'
                    : 'Registra al cliente para sincronizar.'}
                </p>
              </div>
            </Modal.Header>
            <form onSubmit={(event) => void submit(event)} noValidate>
              <Modal.Body className="customer-form-body">
                {(error || serverError) && (
                  <Alert status="danger">
                    <Alert.Content>
                      <Alert.Description>{error || serverError}</Alert.Description>
                    </Alert.Content>
                  </Alert>
                )}

                <section className="customer-form-section">
                  <h3>Información</h3>
                  <div className="customer-form-grid">
                    <div className="customer-field customer-field-full">
                      <Label>Tipo de persona</Label>
                      <RadioGroup
                        aria-label="Tipo de persona"
                        className="customer-person-type-options"
                        name="person-type"
                        orientation="horizontal"
                        value={value.personType}
                        onChange={(selected) => changePersonType(String(selected))}
                      >
                        <Radio className="customer-person-type-option" value="PERSON">
                          <Radio.Content>
                            <Radio.Control>
                              <Radio.Indicator />
                            </Radio.Control>
                            <div className="customer-person-type-copy">
                              <span>Persona natural</span>
                              <Description>Identidad personal</Description>
                            </div>
                          </Radio.Content>
                        </Radio>
                        <Radio className="customer-person-type-option" value="COMPANY">
                          <Radio.Content>
                            <Radio.Control>
                              <Radio.Indicator />
                            </Radio.Control>
                            <div className="customer-person-type-copy">
                              <span>Empresa</span>
                              <Description>Identidad legal</Description>
                            </div>
                          </Radio.Content>
                        </Radio>
                      </RadioGroup>
                    </div>
                    <TextField isRequired>
                      <Label>Nombres</Label>
                      <Input
                        variant="secondary"
                        placeholder="John Smith"
                        value={value.firstName ?? ''}
                        onChange={text('firstName', true, 'name')}
                      />
                    </TextField>
                    <TextField isRequired>
                      <Label>Apellidos</Label>
                      <Input
                        variant="secondary"
                        placeholder="Doe Jones"
                        value={value.lastName ?? ''}
                        onChange={text('lastName', true, 'name')}
                      />
                    </TextField>
                    <TextField className="customer-field-full">
                      <Label>Nombre público</Label>
                      <Input
                        variant="secondary"
                        placeholder="John Smith Doe Jones"
                        value={value.displayName}
                        onChange={changeDisplayName}
                      />
                    </TextField>
                    {!isEdit &&
                      lookupResult &&
                      !lookupResult.existsLocally &&
                      lookupResult.conflicts.name && (
                        <div className="customer-conflict customer-field-full">
                          <strong>Encontramos nombres diferentes</strong>
                          <RadioGroup
                            aria-label="Seleccionar nombre del cliente"
                            onChange={(selected) => {
                              const option = lookupResult.conflicts.name?.options[Number(selected)];
                              if (!option) return;
                              setValue((current) => ({
                                ...current,
                                ...option.value,
                                company:
                                  current.personType === 'COMPANY' &&
                                  (!current.company || current.company === current.displayName)
                                    ? option.value.displayName || null
                                    : current.company,
                              }));
                              clearConflict('name');
                            }}
                          >
                            {lookupResult.conflicts.name.options.map((option, index) => (
                              <Radio
                                className="customer-conflict-option"
                                key={`${option.sources.join('-')}-${index}`}
                                value={String(index)}
                              >
                                <Radio.Content>
                                  <Radio.Control>
                                    <Radio.Indicator />
                                  </Radio.Control>
                                  <span className="customer-conflict-value">
                                    {option.value.displayName}
                                  </span>
                                  <CustomerSourceChips sources={option.sources} />
                                </Radio.Content>
                              </Radio>
                            ))}
                          </RadioGroup>
                        </div>
                      )}
                  </div>
                </section>

                <section className="customer-form-section">
                  <h3>Documento</h3>
                  <div className="customer-form-grid">
                    <CustomerAutocomplete
                      ariaLabel="Tipo de documento"
                      label="Tipo de documento"
                      placeholder="Seleccionar"
                      value={value.documentType}
                      options={customerDocumentTypes.map((option) => ({
                        id: option.value,
                        name: option.label,
                      }))}
                      isInvalid={Boolean(documentErrors.documentType)}
                      isRequired
                      onChange={(documentType) => {
                        if (!documentType) return;
                        // El tipo es parte de la llave de búsqueda: un resultado anterior deja de ser válido.
                        setLookupResult(null);
                        setLookupError('');
                        setDocumentErrors((current) => ({
                          ...current,
                          documentType: undefined,
                        }));
                        setValue((current) => ({
                          ...current,
                          documentType: documentType as CreateCustomerInput['documentType'],
                          checkDigit:
                            documentType === current.documentType ? current.checkDigit : null,
                        }));
                      }}
                    />
                    <div className="customer-field">
                      <SearchField
                        aria-label="Número de documento"
                        className="customer-document-search"
                        isDisabled={isEdit || isLookingUp}
                        isInvalid={Boolean(documentErrors.documentNumber)}
                        isRequired
                        value={value.documentNumber}
                        variant="secondary"
                        onChange={changeDocument}
                        onSubmit={() => void lookupDocument()}
                        onClear={() => changeDocument('')}
                      >
                        <Label>Número de documento</Label>
                        <SearchField.Group>
                          <SearchField.SearchIcon />
                          <SearchField.Input placeholder="Buscar número de documento…" />
                          <SearchField.ClearButton />
                        </SearchField.Group>
                      </SearchField>
                    </div>
                  </div>
                  {!isEdit && lookupError && (
                    <Alert className="customer-lookup-alert" status="danger">
                      <Alert.Content>
                        <Alert.Title>No pudimos buscar el cliente</Alert.Title>
                        <Alert.Description>{lookupError}</Alert.Description>
                      </Alert.Content>
                    </Alert>
                  )}
                  {!isEdit && lookupResult?.existsLocally && (
                    <Alert className="customer-lookup-alert" status="warning">
                      <Alert.Content>
                        <Alert.Title>Este cliente ya está registrado</Alert.Title>
                        <Alert.Description>
                          Puedes abrir su información para revisarla o actualizarla.
                        </Alert.Description>
                        <Button
                          size="sm"
                          variant="secondary"
                          onPress={() => onOpenExisting(lookupResult.customerId)}
                        >
                          Ver cliente
                        </Button>
                      </Alert.Content>
                    </Alert>
                  )}
                  {!isEdit && lookupResult && !lookupResult.existsLocally && (
                    <Alert
                      className="customer-lookup-alert"
                      status={lookupResult.found ? 'success' : 'warning'}
                    >
                      <Alert.Content>
                        <Alert.Title>
                          {lookupResult.found ? 'Cliente encontrado' : 'Cliente no encontrado'}
                        </Alert.Title>
                        <Alert.Description>
                          {lookupResult.found
                            ? 'Encontramos información del cliente. Revisa y elige los datos correctos antes de guardarlo.'
                            : 'No encontramos información previa. Completa los datos para registrar el cliente.'}
                        </Alert.Description>
                      </Alert.Content>
                    </Alert>
                  )}
                  {!isEdit && lookupResult && !lookupResult.existsLocally && (
                    <div className="customer-lookup-sources">
                      {lookupResult.integrations.map((source) => (
                        <p key={source.provider}>
                          <strong>{sourceLabels[source.provider]}</strong>{' '}
                          {source.status === 'FOUND'
                            ? 'tiene este cliente.'
                            : source.status === 'NOT_FOUND'
                              ? 'no tiene este documento.'
                              : source.status === 'AMBIGUOUS'
                                ? `tiene ${source.candidates} clientes con este documento: corrige los duplicados en la tienda para poder vincularlo.`
                                : 'no se pudo consultar.'}
                        </p>
                      ))}
                      {siigoDocumentTypeLabel && (
                        <p>
                          En Siigo el documento figura como{' '}
                          <strong>{siigoDocumentTypeLabel}</strong>.
                        </p>
                      )}
                    </div>
                  )}
                </section>

                <section className="customer-form-section">
                  <h3>Contacto y dirección</h3>
                  <div className="customer-form-grid">
                    <TextField type="email">
                      <Label>Correo electrónico</Label>
                      <Input
                        variant="secondary"
                        placeholder="johndoe@mail.com"
                        value={value.email ?? ''}
                        onChange={text('email', true, 'email')}
                      />
                    </TextField>
                    {!isEdit &&
                      lookupResult &&
                      !lookupResult.existsLocally &&
                      lookupResult.conflicts.email && (
                        <div className="customer-conflict customer-field-full">
                          <strong>Encontramos correos diferentes</strong>
                          <RadioGroup
                            aria-label="Seleccionar correo electrónico"
                            onChange={(selected) => {
                              setValue((current) => ({ ...current, email: String(selected) }));
                              clearConflict('email');
                            }}
                          >
                            {lookupResult.conflicts.email.options.map((option) => (
                              <Radio
                                className="customer-conflict-option"
                                key={option.value}
                                value={option.value}
                              >
                                <Radio.Content>
                                  <Radio.Control>
                                    <Radio.Indicator />
                                  </Radio.Control>
                                  <span className="customer-conflict-value">{option.value}</span>
                                  <CustomerSourceChips sources={option.sources} />
                                </Radio.Content>
                              </Radio>
                            ))}
                          </RadioGroup>
                        </div>
                      )}
                    <div className="customer-field">
                      <Label>Teléfono</Label>
                      <PhoneInput
                        country={value.country ?? 'CO'}
                        value={value.phone ?? ''}
                        onChange={(phone) => {
                          setValue((current) => ({ ...current, phone: phone || null }));
                          clearConflict('phone');
                        }}
                      />
                    </div>
                    {!isEdit &&
                      lookupResult &&
                      !lookupResult.existsLocally &&
                      lookupResult.conflicts.phone && (
                        <div className="customer-conflict customer-field-full">
                          <strong>Encontramos teléfonos diferentes</strong>
                          <RadioGroup
                            aria-label="Seleccionar teléfono"
                            onChange={(selected) => {
                              setValue((current) => ({ ...current, phone: String(selected) }));
                              clearConflict('phone');
                            }}
                          >
                            {lookupResult.conflicts.phone.options.map((option) => (
                              <Radio
                                className="customer-conflict-option"
                                key={option.value}
                                value={option.value}
                              >
                                <Radio.Content>
                                  <Radio.Control>
                                    <Radio.Indicator />
                                  </Radio.Control>
                                  <span className="customer-conflict-value">{option.value}</span>
                                  <CustomerSourceChips sources={option.sources} />
                                </Radio.Content>
                              </Radio>
                            ))}
                          </RadioGroup>
                        </div>
                      )}
                    <CustomerAutocomplete
                      ariaLabel="País"
                      label="País"
                      placeholder="Seleccionar"
                      value={value.country ?? ''}
                      options={countries.map((option) => ({
                        id: option.code,
                        name: option.name,
                      }))}
                      onChange={(country) => {
                        setValue((current) => ({
                          ...current,
                          country: country || null,
                          region: null,
                          cityCode: null,
                          cityName: null,
                        }));
                        clearConflict('address');
                      }}
                    />
                    {isColombia || hasPredefinedStates ? (
                      <CustomerAutocomplete
                        key={`region:${value.country}`}
                        ariaLabel={isColombia ? 'Departamento' : 'Región o provincia'}
                        label={isColombia ? 'Departamento' : 'Región / Provincia'}
                        placeholder="Seleccionar"
                        value={value.region ?? ''}
                        options={states.map((option) => ({
                          id: option.code,
                          name: option.name,
                        }))}
                        isDisabled={!value.country}
                        onChange={(region) => {
                          setValue((current) => ({
                            ...current,
                            region: region || null,
                            cityCode: null,
                            cityName: null,
                          }));
                          clearConflict('address');
                        }}
                      />
                    ) : (
                      <TextField>
                        <Label>Región / Provincia</Label>
                        <Input
                          variant="secondary"
                          placeholder="Escribe la región o provincia"
                          value={value.region ?? ''}
                          disabled={!value.country}
                          onChange={(event) => {
                            setValue((current) => ({
                              ...current,
                              region: event.target.value || null,
                              cityCode: null,
                              cityName: null,
                            }));
                            clearConflict('address');
                          }}
                        />
                      </TextField>
                    )}
                    {isColombia ? (
                      <CustomerAutocomplete
                        key={`city:${value.country}:${value.region}`}
                        ariaLabel="Ciudad o municipio"
                        label="Ciudad / Municipio"
                        placeholder="Seleccionar"
                        value={value.cityCode ?? ''}
                        options={cities.map((option) => ({
                          id: option.code,
                          name: option.name,
                        }))}
                        isDisabled={!value.region}
                        onChange={(cityCode) => {
                          setValue((current) => ({
                            ...current,
                            cityCode: cityCode || null,
                            cityName: null,
                          }));
                          clearConflict('address');
                        }}
                      />
                    ) : (
                      <TextField>
                        <Label>Ciudad</Label>
                        <Input
                          variant="secondary"
                          placeholder="Escribe la ciudad"
                          value={value.cityName ?? ''}
                          disabled={!value.country}
                          onChange={(event) => {
                            setValue((current) => ({
                              ...current,
                              cityCode: null,
                              cityName: event.target.value || null,
                            }));
                            clearConflict('address');
                          }}
                        />
                      </TextField>
                    )}
                    <TextField>
                      <Label>Código postal</Label>
                      <Input
                        variant="secondary"
                        value={value.postalCode ?? ''}
                        onChange={text('postalCode', true, 'address')}
                      />
                    </TextField>
                    <TextField className="customer-field-full">
                      <Label>Dirección</Label>
                      <Input
                        variant="secondary"
                        placeholder="Nombre de la calle y número de la casa"
                        value={value.addressLine1 ?? ''}
                        onChange={text('addressLine1', true, 'address')}
                      />
                    </TextField>
                    <TextField
                      aria-label="Complemento de dirección"
                      className="customer-field-full"
                    >
                      <Input
                        variant="secondary"
                        placeholder="Barrio, urbanización, apartamento, habitación, etc"
                        value={value.addressLine2 ?? ''}
                        onChange={text('addressLine2', true, 'address')}
                      />
                    </TextField>
                    {!isEdit &&
                      lookupResult &&
                      !lookupResult.existsLocally &&
                      lookupResult.conflicts.address && (
                        <div className="customer-conflict customer-field-full">
                          <strong>Encontramos direcciones diferentes</strong>
                          <RadioGroup
                            aria-label="Seleccionar dirección"
                            onChange={(selected) => {
                              const option =
                                lookupResult.conflicts.address?.options[Number(selected)];
                              if (!option) return;
                              setValue((current) => ({
                                ...current,
                                postalCode: option.value.postalCode,
                                addressLine1: option.value.addressLine1,
                                addressLine2: option.value.addressLine2,
                              }));
                              clearConflict('address');
                            }}
                          >
                            {lookupResult.conflicts.address.options.map((option, index) => (
                              <Radio
                                className="customer-conflict-option"
                                key={`${option.sources.join('-')}-${index}`}
                                value={String(index)}
                              >
                                <Radio.Content>
                                  <Radio.Control>
                                    <Radio.Indicator />
                                  </Radio.Control>
                                  <span className="customer-conflict-value">
                                    {formatAddress(option.value)}
                                  </span>
                                  <CustomerSourceChips sources={option.sources} />
                                </Radio.Content>
                              </Radio>
                            ))}
                          </RadioGroup>
                        </div>
                      )}
                  </div>
                </section>

                <section className="customer-form-section">
                  <h3>Información fiscal</h3>
                  <div className="customer-field">
                    <Label>Responsabilidad fiscal</Label>
                    <Select
                      aria-label="Responsabilidad fiscal"
                      variant="secondary"
                      value={value.fiscalResponsibilities[0] ?? 'R-99-PN'}
                      onChange={(selected) =>
                        setValue((current) => ({
                          ...current,
                          fiscalResponsibilities: [
                            String(
                              selected ?? 'R-99-PN',
                            ) as CreateCustomerInput['fiscalResponsibilities'][number],
                          ],
                        }))
                      }
                    >
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {customerFiscalResponsibilities.map((option) => (
                            <ListBox.Item
                              key={option.value}
                              id={option.value}
                              textValue={option.label}
                            >
                              {option.label}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>
                  <div className="customer-vat-control">
                    <div>
                      <strong>Responsable de IVA</strong>
                      <span>Indica si el cliente es responsable del impuesto.</span>
                    </div>
                    <Switch
                      aria-label="Responsable de IVA"
                      isSelected={value.vatResponsible}
                      onChange={(selected) =>
                        setValue((current) => ({ ...current, vatResponsible: selected }))
                      }
                    >
                      <Switch.Content>
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                      </Switch.Content>
                    </Switch>
                  </div>
                </section>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" onPress={onClose} isDisabled={isSubmitting}>
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  isPending={isSubmitting}
                  isDisabled={
                    isSubmitting ||
                    (!isEdit &&
                      (lookupResult?.identification !== value.documentNumber.trim() ||
                        lookupResult.existsLocally ||
                        hasUnresolvedConflict))
                  }
                >
                  {({ isPending }) => (
                    <>
                      {isPending ? (
                        <Spinner color="current" size="sm" />
                      ) : !isEdit ? (
                        <PersonPlus width={17} height={17} />
                      ) : null}
                      {isPending
                        ? isEdit
                          ? 'Guardando'
                          : 'Creando'
                        : isEdit
                          ? 'Guardar cambios'
                          : 'Crear cliente'}
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
