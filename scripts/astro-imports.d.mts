export interface Rule {
  name: string;
  from?: object;
  to?: object;
}

export interface AstroImportViolation {
  file: string;
  specifier: string;
  rule: string;
}

export function importSpecifiers(source: string): string[];
export function violationsInSource(file: string, source: string, forbidden: Rule[]): AstroImportViolation[];
export function scanAstroFiles(roots: string[], forbidden: Rule[], baseDir: string): Promise<AstroImportViolation[]>;
