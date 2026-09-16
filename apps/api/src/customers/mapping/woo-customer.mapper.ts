import { BadRequestException, Injectable } from '@nestjs/common';
import { normalizePhoneE164 } from '@sevale/shared';
import type { CustomerMappingSource } from './customer-mapping.types.js';
import { CustomerLocationsService } from './customer-locations.service.js';

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

@Injectable()
export class WooCustomerMapper {
  constructor(private readonly locations: CustomerLocationsService) {}

  map(customer: CustomerMappingSource): WooCustomerPayload {
    if (!customer.email) {
      throw new BadRequestException({
        success: false,
        error: {
          code: 'WOOCOMMERCE_CUSTOMER_EMAIL_REQUIRED',
          message: 'Completa el correo antes de sincronizar con WooCommerce.',
        },
      });
    }
    const location =
      customer.country && customer.region && customer.cityCode
        ? this.locations.resolve(customer.country, customer.region, customer.cityCode)
        : null;
    const phone = customer.phone
      ? normalizePhoneE164(customer.phone, customer.country ?? '')
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

    return {
      username: customer.documentNumber,
      email: customer.email,
      ...(customer.firstName ? { first_name: customer.firstName } : {}),
      ...(customer.lastName ? { last_name: customer.lastName } : {}),
      billing: {
        ...(customer.firstName ? { first_name: customer.firstName } : {}),
        ...(customer.lastName ? { last_name: customer.lastName } : {}),
        ...(customer.company ? { company: customer.company } : {}),
        ...(customer.addressLine1 ? { address_1: customer.addressLine1 } : {}),
        ...(customer.addressLine2 ? { address_2: customer.addressLine2 } : {}),
        ...(location ? { city: location.woo.city, state: location.woo.state } : {}),
        ...(customer.postalCode ? { postcode: customer.postalCode } : {}),
        ...(location ? { country: location.woo.country } : {}),
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
