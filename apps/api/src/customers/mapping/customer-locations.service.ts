import { BadRequestException, Injectable } from '@nestjs/common';
import { mapLocationToSiigo, mapLocationToWoo, resolveCountry, resolveState } from '@sevale/shared';
import type { ResolvedCustomerLocation } from './customer-mapping.types.js';

@Injectable()
export class CustomerLocationsService {
  resolve(countryCode: string, regionCode: string, cityCode: string): ResolvedCustomerLocation {
    const country = resolveCountry(countryCode);
    const region = resolveState(countryCode, regionCode);
    const woo = mapLocationToWoo(countryCode, regionCode, cityCode);
    const siigo = mapLocationToSiigo(countryCode, regionCode, cityCode);

    if (!country || !region || !woo || !siigo) {
      throw new BadRequestException({
        success: false,
        error: {
          code: 'CUSTOMER_LOCATION_NOT_MAPPED',
          message:
            'La ubicación seleccionada no tiene un mapping completo para Siigo y WooCommerce.',
        },
      });
    }

    return {
      display: { country: country.name, region: region.name, city: woo.city },
      woo,
      siigo,
    };
  }
}
