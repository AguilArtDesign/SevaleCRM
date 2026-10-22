export type CsvBatch = {
  /** CSV completo del lote: encabezado + sus filas. Es lo que se envía en una petición. */
  csv: string;
  /** Filas de datos del lote, sin contar el encabezado. */
  rows: number;
};

/**
 * Parte las líneas respetando las comillas: un campo entre comillas puede contener saltos de línea y
 * cortar ahí corrompería la fila. Es la misma regla que aplica el parser del backend.
 */
function splitLines(text: string): string[] {
  const lines: string[] = [];
  let current = '';
  let quoted = false;
  let atFieldStart = true;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quoted) {
      current += character;
      if (character === '"') {
        if (text[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      }
      continue;
    }

    if (character === '"' && atFieldStart) {
      quoted = true;
      atFieldStart = false;
      current += character;
      continue;
    }

    if (character === '\n') {
      lines.push(current.endsWith('\r') ? current.slice(0, -1) : current);
      current = '';
      atFieldStart = true;
      continue;
    }

    if (character === ',') atFieldStart = true;
    else atFieldStart = false;
    current += character;
  }

  if (current.length > 0) {
    lines.push(current.endsWith('\r') ? current.slice(0, -1) : current);
  }
  return lines;
}

/**
 * Divide el archivo en lotes para no enviar 20 MB en un solo POST. El tamaño del lote se adapta a la
 * longitud media de las filas, para quedar siempre por debajo del límite de la API aunque el archivo
 * traiga nombres de empresa largos.
 */
export function splitCsvBatches(text: string, maxBatchChars = 600_000): CsvBatch[] {
  const lines = splitLines(text);
  const header = lines[0] ?? '';
  const dataLines = lines.slice(1).filter((line) => line.trim());

  if (dataLines.length === 0) return [{ csv: header, rows: 0 }];

  const averageLength = Math.max(
    1,
    Math.ceil(dataLines.reduce((total, line) => total + line.length + 1, 0) / dataLines.length),
  );
  const rowsPerBatch = Math.max(200, Math.min(4_000, Math.floor(maxBatchChars / averageLength)));

  const batches: CsvBatch[] = [];
  for (let index = 0; index < dataLines.length; index += rowsPerBatch) {
    const group = dataLines.slice(index, index + rowsPerBatch);
    batches.push({ csv: [header, ...group].join('\n'), rows: group.length });
  }
  return batches;
}
