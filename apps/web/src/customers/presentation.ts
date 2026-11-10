import { userAvatarGradient } from '../users/presentation';

type CustomerName = {
  displayName: string;
  firstName?: string | null;
  lastName?: string | null;
  // El prospecto puede no tener tipo de persona: es opcional hasta que se decide al editar.
  personType?: 'PERSON' | 'COMPANY' | null;
};

/**
 * Nombres con inicial mayúscula. Es la forma en que se guardan los nombres de persona, así que sirve
 * tanto para mostrarlos como para corregir lo que se escribe en un formulario.
 */
export function capitalizeName(value: string) {
  return value
    .toLocaleLowerCase('es-CO')
    .replace(
      /(^|[\s'-])(\p{L})/gu,
      (_, separator: string, letter: string) => `${separator}${letter.toLocaleUpperCase('es-CO')}`,
    );
}

export function customerDisplayName(customer: CustomerName) {
  // Una empresa se escribe en mayúsculas por convención: la razón social no se capitaliza como un
  // nombre de persona, y así se lee igual que en Siigo. Es solo presentación, no se guarda así.
  return customer.personType === 'PERSON'
    ? capitalizeName(customer.displayName)
    : customer.displayName.toLocaleUpperCase('es-CO');
}

/** Código de Siigo para el NIT: el único documento de cliente que lleva dígito de verificación. */
const nitDocumentType = '31';

/**
 * Documento tal como se lee en el CRM. Solo el NIT lleva el dígito de verificación, y solo se añade
 * cuando existe: un NIT sin dígito se muestra tal cual en lugar de con un guion suelto.
 */
export function customerDocumentLabel(customer: {
  documentNumber: string;
  documentType: string;
  checkDigit?: string | null;
}) {
  return customer.documentType === nitDocumentType && customer.checkDigit
    ? `${customer.documentNumber}-${customer.checkDigit}`
    : customer.documentNumber;
}

/**
 * Las líneas de dirección se muestran en mayúsculas, como se escriben en Siigo y en la guía de
 * transporte. La ciudad y el resto de la ubicación conservan su formato.
 */
export function upperCaseAddress(value: string | null | undefined) {
  return value ? value.toLocaleUpperCase('es-CO') : value;
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

/**
 * Color del avatar de un cliente con el mismo generador que el sidebar, sembrado por el correo: la
 * misma persona no aparece de un color en su perfil y de otro en la campana de notificaciones.
 * Los avatares de las tablas conservan su paleta fija, que allí ayuda a distinguir filas.
 */
export function customerAvatarStyle(customer: { id: number; email?: string | null }) {
  return userAvatarGradient(customer.email || String(customer.id));
}
