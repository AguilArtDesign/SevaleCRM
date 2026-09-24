export type WooUsernameSource = {
  personType: 'PERSON' | 'COMPANY';
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  documentType: string;
  documentNumber: string;
};

// El username de WooCommerce es único a nivel de WordPress y, a diferencia de la pareja
// (tipo + número), no identifica al cliente: aquí solo agrega margen para que dos clientes
// distintos no choquen al crearse. Se arma con dos iniciales, el tipo y el número, y nunca se
// usa como llave de búsqueda.
const FALLBACK_INITIAL = 'X';

function withoutAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '');
}

function alphanumeric(value: string): string {
  return withoutAccents(value).replace(/[^A-Za-z0-9]/gu, '');
}

// Inicial de la palabra indicada y, si no existe, de la primera palabra disponible.
function initial(value: string | null | undefined, index: number): string {
  const words = withoutAccents(value ?? '')
    .toLocaleUpperCase('es')
    .split(/\s+/u)
    .map((word) => alphanumeric(word))
    .filter((word) => word.length > 0);
  const word = words[index] ?? words[0] ?? '';
  return word.charAt(0) || FALLBACK_INITIAL;
}

export function wooCustomerUsername(source: WooUsernameSource): string {
  const isCompany = source.personType === 'COMPANY';
  const first = initial(isCompany ? source.company : source.firstName, 0);
  const second = initial(isCompany ? source.company : source.lastName, isCompany ? 1 : 0);
  const type = alphanumeric(source.documentType).toUpperCase() || FALLBACK_INITIAL;
  const number = alphanumeric(source.documentNumber).toUpperCase() || FALLBACK_INITIAL;

  return `${first}${second}${type}-${number}`;
}
