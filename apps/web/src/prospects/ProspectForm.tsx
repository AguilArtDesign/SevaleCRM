import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Description,
  Label,
  ListBox,
  Modal,
  Radio,
  RadioGroup,
  Tag,
  TagGroup,
  TextField,
} from '@heroui/react';
import { FloppyDisk, Xmark } from '@gravity-ui/icons';
import {
  getCustomerColombiaCities,
  getCustomerColombiaStates,
  getCustomerCountries,
  getCustomerWooStates,
} from '@sevale/shared';
import {
  createProspectSchema,
  customerDocumentTypes,
  type ProspectSourceInput,
  type ProspectStatusInput,
} from '@sevale/validation';
import { Input } from '../components/Input';
import { PhoneInput } from '../components/PhoneInput';
import { Select } from '../components/Select';
import { CustomerAutocomplete } from '../customers/CustomerAutocomplete';
import { fetchActiveAgreements, prospectsApi, type ProspectRecord } from './api';
import { messageFrom, prospectSourceMeta, prospectStatusFilterOptions } from './presentation';
import { TagColorDot } from './TagChip';

export type ProspectFormValue = {
  personType: 'PERSON' | 'COMPANY';
  firstName: string;
  lastName: string;
  company: string;
  documentType: string;
  documentNumber: string;
  checkDigit: string;
  email: string;
  phone: string;
  country: string;
  region: string;
  cityCode: string;
  cityName: string;
  postalCode: string;
  addressLine1: string;
  addressLine2: string;
  agreementId: string;
  source: ProspectSourceInput;
  status: ProspectStatusInput;
  assignedUserId: string;
};

type FormValue = ProspectFormValue;

const emptyValue: FormValue = {
  // Todo prospecto nace como persona; si el comercial descubre que es una empresa, lo cambia al
  // editar la ficha.
  personType: 'PERSON',
  firstName: '',
  lastName: '',
  company: '',
  documentType: '',
  documentNumber: '',
  checkDigit: '',
  email: '',
  phone: '',
  country: '',
  region: '',
  cityCode: '',
  cityName: '',
  postalCode: '',
  addressLine1: '',
  addressLine2: '',
  agreementId: '',
  source: 'MANUAL',
  status: 'NEW',
  assignedUserId: '',
};

function initialValue(prospect: ProspectRecord | null, defaultAssignedUserId?: string): FormValue {
  // Al crear, el prospecto nace asignado a quien lo registra; el selector permite cambiarlo.
  if (!prospect) return { ...emptyValue, assignedUserId: defaultAssignedUserId ?? '' };
  return {
    personType: prospect.personType ?? 'PERSON',
    firstName: prospect.firstName ?? '',
    lastName: prospect.lastName ?? '',
    company: prospect.company ?? '',
    documentType: prospect.documentType ?? '',
    documentNumber: prospect.documentNumber ?? '',
    checkDigit: prospect.checkDigit ?? '',
    email: prospect.email ?? '',
    phone: prospect.phone ?? '',
    country: prospect.country ?? '',
    region: prospect.region ?? '',
    cityCode: prospect.cityCode ?? '',
    cityName: prospect.cityName ?? '',
    postalCode: prospect.postalCode ?? '',
    addressLine1: prospect.addressLine1 ?? '',
    addressLine2: prospect.addressLine2 ?? '',
    agreementId: prospect.agreement ? String(prospect.agreement.id) : '',
    source: prospect.source,
    status: prospect.status,
    assignedUserId: prospect.assignedUser?.id ?? '',
  };
}

