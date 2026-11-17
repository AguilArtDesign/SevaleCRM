import type { PointsErrorDiagnosis } from '@sevale/shared';

/**
 * Traducción de un error del proveedor, para el administrador.
 *
 * El comercial ve el mensaje corto del panel, que es el que entiende; esto es lo que permite saber
 * qué pasó de verdad sin abrir los Logs. Va aparte del aviso rojo a propósito: no es el error, es su
 * explicación, y mezclarlos haría que el operador creyera que hay dos fallos.
 *
 * Solo se renderiza cuando el API manda el diagnóstico, y el API solo lo manda al administrador.
 */
export function PointsErrorDiagnosisBox({
  label,
  diagnosis,
  code,
  message,
}: {
  label: string;
  diagnosis: PointsErrorDiagnosis | null;
  code?: string | null;
  message?: string | null;
}) {
  // Sin diagnóstico no hay nada que explicar: el aviso con el mensaje ya está arriba.
  if (!diagnosis) return null;

  return (
    <div className="points-diagnosis">
      <strong className="points-diagnosis-title">{label}</strong>
      <dl>
        <div>
          <dt>Servicio</dt>
          <dd>
            {diagnosis.service} · HTTP {diagnosis.http}
          </dd>
        </div>
        <div>
          <dt>Código del proveedor</dt>
          <dd>
            <code>{diagnosis.code}</code>
          </dd>
        </div>
        <div>
          <dt>Causa</dt>
          <dd>{diagnosis.cause}</dd>
        </div>
        <div>
          <dt>Acción recomendada</dt>
          <dd>{diagnosis.action}</dd>
        </div>
        {(code || message) && (
          <div>
            <dt>Respuesta original</dt>
            <dd className="points-diagnosis-raw">{message || code}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
