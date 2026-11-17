/**
 * Errores que devuelve Puntos Colombia, traducidos a algo que se pueda leer.
 *
 * El comercial no ve esto: en pantalla sigue el mensaje corto de siempre. El catálogo es para quien
 * administra el CRM, porque un `POS_LOCATION_NOT_OF_PARTNER` solo dice algo si alguien sabe que el
 * punto de venta del usuario no pertenece al partner configurado.
 *
 * La tabla sale del documento de errores del proveedor. Varios códigos se repiten con motivos
 * distintos —`COMMON_BUSINESS_ERROR` es el caso extremo—, así que la resolución intenta por código y,
 * cuando hay más de uno, por un fragmento del mensaje original. Si nada coincide se devuelve `null`:
 * inventar una explicación sería peor que mostrar el código tal cual.
 */

export const pointsErrorServices = [
  'Autenticación',
  'Consulta de Cuenta',
  'Acumulación',
  'Solicitud Método de Autenticación',
  'Redención',
] as const;

export type PointsErrorService = (typeof pointsErrorServices)[number];

type PointsErrorEntry = {
  service: PointsErrorService;
  /** Estado HTTP tal como lo documenta el proveedor: puede ser un rango (`401 / 403`). */
  http: string;
  code: string;
  /** Fragmentos del mensaje del proveedor que distinguen este motivo de los demás del mismo código. */
  match?: readonly string[];
  /** Texto de referencia del proveedor, para poder buscar el caso en su documentación. */
  providerMessage: string;
  cause: string;
  action: string;
};