export function ProspectForm({
  isOpen,
  prospect,
  isSubmitting,
  defaultAssignedUserId,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  prospect: ProspectRecord | null;
  isSubmitting: boolean;
  /** Comercial que queda asignado al crear: por defecto, quien registra el prospecto. */
  defaultAssignedUserId?: string;
  onClose: () => void;
  onSubmit: (value: FormValue, tagIds: number[]) => Promise<void>;
}) {
  const [value, setValue] = useState<FormValue>(() =>
    initialValue(prospect, defaultAssignedUserId),
  );
  const [tagIds, setTagIds] = useState<number[]>(() => prospect?.tags.map((tag) => tag.id) ?? []);
  const [error, setError] = useState('');
  // `Select` y `TagGroup` trabajan con claves de texto; las etiquetas viajan como ids numéricos.
  const tagKeys = useMemo(() => tagIds.map(String), [tagIds]);
  const toTagIds = (keys: 'all' | Iterable<unknown>) =>
    [...(keys === 'all' ? [] : keys)]
      .map((key) => Number(key))
      .filter((id) => Number.isInteger(id));
  // Si el comercial ya eligió a mano, el valor por defecto no debe pisar su elección cuando el
  // usuario actual termina de cargar.
  const [assigneeTouched, setAssigneeTouched] = useState(false);
  const isEdit = prospect !== null;

  const countries = useMemo(() => getCustomerCountries(), []);
  const isColombia = value.country === 'CO';
  const states = useMemo(
    () =>
      value.country === 'CO'
        ? getCustomerColombiaStates()
        : getCustomerWooStates(value.country || 'NONE'),
    [value.country],
  );
  const hasPredefinedStates = states.length > 0;
  const cities = useMemo(
    () => (isColombia ? getCustomerColombiaCities(value.region) : []),
    [isColombia, value.region],
  );

  const tagsQuery = useQuery({
    queryKey: ['tags'],
    queryFn: () => prospectsApi.tags(),
    enabled: isOpen,
  });
  const assigneesQuery = useQuery({
    queryKey: ['prospect-assignees'],
    queryFn: () => prospectsApi.assignees(),
    enabled: isOpen,
  });
  const agreementsQuery = useQuery({
    queryKey: ['agreements', 'active-options'],
    queryFn: fetchActiveAgreements,
    enabled: isOpen,
  });

  // El trigger del multi-select muestra como máximo dos etiquetas y cuenta el resto: con diez
  // seleccionadas el control crecería a varias líneas y deformaría el formulario.
  const tagLabel = useMemo(() => {
    const names = tagIds
      .map((id) => (tagsQuery.data ?? []).find((tag) => tag.id === id)?.name)
      .filter((name): name is string => Boolean(name));
    if (names.length === 0) return null;
    const visible = names.slice(0, 2);
    const rest = names.length - visible.length;
    return rest > 0 ? `${visible.join(' y ')}, +${rest}` : visible.join(' y ');
  }, [tagIds, tagsQuery.data]);

  useEffect(() => {
    if (!isOpen) return;
    setValue(initialValue(prospect, defaultAssignedUserId));
    setTagIds(prospect?.tags.map((tag) => tag.id) ?? []);
    setAssigneeTouched(false);
    setError('');
  }, [isOpen, prospect, defaultAssignedUserId]);

  // El usuario actual llega de forma asíncrona: cuando aparece, se aplica como comercial por
  // defecto si el formulario está creando y nadie ha tocado todavía el selector.
  useEffect(() => {
    if (isEdit || assigneeTouched || !defaultAssignedUserId) return;
    setValue((current) =>
      current.assignedUserId ? current : { ...current, assignedUserId: defaultAssignedUserId },
    );
  }, [isEdit, assigneeTouched, defaultAssignedUserId]);

  // El convenio ya vinculado puede estar inactivo: se conserva en el selector para no perderlo.
  const agreementOptions = useMemo(() => {
    const options = (agreementsQuery.data ?? []).map((agreement) => ({
      id: String(agreement.id),
      name: agreement.companyName,
    }));
    if (
      prospect?.agreement &&
      !options.some((option) => option.id === String(prospect.agreement!.id))
    ) {
      options.unshift({
        id: String(prospect.agreement.id),
        name: `${prospect.agreement.companyName} (inactivo)`,
      });
    }
    return options;
  }, [agreementsQuery.data, prospect]);

  const text =
    (key: keyof FormValue) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setValue((current) => ({ ...current, [key]: event.target.value }));
    };

  // Campos que comparten la creación compacta y la edición completa: se definen una sola vez para
  // que las dos vistas no se desincronicen.
  const firstNameField = (
    <TextField>
      <Label>Nombres</Label>
      <Input
        variant="secondary"
        placeholder="Ana"
        value={value.firstName}
        onChange={text('firstName')}
      />
    </TextField>
  );
  const lastNameField = (
    <TextField>
      <Label>Apellidos</Label>
      <Input
        variant="secondary"
        placeholder="Pérez"
        value={value.lastName}
        onChange={text('lastName')}
      />
    </TextField>
  );
  const documentTypeField = (
    <CustomerAutocomplete
      ariaLabel="Tipo de documento"
      label="Tipo de documento"
      placeholder="Seleccionar"
      value={value.documentType}
      options={customerDocumentTypes.map((option) => ({ id: option.value, name: option.label }))}
      onChange={(documentType) => setValue((current) => ({ ...current, documentType }))}
    />
  );
  const documentNumberField = (
    <TextField>
      <Label>Número de documento</Label>
      <Input
        variant="secondary"
        placeholder="900123456"
        value={value.documentNumber}
        onChange={text('documentNumber')}
      />
    </TextField>
  );
  const emailField = (className?: string) => (
    <div className={className ? `customer-field ${className}` : undefined}>
      <Label>Correo</Label>
      <Input
        type="email"
        variant="secondary"
        placeholder="ana@empresa.com"
        value={value.email}
        onChange={text('email')}
      />
    </div>
  );
  // El teléfono usa el mismo componente que Clientes: intl-tel-input con el país del prospecto como
  // prefijo, y normalización a E.164 al escribir.
  const phoneField = (
    <div className="customer-field">
      <Label>Teléfono</Label>
      <PhoneInput
        country={value.country || 'CO'}
        value={value.phone}
        onChange={(phone) => setValue((current) => ({ ...current, phone }))}
      />
    </div>
  );
  const countryField = (
    <CustomerAutocomplete
      ariaLabel="País"
      label="País"
      placeholder="Seleccionar"
      value={value.country}
      options={countries.map((option) => ({ id: option.code, name: option.name }))}
      onChange={(country) =>
        // Cambiar de país invalida la ubicación completa.
        setValue((current) => ({ ...current, country, region: '', cityCode: '', cityName: '' }))
      }
    />
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const parsed = createProspectSchema.safeParse({
      personType: value.personType,
      firstName: value.firstName,
      lastName: value.lastName,
      company: value.company,
      documentType: value.documentType,
      documentNumber: value.documentNumber,
      checkDigit: value.checkDigit,
      email: value.email,
      phone: value.phone,
      country: value.country,
      region: value.region,
      cityCode: value.cityCode,
      cityName: value.cityName,
      postalCode: value.postalCode,
      addressLine1: value.addressLine1,
      addressLine2: value.addressLine2,
      agreementId: value.agreementId,
      source: value.source,
      status: value.status,
      assignedUserId: value.assignedUserId,
      tagIds,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisa los datos del prospecto.');
      return;
    }
    try {
      await onSubmit(value, tagIds);
    } catch (submitError) {
      setError(messageFrom(submitError));
    }
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={(open) => !open && !isSubmitting && onClose()}>
      <Modal.Container size="lg" placement="center" scroll="inside">
        <Modal.Dialog className="customer-form-modal prospect-form-modal">
          <Modal.CloseTrigger aria-label="Cerrar formulario">
            <Xmark width={16} height={16} />
          </Modal.CloseTrigger>
          <Modal.Header>
            <div>
              <Modal.Heading>{isEdit ? 'Editar prospecto' : 'Crear prospecto'}</Modal.Heading>
              <p>
                {isEdit
                  ? 'Actualiza la información comercial del prospecto.'
                  : 'Registra los datos clave; el resto de la ficha se completa al editarlo.'}
              </p>
            </div>
          </Modal.Header>
          <form onSubmit={(event) => void submit(event)} noValidate>
            <Modal.Body className="customer-form-body">
              {error && (
                <Alert status="danger">
                  <Alert.Content>
                    <Alert.Description>{error}</Alert.Description>
                  </Alert.Content>
                </Alert>
              )}

              {/* La creación pide solo lo esencial para registrar el contacto; el resto de la
                  ficha se completa al editarlo. */}
              {!isEdit && (
                <section className="customer-form-section">
                  <h3>Datos del prospecto</h3>
                  <div className="customer-form-grid">
                    {firstNameField}
                    {lastNameField}
                    {documentTypeField}
                    {documentNumberField}
                    {countryField}
                    {phoneField}
                    {emailField('customer-field-full')}
                  </div>
                </section>
              )}

              {isEdit && (
                <>
                  <section className="customer-form-section">
                    <h3>Datos principales</h3>
                    <div className="customer-form-grid">
                      <div className="customer-field customer-field-full">
                        <Label>Tipo de persona</Label>
                        <RadioGroup
                          aria-label="Tipo de persona"
                          className="customer-person-type-options"
                          name="prospect-person-type"
                          orientation="horizontal"
                          value={value.personType || 'PERSON'}
                          onChange={(selected) =>
                            setValue((current) => ({
                              ...current,
                              personType: selected as 'PERSON' | 'COMPANY',
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
                      {firstNameField}
                      {lastNameField}
                      <TextField className="customer-field-full">
                        <Label>Empresa</Label>
                        <Input
                          variant="secondary"
                          placeholder="Comercializadora ABC SAS"
                          value={value.company}
                          onChange={text('company')}
                        />
                      </TextField>
                    </div>
                  </section>

                  <section className="customer-form-section">
                    <h3>Identificación</h3>
                    <div className="customer-form-grid">
                      {documentTypeField}
                      {documentNumberField}
                    </div>
                  </section>

                  <section className="customer-form-section">
                    <h3>Contacto</h3>
                    <div className="customer-form-grid">
                      {emailField()}
                      {phoneField}
                    </div>
                  </section>

                  <section className="customer-form-section">
                    <h3>Ubicación</h3>
                    <div className="customer-form-grid">
                      {countryField}
                      {isColombia || hasPredefinedStates ? (
                        <CustomerAutocomplete
                          key={`prospect-region:${value.country}`}
                          ariaLabel={isColombia ? 'Departamento' : 'Región o provincia'}
                          label={isColombia ? 'Departamento' : 'Región / Provincia'}
                          placeholder="Seleccionar"
                          value={value.region}
                          options={states.map((option) => ({ id: option.code, name: option.name }))}
                          isDisabled={!value.country}
                          onChange={(region) =>
                            setValue((current) => ({
                              ...current,
                              region,
                              cityCode: '',
                              cityName: '',
                            }))
                          }
                        />
                      ) : (
                        <TextField>
                          <Label>Región / Provincia</Label>
                          <Input
                            variant="secondary"
                            placeholder="Escribe la región o provincia"
                            disabled={!value.country}
                            value={value.region}
                            onChange={text('region')}
                          />
                        </TextField>
                      )}
                      {isColombia ? (
                        <CustomerAutocomplete
                          key={`prospect-city:${value.country}:${value.region}`}
                          ariaLabel="Ciudad o municipio"
                          label="Ciudad / Municipio"
                          placeholder="Seleccionar"
                          value={value.cityCode}
                          options={cities.map((option) => ({ id: option.code, name: option.name }))}
                          isDisabled={!value.region}
                          onChange={(cityCode) =>
                            setValue((current) => ({ ...current, cityCode, cityName: '' }))
                          }
                        />
                      ) : (
                        <TextField>
                          <Label>Ciudad</Label>
                          <Input
                            variant="secondary"
                            placeholder="Escribe la ciudad"
                            disabled={!value.country}
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
                      <TextField
                        className="customer-field-full"
                        aria-label="Complemento de la dirección"
                      >
                        <Input
                          variant="secondary"
                          aria-label="Complemento de la dirección"
                          placeholder="Barrio, urbanización, apartamento, habitación, etc."
                          value={value.addressLine2}
                          onChange={text('addressLine2')}
                        />
                      </TextField>
                    </div>
                  </section>
                </>
              )}

              <section className="customer-form-section">
                <h3>Clasificación comercial</h3>
                <div className="customer-form-grid">
                  <CustomerAutocomplete
                    ariaLabel="Convenio"
                    label="Convenio"
                    placeholder="Sin convenio"
                    value={value.agreementId}
                    options={agreementOptions}
                    onChange={(agreementId) => setValue((current) => ({ ...current, agreementId }))}
                  />
                  {/* Al crear, el estado no se pregunta: todo prospecto nace «Nuevo» y el backend lo
                      aplica por defecto. En su lugar se eligen las etiquetas, con selección
                      múltiple, que es la clasificación que sí se decide al registrar. */}
                  {!isEdit ? (
                    <div className="customer-field">
                      <Label>Etiquetas</Label>
                      {(tagsQuery.data ?? []).length === 0 ? (
                        <span className="prospect-tags-empty">
                          No hay etiquetas en el catálogo.
                        </span>
                      ) : (
                        <Select
                          aria-label="Etiquetas del prospecto"
                          variant="secondary"
                          selectionMode="multiple"
                          placeholder="Sin etiquetas"
                          value={tagKeys}
                          onChange={(keys) => setTagIds(toTagIds(keys))}
                        >
                          <Select.Trigger>
                            <Select.Value className="prospect-tags-value">{tagLabel}</Select.Value>
                            <Select.Indicator />
                          </Select.Trigger>
                          <Select.Popover>
                            <ListBox selectionMode="multiple">
                              {(tagsQuery.data ?? []).map((tag) => (
                                <ListBox.Item key={tag.id} id={String(tag.id)} textValue={tag.name}>
                                  <span className="prospect-tag-option">
                                    <TagColorDot color={tag.color} />
                                    {tag.name}
                                  </span>
                                  <ListBox.ItemIndicator />
                                </ListBox.Item>
                              ))}
                            </ListBox>
                          </Select.Popover>
                        </Select>
                      )}
                    </div>
                  ) : (
                    <div className="customer-field">
                      <Label>Estado</Label>
                      <Select
                        aria-label="Estado del prospecto"
                        variant="secondary"
                        value={value.status}
                        onChange={(status) =>
                          setValue((current) => ({
                            ...current,
                            status: String(status) as ProspectStatusInput,
                          }))
                        }
                      >
                        <Select.Trigger>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            {prospectStatusFilterOptions
                              .filter((option) => option.id !== 'all' && option.id !== 'CONVERTED')
                              .map((option) => (
                                <ListBox.Item
                                  key={option.id}
                                  id={option.id}
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
                  )}
                  <div className="customer-field">
                    <Label>Origen</Label>
                    <Select
                      aria-label="Origen del prospecto"
                      variant="secondary"
                      value={value.source}
                      onChange={(source) =>
                        setValue((current) => ({
                          ...current,
                          source: String(source) as ProspectSourceInput,
                        }))
                      }
                    >
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {Object.entries(prospectSourceMeta).map(([key, label]) => (
                            <ListBox.Item key={key} id={key} textValue={label}>
                              {label}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>
                  <div className="customer-field">
                    <Label>Comercial asignado</Label>
                    <Select
                      aria-label="Comercial asignado"
                      variant="secondary"
                      isDisabled={assigneesQuery.isPending}
                      value={value.assignedUserId || 'unassigned'}
                      onChange={(selected) => {
                        setAssigneeTouched(true);
                        setValue((current) => ({
                          ...current,
                          assignedUserId: String(selected) === 'unassigned' ? '' : String(selected),
                        }));
                      }}
                    >
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          <ListBox.Item id="unassigned" textValue="Sin asignar">
                            Sin asignar
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                          {(assigneesQuery.data ?? []).map((user) => (
                            <ListBox.Item key={user.id} id={user.id} textValue={user.name}>
                              {user.name}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>
                  {/* En edición se conserva el selector de etiquetas como etiquetas visibles, para
                      ver de un vistazo cuáles tiene el prospecto. */}
                  {isEdit && (
                    <div className="customer-field customer-field-full">
                      <Label>Etiquetas</Label>
                      {(tagsQuery.data ?? []).length === 0 ? (
                        <span className="prospect-tags-empty">
                          No hay etiquetas en el catálogo.
                        </span>
                      ) : (
                        <TagGroup
                          aria-label="Etiquetas del prospecto"
                          className="prospect-tag-selector"
                          selectionMode="multiple"
                          selectedKeys={new Set(tagKeys)}
                          onSelectionChange={(keys) => setTagIds(toTagIds(keys))}
                        >
                          <TagGroup.List>
                            {(tagsQuery.data ?? []).map((tag) => (
                              <Tag
                                key={tag.id}
                                id={String(tag.id)}
                                textValue={tag.name}
                                className="prospect-tag-choice"
                                style={
                                  { '--tag-color': tag.color ?? 'transparent' } as CSSProperties
                                }
                              >
                                <span className="prospect-tag-option">
                                  <TagColorDot color={tag.color} />
                                  {tag.name}
                                </span>
                              </Tag>
                            ))}
                          </TagGroup.List>
                        </TagGroup>
                      )}
                    </div>
                  )}
                </div>
              </section>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" isDisabled={isSubmitting} onPress={onClose}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" isPending={isSubmitting}>
                <FloppyDisk width={15} height={15} />
                {isEdit ? 'Guardar cambios' : 'Crear prospecto'}
              </Button>
            </Modal.Footer>
          </form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
