import { BadRequestException, Injectable } from '@nestjs/common';
import { mapPhoneToSiigo, normalizePhoneE164 } from '@sevale/shared';
import type { CustomerMappingSource } from './customer-mapping.types.js';
import { CustomerLocationsService } from './customer-locations.service.js';

export type SiigoCustomerPayload = {
  type: 'Customer';
  person_type: 'Person' | 'Company';
  id_type: string;
  identification: string;
  name: string[];
  check_digit?: string;
  commercial_name?: string;
  active?: boolean;
  vat_responsible: boolean;
  fiscal_responsibilities: Array<{ code: string }>;
  address: {
    address: string;
    city: { country_code: string; state_code: string; city_code: string };
    postal_code?: string;
  };
  phones?: Array<{ indicative: string; number: string }>;
  contacts?: Array<{
    first_name: string;
    last_name?: string;
    email: string;
    phone?: { indicative: string; number: string };
  }>;
};

function cleanAddress(line1: string, line2: string | null | undefined): string {
  return [line1.trim(), line2?.trim()].filter(Boolean).join(', ');
}

function uppercase(value: string): string {
  return value.toLocaleUpperCase('es-CO');
}

type SiigoReadyCustomer = CustomerMappingSource & {
  addressLine1: string;
  country: string;
  region: string;
  cityCode: string;
};

function requireSiigoData(customer: CustomerMappingSource): asserts customer is SiigoReadyCustomer {
  const missing: string[] = [];
  if (customer.fiscalResponsibilities.length === 0) missing.push('responsabilidad fiscal');
  if (!customer.addressLine1) missing.push('dirección principal');
  if (!customer.country) missing.push('país');
  if (!customer.region) missing.push('región o departamento');
  if (!customer.cityCode) missing.push('ciudad o municipio');
  if (missing.length === 0) return;

  throw new BadRequestException({
    success: false,
    error: {
      code: 'SIIGO_CUSTOMER_REQUIRED_DATA_MISSING',
      message: `Completa estos datos antes de sincronizar con Siigo: ${missing.join(', ')}.`,
    },
  });
}

@Injectable()
export class SiigoCustomerMapper {
  constructor(private readonly locations: CustomerLocationsService) {}

  map(customer: CustomerMappingSource): SiigoCustomerPayload {
    requireSiigoData(customer);
    const location = this.locations.resolve(customer.country, customer.region, customer.cityCode);
    const phone = customer.phone ? mapPhoneToSiigo(customer.phone, customer.country) : null;
    if (customer.phone && !phone) {
      throw new BadRequestException({
        success: false,
        error: {
          code: 'CUSTOMER_PHONE_NOT_VALID',
          message: 'El teléfono no es válido para el país seleccionado.',
        },
      });
    }

    const nameParts =
      customer.personType === 'PERSON'
        ? [customer.firstName, customer.lastName].filter((part): part is string => Boolean(part))
        : [customer.company].filter((part): part is string => Boolean(part));
    const canonicalName = nameParts.join(' ');
    const name = nameParts.map(uppercase);
    const contactFirstName = customer.firstName?.trim();
    const normalizedPhone = customer.phone
      ? normalizePhoneE164(customer.phone, customer.country)
      : null;

    return {
      type: 'Customer',
      person_type: customer.personType === 'PERSON' ? 'Person' : 'Company',
      id_type: customer.documentType,
      identification: customer.documentNumber,
      name,
      ...(customer.checkDigit ? { check_digit: customer.checkDigit } : {}),
      ...(customer.displayName !== canonicalName ? { commercial_name: customer.displayName } : {}),
      ...(customer.active === undefined ? {} : { active: customer.active }),
      vat_responsible: customer.vatResponsible,
      fiscal_responsibilities: customer.fiscalResponsibilities.map((code) => ({ code })),
      address: {
        address: uppercase(cleanAddress(customer.addressLine1, customer.addressLine2)),
        city: {
          country_code: location.siigo.countryCode,
          state_code: location.siigo.stateCode,
          city_code: location.siigo.cityCode,
        },
        ...(customer.postalCode ? { postal_code: customer.postalCode } : {}),
      },
      ...(phone ? { phones: [phone] } : {}),
      ...(contactFirstName && customer.email
        ? {
            contacts: [
              {
                first_name: uppercase(contactFirstName),
                ...(customer.lastName ? { last_name: uppercase(customer.lastName) } : {}),
                email: customer.email,
                ...(phone && normalizedPhone ? { phone } : {}),
              },
            ],
          }
        : {}),
    };
  }
}
