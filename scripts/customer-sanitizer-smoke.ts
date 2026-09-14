import {
  normalizeCustomerName,
  normalizeCustomerPhone,
  resolveSiigoPhone,
  sanitizeCustomerEmail,
  sanitizePostalCode,
  sanitizeSiigoAddress,
} from '../apps/api/src/customers/customer-data-sanitizer.js';

function equal(actual: unknown, expected: unknown, context: string) {
  if (actual !== expected) {
    throw new Error(`${context}: se esperaba ${String(expected)} y se recibió ${String(actual)}.`);
  }
}

equal(
  resolveSiigoPhone({ phones: [{ indicative: '57', number: '3044251788' }] }, 'CO'),
  '+573044251788',
  'El teléfono principal válido debe normalizarse a E.164',
);
equal(
  resolveSiigoPhone({ phones: [{ indicative: '000', number: '0000000' }] }, 'CO'),
  null,
  'Los teléfonos placeholder deben descartarse',
);
equal(
  resolveSiigoPhone({ phones: [{ indicative: '000', number: '3002719324' }] }, 'CO'),
  '+573002719324',
  'Un número nacional inequívoco debe recuperarse mediante el país',
);
equal(
  resolveSiigoPhone(
    {
      phones: [{ indicative: '57', number: '3044251788' }],
      contacts: [{ phone: { indicative: '57', number: '3105551234' } }],
    },
    'CO',
  ),
  '+573044251788',
  'El teléfono principal debe ganar cuando ambos candidatos son válidos',
);
equal(
  resolveSiigoPhone(
    {
      phones: [{ indicative: '000', number: '0000000' }],
      contacts: [{ phone: { indicative: '57', number: '3105551234' } }],
    },
    'CO',
  ),
  '+573105551234',
  'El contacto debe utilizarse cuando el teléfono principal es inválido',
);
equal(
  resolveSiigoPhone(
    {
      phones: [],
      contacts: [{ phone: { indicative: '00', number: '0000000' } }],
    },
    'CO',
  ),
  null,
  'La ausencia de candidatos válidos debe producir null',
);
equal(
  normalizeCustomerPhone('+57 304 425 1788', 'CO'),
  '+573044251788',
  'El guardado final debe normalizar el formato visual a E.164',
);

equal(
  sanitizeCustomerEmail(' CLIENTE@GMAIL.COM '),
  'cliente@gmail.com',
  'El email debe normalizar espacios y mayúsculas',
);
for (const email of [
  'usuario@sevale.com',
  'usuario@seratus.com.co',
  'usuario@pali.com.co',
  'usuario@joem.com.co',
  'email-invalido',
]) {
  equal(sanitizeCustomerEmail(email), null, `El email ${email} debe descartarse`);
}

equal(sanitizePostalCode('00000'), null, 'El código postal de ceros debe descartarse');
equal(sanitizePostalCode('000000'), null, 'El código postal de ceros debe descartarse');
equal(sanitizePostalCode('050040'), '050040', 'Los ceros iniciales deben conservarse');

equal(sanitizeSiigoAddress('No aplica'), null, 'La dirección placeholder debe descartarse');
equal(sanitizeSiigoAddress(' N/A '), null, 'La dirección N/A debe descartarse');
equal(
  sanitizeSiigoAddress('CRA 79B #92-155, INT 201'),
  'CRA 79B #92-155, INT 201',
  'La dirección real debe conservarse',
);
equal(
  normalizeCustomerName('  YOHANDER   DAVID  '),
  'YOHANDER DAVID',
  'Los nombres solo deben normalizar espacios',
);
