import { useState, useMemo, useRef } from 'react';

// ─── Interfaces ───────────────────────────────────────────────────────────────
interface ParsedTable {
  headers: string[];
  rows: string[][];
  rawText: string;
  fileName: string;
  delimiter: string;
}

interface AuditRow {
  index: number;
  id: string;
  matricula: string;
  nome?: string;
  status: 'valid' | 'rescindido' | 'duplicate_id' | 'duplicate_mat';
  reason: string;
  originalRow: string[];
}

interface RescindidoInfo {
  matricula: string;
  nome?: string;
  dataExon?: string;
  orgao?: string;
}

// ─── CSV / Table Parser ───────────────────────────────────────────────────────
function parseCsvOrTable(text: string, fileName = 'dados.csv'): ParsedTable {
  // Strip UTF-8 BOM if present
  const cleanText = text.replace(/^\uFEFF/, '').trim();
  if (!cleanText) {
    return { headers: [], rows: [], rawText: '', fileName, delimiter: ';' };
  }

  const lines = cleanText.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length === 0) {
    return { headers: [], rows: [], rawText: cleanText, fileName, delimiter: ';' };
  }

  // Detect delimiter (\t from Excel, or ;, or ,)
  const firstLine = lines[0];
  let delimiter = ';';
  const tabs = (firstLine.match(/\t/g) || []).length;
  const semicolons = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;

  if (tabs > semicolons && tabs > commas) {
    delimiter = '\t';
  } else if (semicolons >= commas) {
    delimiter = ';';
  } else {
    delimiter = ',';
  }

  const parseRow = (line: string): string[] => {
    if (delimiter === '\t') {
      return line.split('\t').map(c => c.trim().replace(/^["']|["']$/g, ''));
    }
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseRow(lines[0]);
  const rows = lines.slice(1).map(parseRow);
  return { headers, rows, rawText: cleanText, fileName, delimiter };
}

// ─── CSV Exporter Helper ─────────────────────────────────────────────────────
function downloadCsv(headers: string[], rows: string[][], filename: string, delimiter = ';') {
  const escapeCell = (cell: string) => {
    if (!cell) return '';
    if (cell.includes(delimiter) || cell.includes('"') || cell.includes('\n') || cell.includes('\r')) {
      return `"${cell.replace(/"/g, '""')}"`;
    }
    return cell;
  };

  const headerLine = headers.map(escapeCell).join(delimiter);
  const dataLines = rows.map(r => r.map(escapeCell).join(delimiter));
  const csvContent = '\uFEFF' + [headerLine, ...dataLines].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ComparePage() {
  // Mode: 'dual-csv' (recommended) vs 'single-table' (legacy/single-column paste)
  const [workflowMode, setWorkflowMode] = useState<'dual-csv' | 'single-table'>('dual-csv');

  // File 1: Lançamentos / Eventos (Ex: CUBO)
  const [lancadosData, setLancadosData] = useState<ParsedTable | null>(null);
  const [lancadosText, setLancadosText] = useState('');
  const [selectedLancadosIdCol, setSelectedLancadosIdCol] = useState('');
  const [selectedLancadosMatCol, setSelectedLancadosMatCol] = useState('');
  const [selectedLancadosNomeCol, setSelectedLancadosNomeCol] = useState('');
  const [dragLancados, setDragLancados] = useState(false);
  const fileLancadosInputRef = useRef<HTMLInputElement>(null);

  // File 2: Rescindidos (Ex: Rescindidos Setembro)
  const [rescindidosData, setRescindidosData] = useState<ParsedTable | null>(null);
  const [rescindidosText, setRescindidosText] = useState('');
  const [selectedRescindidosMatCol, setSelectedRescindidosMatCol] = useState('');
  const [selectedRescindidosNomeCol, setSelectedRescindidosNomeCol] = useState('');
  const [dragRescindidos, setDragRescindidos] = useState(false);
  const fileRescindidosInputRef = useRef<HTMLInputElement>(null);

  // Legacy single table state
  const [singleTableText, setSingleTableText] = useState('');
  const [singleRescindidosCol, setSingleRescindidosCol] = useState('');

  // Deduplication & Filtering Options
  const [filterRescindidos, setFilterRescindidos] = useState(true);
  const [removeDuplicateIds, setRemoveDuplicateIds] = useState(true);
  const [removeDuplicateMatriculas, setRemoveDuplicateMatriculas] = useState(false);
  const [ignoreLeadingZeros, setIgnoreLeadingZeros] = useState(true);
  const [caseInsensitive, setCaseInsensitive] = useState(true);
  const [trimValues, setTrimValues] = useState(true);

  // Output formatting
  const [outputSeparator, setOutputSeparator] = useState<string>('colon'); // default colon for Centi
  const [customSeparator, setCustomSeparator] = useState('');

  // UI tabs & states
  const [activeResultTab, setActiveResultTab] = useState<'valid-ids' | 'clean-csv' | 'removed-rows' | 'audit'>('valid-ids');
  const [copiedIds, setCopiedIds] = useState(false);
  const [copiedRemoved, setCopiedRemoved] = useState(false);
  const [auditSearch, setAuditSearch] = useState('');

  // ─── Normalization Helper ───────────────────────────────────────────────────
  const normalize = (val: string): string => {
    let res = val || '';
    if (trimValues) res = res.trim();
    if (caseInsensitive) res = res.toLowerCase();
    if (ignoreLeadingZeros) {
      res = res.replace(/^0+(?=\d)/, '');
    }
    return res;
  };

  // ─── File Load Handlers ─────────────────────────────────────────────────────
  const loadLancadosFromFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) || '';
      const parsed = parseCsvOrTable(text, file.name);
      setLancadosData(parsed);
      setLancadosText(text);
      autoDetectLancadosCols(parsed.headers);
    };
    reader.readAsText(file, 'UTF-8');
  };

  const loadRescindidosFromFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) || '';
      const parsed = parseCsvOrTable(text, file.name);
      setRescindidosData(parsed);
      setRescindidosText(text);
      autoDetectRescindidosCols(parsed.headers);
    };
    reader.readAsText(file, 'UTF-8');
  };

  // Auto-detect columns for Lançamentos
  const autoDetectLancadosCols = (headers: string[]) => {
    if (!headers || headers.length === 0) return;

    // Detect ID column: matches "id", "id evento", "codigo" (usually first col)
    const idIdx = headers.findIndex(h => /^(id|id\s*evento|c[oó]digo|cod)($|_|\s)/i.test(h.trim()));
    setSelectedLancadosIdCol(idIdx !== -1 ? headers[idIdx] : headers[0]);

    // Detect Matrícula column: matches "matricula", "matrícula", "matr", "cod func"
    const matIdx = headers.findIndex(h => /matr[ií]cula|cod.*func|id.*func/i.test(h.trim()));
    if (matIdx !== -1) {
      setSelectedLancadosMatCol(headers[matIdx]);
    } else if (headers.length > 4) {
      setSelectedLancadosMatCol(headers[4]); // Coluna E (índice 4 no CUBO)
    } else if (headers.length > 1) {
      setSelectedLancadosMatCol(headers[1]);
    }

    // Detect Nome column
    const nomeIdx = headers.findIndex(h => /nome|servidor|funcion[aá]rio/i.test(h.trim()));
    if (nomeIdx !== -1) {
      setSelectedLancadosNomeCol(headers[nomeIdx]);
    }
  };

  // Auto-detect columns for Rescindidos
  const autoDetectRescindidosCols = (headers: string[]) => {
    if (!headers || headers.length === 0) return;

    // Detect Matrícula column
    const matIdx = headers.findIndex(h => /matr[ií]cula|matricula|cod.*func/i.test(h.trim()));
    if (matIdx !== -1) {
      setSelectedRescindidosMatCol(headers[matIdx]);
    } else if (headers.length > 5) {
      setSelectedRescindidosMatCol(headers[5]); // Coluna F (índice 5 nos rescindidos)
    } else if (headers.length > 0) {
      setSelectedRescindidosMatCol(headers[0]);
    }

    // Detect Nome column
    const nomeIdx = headers.findIndex(h => /nome|servidor/i.test(h.trim()));
    if (nomeIdx !== -1) {
      setSelectedRescindidosNomeCol(headers[nomeIdx]);
    }
  };

  // Swap files (in case the user uploaded inverted)
  const handleSwapFiles = () => {
    const oldLancData = lancadosData;
    const oldLancText = lancadosText;
    const oldRescData = rescindidosData;
    const oldRescText = rescindidosText;

    setLancadosData(oldRescData);
    setLancadosText(oldRescText);
    setRescindidosData(oldLancData);
    setRescindidosText(oldLancText);

    if (oldRescData) autoDetectLancadosCols(oldRescData.headers);
    if (oldLancData) autoDetectRescindidosCols(oldLancData.headers);
  };

  // Paste from clipboard helper
  const handlePasteClipboardLancados = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        const parsed = parseCsvOrTable(text, 'colado_lancamentos.csv');
        setLancadosData(parsed);
        setLancadosText(text);
        autoDetectLancadosCols(parsed.headers);
      }
    } catch {
      alert('Permissão de colar negada ou use Ctrl+V.');
    }
  };

  const handlePasteClipboardRescindidos = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        const parsed = parseCsvOrTable(text, 'colado_rescindidos.csv');
        setRescindidosData(parsed);
        setRescindidosText(text);
        autoDetectRescindidosCols(parsed.headers);
      }
    } catch {
      alert('Permissão de colar negada ou use Ctrl+V.');
    }
  };

  // Clear all
  const handleClearAll = () => {
    setLancadosData(null);
    setLancadosText('');
    setSelectedLancadosIdCol('');
    setSelectedLancadosMatCol('');
    setSelectedLancadosNomeCol('');

    setRescindidosData(null);
    setRescindidosText('');
    setSelectedRescindidosMatCol('');
    setSelectedRescindidosNomeCol('');

    setSingleTableText('');
  };

  // Load Demonstration Example (Identical to user images!)
  const handleLoadExcelExample = () => {
    setWorkflowMode('dual-csv');

    // File 1: CUBO (43) - Eventos a Lançar
    const cuboCsv = [
      'Id;Id concess;Órgão;Id Funcion;Matricula;Código Ad;Nome;Dt. Admis;Id Evento;Nome Eve;Integrado;Id da Integ;Document;Origem da;Integraçãc;CPF;Tipo evento',
      '78293794;0;PREFEITURA;42032;3008637;5803339;ALCIONE DE SOUZA;01/02/2020;3359;VOLUS - A;Não integ;0;Sim;FP001;Sim;044.627.001-00;Desconto',
      '78293793;0;PREFEITURA;41861;3008490;5842811;PAULA ADRIANA SILVA;01/03/2021;3359;VOLUS - A;Não integ;0;Sim;FP001;Sim;597.392.311-20;Desconto',
      '78316650;0;FUNDO M;42098;3008702;6735635;MARCIO ROGERIO;15/05/2019;3359;VOLUS - A;Não integ;0;Sim;FP001;Sim;702.432.151-34;Desconto',
      '78306880;0;FUNDO M;42172;3008771;7126336;MAXWELL SILVA;10/01/2022;3359;VOLUS - A;Não integ;0;Sim;FP001;Sim;040.240.841-55;Desconto',
      '78293795;0;PREFEITURA;42254;3008849;7443314;ELIAS VIANA;01/04/2018;3359;VOLUS - A;Não integ;0;Sim;FP001;Sim;042.658.011-88;Desconto',
      '78306881;0;FUNDO M;42271;3008866;7443326;BARBARA ALVES;01/06/2021;3359;VOLUS - A;Não integ;0;Sim;FP001;Sim;012.848.371-99;Desconto',
      '78293789;0;PREFEITURA;40867;3008007;5294600;FRANCISCO CARLOS;12/07/2020;3359;VOLUS - A;Não integ;0;Sim;FP001;Sim;053.984.611-12;Desconto',
      '78306879;0;FUNDO M;40821;3007951;5299085;LUCAS GABRIEL;20/08/2020;3359;VOLUS - A;Não integ;0;Sim;FP001;Sim;701.265.401-44;Desconto',
      // Rescinded employee in September that shouldn't be launched:
      '78319017;0;FUNDO M;48363;3014702;5803400;ELEN CAROLINE;01/02/2019;3359;VOLUS - A;Não integ;0;Sim;FP001;Sim;051.418.451-22;Desconto',
      '78310711;0;PREFEITURA;53339;3019960;5803401;LETICIA MARIA;05/03/2022;3359;VOLUS - A;Não integ;0;Sim;FP001;Sim;021.838.011-33;Desconto',
      // Internal duplicate row to test duplicate removal:
      '78293794;0;PREFEITURA;42032;3008637;5803339;ALCIONE DE SOUZA (DUPLICADA);01/02/2020;3359;VOLUS - A;Não integ;0;Sim;FP001;Sim;044.627.001-00;Desconto'
    ].join('\n');

    // File 2: Rescindidos Setembro
    const rescindidosCsv = [
      'Id;Operacao;CodigoTer;DataExon;IdPessoaF;Matricula;Nome;OrgaoNome',
      '400678;Cadastro;;30/09/2026;48363;3014702;ELEN CAROLINE;FUNDO MUNICIPAL SAUDE RIO VERDE',
      '400680;Cadastro;;30/09/2026;53339;3019960;LETICIA MARIA;PREFEITURA MUNICIPAL DE RIO VERDE',
      '400683;Cadastro;;30/09/2026;53341;3019962;EZEQUIEL COSTA;FUNDO MUNICIPAL SAUDE RIO VERDE',
      '400688;Cadastro;;30/09/2026;53340;3019961;ANNA PAULA;FUNDO MUNICIPAL SAUDE RIO VERDE',
      '400690;Cadastro;;30/09/2026;53342;3019963;WAGNER ROCHA;FUNDO MUNICIPAL SAUDE RIO VERDE',
      '400691;Cadastro;;30/09/2026;53338;3019959;NATANIEL SANTOS;FUNDO MUNICIPAL SAUDE RIO VERDE',
      '401145;Cadastro;;30/09/2026;54719;3021452;FRANCINE DIAS;PREFEITURA MUNICIPAL DE RIO VERDE',
      '401519;Cadastro;;30/09/2026;47781;3014093;MICHELLY SILVA;FUND. DE MAN. E DES. DA EDUC.'
    ].join('\n');

    const parsedLanc = parseCsvOrTable(cuboCsv, 'CUBO (43).csv');
    setLancadosData(parsedLanc);
    setLancadosText(cuboCsv);
    setSelectedLancadosIdCol('Id');
    setSelectedLancadosMatCol('Matricula');
    setSelectedLancadosNomeCol('Nome');

    const parsedResc = parseCsvOrTable(rescindidosCsv, 'Rescindidos Setembro.csv');
    setRescindidosData(parsedResc);
    setRescindidosText(rescindidosCsv);
    setSelectedRescindidosMatCol('Matricula');
    setSelectedRescindidosNomeCol('Nome');
  };

  // ─── Processing Engine: Cross-Check & Deduplication ─────────────────────────
  const processedResult = useMemo(() => {
    if (workflowMode === 'dual-csv') {
      if (!lancadosData || lancadosData.rows.length === 0) {
        return {
          totalRows: 0,
          rescindidosCount: rescindidosData ? rescindidosData.rows.length : 0,
          validRows: [],
          validIds: [],
          removedRows: [],
          auditRows: [],
          headers: lancadosData ? lancadosData.headers : [],
        };
      }

      const headers = lancadosData.headers;
      const idColIdx = headers.indexOf(selectedLancadosIdCol);
      const matColIdx = headers.indexOf(selectedLancadosMatCol);
      const nomeColIdx = headers.indexOf(selectedLancadosNomeCol);

      // Build Set & Map of Rescindidos
      const rescindidosMap = new Map<string, RescindidoInfo>();
      if (rescindidosData && filterRescindidos) {
        const rHeaders = rescindidosData.headers;
        const rMatIdx = rHeaders.indexOf(selectedRescindidosMatCol);
        const rNomeIdx = rHeaders.indexOf(selectedRescindidosNomeCol);
        const rDataExonIdx = rHeaders.findIndex(h => /exon|demiss|data/i.test(h));
        const rOrgaoIdx = rHeaders.findIndex(h => /orgao|órgão/i.test(h));

        for (const rRow of rescindidosData.rows) {
          const rawMat = rMatIdx !== -1 ? rRow[rMatIdx] : rRow[0];
          if (!rawMat) continue;
          const matNorm = normalize(rawMat);
          if (matNorm) {
            rescindidosMap.set(matNorm, {
              matricula: rawMat.trim(),
              nome: rNomeIdx !== -1 ? rRow[rNomeIdx] : undefined,
              dataExon: rDataExonIdx !== -1 ? rRow[rDataExonIdx] : undefined,
              orgao: rOrgaoIdx !== -1 ? rRow[rOrgaoIdx] : undefined,
            });
          }
        }
      }

      const validRows: string[][] = [];
      const validIds: string[] = [];
      const removedRows: AuditRow[] = [];
      const auditRows: AuditRow[] = [];

      const seenIds = new Set<string>();
      const seenMatriculas = new Set<string>();

      lancadosData.rows.forEach((row, idx) => {
        const idVal = idColIdx !== -1 ? (row[idColIdx] ?? '').trim() : (row[0] ?? '').trim();
        const matVal = matColIdx !== -1 ? (row[matColIdx] ?? '').trim() : '';
        const nomeVal = nomeColIdx !== -1 ? (row[nomeColIdx] ?? '').trim() : '';

        const matNorm = normalize(matVal);
        const idNorm = idVal;

        // Check 1: Is this employee rescinded?
        const rescInfo = matNorm !== '' ? rescindidosMap.get(matNorm) : undefined;
        const isRescindido = Boolean(rescInfo);

        // Check 2: Is ID duplicate within lançados?
        const isDuplicateId = idNorm !== '' && seenIds.has(idNorm);

        // Check 3: Is Matrícula duplicate within lançados?
        const isDuplicateMat = matNorm !== '' && seenMatriculas.has(matNorm);

        if (filterRescindidos && isRescindido) {
          const auditItem: AuditRow = {
            index: idx + 1,
            id: idVal,
            matricula: matVal,
            nome: nomeVal || rescInfo?.nome,
            status: 'rescindido',
            reason: `Matrícula consta no arquivo de Rescindidos${rescInfo?.dataExon ? ` (${rescInfo.dataExon})` : ''}`,
            originalRow: row,
          };
          removedRows.push(auditItem);
          auditRows.push(auditItem);
        } else if (removeDuplicateIds && isDuplicateId) {
          const auditItem: AuditRow = {
            index: idx + 1,
            id: idVal,
            matricula: matVal,
            nome: nomeVal,
            status: 'duplicate_id',
            reason: `Linha duplicada: ID "${idVal}" já constava anteriormente`,
            originalRow: row,
          };
          removedRows.push(auditItem);
          auditRows.push(auditItem);
        } else if (removeDuplicateMatriculas && isDuplicateMat) {
          const auditItem: AuditRow = {
            index: idx + 1,
            id: idVal,
            matricula: matVal,
            nome: nomeVal,
            status: 'duplicate_mat',
            reason: `Linha duplicada: Matrícula "${matVal}" já teve lançamento registrado`,
            originalRow: row,
          };
          removedRows.push(auditItem);
          auditRows.push(auditItem);
        } else {
          // Valid row
          if (idNorm) seenIds.add(idNorm);
          if (matNorm) seenMatriculas.add(matNorm);

          if (idVal) validIds.push(idVal);
          validRows.push(row);

          auditRows.push({
            index: idx + 1,
            id: idVal,
            matricula: matVal,
            nome: nomeVal,
            status: 'valid',
            reason: 'Liberado para lançamento',
            originalRow: row,
          });
        }
      });

      return {
        totalRows: lancadosData.rows.length,
        rescindidosCount: rescindidosMap.size,
        validRows,
        validIds,
        removedRows,
        auditRows,
        headers,
      };
    } else {
      // Legacy single table mode
      const parsed = parseCsvOrTable(singleTableText, 'tabela_unica.csv');
      if (parsed.rows.length === 0) {
        return {
          totalRows: 0,
          rescindidosCount: 0,
          validRows: [],
          validIds: [],
          removedRows: [],
          auditRows: [],
          headers: [],
        };
      }

      const headers = parsed.headers;
      const idIdx = headers.findIndex(h => /^id/i.test(h));
      const matIdx = headers.findIndex(h => /matricula/i.test(h));
      const resIdx = headers.indexOf(singleRescindidosCol);

      const rescindidosSet = new Set<string>();
      if (resIdx !== -1) {
        parsed.rows.forEach(r => {
          const v = normalize(r[resIdx] ?? '');
          if (v) rescindidosSet.add(v);
        });
      }

      const validRows: string[][] = [];
      const validIds: string[] = [];
      const removedRows: AuditRow[] = [];
      const auditRows: AuditRow[] = [];
      const seenIds = new Set<string>();

      parsed.rows.forEach((row, idx) => {
        const idVal = idIdx !== -1 ? (row[idIdx] ?? '').trim() : (row[0] ?? '').trim();
        const matVal = matIdx !== -1 ? (row[matIdx] ?? '').trim() : '';
        const matNorm = normalize(matVal);

        const isRescindido = matNorm !== '' && rescindidosSet.has(matNorm);
        const isDuplicateId = idVal !== '' && seenIds.has(idVal);

        if (isRescindido) {
          const item: AuditRow = {
            index: idx + 1,
            id: idVal,
            matricula: matVal,
            status: 'rescindido',
            reason: 'Consta na coluna de rescindidos',
            originalRow: row,
          };
          removedRows.push(item);
          auditRows.push(item);
        } else if (removeDuplicateIds && isDuplicateId) {
          const item: AuditRow = {
            index: idx + 1,
            id: idVal,
            matricula: matVal,
            status: 'duplicate_id',
            reason: 'ID duplicado',
            originalRow: row,
          };
          removedRows.push(item);
          auditRows.push(item);
        } else {
          if (idVal) seenIds.add(idVal);
          validIds.push(idVal);
          validRows.push(row);
          auditRows.push({
            index: idx + 1,
            id: idVal,
            matricula: matVal,
            status: 'valid',
            reason: 'Liberado',
            originalRow: row,
          });
        }
      });

      return {
        totalRows: parsed.rows.length,
        rescindidosCount: rescindidosSet.size,
        validRows,
        validIds,
        removedRows,
        auditRows,
        headers,
      };
    }
  }, [
    workflowMode,
    lancadosData,
    rescindidosData,
    selectedLancadosIdCol,
    selectedLancadosMatCol,
    selectedLancadosNomeCol,
    selectedRescindidosMatCol,
    selectedRescindidosNomeCol,
    singleTableText,
    singleRescindidosCol,
    filterRescindidos,
    removeDuplicateIds,
    removeDuplicateMatriculas,
    ignoreLeadingZeros,
    caseInsensitive,
    trimValues,
  ]);

  // ─── Formatted Output Text (IDs joined by separator) ─────────────────────────
  const formattedOutputText = useMemo(() => {
    const ids = processedResult.validIds;
    if (ids.length === 0) return '';

    let sep = ':';
    if (outputSeparator === 'colon') sep = ':';
    else if (outputSeparator === 'newline') sep = '\n';
    else if (outputSeparator === 'comma') sep = ', ';
    else if (outputSeparator === 'semicolon') sep = '; ';
    else if (outputSeparator === 'custom') sep = customSeparator;

    return ids.join(sep);
  }, [processedResult.validIds, outputSeparator, customSeparator]);

  const removedOutputText = useMemo(() => {
    return processedResult.removedRows
      .map(
        r =>
          `[${r.status === 'rescindido' ? 'RESCINDIDO' : 'DUPLICADO'}] ID: ${r.id} | Matrícula: ${r.matricula}${
            r.nome ? ` | Nome: ${r.nome}` : ''
          } — Motivo: ${r.reason}`
      )
      .join('\n');
  }, [processedResult.removedRows]);

  // Copy helpers
  const handleCopyIds = async () => {
    if (!formattedOutputText) return;
    try {
      await navigator.clipboard.writeText(formattedOutputText);
      setCopiedIds(true);
      setTimeout(() => setCopiedIds(false), 2000);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCopyRemoved = async () => {
    if (!removedOutputText) return;
    try {
      await navigator.clipboard.writeText(removedOutputText);
      setCopiedRemoved(true);
      setTimeout(() => setCopiedRemoved(false), 2000);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDownloadTxt = () => {
    if (!formattedOutputText) return;
    const blob = new Blob([formattedOutputText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ids_eventos_para_envio_${Date.now()}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadCleanCsv = () => {
    if (processedResult.validRows.length === 0 || processedResult.headers.length === 0) return;
    const baseName = lancadosData?.fileName ? lancadosData.fileName.replace(/\.csv$/i, '') : 'lancamentos';
    downloadCsv(processedResult.headers, processedResult.validRows, `${baseName}_SEM_RESCINDIDOS_E_DUPLICADOS.csv`, ';');
  };

  const handleDownloadRemovedCsv = () => {
    if (processedResult.removedRows.length === 0) return;
    const headers = ['ID', 'Matricula', 'Nome', 'Status', 'Motivo da Exclusao'];
    const rows = processedResult.removedRows.map(r => [
      r.id,
      r.matricula,
      r.nome || '',
      r.status === 'rescindido' ? 'Rescindido' : 'Duplicado',
      r.reason,
    ]);
    downloadCsv(headers, rows, `linhas_excluidas_rescindidos_${Date.now()}.csv`, ';');
  };

  // Filtered audit list
  const filteredAuditRows = useMemo(() => {
    if (!auditSearch.trim()) return processedResult.auditRows;
    const term = auditSearch.toLowerCase();
    return processedResult.auditRows.filter(
      r =>
        r.id.toLowerCase().includes(term) ||
        r.matricula.toLowerCase().includes(term) ||
        (r.nome && r.nome.toLowerCase().includes(term)) ||
        r.status.includes(term) ||
        r.reason.toLowerCase().includes(term)
    );
  }, [processedResult.auditRows, auditSearch]);

  const rescindidosCount = processedResult.removedRows.filter(r => r.status === 'rescindido').length;
  const duplicatesCount = processedResult.removedRows.filter(
    r => r.status === 'duplicate_id' || r.status === 'duplicate_mat'
  ).length;

  return (
    <div className="compare-page">
      {/* Top Banner */}
      <div className="compare-top-actions">
        <div className="compare-info-text">
          <h2>Cruzamento de 2 Arquivos CSV: Rescindidos x Lançamentos</h2>
          <p>
            Envie o arquivo dos <strong>Rescindidos</strong> e o arquivo dos <strong>Lançamentos a realizar</strong>. O
            sistema cruza as <strong>Matrículas</strong> de ambos, <strong>elimina automaticamente os funcionários rescindidos</strong> e{' '}
            <strong>as linhas duplicadas</strong>, gerando a lista de IDs pronta para envio ao Centi (com separador de dois pontos) e o CSV limpo completo!
          </p>
        </div>
        <div className="compare-header-btns">
          <button
            type="button"
            className="action-btn-outline"
            onClick={handleLoadExcelExample}
            title="Carregar exemplo idêntico aos dois arquivos das suas imagens"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
            </svg>
            Carregar Exemplo Real (CUBO x Rescindidos)
          </button>

          {(lancadosData || rescindidosData || singleTableText) && (
            <button
              type="button"
              className="action-btn-danger"
              onClick={handleClearAll}
              title="Limpar todos os arquivos carregados"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
              Limpar Tudo
            </button>
          )}
        </div>
      </div>

      {/* Mode Switcher */}
      <div className="compare-mode-switch">
        <button
          type="button"
          className={`mode-pill ${workflowMode === 'dual-csv' ? 'active' : ''}`}
          onClick={() => setWorkflowMode('dual-csv')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="12" y1="18" x2="12" y2="12" />
            <line x1="9" y1="15" x2="15" y2="15" />
          </svg>
          Cruzar 2 Arquivos CSV (Rescindidos x Lançados) - Recomendado
        </button>
        <button
          type="button"
          className={`mode-pill ${workflowMode === 'single-table' ? 'active' : ''}`}
          onClick={() => setWorkflowMode('single-table')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="3" y1="9" x2="21" y2="9"></line>
            <line x1="9" y1="21" x2="9" y2="9"></line>
          </svg>
          Colar Planilha Única do Excel
        </button>
      </div>

      {/* DUAL CSV WORKFLOW */}
      {workflowMode === 'dual-csv' ? (
        <div className="dual-csv-container">
          <div className="dual-csv-grid">
            {/* CARD 1: Arquivo dos que vão ser lançados (Ex: CUBO) */}
            <div className={`csv-card csv-card-lancados ${dragLancados ? 'active-drag' : ''}`}>
              <div className="csv-card-header">
                <div className="csv-card-title-group">
                  <span className="badge badge-primary">Arquivo 1 (Lançamentos)</span>
                  <h3>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    Arquivo a ser Lançado (Ex: CUBO)
                  </h3>
                  <p>Arquivo principal contendo Id, Matrícula, Nome, etc.</p>
                </div>
                <div className="file-drop-actions">
                  <button
                    type="button"
                    className="btn-tiny"
                    onClick={handlePasteClipboardLancados}
                    title="Colar dados copiados do Excel"
                  >
                    📋 Colar
                  </button>
                </div>
              </div>

              {/* Upload or Info */}
              <input
                type="file"
                ref={fileLancadosInputRef}
                accept=".csv,.txt,.tsv"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) loadLancadosFromFile(f);
                }}
              />

              {!lancadosData ? (
                <div
                  className="file-drop-box"
                  onClick={() => fileLancadosInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragLancados(true);
                  }}
                  onDragLeave={() => setDragLancados(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragLancados(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) loadLancadosFromFile(f);
                  }}
                >
                  <div className="file-drop-icon">📁</div>
                  <div className="file-drop-text">Clique ou arraste o CSV a ser lançado aqui</div>
                  <div className="file-drop-subtext">Suporta arquivos .csv, .txt ou copie e clique em Colar</div>
                </div>
              ) : (
                <div className="file-loaded-info">
                  <div>
                    <div className="file-loaded-name">
                      📄 {lancadosData.fileName}
                    </div>
                    <div className="file-loaded-meta">
                      {lancadosData.rows.length} registros • {lancadosData.headers.length} colunas detectadas
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button
                      type="button"
                      className="btn-tiny"
                      onClick={() => fileLancadosInputRef.current?.click()}
                    >
                      Trocar
                    </button>
                    <button
                      type="button"
                      className="btn-tiny btn-tiny-danger"
                      onClick={() => {
                        setLancadosData(null);
                        setLancadosText('');
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}

              {/* Column Selection for Lançamentos */}
              {lancadosData && lancadosData.headers.length > 0 && (
                <div className="col-picker-group">
                  <div className="col-picker-title">Configurar Colunas do Arquivo 1</div>
                  <div className="col-picker-row">
                    <div className="col-picker-field">
                      <label>Coluna com a Matrícula:</label>
                      <select
                        className="col-picker-select"
                        value={selectedLancadosMatCol}
                        onChange={(e) => setSelectedLancadosMatCol(e.target.value)}
                      >
                        {lancadosData.headers.map((h, i) => (
                          <option key={i} value={h}>
                            {i + 1}. {h}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="col-picker-field">
                      <label>Coluna ID (para Centi):</label>
                      <select
                        className="col-picker-select"
                        value={selectedLancadosIdCol}
                        onChange={(e) => setSelectedLancadosIdCol(e.target.value)}
                      >
                        {lancadosData.headers.map((h, i) => (
                          <option key={i} value={h}>
                            {i + 1}. {h}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* CARD 2: Arquivo dos Rescindidos */}
            <div className={`csv-card csv-card-rescindidos ${dragRescindidos ? 'active-drag' : ''}`}>
              <div className="csv-card-header">
                <div className="csv-card-title-group">
                  <span className="badge badge-danger">Arquivo 2 (Rescindidos)</span>
                  <h3>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                    Arquivo de Rescindidos (Ex: Rescindidos Setembro)
                  </h3>
                  <p>Arquivo com a relação de funcionários que foram rescindidos.</p>
                </div>
                <div className="file-drop-actions">
                  <button
                    type="button"
                    className="btn-tiny"
                    onClick={handlePasteClipboardRescindidos}
                    title="Colar dados copiados do Excel"
                  >
                    📋 Colar
                  </button>
                </div>
              </div>

              {/* Upload or Info */}
              <input
                type="file"
                ref={fileRescindidosInputRef}
                accept=".csv,.txt,.tsv"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) loadRescindidosFromFile(f);
                }}
              />

              {!rescindidosData ? (
                <div
                  className="file-drop-box"
                  onClick={() => fileRescindidosInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragRescindidos(true);
                  }}
                  onDragLeave={() => setDragRescindidos(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragRescindidos(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) loadRescindidosFromFile(f);
                  }}
                >
                  <div className="file-drop-icon">🚫</div>
                  <div className="file-drop-text">Clique ou arraste o CSV dos Rescindidos aqui</div>
                  <div className="file-drop-subtext">Suporta arquivos .csv, .txt ou copie e clique em Colar</div>
                </div>
              ) : (
                <div className="file-loaded-info">
                  <div>
                    <div className="file-loaded-name">
                      🚫 {rescindidosData.fileName}
                    </div>
                    <div className="file-loaded-meta">
                      {rescindidosData.rows.length} rescindidos listados • {rescindidosData.headers.length} colunas detectadas
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button
                      type="button"
                      className="btn-tiny"
                      onClick={() => fileRescindidosInputRef.current?.click()}
                    >
                      Trocar
                    </button>
                    <button
                      type="button"
                      className="btn-tiny btn-tiny-danger"
                      onClick={() => {
                        setRescindidosData(null);
                        setRescindidosText('');
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}

              {/* Column Selection for Rescindidos */}
              {rescindidosData && rescindidosData.headers.length > 0 && (
                <div className="col-picker-group">
                  <div className="col-picker-title">Configurar Coluna de Rescindidos</div>
                  <div className="col-picker-row">
                    <div className="col-picker-field" style={{ gridColumn: '1 / -1' }}>
                      <label>Coluna com a Matrícula do Rescindido:</label>
                      <select
                        className="col-picker-select"
                        value={selectedRescindidosMatCol}
                        onChange={(e) => setSelectedRescindidosMatCol(e.target.value)}
                      >
                        {rescindidosData.headers.map((h, i) => (
                          <option key={i} value={h}>
                            {i + 1}. {h}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Swap Button */}
          {lancadosData && rescindidosData && (
            <div className="swap-btn-wrap">
              <button type="button" className="swap-btn" onClick={handleSwapFiles} title="Inverter os dois arquivos">
                ⇄ Inverter Ordem dos Arquivos
              </button>
            </div>
          )}
        </div>
      ) : (
        /* Legacy single table pasted from Excel */
        <div className="card compare-input-card">
          <div className="card-header-flex">
            <div>
              <span className="badge badge-primary">Planilha Única</span>
              <h3 className="card-title-sm">Dados da Planilha Unificada (Excel ou CSV)</h3>
              <p className="card-help-text">
                Cole a planilha que já contenha a coluna de matrícula e a coluna de rescindidos lado a lado.
              </p>
            </div>
          </div>
          <textarea
            className="text-input compare-textarea"
            style={{ minHeight: '160px' }}
            placeholder="Cole aqui os dados copiados do Excel (Ctrl+C e Ctrl+V)..."
            value={singleTableText}
            onChange={(e) => setSingleTableText(e.target.value)}
          />

          {singleTableText && (
            <div className="col-picker-group" style={{ marginTop: '0.75rem' }}>
              <div className="col-picker-title">Configuração de Coluna</div>
              <div className="col-picker-field">
                <label>Qual coluna contém as matrículas dos rescindidos?</label>
                <select
                  className="col-picker-select"
                  value={singleRescindidosCol}
                  onChange={(e) => setSingleRescindidosCol(e.target.value)}
                >
                  <option value="">(Selecione a coluna de rescindidos)</option>
                  {parseCsvOrTable(singleTableText).headers.map((h, i) => (
                    <option key={i} value={h}>
                      Coluna {i + 1}: {h}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Options & Settings Bar */}
      <div className="card compare-options-card">
        <div className="options-grid">
          {/* Deduplication & Matching Toggles */}
          <div className="options-col">
            <label className="options-group-title">Regras de Exclusão & Deduplicação</label>
            <div className="options-toggles">
              <label className="toggle-label" title="Cruza com o arquivo de rescindidos e exclui os funcionários correspondentes">
                <input
                  type="checkbox"
                  checked={filterRescindidos}
                  onChange={(e) => setFilterRescindidos(e.target.checked)}
                />
                <span className="toggle-custom"></span>
                <span><strong>Eliminar funcionários rescindidos</strong> (cruzar matrículas)</span>
              </label>

              <label className="toggle-label" title="Remove linhas que possuem o mesmo ID repetido no arquivo a ser lançado">
                <input
                  type="checkbox"
                  checked={removeDuplicateIds}
                  onChange={(e) => setRemoveDuplicateIds(e.target.checked)}
                />
                <span className="toggle-custom"></span>
                <span><strong>Eliminar IDs duplicados</strong> no arquivo a lançar</span>
              </label>

              <label className="toggle-label" title="Se uma mesma matrícula tiver múltiplos lançamentos, mantém apenas o primeiro">
                <input
                  type="checkbox"
                  checked={removeDuplicateMatriculas}
                  onChange={(e) => setRemoveDuplicateMatriculas(e.target.checked)}
                />
                <span className="toggle-custom"></span>
                <span>Eliminar matrículas repetidas no arquivo a lançar (opcional)</span>
              </label>

              <label className="toggle-label" title="Equipara por exemplo '003014702' com '3014702'">
                <input
                  type="checkbox"
                  checked={ignoreLeadingZeros}
                  onChange={(e) => setIgnoreLeadingZeros(e.target.checked)}
                />
                <span className="toggle-custom"></span>
                <span>Ignorar zeros à esquerda na Matrícula (ex: 00123 = 123)</span>
              </label>

              <label className="toggle-label" title="Remove espaços em branco acidentais nas bordas">
                <input
                  type="checkbox"
                  checked={trimValues}
                  onChange={(e) => setTrimValues(e.target.checked)}
                />
                <span className="toggle-custom"></span>
                <span>Remover espaços em branco extras (trim)</span>
              </label>

              <label className="toggle-label" title="Ignorar se letras estão maiúsculas ou minúsculas">
                <input
                  type="checkbox"
                  checked={caseInsensitive}
                  onChange={(e) => setCaseInsensitive(e.target.checked)}
                />
                <span className="toggle-custom"></span>
                <span>Ignorar maiúsculas/minúsculas</span>
              </label>
            </div>
          </div>

          {/* Separator / Format of Output */}
          <div className="options-col">
            <label className="options-group-title">Separador dos IDs para Envio ao Centi</label>
            <div className="separator-pills-wrap">
              <button
                type="button"
                className={`pill-btn ${outputSeparator === 'colon' ? 'active' : ''}`}
                onClick={() => setOutputSeparator('colon')}
                title="Dois pontos: formato padrão para envio em massa no Centi"
              >
                Dois Pontos ( : )
              </button>
              <button
                type="button"
                className={`pill-btn ${outputSeparator === 'newline' ? 'active' : ''}`}
                onClick={() => setOutputSeparator('newline')}
              >
                Linha por Linha
              </button>
              <button
                type="button"
                className={`pill-btn ${outputSeparator === 'comma' ? 'active' : ''}`}
                onClick={() => setOutputSeparator('comma')}
              >
                Vírgula ( , )
              </button>
              <button
                type="button"
                className={`pill-btn ${outputSeparator === 'semicolon' ? 'active' : ''}`}
                onClick={() => setOutputSeparator('semicolon')}
              >
                Ponto e Vírgula ( ; )
              </button>
              <button
                type="button"
                className={`pill-btn ${outputSeparator === 'custom' ? 'active' : ''}`}
                onClick={() => setOutputSeparator('custom')}
              >
                Outro
              </button>
            </div>

            {outputSeparator === 'custom' && (
              <input
                type="text"
                className="text-input"
                style={{ marginTop: '0.5rem' }}
                placeholder="Ex: - ou | ou espaço"
                value={customSeparator}
                onChange={(e) => setCustomSeparator(e.target.value)}
              />
            )}
          </div>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="compare-metrics-grid">
        <div className="metric-box">
          <div className="metric-header">
            <span className="metric-title">Total no Arquivo a Lançar</span>
            <span className="metric-icon">📄</span>
          </div>
          <div className="metric-value">{processedResult.totalRows}</div>
          <div className="metric-desc">Registros originais no arquivo 1</div>
        </div>

        <div className="metric-box">
          <div className="metric-header">
            <span className="metric-title">Matrículas Rescindidas</span>
            <span className="metric-icon">🚫</span>
          </div>
          <div className="metric-value">{processedResult.rescindidosCount}</div>
          <div className="metric-desc">Carregadas do arquivo 2</div>
        </div>

        <div className="metric-box metric-danger">
          <div className="metric-header">
            <span className="metric-title">Rescindidos Eliminados</span>
            <span className="metric-icon">✂️</span>
          </div>
          <div className="metric-value">{rescindidosCount}</div>
          <div className="metric-desc">Encontrados e excluídos</div>
        </div>

        <div className="metric-box" style={{ borderLeft: '4px solid #f59e0b' }}>
          <div className="metric-header">
            <span className="metric-title">Duplicados Eliminados</span>
            <span className="metric-icon">⚠️</span>
          </div>
          <div className="metric-value">{duplicatesCount}</div>
          <div className="metric-desc">Linhas repetidas retiradas</div>
        </div>

        <div className="metric-box metric-success">
          <div className="metric-header">
            <span className="metric-title">Válidos Liberados</span>
            <span className="metric-icon">🚀</span>
          </div>
          <div className="metric-value">{processedResult.validIds.length}</div>
          <div className="metric-desc">Prontos para lançamento no Centi</div>
        </div>
      </div>

      {/* Results View Tabs */}
      <div className="card compare-result-card">
        <div className="compare-result-tabs-bar">
          <div className="result-tabs-buttons">
            <button
              type="button"
              className={`result-tab-btn ${activeResultTab === 'valid-ids' ? 'active' : ''}`}
              onClick={() => setActiveResultTab('valid-ids')}
            >
              <span className="status-dot dot-success"></span>
              IDs para Envio ({processedResult.validIds.length})
            </button>

            <button
              type="button"
              className={`result-tab-btn ${activeResultTab === 'clean-csv' ? 'active' : ''}`}
              onClick={() => setActiveResultTab('clean-csv')}
            >
              <span className="status-dot dot-info"></span>
              Planilha / CSV Limpo ({processedResult.validRows.length})
            </button>

            <button
              type="button"
              className={`result-tab-btn ${activeResultTab === 'removed-rows' ? 'active' : ''}`}
              onClick={() => setActiveResultTab('removed-rows')}
            >
              <span className="status-dot dot-danger"></span>
              Linhas Eliminadas ({processedResult.removedRows.length})
            </button>

            <button
              type="button"
              className={`result-tab-btn ${activeResultTab === 'audit' ? 'active' : ''}`}
              onClick={() => setActiveResultTab('audit')}
            >
              <span className="status-dot dot-warning"></span>
              Auditoria Completa ({processedResult.auditRows.length})
            </button>
          </div>

          {/* Action buttons on tab header */}
          {activeResultTab === 'valid-ids' && (
            <div className="result-actions-flex">
              <button
                type="button"
                className={`btn-action-primary ${copiedIds ? 'copied' : ''}`}
                onClick={handleCopyIds}
                disabled={processedResult.validIds.length === 0}
              >
                {copiedIds ? (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    IDs Copiados!
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    Copiar IDs para Envio
                  </>
                )}
              </button>
              <button
                type="button"
                className="btn-action-secondary"
                onClick={handleDownloadTxt}
                disabled={processedResult.validIds.length === 0}
                title="Baixar lista de IDs em arquivo .TXT"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                Baixar .TXT
              </button>
            </div>
          )}

          {activeResultTab === 'clean-csv' && (
            <div className="result-actions-flex">
              <button
                type="button"
                className="btn-export-csv"
                onClick={handleDownloadCleanCsv}
                disabled={processedResult.validRows.length === 0}
                title="Baixar a planilha com todas as colunas sem os rescindidos e sem duplicados"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                Baixar CSV Filtrado Completo
              </button>
            </div>
          )}

          {activeResultTab === 'removed-rows' && (
            <div className="result-actions-flex">
              <button
                type="button"
                className={`btn-action-secondary ${copiedRemoved ? 'copied' : ''}`}
                onClick={handleCopyRemoved}
                disabled={processedResult.removedRows.length === 0}
              >
                {copiedRemoved ? 'Copiado!' : 'Copiar Eliminados'}
              </button>
              <button
                type="button"
                className="btn-action-secondary"
                onClick={handleDownloadRemovedCsv}
                disabled={processedResult.removedRows.length === 0}
              >
                📥 Baixar CSV de Excluídos
              </button>
            </div>
          )}
        </div>

        {/* Tab 1: Valid IDs for System Submission */}
        {activeResultTab === 'valid-ids' && (
          <div className="result-content-wrap">
            <textarea
              readOnly
              className="text-input compare-result-textarea"
              value={formattedOutputText}
              placeholder="Envie os dois arquivos CSV acima para gerar os IDs limpos prontos para envio..."
            />
            <div className="result-footer-info">
              <span>{processedResult.validIds.length} IDs liberados para envio ao Centi</span>
              <span>
                Separador ativo:{' '}
                <strong>
                  {outputSeparator === 'colon'
                    ? 'Dois pontos (:)'
                    : outputSeparator === 'newline'
                    ? 'Quebra de linha'
                    : outputSeparator === 'comma'
                    ? 'Vírgula (,)'
                    : outputSeparator === 'semicolon'
                    ? 'Ponto e vírgula (;)'
                    : customSeparator || 'Personalizado'}
                </strong>
              </span>
            </div>
          </div>
        )}

        {/* Tab 2: Clean CSV Table Preview */}
        {activeResultTab === 'clean-csv' && (
          <div className="audit-table-wrap">
            {processedResult.validRows.length === 0 ? (
              <div className="empty-notice">
                <p>Nenhuma linha válida para exibição. Carregue os arquivos CSV acima.</p>
              </div>
            ) : (
              <>
                <div className="audit-search-bar">
                  <span className="audit-counter">
                    Exibindo os primeiros {Math.min(50, processedResult.validRows.length)} de {processedResult.validRows.length} registros liberados
                  </span>
                  <button
                    type="button"
                    className="btn-export-csv"
                    onClick={handleDownloadCleanCsv}
                  >
                    📥 Baixar CSV Filtrado ({processedResult.validRows.length} linhas)
                  </button>
                </div>
                <div className="preview-table-container">
                  <table className="preview-table">
                    <thead>
                      <tr>
                        <th style={{ width: '40px' }}>#</th>
                        {processedResult.headers.map((h, i) => (
                          <th key={i}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {processedResult.validRows.slice(0, 50).map((row, rIdx) => (
                        <tr key={rIdx}>
                          <td style={{ color: 'var(--text-muted)' }}>{rIdx + 1}</td>
                          {row.map((cell, cIdx) => (
                            <td key={cIdx}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* Tab 3: Removed Rows (Rescindidos & Duplicados) */}
        {activeResultTab === 'removed-rows' && (
          <div className="result-content-wrap">
            {processedResult.removedRows.length === 0 ? (
              <div className="empty-notice">
                <p>Nenhuma linha excluída. Não foram encontrados rescindidos nem registros duplicados.</p>
              </div>
            ) : (
              <>
                <div className="audit-table-container">
                  <table className="audit-table">
                    <thead>
                      <tr>
                        <th style={{ width: '45px' }}>#</th>
                        <th>Tipo de Exclusão</th>
                        <th>ID</th>
                        <th>Matrícula</th>
                        <th>Nome</th>
                        <th>Motivo Detalhado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {processedResult.removedRows.map((row, i) => (
                        <tr
                          key={i}
                          className={row.status === 'rescindido' ? 'row-rescindido' : 'row-duplicate'}
                        >
                          <td>{i + 1}</td>
                          <td>
                            {row.status === 'rescindido' ? (
                              <span className="status-badge badge-danger">✕ Rescindido</span>
                            ) : (
                              <span className="status-badge badge-warning">⚠️ Duplicado</span>
                            )}
                          </td>
                          <td className="font-mono text-bright">
                            <strong>{row.id}</strong>
                          </td>
                          <td className="font-mono text-muted">{row.matricula}</td>
                          <td>{row.nome || '-'}</td>
                          <td>
                            <span className={row.status === 'rescindido' ? 'text-danger-light' : 'text-warning-light'}>
                              {row.reason}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="result-footer-info danger-footer" style={{ marginTop: '0.75rem' }}>
                  <span>
                    Total: {processedResult.removedRows.length} linhas eliminadas ({rescindidosCount} rescindidos + {duplicatesCount} duplicados)
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Tab 4: Detailed Line-by-Line Audit */}
        {activeResultTab === 'audit' && (
          <div className="audit-table-wrap">
            <div className="audit-search-bar">
              <input
                type="text"
                className="text-input audit-search-input"
                placeholder="Buscar por ID, matrícula, nome ou status..."
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
              />
              <span className="audit-counter">
                Exibindo {filteredAuditRows.length} de {processedResult.auditRows.length} registros
              </span>
            </div>

            {processedResult.auditRows.length === 0 ? (
              <div className="empty-notice">
                <p>Insira os arquivos CSV acima para ver a auditoria detalhada.</p>
              </div>
            ) : (
              <div className="audit-table-container">
                <table className="audit-table">
                  <thead>
                    <tr>
                      <th style={{ width: '45px' }}>#</th>
                      <th>Status</th>
                      <th>ID do Evento</th>
                      <th>Matrícula</th>
                      <th>Nome</th>
                      <th>Ação / Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAuditRows.map((row, i) => (
                      <tr
                        key={i}
                        className={
                          row.status === 'rescindido'
                            ? 'row-rescindido'
                            : row.status === 'duplicate_id' || row.status === 'duplicate_mat'
                            ? 'row-duplicate'
                            : 'row-valid'
                        }
                      >
                        <td>{row.index}</td>
                        <td>
                          {row.status === 'valid' && (
                            <span className="status-badge badge-success">✓ Liberado</span>
                          )}
                          {row.status === 'rescindido' && (
                            <span className="status-badge badge-danger">✕ Rescindido</span>
                          )}
                          {(row.status === 'duplicate_id' || row.status === 'duplicate_mat') && (
                            <span className="status-badge badge-warning">⚠️ Duplicado</span>
                          )}
                        </td>
                        <td className="font-mono text-bright">
                          <strong>{row.id}</strong>
                        </td>
                        <td className="font-mono text-muted">{row.matricula}</td>
                        <td>{row.nome || '-'}</td>
                        <td>
                          {row.status === 'valid' && (
                            <span className="text-success-light">Liberado para lançamento</span>
                          )}
                          {row.status === 'rescindido' && (
                            <span className="text-danger-light">{row.reason}</span>
                          )}
                          {(row.status === 'duplicate_id' || row.status === 'duplicate_mat') && (
                            <span className="text-warning-light">{row.reason}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
