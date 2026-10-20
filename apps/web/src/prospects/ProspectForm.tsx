import { useEffect, useMemo, useState, type FormEvent } from 'react';
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
  TextArea,
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
import { Select } from '../components/Select';
import { CustomerAutocomplete } from '../customers/CustomerAutocomplete';
import { fetchActiveAgreements, prospectsApi, type ProspectRecord } from './api';
import { messageFrom, prospectSourceMeta, prospectStatusFilterOptions } from './presentation';

export type ProspectFormValue = {
  personType: 'PERSON' | 'COMPANY' | '';
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
  notes: string;
};

type FormValue = ProspectFormValue;

const emptyValue: FormValue = {
  personType: '',
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
  notes: '',
};

function initialValue(prospect: ProspectRecord | null): FormValue {
  if (!prospect) return { ...emptyValue };
  return {
    personType: prospect.personType ?? '',
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
    notes: prospect.notes ?? '',
  };
}

export function ProspectForm({
  isOpen,
  prospect,
  isSubmitting,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  prospect: ProspectRecord | null;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (value: FormValue, tagIds: number[]) => Promise<void>;
}) {
  const [value, setValue] = useState<FormValue>(() => initialValue(prospect));
  const [tagIds, setTagIds] = useState<number[]>(() => prospect?.tags.map((tag) => tag.id) ?? []);
  const [error, setError] = useState('');
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

  useEffect(() => {
    if (!isOpen) return;
    setValue(initialValue(prospect));
    setTagIds(prospect?.tags.map((tag) => tag.id) ?? []);
    setError('');
  }, [isOpen, prospect]);

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
      notes: value.notes,
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
                  : 'Basta con un dato: nombre, empresa, documento, correo o teléfono.'}
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
                      value={value.personType || 'UNKNOWN'}
                      onChange={(selected) =>
                        setValue((current) => ({
                          ...current,
                          personType:
                            selected === 'UNKNOWN' ? '' : (selected as 'PERSON' | 'COMPANY'),
                        }))
                      }
                    >
                      <Radio className="customer-person-type-option" value="UNKNOWN">
                        <Radio.Content>
                          <Radio.Control>
                            <Radio.Indicator />
                          </Radio.Control>
                          <div className="customer-person-type-copy">
                            <span>Sin definir</span>
                            <Description>Se elige al convertir</Description>
                          </div>
                        </Radio.Content>
                      </Radio>
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
                  <TextField>
                    <Label>Nombres</Label>
                    <Input
                      variant="secondary"
                      placeholder="Ana"
                      value={value.firstName}
                      onChange={text('firstName')}
                    />
                  </TextField>
                  <TextField>
                    <Label>Apellidos</Label>
                    <Input
                      variant="secondary"
                      placeholder="Pérez"
                      value={value.lastName}
                      onChange={text('lastName')}
                    />
                  </TextField>
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
                  <CustomerAutocomplete
                    ariaLabel="Tipo de documento"
                    label="Tipo de documento"
                    placeholder="Seleccionar"
                    value={value.documentType}
                    options={customerDocumentTypes.map((option) => ({
                      id: option.value,
                      name: option.label,
                    }))}
                    onChange={(documentType) =>
                      setValue((current) => ({ ...current, documentType }))
                    }
                  />
                  <TextField>
                    <Label>Número de documento</Label>
                    <Input
                      variant="secondary"
                      placeholder="900123456"
                      value={value.documentNumber}
                      onChange={text('documentNumber')}
                    />
                  </TextField>
                  <TextField>
                    <Label>DV</Label>
                    <Input
                      variant="secondary"
                      placeholder="7"
                      maxLength={1}
                      value={value.checkDigit}
                      onChange={text('checkDigit')}
                    />
                  </TextField>
                </div>
              </section>

              <section className="customer-form-section">
                <h3>Contacto</h3>
                <div className="customer-form-grid">
                  <TextField>
                    <Label>Correo</Label>
                    <Input
                      type="email"
                      variant="secondary"
                      placeholder="ana@empresa.com"
                      value={value.email}
                      onChange={text('email')}
                    />
                  </TextField>
                  <TextField>
                    <Label>Teléfono</Label>
                    <Input
                      variant="secondary"
                      placeholder="+57 300 1234567"
                      value={value.phone}
                      onChange={text('phone')}
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
                    options={countries.map((option) => ({ id: option.code, name: option.name }))}
                    onChange={(country) =>
                      // Cambiar de país invalida la ubicación completa.
                      setValue((current) => ({
                        ...current,
                        country,
                        region: '',
                        cityCode: '',
                        cityName: '',
                      }))
                    }
                  />
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
                              <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
                                {option.label}
                                <ListBox.ItemIndicator />
                              </ListBox.Item>
                            ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>
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
                      onChange={(selected) =>
                        setValue((current) => ({
                          ...current,
                          assignedUserId: String(selected) === 'unassigned' ? '' : String(selected),
                        }))
                      }
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
                  <div className="customer-field customer-field-full">
                    <Label>Etiquetas</Label>
                    {(tagsQuery.data ?? []).length === 0 ? (
                      <span className="prospect-tags-empty">No hay etiquetas en el catálogo.</span>
                    ) : (
                      <TagGroup
                        aria-label="Etiquetas del prospecto"
                        className="prospect-tag-selector"
                        selectionMode="multiple"
                        selectedKeys={new Set(tagIds.map(String))}
                        onSelectionChange={(keys) =>
                          setTagIds(
                            [...keys]
                              .map((key) => Number(key))
                              .filter((id) => Number.isInteger(id)),
                          )
                        }
                      >
                        <TagGroup.List>
                          {(tagsQuery.data ?? []).map((tag) => (
                            <Tag key={tag.id} id={String(tag.id)} textValue={tag.name}>
                              {tag.name}
                            </Tag>
                          ))}
                        </TagGroup.List>
                      </TagGroup>
                    )}
                  </div>
                </div>
              </section>

              <section className="customer-form-section">
                <h3>Información adicional</h3>
                <TextField className="customer-field-full">
                  <Label>Notas</Label>
                  <TextArea
                    aria-label="Notas del prospecto"
                    variant="secondary"
                    rows={3}
                    placeholder="Contexto de la conversación, intereses, próximos pasos…"
                    value={value.notes}
                    onChange={text('notes')}
                  />
                </TextField>
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