const catalog: readonly PointsErrorEntry[] = [
  // --- Autenticación -------------------------------------------------------------------------
  {
    service: 'Autenticación',
    http: '400',
    code: 'COMMON_FIELD_MANDATORY',
    match: ['grant_type'],
    providerMessage: '"grant_type" is required',
    cause: 'No se envió el campo obligatorio grant_type.',
    action: 'Validar que el campo grant_type viaje en la petición.',
  },
  {
    service: 'Autenticación',
    http: '422',
    code: 'UNPROCESSABLE_ENTITY',
    match: ['grant_type'],
    providerMessage:
      '"grant_type" must be one of [client_credentials, authorization_code, refresh_token]',
    cause: 'El valor de grant_type no es válido.',
    action: 'Usar un valor soportado por el servicio.',
  },
  {
    service: 'Autenticación',
    http: '401 / 403',
    code: 'INVALID_CLIENT',
    providerMessage: 'The given client credentials were not valid',
    cause: 'El ClientId o el ClientSecret no son válidos para el ambiente.',
    action: 'Revisar las credenciales configuradas para el ambiente correspondiente.',
  },

  // --- Consulta de cuenta --------------------------------------------------------------------
  {
    service: 'Consulta de Cuenta',
    http: '404',
    code: 'POS_CUSTOMER_NOT_FOUND',
    providerMessage: 'Customer not found',
    cause: 'El cliente no está registrado en Puntos Colombia.',
    action: 'Indicarle al cliente que debe registrarse en el programa.',
  },
  {
    service: 'Consulta de Cuenta',
    http: '400',
    code: 'POS_AMBIGUOUS_DOCUMENT_NO',
    providerMessage: 'More than one identifier matches provided document number',
    cause: 'Hay varios registros asociados al documento consultado.',
    action: 'Validar la información del documento con el cliente.',
  },
  {
    service: 'Consulta de Cuenta',
    http: '400',
    code: 'POS_LOCATION_NOT_OF_PARTNER',
    providerMessage: 'Location provided does not belong to provided partner',
    cause: 'El punto de venta del usuario no pertenece al partner configurado.',
    action: 'Revisar el PartnerCode y el código de punto de venta del usuario.',
  },
  {
    service: 'Consulta de Cuenta',
    http: '400',
    code: 'POS_LOCATION_WRONG_STATUS',
    providerMessage: 'Status of location does not allow this operation',
    cause: 'El punto de venta está cerrado o inactivo.',
    action: 'Revisar el estado del punto de venta con Puntos Colombia.',
  },
  {
    service: 'Consulta de Cuenta',
    http: '404',
    code: 'POS_LOCATION_NOT_FOUND',
    providerMessage: 'Location with the provided identifier does not exist',
    cause: 'El punto de venta del usuario no existe en Puntos Colombia.',
    action: 'Revisar el código de punto de venta de la ficha del usuario.',
  },
  {
    service: 'Consulta de Cuenta',
    http: '422',
    code: 'UNPROCESSABLE_ENTITY',
    providerMessage: 'Datos inválidos',
    cause: 'Uno o más campos no cumplen el formato esperado.',
    action: 'Validar los datos enviados según la especificación.',
  },

  // --- Acumulación ---------------------------------------------------------------------------
  {
    service: 'Acumulación',
    http: '400',
    code: 'POS_DUPLICATE_TRANSACTION',
    providerMessage: 'Transaction with specified identifier already exists',
    cause: 'La transacción ya se había procesado con ese identificador.',
    action: 'Tomarla como exitosa y no reenviarla.',
  },
  {
    service: 'Acumulación',
    http: '400',
    code: 'MESSAGE_NOT_READABLE',
    match: ['amount'],
    providerMessage: 'not allowed character for field amount provided',
    cause: 'El monto viaja con caracteres o valores no permitidos.',
    action: 'Validar la estructura y el formato del cuerpo enviado.',
  },
  {
    service: 'Acumulación',
    http: '400',
    code: 'COMMON_BUSINESS_ERROR',
    match: ['monto mínimo'],
    providerMessage: 'valor inferior al monto mínimo permitido',
    cause: 'La compra no alcanza el monto mínimo para acumular.',
    action: 'Revisar las reglas de negocio de acumulación.',
  },
  {
    service: 'Acumulación',
    http: '400',
    code: 'COMMON_BUSINESS_ERROR',
    match: ['transacciones permitidas por cliente'],
    providerMessage: 'excede transacciones permitidas por cliente en el día',
    cause: 'El cliente alcanzó el límite diario de transacciones.',
    action: 'Informarle que puede continuar otro día.',
  },
  {
    service: 'Acumulación',
    http: '400',
    code: 'COMMON_BUSINESS_ERROR',
    match: ['excede límite permitido'],
    providerMessage: 'Transacción excede límite permitido',
    cause: 'La transacción supera un límite configurado por el programa.',
    action: 'Validar los límites configurados con Puntos Colombia.',
  },
  {
    service: 'Acumulación',
    http: '400',
    code: 'COMMON_BUSINESS_ERROR',
    match: ['corporate account'],
    providerMessage: 'corporate account',
    cause: 'La cuenta es corporativa y no permite la operación.',
    action: 'Informar que la cuenta no es elegible para acumular.',
  },
  {
    service: 'Acumulación',
    http: '400',
    code: 'COMMON_BUSINESS_ERROR',
    match: ['valor en compra máximo'],
    providerMessage: 'excede valor en compra máximo para el día',
    cause: 'El cliente superó el valor máximo diario permitido.',
    action: 'Informarle que alcanzó el límite diario.',
  },
  {
    service: 'Acumulación',
    http: '400',
    code: 'COMMON_BUSINESS_ERROR',
    match: ['autoacumulación'],
    providerMessage: 'Alerta de autoacumulación',
    cause:
      'El programa detectó una regla de autoacumulación: el vendedor acumula sobre su propia compra.',
    action: 'Validar la operación antes de continuar.',
  },
  {
    service: 'Acumulación',
    http: '400',
    code: 'POS_CUSTOMER_WRONG_STATUS',
    providerMessage: 'Customer blocked',
    cause: 'El cliente está bloqueado en el programa.',
    action: 'Informar que la cuenta no está habilitada.',
  },
  {
    service: 'Acumulación',
    http: '400',
    code: 'POS_ACCOUNT_WRONG_STATUS',
    providerMessage: 'Account blocked',
    cause: 'La cuenta está bloqueada.',
    action: 'Informar que la cuenta no está habilitada.',
  },
  {
    service: 'Acumulación',
    http: '400',
    code: 'POS_LOCATION_WRONG_STATUS',
    providerMessage: 'Location closed',
    cause: 'El punto de venta está cerrado.',
    action: 'Revisar el estado del punto de venta con Puntos Colombia.',
  },
  {
    service: 'Acumulación',
    http: '400',
    code: 'POS_IDENTIFIER_WRONG_STATUS',
    providerMessage: 'Identifier closed',
    cause: 'El identificador del cliente está cerrado.',
    action: 'Revisar el estado del identificador.',
  },
  {
    service: 'Acumulación',
    http: '400',
    code: 'POS_TRN_ACCOUNT_ASYNC_PROCESSING',
    providerMessage: 'Asynchronous transaction is being processed',
    cause: 'Hay una transacción asíncrona del cliente en proceso.',
    action: 'Reintentar más tarde.',
  },
  {
    service: 'Acumulación',
    http: '404',
    code: 'POS_IDENTIFIER_NOT_FOUND_OR_CLOSED',
    providerMessage: 'Identifier not found or closed',
    cause: 'El documento no existe o está cerrado.',
    action: 'Validar la información del documento.',
  },
  {
    service: 'Acumulación',
    http: '404',
    code: 'COMMON_PARTNER_NOT_FOUND',
    providerMessage: 'Provided partner does not exist',
    cause: 'El PartnerCode configurado no existe.',
    action: 'Revisar el PartnerCode en la configuración del CRM.',
  },
  {
    service: 'Acumulación',
    http: '404',
    code: 'ERR_BAD_REQUEST',
    providerMessage: 'Request failed with status code 404',
    cause: 'Un servicio interno del proveedor no encontró el recurso.',
    action: 'Revisar la configuración y los parámetros enviados.',
  },
  {
    service: 'Acumulación',
    http: '422',
    code: 'UNPROCESSABLE_ENTITY',
    match: ['documentNo'],
    providerMessage: '"documentNo" is not allowed to be empty',
    cause: 'La petición viajó sin número de documento.',
    action: 'Verificar que el documento del cliente llegue a la petición.',
  },
  {
    service: 'Acumulación',
    http: '500',
    code: 'ECONNABORTED',
    match: ['timeout exceeded'],
    providerMessage: 'timeout exceeded',
    cause: 'El proveedor no respondió dentro del tiempo de espera.',
    action: 'Reintentar la transacción.',
  },
  {
    service: 'Acumulación',
    http: '500',
    code: 'ECONNRESET',
    providerMessage: 'read ECONNRESET',
    cause: 'El proveedor cortó la conexión durante la petición.',
    action: 'Reintentar la transacción.',
  },
  {
    service: 'Acumulación',
    http: '503',
    code: 'ERR_BAD_RESPONSE',
    providerMessage: 'Service Unavailable',
    cause: 'El servicio del proveedor no estaba disponible.',
    action: 'Reintentar más tarde.',
  },

  // --- Solicitud del método de autenticación -------------------------------------------------
  {
    service: 'Solicitud Método de Autenticación',
    http: '400',
    code: 'COMMON_FIELD_MANDATORY',
    match: ['value', 'method'],
    providerMessage: "Mandatory field 'value|method' not provided in body.",
    cause: 'Faltó el valor o el método con el que se pide el código.',
    action: 'Validar que method y value viajen según corresponda.',
  },
  {
    service: 'Solicitud Método de Autenticación',
    http: '400',
    code: 'MAX_SEND_OTP_ATTEMPTS_EXCEEDED',
    providerMessage: 'Maximum attempts exceeded to send otp in a one minute',
    cause: 'Se superó el máximo de códigos solicitados en un minuto.',
    action: 'Esperar antes de pedir un código nuevo.',
  },
  {
    service: 'Solicitud Método de Autenticación',
    http: '400',
    code: 'BAD_REQUEST',
    providerMessage:
      'The server cannot or will not process the request due to an apparent client error.',
    cause: 'La petición tiene un error de formato o de estructura.',
    action: 'Validar el cuerpo enviado y los campos requeridos.',
  },
  {
    service: 'Solicitud Método de Autenticación',
    http: '404',
    code: 'ERR_BAD_REQUEST',
    providerMessage: 'Request failed with status code 404',
    cause: 'Un servicio interno del proveedor no encontró el recurso.',
    action: 'Validar el endpoint, los parámetros y la configuración de la integración.',
  },
  {
    service: 'Solicitud Método de Autenticación',
    http: '422',
    code: 'UNPROCESSABLE_ENTITY',
    match: ['must be one of'],
    providerMessage: '"documentNo" must be one of [string, number]',
    cause: 'El documento no viajó como texto ni como número.',
    action: 'Enviar el documento como string o number.',
  },
  {
    service: 'Solicitud Método de Autenticación',
    http: '422',
    code: 'UNPROCESSABLE_ENTITY',
    match: ['alpha-numeric'],
    providerMessage: '"documentNumber" must only contain alpha-numeric characters',
    cause: 'El documento contiene caracteres no permitidos.',
    action: 'Enviar el documento solo con caracteres alfanuméricos.',
  },

  // --- Redención -----------------------------------------------------------------------------
  {
    service: 'Redención',
    http: '400',
    code: 'POS_TRN_NOT_ENOUGH_POINTS',
    providerMessage: 'Not enough points. Available: {available}, required: {required}',
    cause: 'La cuenta no tiene puntos suficientes para la redención.',
    action: 'Informarle al cliente que no alcanza el saldo para redimir.',
  },
  {
    service: 'Redención',
    http: '400',
    code: 'BAD_REQUEST',
    providerMessage: 'The provided data does not contain a valid format.',
    cause: 'La petición no tiene un formato válido.',
    action: 'Validar la estructura, los tipos de datos y los campos enviados.',
  },
  {
    service: 'Redención',
    http: '400',
    code: 'POS_ACCOUNT_WRONG_STATUS',
    providerMessage: 'Status of retrieved Account does not allow this operation.',
    cause: 'El estado de la cuenta no permite redimir.',
    action: 'Informar que la cuenta no está habilitada para redención.',
  },
  {
    service: 'Redención',
    http: '400',
    code: 'POS_DUPLICATE_TRANSACTION',
    providerMessage: 'Transaction with specified identifier already exists',
    cause: 'La redención ya se había procesado con ese identificador.',
    action: 'Revisar el identificador y no reprocesar la operación.',
  },
  {
    service: 'Redención',
    http: '400',
    code: 'POS_LOCATION_NOT_OF_PARTNER',
    providerMessage: 'Location provided does not belong to provided partner',
    cause: 'El punto de venta del usuario no pertenece al partner configurado.',
    action: 'Revisar la relación entre PartnerCode y el punto de venta del usuario.',
  },
  {
    service: 'Redención',
    http: '400',
    code: 'POS_IDENTIFIER_WRONG_STATUS',
    providerMessage: 'Status of retrieved Identifier does not allow this operation: Closed',
    cause: 'El identificador del cliente está cerrado.',
    action: 'Revisar el estado del identificador asociado al cliente.',
  },
  {
    service: 'Redención',
    http: '400',
    code: 'COMMON_BUSINESS_ERROR',
    match: ['valor mínimo de redención'],
    providerMessage:
      'El valor mínimo de redención son 200 puntos o su equivalente en dinero de 1400$.',
    cause: 'La redención no alcanza el mínimo permitido.',
    action: 'Informarle al cliente el mínimo requerido para redimir.',
  },
  {
    service: 'Redención',
    http: '400',
    code: 'COMMON_BUSINESS_ERROR',
    match: ['segment of customers'],
    providerMessage: 'Transaction not allowed to this segment of customers.',
    cause: 'La redención no está permitida para el segmento del cliente.',
    action: 'Informar que la redención no está disponible para ese cliente.',
  },
  {
    service: 'Redención',
    http: '400',
    code: 'COMMON_BUSINESS_ERROR',
    match: ['Redemption is blocked for customer'],
    providerMessage: 'Redemption is blocked for customer {customerId}',
    cause: 'La redención está bloqueada para ese cliente.',
    action: 'Informar que la redención no está habilitada.',
  },
  {
    service: 'Redención',
    http: '401',
    code: 'UNAUTHORIZED_VERIFICATION_CODE_NOT_VALID',
    providerMessage: 'Some of the data provided are not valid or does not exist.',
    cause: 'El código de verificación, el PIN o la clave dinámica no es válido.',
    action: 'Pedirle al cliente que revise el código o genere uno nuevo.',
  },
  {
    service: 'Redención',
    http: '404',
    code: 'ERR_BAD_REQUEST',
    providerMessage: 'Request failed with status code 404',
    cause: 'Un servicio interno del proveedor no encontró el recurso.',
    action: 'Validar los parámetros, el endpoint y la configuración de la integración.',
  },
  {
    service: 'Redención',
    http: '422',
    code: 'UNPROCESSABLE_ENTITY',
    match: ['pin'],
    providerMessage: '"pin" is not allowed to be empty',
    cause: 'La redención viajó sin el PIN del cliente.',
    action: 'Enviar el campo pin con el código correspondiente.',
  },
  {
    service: 'Redención',
    http: '429',
    code: 'USER_BLOCKED',
    providerMessage: 'The maximum number of daily attempts has been exceeded by invalid password.',
    cause: 'El cliente superó el máximo de intentos diarios con código inválido.',
    action: 'Informarle que debe intentar más tarde o seguir el proceso de Puntos Colombia.',
  },
  {
    service: 'Redención',
    http: '500',
    code: 'ECONNABORTED',
    match: ['timeout of 2000ms'],
    providerMessage: 'timeout of 2000ms exceeded',
    cause: 'El proveedor no respondió dentro del tiempo de espera (2 s).',
    action: 'Reintentar según la estrategia definida para errores técnicos.',
  },
  {
    service: 'Redención',
    http: '500',
    code: 'ECONNABORTED',
    match: ['timeout of 10000ms'],
    providerMessage: 'timeout of 10000ms exceeded',
    cause: 'El proveedor no respondió dentro del tiempo de espera (10 s).',
    action: 'Reintentar según la estrategia definida para errores técnicos.',
  },
  {
    service: 'Redención',
    http: '500',
    code: 'TRANS_NOT_ALLOWED',
    providerMessage: 'This operation is not allowed due to an error validating.',
    cause: 'La operación falló al validarse del lado del proveedor.',
    action: 'Reintentar o escalar a soporte si persiste.',
  },
  {
    service: 'Redención',
    http: '500',
    code: 'ECONNRESET',
    match: ['socket hang up'],
    providerMessage: 'socket hang up',
    cause: 'El proveedor cortó la conexión durante la petición.',
    action: 'Reintentar la operación.',
  },
  {
    service: 'Redención',
    http: '500',
    code: 'ECONNRESET',
    match: ['read ECONNRESET'],
    providerMessage: 'read ECONNRESET',
    cause: 'El proveedor cortó la conexión durante la petición.',
    action: 'Reintentar la operación.',
  },
  {
    service: 'Redención',
    http: '500',
    code: 'ERR_BAD_RESPONSE',
    match: ['status code 500'],
    providerMessage: 'Request failed with status code 500',
    cause: 'El proveedor devolvió un error interno.',
    action: 'Reintentar o escalar a soporte si persiste.',
  },
  {
    service: 'Redención',
    http: '500',
    code: 'ERR_BAD_RESPONSE',
    match: ['Service Unavailable'],
    providerMessage: 'Service Unavailable',
    cause: 'El servicio del proveedor no estaba disponible.',
    action: 'Reintentar más tarde.',
  },
];

