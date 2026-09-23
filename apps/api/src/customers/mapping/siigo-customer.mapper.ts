import { BadRequestException, Injectable } from '@nestjs/common';
import {
  mapPhoneToSiigo,
  normalizePhoneE164,
  resolveCustomerCountryName,
  resolveCustomerRegionName,
  resolveCustomerSiigoCity,
  resolveCustomerSiigoCountryByWooCode,
} from '@sevale/shared';
import type { CustomerMappingSource } from './customer-mapping.types.js';
import type { SiigoLocationSelection } from './customer-mapping.types.js';
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
    address?: string;
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

function cleanAddress(line1: string | null | undefined, line2: string | null | undefined): string {
  return [line1?.trim(), line2?.trim()].filter(Boolean).join(', ');
}

function addressForSiigo(customer: SiigoReadyCustomer): string {
  if (customer.country === 'CO') {
    return cleanAddress(customer.addressLine1, customer.addressLine2);
  }
  return [
    customer.addressLine1?.trim(),
    customer.addressLine2?.trim(),
    customer.cityName?.trim(),
    resolveCustomerRegionName(customer.country, customer.region),
    customer.postalCode?.trim(),
    resolveCustomerCountryName(customer.country),
  ]
    .filter((part): part is string => Boolean(part))
    .join(', ');
}

function uppercase(value: string): string {
  return value.toLocaleUpperCase('es-CO');
}

type SiigoReadyCustomer = CustomerMappingSource & { country: string };

function requireSiigoData(customer: CustomerMappingSource): asserts customer is SiigoReadyCustomer {
  const missing: string[] = [];
  if (customer.fiscalResponsibilities.length === 0) missing.push('responsabilidad fiscal');
  if (!customer.country) missing.push('país');
  if (customer.country === 'CO' && !customer.region) missing.push('región o departamento');
  if (customer.country === 'CO' && !customer.cityCode) missing.push('ciudad o municipio');
  if (missing.length === 0) return;

  throw new BadRequestException({
    success: false,
    error: {
      code: 'SIIGO_CUSTOMER_REQUIRED_DATA_MISSING',
      message: `Completa estos datos antes de sincronizar con Siigo: ${missing.join(', ')}.`,
    },
  });
}

function siigoLocationError(code: string, message: string): BadRequestException {
  return new BadRequestException({ success: false, error: { code, message } });
}

@Injectable()
export class SiigoCustomerMapper {
  constructor(private readonly locations: CustomerLocationsService) {}

  map(
    customer: CustomerMappingSource,
    siigoSelection?: SiigoLocationSelection,
  ): SiigoCustomerPayload {
    requireSiigoData(customer);
    const location = this.resolveLocation(customer, siigoSelection);
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
    const address = addressForSiigo(customer);
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
        ...(address ? { address: customer.country === 'CO' ? uppercase(address) : address } : {}),
        city: {
          country_code: location.countryCode,
          state_code: location.stateCode,
          city_code: location.cityCode,
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

  private resolveLocation(
    customer: SiigoReadyCustomer,
    selection?: SiigoLocationSelection,
  ): { countryCode: string; stateCode: string; cityCode: string } {
    if (customer.country === 'CO') {
      const location = this.locations.resolve(
        customer.country,
        customer.region as string,
        customer.cityCode as string,
      );
      return location.siigo;
    }

    const country = resolveCustomerSiigoCountryByWooCode(customer.country);
    if (!country) {
      throw siigoLocationError(
        'SIIGO_CUSTOMER_COUNTRY_NOT_MAPPED',
        'El país del cliente no está disponible en el catálogo de Siigo.',
      );
    }
    if (!selection) {
      throw siigoLocationError(
        'SIIGO_CUSTOMER_LOCATION_REQUIRED',
        'Selecciona la región y la ciudad de Siigo antes de sincronizar.',
      );
    }
    const city = resolveCustomerSiigoCity(country.code, selection.stateCode, selection.cityCode);
    if (!city) {
      throw siigoLocationError(
        'SIIGO_CUSTOMER_LOCATION_INVALID',
        'La ciudad seleccionada no pertenece a la región de Siigo.',
      );
    }
    return {
      countryCode: country.code,
      stateCode: selection.stateCode,
      cityCode: city.code,
    };
  }
}
