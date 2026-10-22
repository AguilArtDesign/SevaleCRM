/**
 * Lee un CSV con el subconjunto de RFC 4180 que usan los archivos del CRM: comas sin comillas,
 * campos entre comillas dobles y comillas escapadas como `""`. Devuelve filas de celdas crudas.
 *
 * No se usa una librería porque el parser del proyecto tiene que ser idéntico en la vista previa y
 * en la importación, y porque así no se añade una dependencia por unas pocas decenas de líneas.
 */
export function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"') {
        if (csv[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) quoted = true;
    else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
      rows.push(row);
      row = [];
      field = '';
    } else field += character;
  }

  if (quoted) throw new Error('Hay un campo entre comillas que no fue cerrado.');
  if (field.length > 0 || row.length > 0) {
    row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
    rows.push(row);
  }
  return rows;
}

/** Normaliza un encabezado para compararlo: sin BOM, sin acentos, minúsculas y sin separadores. */
export function normalizeHeader(header: string, index: number): string {
  const withoutBom = index === 0 ? header.replace(/^\uFEFF/, '') : header;
  return withoutBom
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}
