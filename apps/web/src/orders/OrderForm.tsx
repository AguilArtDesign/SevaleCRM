import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Avatar,
  Button,
  Label,
  ListBox,
  Modal,
  Radio,
  RadioGroup,
  SearchField,
  Skeleton,
  Spinner,
  Switch,
  TextField,
} from '@heroui/react';
import {
  ArrowRotateRight,
  FloppyDisk,
  Minus,
  Pencil,
  Plus,
  ShoppingCart,
  TrashBin,
} from '@gravity-ui/icons';
import {
  countryFlagPath,
  paymentMethods,
  resolveCity,
  resolveCountry,
  resolvePaymentMethod,
  resolveShippingMethod,
  resolveState,
  shippingMethods,
  splitShippingCents,
  toShippingCents,
} from '@sevale/shared';
import type { CreateOrderOperationInput } from '@sevale/validation';
import { Input } from '../components/Input';
import { Chip } from '../components/Chip';
import { Select } from '../components/Select';
import { couponsApi, type CouponRecord } from '../coupons/api';
import { customersApi, type CustomerRecord } from '../customers/api';
import {
  customerAvatarClass,
  customerDisplayName,
  customerInitials,
} from '../customers/presentation';
import { inventoryApi, type ProductRecord, type ProductStore } from '../inventory/api';
import type { OrderCustomerRecord, OrderDetailRecord } from './api';

type AddressValue = {
  firstName: string;
  lastName: string;
  company: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  phone: string;
};

type BillingValue = AddressValue & { email: string };

type FormItem = {
  product: ProductRecord;
  quantity: string;
  originalPrice: string;
  unitPrice: string;
  discountTotal: string;
};

const emptyAddress: AddressValue = {
  firstName: '',
  lastName: '',
  company: '',
  address1: '',
  address2: '',
  city: '',
  state: '',
  postcode: '',
  country: 'CO',
  phone: '',
};

function nullable(value: string): string | null {
  return value.trim() || null;
}

function money(value: string | number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fixed(value: number): string {
  return Math.max(0, value).toFixed(2);
}

function productPrice(product: ProductRecord, currency: 'COP' | 'USD'): string {
  return fixed(currency === 'COP' ? product.wooPriceCop : product.wooPriceUsd);
}

function formattedProductPrice(value: string | number, currency: 'COP' | 'USD'): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 0,
    maximumFractionDigits: currency === 'COP' ? 0 : 2,
  }).format(money(value));
}

type SelectableCustomer = CustomerRecord | OrderCustomerRecord;

function addressFromCustomer(customer: SelectableCustomer): BillingValue {
  const cityName =
    'location' in customer
      ? customer.location.cityName
      : customer.country && customer.region && customer.cityCode
        ? (resolveCity(customer.country, customer.region, customer.cityCode) ?? customer.cityCode)
        : null;
  return {
    firstName: customer.firstName ?? '',
    lastName: customer.lastName ?? '',
    company: customer.company ?? '',
    address1: customer.addressLine1 ?? '',
    address2: customer.addressLine2 ?? '',
    city: cityName ?? '',
    state: customer.region ?? '',
    postcode: customer.postalCode ?? '',
    country: customer.country ?? 'CO',
    email: customer.email ?? '',
    phone: customer.phone ?? '',
  };
}

function isBillingComplete(value: BillingValue): boolean {
  const hasRecipient =
    Boolean(value.company.trim()) || Boolean(value.firstName.trim() && value.lastName.trim());
  return (
    hasRecipient &&
    [
      value.address1,
      value.city,
      value.state,
      value.postcode,
      value.country,
      value.email,
      value.phone,
    ].every((field) => Boolean(field.trim()))
  );
}

function BillingSummary({ value, onEdit }: { value: BillingValue; onEdit: () => void }) {
  const recipient =
    [value.firstName, value.lastName].filter(Boolean).join(' ').trim() || value.company;
  const region = resolveState(value.country, value.state)?.name ?? value.state;
  const country = resolveCountry(value.country)?.name ?? value.country;
  return (
    <div className="order-billing-summary">
      <div className="order-billing-summary-copy">
        <strong>{recipient}</strong>
        {value.company && value.company !== recipient && <span>{value.company}</span>}
        <span>{value.address1}</span>
        {value.address2 && <span>{value.address2}</span>}
        <span>{[value.city, region].filter(Boolean).join(', ')}</span>
        <span>{value.postcode}</span>
        <span className="order-billing-country">
          <img src={countryFlagPath(value.country)} alt="" aria-hidden="true" />
          {country}
        </span>
        <span>{value.email}</span>
        <span>{value.phone}</span>
      </div>
      <Button
        className="order-edit-billing"
        size="sm"
        variant="tertiary"
        isIconOnly
        aria-label="Editar datos de facturación"
        onPress={onEdit}
      >
        <Pencil width={15} height={15} />
      </Button>
    </div>
  );
}

function billingFromOrder(order: OrderDetailRecord): BillingValue {
  return {
    firstName: order.billingFirstName ?? '',
    lastName: order.billingLastName ?? '',
    company: order.billingCompany ?? '',
    address1: order.billingAddress1 ?? '',
    address2: order.billingAddress2 ?? '',
    city: order.billingCity ?? '',
    state: order.billingState ?? '',
    postcode: order.billingPostcode ?? '',
    country: order.billingCountry ?? '',
    email: order.billingEmail ?? '',
    phone: order.billingPhone ?? '',
  };
}

