/** Point d'entrée de l'import : reconnaît le format d'un fichier. */
import { parseCsv, type CsvTable } from './csv';
import { detectBinanceLedger } from './binance';
import { offsetFromFileName } from './common';
import { isPmpaFormat } from './generic';

export type DetectedFile =
  | { kind: 'binance'; fileName: string; table: CsvTable; offsetMinutes: number | null }
  | { kind: 'pmpa'; fileName: string; table: CsvTable }
  | { kind: 'generic'; fileName: string; table: CsvTable }
  | { kind: 'error'; fileName: string; message: string };

export function detectFile(text: string, fileName: string): DetectedFile {
  if (!text.trim()) return { kind: 'error', fileName, message: 'Le fichier est vide.' };
  let table: CsvTable;
  try {
    table = parseCsv(text);
  } catch {
    return { kind: 'error', fileName, message: "Ce fichier n'est pas un CSV lisible." };
  }
  if (table.headers.length < 2) return { kind: 'error', fileName, message: "Une seule colonne détectée : ce fichier n'est pas un CSV de transactions." };
  if (table.rows.length === 0) return { kind: 'error', fileName, message: 'Le fichier ne contient aucune ligne de données.' };
  if (detectBinanceLedger(table.headers)) return { kind: 'binance', fileName, table, offsetMinutes: offsetFromFileName(fileName) };
  if (isPmpaFormat(table.headers)) return { kind: 'pmpa', fileName, table };
  return { kind: 'generic', fileName, table };
}

export type { ImportReport, IgnoredGroup } from './common';
