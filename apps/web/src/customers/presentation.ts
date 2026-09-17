type CustomerName = {
  displayName: string;
  firstName?: string | null;
  lastName?: string | null;
  personType?: 'PERSON' | 'COMPANY';
};

function capitalizeName(value: string) {
  return value
    .toLocaleLowerCase('es-CO')
    .replace(
      /(^|[\s'-])(\p{L})/gu,
      (_, separator: string, letter: string) => `${separator}${letter.toLocaleUpperCase('es-CO')}`,
    );
}

export function customerDisplayName(customer: CustomerName) {
  return customer.personType === 'PERSON'
    ? capitalizeName(customer.displayName)
    : customer.displayName;
}

export function customerInitials(customer: CustomerName) {
  const firstName = customer.firstName?.trim().split(/\s+/)[0];
  const firstLastName = customer.lastName?.trim().split(/\s+/)[0];
  const fallbackWords = customer.displayName.trim().split(/\s+/);
  return (
    firstName && firstLastName
      ? `${firstName[0]}${firstLastName[0]}`
      : fallbackWords
          .slice(0, 2)
          .map((word) => word[0])
          .join('')
  ).toLocaleUpperCase('es-CO');
}

export function customerAvatarClass(customerId: number) {
  return `customer-table-avatar customer-table-avatar--${customerId % 6}`;
}
