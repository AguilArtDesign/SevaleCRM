import { BadRequestException, Injectable } from '@nestjs/common';
import {
  resolveCustomerColombiaCity,
  resolveCustomerColombiaState,
  resolveCustomerCountry,
  resolveCustomerSiigoCountryByWooCode,
} from '@sevale/shared';
import type { ResolvedCustomerLocation } from './customer-mapping.types.js';

@Injectable()
export class CustomerLocationsService {
  resolve(countryCode: string, regionCode: string, cityCode: string): ResolvedCustomerLocation {
    const country = countryCode.trim().toUpperCase() === 'CO' ? resolveCustomerCountry('CO') : null;
    const region = country ? resolveCustomerColombiaState(regionCode) : null;
    const city = region ? resolveCustomerColombiaCity(region.code, cityCode) : null;
    const siigoCountry = country ? resolveCustomerSiigoCountryByWooCode('CO') : null;

    if (!country || !region || !city || !siigoCountry) {
      throw new BadRequestException({
        success: false,
        error: {
          code: 'CUSTOMER_LOCATION_NOT_MAPPED',
          message: 'La ubicación seleccionada no es válida para Colombia.',
        },
      });
    }

    return {
      display: { country: country.name, region: region.name, city: city.name },
      woo: { country: 'CO', state: region.code, city: city.name },
      siigo: {
        countryCode: siigoCountry.code,
        stateCode: region.siigoCode,
        cityCode: city.code,
      },
    };
  }
}
