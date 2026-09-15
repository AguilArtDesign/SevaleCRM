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
  Switch,
  TextField,
} from '@heroui/react';
import {
  createCustomerSchema,
  customerDocumentTypes,
  customerFiscalResponsibilities,
  type CreateCustomerInput,
} from '@sevale/validation';
import { getCities, getCountries, getStates } from '@sevale/shared';
import { Input } from '../components/Input';
import { PhoneInput } from '../components/PhoneInput';
import { Select } from '../components/Select';
import { customersApi, type CustomerRecord, type CustomerSourceLookup } from './api';
import { CustomerAutocomplete } from './CustomerAutocomplete';

const emptyCustomer: CreateCustomerInput = {
  personType: 'PERSON',
  firstName: null,
  lastName: null,
  displayName: '',
  company: null,
  documentType: '13',
  documentNumber: '',
  checkDigit: null,
  email: null,
  phone: null,
  country: null,
  region: null,
  cityCode: null,
  postalCode: null,
  addressLine1: null,
  addressLine2: null,
  vatResponsible: false,
  fiscalResponsibilities: ['R-99-PN'],
};

function initialValue(customer?: CustomerRecord | null): CreateCustomerInput {
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
    postalCode: customer.postalCode,
    addressLine1: customer.addressLine1,
    addressLine2: customer.addressLine2,
    vatResponsible: customer.vatResponsible,
    fiscalResponsibilities: [customer.fiscalResponsibilities[0] ?? 'R-99-PN'],
  };
}

