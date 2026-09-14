import type { CreateCustomerInput } from '@sevale/validation';

export type CustomerMappingSource = CreateCustomerInput & { active?: boolean };

export type ResolvedCustomerLocation = {
  display: { country: string; region: string; city: string };
  woo: { country: string; state: string; city: string };
  siigo: { countryCode: string; stateCode: string; cityCode: string };
};
