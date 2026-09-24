import { BadRequestException, Injectable } from '@nestjs/common';
import {
  formatPhoneInternational,
  getCustomerWooStates,
  resolveCustomerColombiaCity,
  resolveCustomerColombiaState,
  resolveCustomerCountry,
  resolveCustomerWooState,
  wooCustomerUsername,
} from '@sevale/shared';
import { capitalizeCustomerName } from '../customer-data-sanitizer.js';
import type { CustomerMappingSource } from './customer-mapping.types.js';

export type WooCustomerPayload = {
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  billing: {
    first_name?: string;
    last_name?: string;
    company?: string;
    address_1?: string;
    address_2?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
    email: string;
    phone?: string;
  };
  meta_data: Array<
    | { key: 'billing_type_document'; value: string }
    | { key: 'billing_identification'; value: string }
  >;
};

function uppercase(value: string): string {
  return value.toLocaleUpperCase('es-CO');
}

type WooLocation = { country: string; state?: string; city?: string };

function locationError(code: string, message: string): BadRequestException {
  return new BadRequestException({ success: false, error: { code, message } });
}

function resolveWooLocation(customer: CustomerMappingSource): WooLocation | null {
  const hasLocation = Boolean(
    customer.country || customer.region || customer.cityCode || customer.cityName,
  );
  if (!hasLocation) return null;
  if (!customer.country) {
    throw locationError(
      'WOOCOMMERCE_CUSTOMER_LOCATION_REQUIRED',
      'Selecciona el país antes de sincronizar el cliente con WooCommerce.',
    );
  }
  const countryCode = customer.country.trim().toUpperCase();
  if (!resolveCustomerCountry(countryCode)) {
    throw locationError(
      'WOOCOMMERCE_CUSTOMER_LOCATION_INVALID',
      'El país seleccionado no existe en el catálogo de WooCommerce.',
    );
  }

  if (countryCode === 'CO') {
    const state = customer.region ? resolveCustomerColombiaState(customer.region) : null;
    const city =
      state && customer.cityCode
        ? resolveCustomerColombiaCity(state.code, customer.cityCode)
        : null;
    if (customer.region && !state) {
      throw locationError(
        'WOOCOMMERCE_CUSTOMER_LOCATION_INVALID',
        'El departamento seleccionado no es válido para WooCommerce.',
      );
    }
    if (customer.cityCode && !city) {
      throw locationError(
        'WOOCOMMERCE_CUSTOMER_LOCATION_INVALID',
        'La ciudad seleccionada no pertenece al departamento indicado.',
      );
    }
    return {
      country: 'CO',
      ...(state ? { state: state.code } : {}),
      ...(city ? { city: city.name } : {}),
    };
  }

  if (customer.cityCode) {
    throw locationError(
      'WOOCOMMERCE_CUSTOMER_LOCATION_INVALID',
      'Corrige la ciudad internacional y guárdala como texto antes de sincronizar.',
    );
  }
  const city = customer.cityName?.trim();
  const states = getCustomerWooStates(countryCode);
  if (states.length > 0) {
    const state = customer.region ? resolveCustomerWooState(countryCode, customer.region) : null;
    if (customer.region && !state) {
      throw locationError(
        'WOOCOMMERCE_CUSTOMER_LOCATION_INVALID',
        'Selecciona una región válida de WooCommerce antes de sincronizar.',
      );
    }
    return {
      country: countryCode,
      ...(state ? { state: state.code } : {}),
      ...(city ? { city } : {}),
    };
  }
  const freeRegion = customer.region?.trim();
  return {
    country: countryCode,
    ...(freeRegion ? { state: freeRegion } : {}),
    ...(city ? { city } : {}),
  };
}

@Injectable()
export class WooCustomerMapper {
  map(customer: CustomerMappingSource): WooCustomerPayload {
    return {
      ...this.build(customer),
      // El username es único en WordPress y no identifica al cliente: se arma con las iniciales,
      // el tipo y el número para que dos clientes distintos no choquen al crearse.
      username: wooCustomerUsername({
        personType: customer.personType,
        firstName: customer.firstName,
        lastName: customer.lastName,
        company: customer.company,
        documentType: customer.documentType,
        documentNumber: customer.documentNumber,
      }),
    };
  }

  /**
   * Payload sin username para las actualizaciones: el username solo se define al crear, porque
   * cambiaría con cualquier corrección del nombre y no identifica al cliente.
   */
  mapForUpdate(customer: CustomerMappingSource): Omit<WooCustomerPayload, 'username'> {
    return this.build(customer);
  }

  private build(customer: CustomerMappingSource): Omit<WooCustomerPayload, 'username'> {
    if (!customer.email) {
      throw new BadRequestException({
        success: false,
        error: {
          code: 'WOOCOMMERCE_CUSTOMER_EMAIL_REQUIRED',
          message: 'Completa el correo antes de sincronizar con WooCommerce.',
        },
      });
    }
    const location = resolveWooLocation(customer);
    const phone = customer.phone
      ? formatPhoneInternational(customer.phone, customer.country ?? '')
      : null;
    if (customer.phone && !phone) {
      throw new BadRequestException({
        success: false,
        error: {
          code: 'CUSTOMER_PHONE_NOT_VALID',
          message: 'El teléfono no es válido para el país seleccionado.',
        },
      });
    }
    const firstName = capitalizeCustomerName(customer.firstName);
    const lastName = capitalizeCustomerName(customer.lastName);

    return {
      email: customer.email,
      ...(firstName ? { first_name: firstName } : {}),
      ...(lastName ? { last_name: lastName } : {}),
      billing: {
        ...(firstName ? { first_name: firstName } : {}),
        ...(lastName ? { last_name: lastName } : {}),
        ...(customer.company ? { company: customer.company } : {}),
        ...(customer.addressLine1 ? { address_1: uppercase(customer.addressLine1) } : {}),
        ...(customer.addressLine2 ? { address_2: uppercase(customer.addressLine2) } : {}),
        ...(location?.city ? { city: location.city } : {}),
        ...(location?.state ? { state: location.state } : {}),
        ...(customer.postalCode ? { postcode: customer.postalCode } : {}),
        ...(location ? { country: location.country } : {}),
        email: customer.email,
        ...(phone ? { phone } : {}),
      },
      meta_data: [
        { key: 'billing_type_document', value: customer.documentType },
        { key: 'billing_identification', value: customer.documentNumber },
      ],
    };
  }
}
