/**
 * Lecteur CSV (RFC 4180) sans dépendance.
 * - guillemets, guillemets doublés, retours à la ligne dans un champ ;
 * - séparateur détecté parmi « , », « ; » et tabulation ;
 * - BOM UTF-8 retiré, fins de ligne CRLF ou LF ;
 * - lignes entièrement vides ignorées.
 * Conçu pour des exports de plusieurs centaines de milliers de lignes.
 */

export type Delimiter = ',' | ';' | '\t';

export interface CsvTable {
  headers: string[];
  rows: string[][];
  delimiter: Delimiter;
}

/** Devine le séparateur à partir de la première ligne (hors guillemets). */
export function detectDelimiter(text: string): Delimiter {
  const firstLine = text.slice(0, Math.min(text.length, 4096)).split(/\r?\n/, 1)[0] ?? '';
  const counts: Record<Delimiter, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === ',' || ch === ';' || ch === '\t')) counts[ch]++;
  }
  const best = (Object.entries(counts) as [Delimiter, number][]).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ',';
}

export function parseCsv(input: string, delimiter?: Delimiter): CsvTable {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const sep = delimiter ?? detectDelimiter(text);
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const n = text.length;

  const endRecord = () => {
    record.push(field);
    field = '';
    if (!(record.length === 1 && record[0].trim() === '')) records.push(record);
    record = [];
  };

  while (i < n) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      // Lecture rapide jusqu'au prochain guillemet.
      const next = text.indexOf('"', i);
      if (next === -1) {
        field += text.slice(i);
        i = n;
      } else {
        field += text.slice(i, next);
        i = next;
      }
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
      i++;
    } else if (ch === sep) {
      record.push(field);
      field = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      endRecord();
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
    } else {
      // Lecture rapide d'un champ non quoté.
      let j = i;
      while (j < n) {
        const c = text[j];
        if (c === sep || c === '\n' || c === '\r') break;
        j++;
      }
      field += text.slice(i, j);
      i = j;
    }
  }
  if (field !== '' || record.length > 0) endRecord();

  const [headerRow = [], ...rows] = records;
  return { headers: headerRow.map((h) => h.trim()), rows, delimiter: sep };
}

/** Échappe une valeur pour l'écriture CSV. */
export function csvCell(value: string | undefined, delimiter: Delimiter = ','): string {
  const v = value ?? '';
  return /["\r\n]/.test(v) || v.includes(delimiter) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(headers: string[], rows: (string | undefined)[][], delimiter: Delimiter = ','): string {
  const line = (cells: (string | undefined)[]) => cells.map((c) => csvCell(c, delimiter)).join(delimiter);
  return [line(headers), ...rows.map(line)].join('\r\n') + '\r\n';
}