export function CustomerForm({
  isOpen,
  customer,
  isSubmitting,
  serverError,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  customer?: CustomerRecord | null;
  isSubmitting: boolean;
  serverError: string;
  onClose: () => void;
  onSubmit: (value: CreateCustomerInput) => Promise<void>;
}) {
  const [value, setValue] = useState<CreateCustomerInput>(() => initialValue(customer));
  const [error, setError] = useState('');
  const [lookupError, setLookupError] = useState('');
  const [lookupResult, setLookupResult] = useState<{
    identification: string;
    exists: boolean;
    integrations: CustomerSourceLookup[];
  } | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const countries = useMemo(() => getCountries(), []);
  const states = useMemo(() => getStates(value.country ?? ''), [value.country]);
  const cities = useMemo(
    () => getCities(value.country ?? '', value.region ?? ''),
    [value.country, value.region],
  );
  const isEdit = Boolean(customer);

  const text =
    (field: keyof CreateCustomerInput, nullable = false) =>
    (event: { target: { value: string } }) =>
      setValue((current) => ({
        ...current,
        [field]: nullable ? event.target.value || null : event.target.value,
      }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!isEdit && lookupResult?.identification !== value.documentNumber.trim()) {
      setError('Busca el documento en Siigo antes de guardar el cliente.');
      return;
    }
    const parsed = createCustomerSchema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || 'Revisa los datos ingresados.');
      return;
    }
    setError('');
    try {
      await onSubmit(parsed.data);
    } catch {
      // El padre presenta el error normalizado devuelto por la API.
    }
  };

  const changeDocument = (documentNumber: string) => {
    setLookupResult(null);
    setLookupError('');
    setValue((current) => ({ ...current, documentNumber }));
  };

  const lookupDocument = async () => {
    const identification = value.documentNumber.trim();
    if (!identification) {
      setLookupError('Ingresa el número de documento que deseas buscar.');
      return;
    }
    setLookupError('');
    setError('');
    setIsLookingUp(true);
    try {
      const result = await customersApi.lookupSiigo(identification);
      setLookupResult({
        identification,
        exists: result.exists,
        integrations: result.integrations,
      });
      if (result.exists) {
        setValue({
          ...result.customer,
          fiscalResponsibilities: [result.customer.fiscalResponsibilities[0] ?? 'R-99-PN'],
        });
      }
    } catch (lookupFailure) {
      setLookupResult(null);
      setLookupError(
        lookupFailure instanceof Error
          ? lookupFailure.message
          : 'No pudimos consultar el documento en Siigo.',
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
                    ? 'Los cambios se guardarán localmente hasta que decidas sincronizarlos.'
                    : 'El alta se guardará solo en el CRM, sin crear clientes externos.'}
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
                        onChange={(selected) =>
                          setValue((current) => ({
                            ...current,
                            personType: String(selected) as 'PERSON' | 'COMPANY',
                          }))
                        }
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
                        onChange={text('firstName', true)}
                      />
                    </TextField>
                    <TextField isRequired>
                      <Label>Apellidos</Label>
                      <Input
                        variant="secondary"
                        placeholder="Doe Jones"
                        value={value.lastName ?? ''}
                        onChange={text('lastName', true)}
                      />
                    </TextField>
                    <TextField className="customer-field-full">
                      <Label>Nombre público</Label>
                      <Input
                        variant="secondary"
                        placeholder="John Smith Doe Jones"
                        value={value.displayName}
                        onChange={text('displayName')}
                      />
                    </TextField>
                  </div>
                </section>

                <section className="customer-form-section">
                  <h3>Documento</h3>
                  <div className="customer-form-grid">
                    <CustomerAutocomplete
                      ariaLabel="Tipo de documento"
                      label="Tipo de documento"
                      placeholder="Selecciona un tipo de documento"
                      searchPlaceholder="Buscar tipo de documento…"
                      value={value.documentType}
                      options={customerDocumentTypes.map((option) => ({
                        id: option.value,
                        name: option.label,
                      }))}
                      onChange={(documentType) => {
                        if (!documentType) return;
                        setValue((current) => ({
                          ...current,
                          documentType: documentType as CreateCustomerInput['documentType'],
                          checkDigit:
                            documentType === current.documentType ? current.checkDigit : null,
                        }));
                      }}
                    />
                    <div className="customer-field">
                      <Label>Número de documento</Label>
                      <SearchField
                        aria-label="Número de documento"
                        className="customer-document-search"
                        isDisabled={isEdit || isLookingUp}
                        value={value.documentNumber}
                        variant="secondary"
                        onChange={changeDocument}
                        onSubmit={() => void lookupDocument()}
                        onClear={() => changeDocument('')}
                      >
                        <SearchField.Group>
                          <SearchField.SearchIcon />
                          <SearchField.Input placeholder="Buscar número de documento…" />
                          <SearchField.ClearButton />
                        </SearchField.Group>
                      </SearchField>
                    </div>
                  </div>
                  {!isEdit && lookupError && (
                    <Alert status="danger">
                      <Alert.Content>
                        <Alert.Title>No pudimos consultar Siigo</Alert.Title>
                        <Alert.Description>{lookupError}</Alert.Description>
                      </Alert.Content>
                    </Alert>
                  )}
                  {!isEdit && lookupResult && (
                    <Alert status={lookupResult.exists ? 'success' : 'warning'}>
                      <Alert.Content>
                        <Alert.Title>
                          {lookupResult.exists
                            ? 'Cliente encontrado en Siigo'
                            : 'Cliente no encontrado en Siigo'}
                        </Alert.Title>
                        <Alert.Description>
                          {lookupResult.exists
                            ? 'Los datos disponibles fueron cargados desde Siigo. Revisa el formulario antes de guardarlo localmente.'
                            : 'No se encontraron datos en Siigo. Puedes completar el formulario y guardarlo localmente.'}{' '}
                          {lookupResult.integrations
                            .filter((integration) => integration.provider !== 'SIIGO')
                            .map((integration) => {
                              const label = integration.provider === 'SERATUS' ? 'Seratus' : 'Pali';
                              if (integration.status === 'FOUND') {
                                return `${label}: ID ${integration.externalId}`;
                              }
                              if (integration.status === 'ERROR') {
                                return `${label}: no se pudo consultar`;
                              }
                              return `${label}: no encontrado`;
                            })
                            .join(' · ')}
                        </Alert.Description>
                      </Alert.Content>
                    </Alert>
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
                        onChange={text('email', true)}
                      />
                    </TextField>
                    <div className="customer-field">
                      <Label>Teléfono</Label>
                      <PhoneInput
                        country={value.country ?? 'CO'}
                        value={value.phone ?? ''}
                        onChange={(phone) =>
                          setValue((current) => ({ ...current, phone: phone || null }))
                        }
                      />
                    </div>
                    <CustomerAutocomplete
                      ariaLabel="País"
                      label="País"
                      placeholder="Selecciona un país"
                      searchPlaceholder="Buscar país…"
                      value={value.country ?? ''}
                      options={countries.map((option) => ({
                        id: option.code,
                        name: option.name,
                      }))}
                      onChange={(country) =>
                        setValue((current) => ({
                          ...current,
                          country: country || null,
                          region: null,
                          cityCode: null,
                        }))
                      }
                    />
                    <CustomerAutocomplete
                      key={`region:${value.country}`}
                      ariaLabel="Región o provincia"
                      label="Región / Provincia"
                      placeholder="Selecciona una región"
                      searchPlaceholder="Buscar región o provincia…"
                      value={value.region ?? ''}
                      options={states.map((option) => ({
                        id: option.wooCode ?? option.code,
                        name: option.name,
                      }))}
                      isDisabled={!value.country}
                      onChange={(region) =>
                        setValue((current) => ({
                          ...current,
                          region: region || null,
                          cityCode: null,
                        }))
                      }
                    />
                    <CustomerAutocomplete
                      key={`city:${value.country}:${value.region}`}
                      ariaLabel="Ciudad o municipio"
                      label="Ciudad / Municipio"
                      placeholder="Selecciona una ciudad"
                      searchPlaceholder="Buscar ciudad o municipio…"
                      value={value.cityCode ?? ''}
                      options={cities.map((option) => ({
                        id: option.code,
                        name: option.name,
                      }))}
                      isDisabled={!value.region}
                      onChange={(cityCode) =>
                        setValue((current) => ({ ...current, cityCode: cityCode || null }))
                      }
                    />
                    <TextField>
                      <Label>Código postal</Label>
                      <Input
                        variant="secondary"
                        value={value.postalCode ?? ''}
                        onChange={text('postalCode', true)}
                      />
                    </TextField>
                    <TextField className="customer-field-full">
                      <Label>Dirección</Label>
                      <Input
                        variant="secondary"
                        value={value.addressLine1 ?? ''}
                        onChange={text('addressLine1', true)}
                      />
                    </TextField>
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
                    (!isEdit && lookupResult?.identification !== value.documentNumber.trim())
                  }
                >
                  {isSubmitting
                    ? isEdit
                      ? 'Guardando'
                      : 'Creando'
                    : isEdit
                      ? 'Guardar cambios'
                      : 'Crear cliente'}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