function shippingFromOrder(order: OrderDetailRecord): AddressValue {
  return {
    firstName: order.shippingFirstName ?? '',
    lastName: order.shippingLastName ?? '',
    company: order.shippingCompany ?? '',
    address1: order.shippingAddress1 ?? '',
    address2: order.shippingAddress2 ?? '',
    city: order.shippingCity ?? '',
    state: order.shippingState ?? '',
    postcode: order.shippingPostcode ?? '',
    country: order.shippingCountry ?? '',
    phone: order.shippingPhone ?? '',
  };
}

function withoutEmail(billing: BillingValue): AddressValue {
  return {
    firstName: billing.firstName,
    lastName: billing.lastName,
    company: billing.company,
    address1: billing.address1,
    address2: billing.address2,
    city: billing.city,
    state: billing.state,
    postcode: billing.postcode,
    country: billing.country,
    phone: billing.phone,
  };
}

function AddressFields({
  value,
  onChange,
  includeEmail = false,
}: {
  value: AddressValue | BillingValue;
  onChange: (value: AddressValue | BillingValue) => void;
  includeEmail?: boolean;
}) {
  const field = (key: keyof BillingValue) => (event: ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [key]: event.target.value });
  return (
    <div className="order-address-grid">
      <TextField>
        <Label>Nombres</Label>
        <Input variant="secondary" value={value.firstName} onChange={field('firstName')} />
      </TextField>
      <TextField>
        <Label>Apellidos</Label>
        <Input variant="secondary" value={value.lastName} onChange={field('lastName')} />
      </TextField>
      <TextField className="order-field-span-2">
        <Label>Empresa</Label>
        <Input variant="secondary" value={value.company} onChange={field('company')} />
      </TextField>
      <TextField className="order-field-span-2">
        <Label>Dirección</Label>
        <Input variant="secondary" value={value.address1} onChange={field('address1')} />
      </TextField>
      <TextField className="order-field-span-2">
        <Label>Complemento</Label>
        <Input variant="secondary" value={value.address2} onChange={field('address2')} />
      </TextField>
      <TextField>
        <Label>Ciudad</Label>
        <Input variant="secondary" value={value.city} onChange={field('city')} />
      </TextField>
      <TextField>
        <Label>Departamento / región</Label>
        <Input variant="secondary" value={value.state} onChange={field('state')} />
      </TextField>
      <TextField>
        <Label>Código postal</Label>
        <Input variant="secondary" value={value.postcode} onChange={field('postcode')} />
      </TextField>
      <TextField>
        <Label>País</Label>
        <Input
          variant="secondary"
          maxLength={2}
          value={value.country}
          onChange={field('country')}
        />
      </TextField>
      {includeEmail && (
        <TextField type="email">
          <Label>Correo electrónico</Label>
          <Input
            variant="secondary"
            value={'email' in value ? value.email : ''}
            onChange={field('email')}
          />
        </TextField>
      )}
      <TextField>
        <Label>Teléfono</Label>
        <Input variant="secondary" value={value.phone} onChange={field('phone')} />
      </TextField>
    </div>
  );
}