/** Lo que el panel de administración muestra como diagnóstico de una operación fallida. */
export type PointsErrorDiagnosis = {
  code: string;
  service: string;
  http: string;
  cause: string;
  action: string;
  /** Mensaje del proveedor que se conservó como evidencia. */
  providerMessage: string;
};

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Traduce el error guardado a causa y acción recomendada.
 *
 * El código no basta cuando el proveedor reutiliza uno solo para varios motivos, así que se filtra
 * con los fragmentos del mensaje. Si el código no aparece, o sigue siendo ambiguo después del
 * mensaje, devuelve `null`: quien lo muestra conserva entonces el código crudo.
 */
export function describePointsError(input: {
  code: string | null | undefined;
  message?: string | null;
  /** Servicio en el que ocurrió, para no cruzar el mismo código entre acumulación y redención. */
  service?: PointsErrorService | null;
}): PointsErrorDiagnosis | null {
  const code = input.code?.trim();
  if (!code) return null;

  const byCode = catalog.filter((entry) => entry.code.toLowerCase() === code.toLowerCase());
  if (byCode.length === 0) return null;
  if (byCode.length === 1 && !byCode[0]?.match) return toDiagnosis(byCode[0]!);

  // El servicio acota cuando puede; si el código solo existe en otro, se sigue con todos, porque la
  // causa suele ser la misma y perderla dejaría el error sin explicar.
  const scoped = input.service ? byCode.filter((entry) => entry.service === input.service) : byCode;
  const candidates = scoped.length > 0 ? scoped : byCode;
  if (candidates.length === 1) return toDiagnosis(candidates[0]!);

  const message = normalize(input.message ?? '');
  const byMessage = candidates.filter((entry) =>
    (entry.match ?? []).some((fragment) => message.includes(normalize(fragment))),
  );
  if (byMessage.length === 1) return toDiagnosis(byMessage[0]!);
  if (byMessage.length > 1) return sameExplanation(byMessage);

  // Sin coincidencia por mensaje: si todas las entradas explican lo mismo, la distinción daba igual.
  return sameExplanation(candidates);
}

/**
 * Devuelve la primera explicación si todas las entradas coinciden en la causa.
 *
 * Se compara la causa y no la acción: el mismo problema descrito en dos servicios puede recomendar
 * pasos algo distintos —«revisar el PartnerCode y el código» frente a «revisar la relación entre
 * ambos»—, pero si la causa es la misma, la explicación sirve igual. Es lo que permite explicar un
 * error de punto de venta que el proveedor documenta en la consulta de cuenta y que la acumulación
 * termina mostrando.
 */
function sameExplanation(entries: readonly PointsErrorEntry[]): PointsErrorDiagnosis | null {
  const [first] = entries;
  if (!first) return null;
  return entries.every((entry) => entry.cause === first.cause) ? toDiagnosis(first) : null;
}

function toDiagnosis(entry: PointsErrorEntry): PointsErrorDiagnosis {
  return {
    code: entry.code,
    service: entry.service,
    http: entry.http,
    cause: entry.cause,
    action: entry.action,
    providerMessage: entry.providerMessage,
  };
}

/** Cuántos casos cubre el catálogo. Sirve para comprobar que el documento no quedó a medias. */
export const pointsErrorCatalogSize = catalog.length;