function CustomerSearch({
  selected,
  onSelect,
  onChange,
}: {
  selected: SelectableCustomer | null;
  onSelect: (customer: CustomerRecord) => void;
  onChange: () => void;
}) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);
  const query = useQuery({
    queryKey: ['orders', 'customer-search', debounced],
    enabled: !selected && Boolean(debounced),
    queryFn: () =>
      customersApi.list({
        search: debounced,
        country: '',
        page: 1,
        pageSize: 8,
        sort: 'createdAt',
        order: 'desc',
      }),
  });
  const isLoadingResults = search.trim() !== debounced || query.isFetching;
  if (selected) {
    return (
      <div className="order-selected-customer">
        <Avatar size="sm" className={customerAvatarClass(selected.id)}>
          <Avatar.Fallback>{customerInitials(selected)}</Avatar.Fallback>
        </Avatar>
        <div className="order-selected-customer-copy">
          <strong>{customerDisplayName(selected)}</strong>
          <span>{selected.email || 'Sin correo'}</span>
        </div>
        <Button
          className="order-change-customer"
          size="sm"
          variant="tertiary"
          isIconOnly
          aria-label="Cambiar cliente"
          onPress={onChange}
        >
          <ArrowRotateRight width={15} height={15} />
        </Button>
      </div>
    );
  }
  return (
    <div className="order-search-control">
      <SearchField
        value={search}
        onChange={setSearch}
        aria-label="Buscar cliente local"
        variant="secondary"
        fullWidth
      >
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input placeholder="Buscar por nombre, documento o correo" />
          <SearchField.ClearButton />
        </SearchField.Group>
      </SearchField>
      {search && (
        <div className="order-search-results order-customer-results" aria-busy={isLoadingResults}>
          <div className="order-search-results-scroll">
            {isLoadingResults && (
              <div className="order-customer-results-skeleton" aria-label="Buscando clientes">
                {Array.from({ length: 4 }, (_, index) => (
                  <div className="order-customer-result-skeleton" key={index}>
                    <Skeleton className="order-customer-skeleton-avatar" />
                    <div>
                      <Skeleton className="order-customer-skeleton-name" />
                      <Skeleton className="order-customer-skeleton-email" />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!isLoadingResults && query.data?.data.length === 0 && (
              <span>No encontramos clientes.</span>
            )}
            {!isLoadingResults &&
              query.data?.data.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  className="order-customer-result"
                  onClick={() => {
                    onSelect(customer);
                    setSearch('');
                  }}
                >
                  <Avatar size="sm" className={customerAvatarClass(customer.id)}>
                    <Avatar.Fallback>{customerInitials(customer)}</Avatar.Fallback>
                  </Avatar>
                  <span className="order-customer-result-copy">
                    <strong>{customerDisplayName(customer)}</strong>
                    <small>{customer.email || 'Sin correo'}</small>
                  </span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProductSearch({
  items,
  currency,
  onAdd,
}: {
  items: FormItem[];
  currency: 'COP' | 'USD';
  onAdd: (product: ProductRecord) => void;
}) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);
  const query = useQuery({
    queryKey: ['orders', 'product-search', debounced],
    queryFn: () =>
      inventoryApi.list({
        search: debounced,
        store: '',
        syncStatus: '',
        stockSort: '',
        page: 1,
        pageSize: 8,
      }),
  });
  const isLoadingResults = search.trim() !== debounced || query.isFetching;
  const selectedIds = new Set(items.map(({ product }) => product.id));
  return (
    <div className="order-search-control">
      <SearchField
        value={search}
        onChange={setSearch}
        aria-label="Buscar producto local"
        variant="secondary"
        fullWidth
      >
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input placeholder="Buscar por nombre o SKU" />
          <SearchField.ClearButton />
        </SearchField.Group>
      </SearchField>
      {search && (
        <div className="order-search-results order-product-search-results">
          <div className="order-search-results-scroll">
            {isLoadingResults && <Spinner size="sm" />}
            {!isLoadingResults && query.data?.data.length === 0 && (
              <span>No encontramos productos.</span>
            )}
            {!isLoadingResults &&
              query.data?.data.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  className="order-product-result"
                  disabled={selectedIds.has(product.id)}
                  onClick={() => {
                    onAdd(product);
                    setSearch('');
                  }}
                >
                  <span className="order-product-thumbnail" aria-hidden="true">
                    {product.imageUrl ? <img src={product.imageUrl} alt="" loading="lazy" /> : '—'}
                  </span>
                  <span className="order-product-result-copy">
                    <strong>{product.productName}</strong>
                    <span className="order-product-result-details">
                      <small>{product.sku}</small>
                      <Chip
                        className={
                          product.store === 'SERATUS'
                            ? 'inventory-store-chip-seratus'
                            : 'inventory-store-chip-pali'
                        }
                      >
                        {product.store === 'SERATUS' ? 'Seratus' : 'Pali'}
                      </Chip>
                    </span>
                  </span>
                  <span className="order-product-result-meta">
                    <strong>
                      {formattedProductPrice(productPrice(product, currency), currency)}
                    </strong>
                    <small>Stock: {product.wooStock}</small>
                  </span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CouponSearch({
  selected,
  onSelect,
  onClear,
}: {
  selected: CouponRecord | null;
  onSelect: (coupon: CouponRecord) => void;
  onClear: () => void;
}) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const query = useQuery({
    queryKey: ['orders', 'coupon-search', debounced],
    enabled: !selected && Boolean(debounced),
    queryFn: () => couponsApi.list({ search: debounced, page: 1, pageSize: 8 }),
  });
  const isLoadingResults = search.trim() !== debounced || query.isFetching;

  if (selected) {
    return (
      <div className="order-selected-coupon">
        <div>
          <strong>{selected.coupon}</strong>
          <span>{selected.description || 'Sin descripción'}</span>
        </div>
        <Chip color="accent">{selected.amount}%</Chip>
        <Button
          className="order-change-coupon"
          size="sm"
          variant="tertiary"
          isIconOnly
          aria-label="Cambiar cupón"
          onPress={onClear}
        >
          <ArrowRotateRight width={15} height={15} />
        </Button>
      </div>
    );
  }

  return (
    <div className="order-search-control">
      <SearchField
        value={search}
        onChange={setSearch}
        aria-label="Buscar cupón local"
        variant="secondary"
        fullWidth
      >
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input placeholder="Buscar por cupón o descripción" />
          <SearchField.ClearButton />
        </SearchField.Group>
      </SearchField>
      {search && (
        <div className="order-search-results order-coupon-results" aria-busy={isLoadingResults}>
          <div className="order-search-results-scroll">
            {isLoadingResults && <Spinner size="sm" />}
            {!isLoadingResults && query.data?.data.length === 0 && (
              <span>No encontramos cupones activos.</span>
            )}
            {!isLoadingResults &&
              query.data?.data.map((coupon) => (
                <button
                  key={coupon.id}
                  type="button"
                  className="order-coupon-result"
                  onClick={() => {
                    onSelect(coupon);
                    setSearch('');
                  }}
                >
                  <span>
                    <strong>{coupon.coupon}</strong>
                    <small>{coupon.description || 'Sin descripción'}</small>
                  </span>
                  <strong>{coupon.amount}%</strong>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function OrderForm({
  isOpen,
  order,
  isSubmitting,
  serverError,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  order: OrderDetailRecord | null;
  isSubmitting: boolean;
  serverError: string;
  onClose: () => void;
  onSubmit: (value: CreateOrderOperationInput) => Promise<void>;
}) {
  const [customer, setCustomer] = useState<SelectableCustomer | null>(order?.customer ?? null);
  const [currency, setCurrency] = useState<'COP' | 'USD'>(order?.currency ?? 'COP');
  const [billing, setBilling] = useState<BillingValue>(() =>
    order ? billingFromOrder(order) : { ...emptyAddress, email: '' },
  );
  const [billingDraft, setBillingDraft] = useState<BillingValue>(() =>
    order ? billingFromOrder(order) : { ...emptyAddress, email: '' },
  );
  const [shipping, setShipping] = useState<AddressValue>(() =>
    order ? shippingFromOrder(order) : { ...emptyAddress },
  );
  const [isBillingVisible, setBillingVisible] = useState(() =>
    order ? !isBillingComplete(billingFromOrder(order)) : false,
  );
  const [differentShipping, setDifferentShipping] = useState(() =>
    order
      ? JSON.stringify(withoutEmail(billingFromOrder(order))) !==
        JSON.stringify(shippingFromOrder(order))
      : false,
  );
  const [items, setItems] = useState<FormItem[]>([]);
  const [editingPriceId, setEditingPriceId] = useState<number | null>(null);
  const [priceDraft, setPriceDraft] = useState('');
  const [selectedCoupon, setSelectedCoupon] = useState<CouponRecord | null>(null);
  const [paymentMethod, setPaymentMethod] = useState(order?.paymentMethod ?? '');
  const [shippingMethod, setShippingMethod] = useState(order?.shippingMethod ?? 'flat_rate');
  const [customShippingTotal, setCustomShippingTotal] = useState(
    order?.shippingMethod === 'custom' ? order.shippingTotal : '',
  );
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) setBillingVisible(order ? !isBillingComplete(billingFromOrder(order)) : false);
  }, [isOpen, order]);

  useEffect(() => {
    let active = true;
    if (!order) {
      setItems([]);
      setSelectedCoupon(null);
      setPaymentMethod('');
      setShippingMethod('flat_rate');
      setCustomShippingTotal('');
      return () => {
        active = false;
      };
    }
    const sourceItems = order.orders.flatMap((storeOrder) => storeOrder.items);
    void Promise.all(
      sourceItems.map(async (item) => {
        const product = item.productId ? await inventoryApi.detail(item.productId) : null;
        return product
          ? {
              product,
              quantity: String(item.quantity),
              originalPrice: item.originalPrice ?? productPrice(product, order.currency),
              unitPrice: item.unitPrice,
              discountTotal: item.discountTotal,
            }
          : null;
      }),
    )
      .then((loaded) => {
        if (active) setItems(loaded.filter((item): item is FormItem => item !== null));
      })
      .catch(() => {
        if (active) setError('No pudimos cargar los productos de este pedido.');
      });
    setPaymentMethod(order.paymentMethod ?? '');
    setShippingMethod(order.shippingMethod ?? '');
    setCustomShippingTotal(order.shippingMethod === 'custom' ? order.shippingTotal : '');

    const couponCode = order.couponCode ?? order.orders.flatMap(({ coupons }) => coupons)[0]?.code;
    setSelectedCoupon(null);
    if (couponCode) {
      void couponsApi
        .list({ search: couponCode, page: 1, pageSize: 8 })
        .then(({ data }) => {
          if (!active) return;
          setSelectedCoupon(
            data.find((coupon) => coupon.coupon.toLowerCase() === couponCode.toLowerCase()) ?? null,
          );
        })
        .catch(() => {
          if (active) setError('No pudimos cargar el cupón de este pedido.');
        });
    }
    return () => {
      active = false;
    };
  }, [order]);

  const activeStores = useMemo(
    () => [...new Set(items.map(({ product }) => product.store))] as ProductStore[],
    [items],
  );
  const itemsSubtotal = useMemo(
    () => items.reduce((total, item) => total + money(item.unitPrice) * money(item.quantity), 0),
    [items],
  );

  useEffect(() => {
    if (items.length === 0 || shippingMethod === 'custom') return;
    const freeShippingRule = resolveShippingMethod('free_shipping')?.rules[currency];
    const freeShippingMinimum =
      freeShippingRule && 'minimum_order_total' in freeShippingRule
        ? freeShippingRule.minimum_order_total
        : undefined;
    if (typeof freeShippingMinimum !== 'number') return;
    const automaticMethod = itemsSubtotal >= freeShippingMinimum ? 'free_shipping' : 'flat_rate';
    if (shippingMethod !== automaticMethod) setShippingMethod(automaticMethod);
  }, [currency, items.length, itemsSubtotal, shippingMethod]);

  const summary = useMemo(() => {
    const subtotal = itemsSubtotal;
    const discount = selectedCoupon
      ? activeStores.reduce((total, store) => {
          const couponEligibleSubtotal = items
            .filter(
              (item) =>
                item.product.store === store && money(item.unitPrice) >= money(item.originalPrice),
            )
            .reduce(
              (storeTotal, item) => storeTotal + money(item.unitPrice) * money(item.quantity),
              0,
            );
          return total + Math.round(couponEligibleSubtotal * selectedCoupon.amount) / 100;
        }, 0)
      : 0;
    const shippingDefinition = resolveShippingMethod(shippingMethod);
    const shippingRule = shippingDefinition?.rules[currency];
    const shippingTotal =
      shippingMethod === 'custom'
        ? money(customShippingTotal)
        : (shippingRule?.shipping_total ?? 0);
    return { subtotal, discount, shippingTotal, total: subtotal - discount + shippingTotal };
  }, [
    activeStores,
    currency,
    customShippingTotal,
    items,
    itemsSubtotal,
    selectedCoupon,
    shippingMethod,
  ]);

  // El envío de la operación se reparte entre las tiendas con el mismo criterio que guarda el CRM, así
  // el resumen de cada tienda muestra el valor que realmente va a asumir.
  const storeShippingShares = useMemo(
    () =>
      splitShippingCents(toShippingCents(summary.shippingTotal), activeStores.length).map(
        (cents) => cents / 100,
      ),
    [activeStores.length, summary.shippingTotal],
  );

  const chooseCustomer = (next: CustomerRecord) => {
    const nextBilling = addressFromCustomer(next);
    setCustomer(next);
    setBilling(nextBilling);
    setBillingDraft(nextBilling);
    setBillingVisible(!isBillingComplete(nextBilling));
    if (!differentShipping) setShipping(withoutEmail(nextBilling));
  };
  const changeCustomer = () => {
    const blankBilling = { ...emptyAddress, email: '' };
    setCustomer(null);
    setBilling(blankBilling);
    setBillingDraft(blankBilling);
    setBillingVisible(false);
    if (!differentShipping) setShipping({ ...emptyAddress });
  };
  const openBillingEditor = () => {
    setBillingDraft({ ...billing });
    setBillingVisible(true);
  };
  const cancelBillingEditor = () => {
    if (!isBillingComplete(billing)) {
      changeCustomer();
      return;
    }
    setBillingDraft({ ...billing });
    setBillingVisible(false);
  };
  const saveBillingEditor = () => {
    if (!isBillingComplete(billingDraft)) {
      setError('Completa los datos de facturación antes de continuar.');
      return;
    }
    setBilling(billingDraft);
    if (!differentShipping) setShipping(withoutEmail(billingDraft));
    setError('');
    setBillingVisible(false);
  };
  const changeCurrency = (next: 'COP' | 'USD') => {
    setCurrency(next);
    if (shippingMethod === 'custom') setCustomShippingTotal('');
    setEditingPriceId(null);
    setPriceDraft('');
    setItems((current) =>
      current.map((item) => ({
        ...item,
        originalPrice: productPrice(item.product, next),
        unitPrice: productPrice(item.product, next),
        discountTotal: '0.00',
      })),
    );
  };
  const updateItem = (id: number, patch: Partial<Omit<FormItem, 'product'>>) =>
    setItems((current) =>
      current.map((item) => (item.product.id === id ? { ...item, ...patch } : item)),
    );
  const changeItemQuantity = (item: FormItem, delta: number) => {
    const next = Math.max(1, Math.min(item.product.wooStock, money(item.quantity) + delta));
    updateItem(item.product.id, { quantity: String(next) });
  };
  const beginPriceEdit = (item: FormItem) => {
    const quantity = Math.max(1, money(item.quantity));
    const effectiveUnitPrice =
      (money(item.unitPrice) * quantity - money(item.discountTotal)) / quantity;
    const maximumUnitPrice = Math.floor(money(productPrice(item.product, currency)));
    setEditingPriceId(item.product.id);
    setPriceDraft(String(Math.min(Math.round(effectiveUnitPrice), maximumUnitPrice)));
  };
  const cancelPriceEdit = () => {
    setEditingPriceId(null);
    setPriceDraft('');
  };
  const savePriceEdit = (item: FormItem) => {
    if (!priceDraft.trim() || money(priceDraft) < 0) return cancelPriceEdit();
    const maximumUnitPrice = money(productPrice(item.product, currency));
    if (money(priceDraft) > maximumUnitPrice) {
      setError(
        `El precio de ${item.product.productName} no puede superar ${formattedProductPrice(maximumUnitPrice, currency)}.`,
      );
      return cancelPriceEdit();
    }
    setError('');
    updateItem(item.product.id, {
      unitPrice: fixed(money(priceDraft)),
      discountTotal: '0.00',
    });
    cancelPriceEdit();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!customer) return setError('Selecciona un cliente.');
    if (items.length === 0) return setError('Agrega al menos un producto.');
    const selectedPaymentMethod = resolvePaymentMethod(paymentMethod);
    if (!selectedPaymentMethod) return setError('Selecciona el método de pago.');
    const selectedShippingMethod = resolveShippingMethod(shippingMethod);
    if (!selectedShippingMethod) return setError('Selecciona el método de envío.');
    if (
      selectedShippingMethod.custom_amount &&
      (!customShippingTotal.trim() || money(customShippingTotal) < 0)
    ) {
      return setError('Ingresa un valor de envío personalizado válido.');
    }
    const shippingRule = selectedShippingMethod.rules[currency];
    const minimumOrderTotal =
      shippingRule && 'minimum_order_total' in shippingRule
        ? shippingRule.minimum_order_total
        : undefined;
    const maximumOrderTotal =
      shippingRule && 'maximum_order_total' in shippingRule
        ? shippingRule.maximum_order_total
        : undefined;
    if (
      selectedShippingMethod.shipping_method === 'free_shipping' &&
      typeof minimumOrderTotal === 'number' &&
      summary.subtotal < minimumOrderTotal
    ) {
      return setError('El subtotal todavía no alcanza el mínimo para envío gratis.');
    }
    if (
      selectedShippingMethod.shipping_method === 'flat_rate' &&
      typeof maximumOrderTotal === 'number' &&
      summary.subtotal >= maximumOrderTotal
    ) {
      return setError('Este subtotal corresponde a envío gratis.');
    }
    for (const item of items) {
      if (money(item.quantity) < 1 || !Number.isInteger(money(item.quantity)))
        return setError('Las cantidades deben ser números enteros mayores a cero.');
      if (money(item.unitPrice) > money(productPrice(item.product, currency)))
        return setError(
          `El precio de ${item.product.productName} no puede superar su valor original.`,
        );
    }
    const effectiveShipping = differentShipping ? shipping : withoutEmail(billing);
    await onSubmit({
      customerId: customer.id,
      currency,
      paymentMethod: selectedPaymentMethod.payment_method,
      shippingMethod: selectedShippingMethod.shipping_method,
      customShippingTotal: selectedShippingMethod.custom_amount
        ? fixed(money(customShippingTotal))
        : null,
      couponId: selectedCoupon?.id ?? null,
      billing: {
        firstName: nullable(billing.firstName),
        lastName: nullable(billing.lastName),
        company: nullable(billing.company),
        address1: nullable(billing.address1),
        address2: nullable(billing.address2),
        city: nullable(billing.city),
        state: nullable(billing.state),
        postcode: nullable(billing.postcode),
        country: nullable(billing.country),
        email: nullable(billing.email),
        phone: nullable(billing.phone),
      },
      shipping: {
        firstName: nullable(effectiveShipping.firstName),
        lastName: nullable(effectiveShipping.lastName),
        company: nullable(effectiveShipping.company),
        address1: nullable(effectiveShipping.address1),
        address2: nullable(effectiveShipping.address2),
        city: nullable(effectiveShipping.city),
        state: nullable(effectiveShipping.state),
        postcode: nullable(effectiveShipping.postcode),
        country: nullable(effectiveShipping.country),
        phone: nullable(effectiveShipping.phone),
      },
      items: items.map((item) => ({
        productId: item.product.id,
        quantity: Number(item.quantity),
        unitPrice: fixed(money(item.unitPrice)),
      })),
    });
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Modal.Backdrop>
        <Modal.Container placement="center" scroll="inside">
          <Modal.Dialog className="order-form-modal">
            <Modal.CloseTrigger aria-label="Cerrar formulario" />
            <Modal.Header>
              <div>
                <Modal.Heading>{order ? 'Editar pedido' : 'Crear pedido'}</Modal.Heading>
                <p>Registra la venta y revisa el resumen por tienda.</p>
              </div>
            </Modal.Header>
            <form onSubmit={(event) => void submit(event)} noValidate>
              <Modal.Body className="order-form-body">
                {(error || serverError) && (
                  <Alert status="danger">
                    <Alert.Content>
                      <Alert.Description>{error || serverError}</Alert.Description>
                    </Alert.Content>
                  </Alert>
                )}

                <section className="order-form-section">
                  <h3>Cliente</h3>
                  <CustomerSearch
                    selected={customer}
                    onSelect={chooseCustomer}
                    onChange={changeCustomer}
                  />
                  {customer && (
                    <>
                      <div className="order-billing-block">
                        <h3>Datos de facturación</h3>
                        {isBillingVisible ? (
                          <div className="order-billing-editor">
                            <AddressFields
                              value={billingDraft}
                              includeEmail
                              onChange={(next) => setBillingDraft(next as BillingValue)}
                            />
                            <div className="order-billing-actions">
                              <Button
                                type="button"
                                variant="danger-soft"
                                onPress={cancelBillingEditor}
                              >
                                Cancelar
                              </Button>
                              <Button type="button" variant="primary" onPress={saveBillingEditor}>
                                <FloppyDisk width={16} height={16} />
                                Actualizar datos
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <BillingSummary value={billing} onEdit={openBillingEditor} />
                        )}
                      </div>
                      <Switch
                        aria-label="Envío a dirección diferente"
                        isSelected={differentShipping}
                        onChange={(selected) => {
                          setDifferentShipping(selected);
                          if (!selected) setShipping(withoutEmail(billing));
                        }}
                      >
                        <Switch.Content>
                          <span>Envío a dirección diferente</span>
                          <Switch.Control>
                            <Switch.Thumb />
                          </Switch.Control>
                        </Switch.Content>
                      </Switch>
                      {differentShipping ? (
                        <AddressFields value={shipping} onChange={(next) => setShipping(next)} />
                      ) : (
                        <p className="order-form-note">
                          Se usará la misma información de facturación.
                        </p>
                      )}
                    </>
                  )}
                </section>

                <section className="order-form-section">
                  <h3>Productos</h3>
                  <ProductSearch
                    items={items}
                    currency={currency}
                    onAdd={(product) =>
                      setItems((current) => [
                        ...current,
                        {
                          product,
                          quantity: '1',
                          originalPrice: productPrice(product, currency),
                          unitPrice: productPrice(product, currency),
                          discountTotal: '0.00',
                        },
                      ])
                    }
                  />
                  <div className="order-items">
                    {items.length > 0 && (
                      <div className="order-items-heading">
                        <strong>Productos del pedido</strong>
                        <span>
                          {items.reduce((total, item) => total + money(item.quantity), 0)} unidades
                        </span>
                      </div>
                    )}
                    <div className="order-items-list">
                      {items.map((item) => {
                        const quantity = Math.max(1, money(item.quantity));
                        const originalTotal =
                          money(productPrice(item.product, currency)) * quantity;
                        const currentTotal =
                          money(item.unitPrice) * quantity - money(item.discountTotal);
                        const changed = Math.abs(originalTotal - currentTotal) >= 0.01;
                        return (
                          <article key={item.product.id} className="order-item-card">
                            <span className="order-product-thumbnail" aria-hidden="true">
                              {item.product.imageUrl ? (
                                <img src={item.product.imageUrl} alt="" loading="lazy" />
                              ) : (
                                '—'
                              )}
                            </span>
                            <div className="order-item-product">
                              <strong>{item.product.productName}</strong>
                              <span className="order-item-meta">
                                <span>
                                  {item.product.sku}, Stock {item.product.wooStock}
                                </span>
                                <Chip
                                  className={
                                    item.product.store === 'SERATUS'
                                      ? 'inventory-store-chip-seratus'
                                      : 'inventory-store-chip-pali'
                                  }
                                >
                                  {item.product.store === 'SERATUS' ? 'Seratus' : 'Pali'}
                                </Chip>
                              </span>
                            </div>
                            <div className="order-quantity-control" aria-label="Cantidad">
                              <Button
                                isIconOnly
                                size="sm"
                                variant="ghost"
                                aria-label={`Restar una unidad de ${item.product.productName}`}
                                isDisabled={quantity <= 1}
                                onPress={() => changeItemQuantity(item, -1)}
                              >
                                <Minus width={15} height={15} />
                              </Button>
                              <strong>{quantity}</strong>
                              <Button
                                isIconOnly
                                size="sm"
                                variant="ghost"
                                aria-label={`Agregar una unidad de ${item.product.productName}`}
                                isDisabled={quantity >= item.product.wooStock}
                                onPress={() => changeItemQuantity(item, 1)}
                              >
                                <Plus width={15} height={15} />
                              </Button>
                            </div>
                            <div className="order-item-total">
                              {changed && (
                                <del>{formattedProductPrice(originalTotal, currency)}</del>
                              )}
                              {editingPriceId === item.product.id ? (
                                <Input
                                  className="order-price-field"
                                  aria-label={`Precio unitario de ${item.product.productName}`}
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  value={priceDraft}
                                  autoFocus
                                  onFocus={(event) => event.currentTarget.select()}
                                  onChange={(event) =>
                                    setPriceDraft(event.target.value.replace(/\D/g, ''))
                                  }
                                  onBlur={() => savePriceEdit(item)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault();
                                      event.currentTarget.blur();
                                    }
                                    if (event.key === 'Escape') {
                                      event.preventDefault();
                                      cancelPriceEdit();
                                    }
                                  }}
                                />
                              ) : (
                                <button
                                  type="button"
                                  className="order-price-button"
                                  aria-label={`Editar precio de ${item.product.productName}`}
                                  onClick={() => beginPriceEdit(item)}
                                >
                                  {formattedProductPrice(currentTotal, currency)}
                                </button>
                              )}
                            </div>
                            <Button
                              className="order-item-remove"
                              isIconOnly
                              size="sm"
                              variant="ghost"
                              aria-label={`Quitar ${item.product.productName}`}
                              onPress={() => {
                                if (editingPriceId === item.product.id) cancelPriceEdit();
                                setItems((current) =>
                                  current.filter(({ product }) => product.id !== item.product.id),
                                );
                              }}
                            >
                              <TrashBin width={16} height={16} />
                            </Button>
                          </article>
                        );
                      })}
                      {items.length === 0 && (
                        <div className="order-items-empty">
                          <ShoppingCart width={24} height={24} />
                          <span>Busca y agrega los productos del pedido.</span>
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                <section className="order-form-section">
                  <h3>Condiciones de la operación</h3>
                  <RadioGroup
                    aria-label="Moneda"
                    value={currency}
                    className="order-currency-group"
                    name="order-currency"
                    orientation="horizontal"
                    onChange={(value) => changeCurrency(String(value) as 'COP' | 'USD')}
                  >
                    <Label>Moneda</Label>
                    <div className="order-currency-options">
                      <Radio className="order-currency-option" value="COP">
                        <Radio.Content>
                          <Radio.Control>
                            <Radio.Indicator />
                          </Radio.Control>
                          <img src="/img/flags/CO.webp" alt="" aria-hidden="true" />
                          <span className="order-currency-copy">
                            <strong>COP</strong>
                            <small>Pesos colombianos</small>
                          </span>
                        </Radio.Content>
                      </Radio>
                      <Radio className="order-currency-option" value="USD">
                        <Radio.Content>
                          <Radio.Control>
                            <Radio.Indicator />
                          </Radio.Control>
                          <img src="/img/flags/US.webp" alt="" aria-hidden="true" />
                          <span className="order-currency-copy">
                            <strong>USD</strong>
                            <small>Dólar americano</small>
                          </span>
                        </Radio.Content>
                      </Radio>
                    </div>
                  </RadioGroup>

                  <div className="order-operation-conditions">
                    <div className="order-coupon-field">
                      <Label>Cupón</Label>
                      <CouponSearch
                        selected={selectedCoupon}
                        onSelect={setSelectedCoupon}
                        onClear={() => setSelectedCoupon(null)}
                      />
                    </div>

                    <Select
                      aria-label="Método de pago"
                      value={paymentMethod}
                      onChange={(value) => setPaymentMethod(String(value ?? ''))}
                      variant="secondary"
                    >
                      <Label>Método de pago</Label>
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {paymentMethods.map((method) => (
                            <ListBox.Item
                              key={method.payment_method}
                              id={method.payment_method}
                              textValue={method.payment_method_title}
                            >
                              {method.payment_method_title}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>

                    <Select
                      aria-label="Método de envío"
                      value={shippingMethod}
                      onChange={(value) => {
                        const next = String(value ?? '');
                        setShippingMethod(next);
                        if (next !== 'custom') setCustomShippingTotal('');
                      }}
                      variant="secondary"
                    >
                      <Label>Método de envío</Label>
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {shippingMethods.map((method) => (
                            <ListBox.Item
                              key={method.shipping_method}
                              id={method.shipping_method}
                              textValue={method.shipping_method_title}
                            >
                              {method.shipping_method_title}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>

                    {shippingMethod === 'custom' && (
                      <TextField>
                        <Label>Valor del envío</Label>
                        <Input
                          variant="secondary"
                          type="number"
                          min="0"
                          step="0.01"
                          value={customShippingTotal}
                          onChange={(event) => setCustomShippingTotal(event.target.value)}
                          placeholder={`Valor en ${currency}`}
                        />
                      </TextField>
                    )}
                  </div>
                </section>

                <section className="order-form-section order-summary">
                  <h3>Resumen del pedido</h3>
                  {activeStores.length > 1 && (
                    <div className="order-store-summaries">
                      {activeStores.map((store, index) => {
                        const shipping = storeShippingShares[index] ?? 0;
                        const storeItems = items.filter(({ product }) => product.store === store);
                        const subtotal = storeItems.reduce(
                          (total, item) => total + money(item.unitPrice) * money(item.quantity),
                          0,
                        );
                        const discount = selectedCoupon
                          ? Math.round(
                              storeItems
                                .filter(
                                  (item) => money(item.unitPrice) >= money(item.originalPrice),
                                )
                                .reduce(
                                  (total, item) =>
                                    total + money(item.unitPrice) * money(item.quantity),
                                  0,
                                ) * selectedCoupon.amount,
                            ) / 100
                          : 0;
                        return (
                          <article key={store} className="order-store-summary">
                            <h4>{store === 'SERATUS' ? 'Seratus' : 'Pali'}</h4>
                            <dl>
                              <div>
                                <dt>Subtotal</dt>
                                <dd>{formattedProductPrice(subtotal, currency)}</dd>
                              </div>
                              <div>
                                <dt>Descuento</dt>
                                <dd>{formattedProductPrice(discount, currency)}</dd>
                              </div>
                              <div>
                                <dt>Envío</dt>
                                <dd>{formattedProductPrice(shipping, currency)}</dd>
                              </div>
                              <div>
                                <dt>Total</dt>
                                <dd>
                                  {formattedProductPrice(subtotal - discount + shipping, currency)}
                                </dd>
                              </div>
                            </dl>
                          </article>
                        );
                      })}
                    </div>
                  )}

                  <dl className="order-summary-general">
                    <div>
                      <dt>Subtotal</dt>
                      <dd>{formattedProductPrice(summary.subtotal, currency)}</dd>
                    </div>
                    <div>
                      <dt>Descuento</dt>
                      <dd>{formattedProductPrice(summary.discount, currency)}</dd>
                    </div>
                    <div>
                      <dt>Envío</dt>
                      <dd>{formattedProductPrice(summary.shippingTotal, currency)}</dd>
                    </div>
                    <div className="order-summary-total">
                      <dt>Total</dt>
                      <dd>{formattedProductPrice(summary.total, currency)}</dd>
                    </div>
                  </dl>
                </section>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" onPress={onClose} isDisabled={isSubmitting}>
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" isPending={isSubmitting}>
                  {({ isPending }) => (
                    <>
                      {isPending ? (
                        <Spinner color="current" size="sm" />
                      ) : (
                        <Plus width={17} height={17} />
                      )}
                      {isPending ? 'Guardando' : order ? 'Guardar cambios' : 'Crear pedido'}
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
