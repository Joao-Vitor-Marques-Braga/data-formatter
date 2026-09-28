import { useState, useMemo, useRef } from 'react';

// Parser for pasted Excel table data or CSV
function parseTableText(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length === 0) return { headers: [], rows: [] };

  // Detect delimiter (\t from Excel, or ;, or ,)
  const firstLine = lines[0];
  let delimiter = '\t';
  if (firstLine.includes('\t')) {
    delimiter = '\t';
  } else if ((firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length) {
    delimiter = ';';
  } else if (firstLine.includes(',')) {
    delimiter = ',';
  }

  const parseRow = (line: string): string[] => {
    if (delimiter === '\t') {
      return line.split('\t').map(c => c.trim());
    }
    // Simple CSV parser supporting quotes
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
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
  return { headers, rows };
}

interface AuditRow {
  id: string;
  matricula: string;
  nome?: string;
  isRescindido: boolean;
  isDuplicateId: boolean;
  status: 'valid' | 'rescindido' | 'duplicate';
}

interface RemovedRow {
  id: string;
  matricula: string;
  nome?: string;
  originalRow: string[];
}

export default function ComparePage() {
  // Input Modes: 'paste-table' (paste entire Excel / CSV) vs 'manual-columns' (2 separate columns)
  const [workflowMode, setWorkflowMode] = useState<'paste-table' | 'manual-columns'>('paste-table');

  // Mode 1: Table / Excel Data
  const [tableRawText, setTableRawText] = useState('');
  const [externalRescindidosText, setExternalRescindidosText] = useState('');
  const [rescindidosSource, setRescindidosSource] = useState<'column-in-table' | 'external-text'>('column-in-table');
  const [selectedIdCol, setSelectedIdCol] = useState<string>('');
  const [selectedMatriculaCol, setSelectedMatriculaCol] = useState<string>('');
  const [selectedRescindidoCol, setSelectedRescindidoCol] = useState<string>('');

  // Mode 2: Quick Columns (Event Matrículas vs Rescindidos Matrículas, or ID + Matrícula)
  const [manualIdsInput, setManualIdsInput] = useState('');
  const [manualMatriculasInput, setManualMatriculasInput] = useState('');
  const [manualRescindidosInput, setManualRescindidosInput] = useState('');

  // Matching & Normalization Options
  const [ignoreLeadingZeros, setIgnoreLeadingZeros] = useState(true);
  const [caseInsensitive, setCaseInsensitive] = useState(true);
  const [trimValues, setTrimValues] = useState(true);
  const [removeInternalDuplicates, setRemoveInternalDuplicates] = useState(true);

  // Output formatting
  const [outputSeparator, setOutputSeparator] = useState<string>('colon'); // default colon for Centi!
  const [customSeparator, setCustomSeparator] = useState('');

  // UI state
  const [activeResultTab, setActiveResultTab] = useState<'valid-ids' | 'removed-rows' | 'audit'>('valid-ids');
  const [copiedIds, setCopiedIds] = useState(false);
  const [copiedRemoved, setCopiedRemoved] = useState(false);
  const [auditSearch, setAuditSearch] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Normalization helper
  const normalize = (val: string): string => {
    let res = val;
    if (trimValues) res = res.trim();
    if (caseInsensitive) res = res.toLowerCase();
    if (ignoreLeadingZeros) {
      res = res.replace(/^0+(?=\d)/, '');
    }
    return res;
  };

  // Parse table when tableRawText changes
  const tableData = useMemo(() => {
    if (!tableRawText.trim()) return null;
    return parseTableText(tableRawText);
  }, [tableRawText]);

  // Auto-detect columns when table headers are loaded
  useMemo(() => {
    if (!tableData || tableData.headers.length === 0) return;
    const headers = tableData.headers;

    // Detect ID column (matches "id", "id evento", etc., usually column 0)
    const idIdx = headers.findIndex(h => /^id(\s|$|_)/i.test(h.trim()));
    if (idIdx !== -1) {
      setSelectedIdCol(headers[idIdx]);
    } else {
      setSelectedIdCol(headers[0]);
    }

    // Detect Rescindidos column in table (e.g. "Matricula r", "Matricula res", "Rescindidos")
    const resColIdx = headers.findIndex(h => /matricula\s*r|rescind|res\b/i.test(h.trim()));
    if (resColIdx !== -1) {
      setSelectedRescindidoCol(headers[resColIdx]);
      setRescindidosSource('column-in-table');
    }

    // Detect Employee Matrícula column (e.g. "Matrícula", "Matricula", "Id Funcionário")
    // Needs to be different from resColIdx
    const matColIdx = headers.findIndex((h, idx) => {
      if (idx === resColIdx) return false;
      return /matr[ií]cula|cod.*func|id.*func/i.test(h.trim());
    });
    if (matColIdx !== -1) {
      setSelectedMatriculaCol(headers[matColIdx]);
    } else if (headers.length > 1) {
      // Pick first column that is not ID or Rescindido
      const fallback = headers.find((_, i) => i !== idIdx && i !== resColIdx);
      if (fallback) setSelectedMatriculaCol(fallback);
    }
  }, [tableData]);

  // Load Demonstration Example (matches exactly the user's Excel sheet)
  const handleLoadExcelExample = () => {
    setWorkflowMode('paste-table');
    const exampleTable = [
      'Id\tId concess\tÓrgão\tId Funcionário\tMatricula r\tMatrícula\tCódigo Ad\tNome\tTipo evento',
      '78319017\t0\tFUND. DE\t6965\t3014702\t1007263\t1347386\tCLAUDIA P\tRemuneração',
      '78310711\t0\tFUNDO M\t6982\t3019960\t1007280\t1267676\tROGERIA G\tRemuneração',
      '78296049\t0\tFUNDO M\t7711\t3019962\t1008009\t1235477\tMARCOS E\tRemuneração',
      '78310712\t0\tFUNDO M\t7040\t3019961\t1007338\t1383753\tMARCIA M\tRemuneração',
      '78319016\t0\tFUND. DE\t6954\t3019963\t1007252\t1196770\tCRISTIANE\tRemuneração',
      '78310709\t0\tFUNDO M\t5595\t3019959\t1005803\t1347383\tCLEICI AD\tRemuneração',
      '78310710\t0\tFUNDO M\t5618\t3021452\t1005826\t1276536\tEURIPEDE\tRemuneração',
      '78283644\t0\tPREFEITUR\t3658\t3014093\t1003752\t1203321\tVANDERLE\tRemuneração',
      '78310708\t0\tFUNDO M\t5168\t3015447\t1005375\t1253387\tAPARECID\tRemuneração',
      '78283646\t0\tPREFEITUR\t8285\t3015437\t1008583\t1283161\tRUI DE SO\tRemuneração',
      '78283647\t0\tPREFEITUR\t8286\t3015440\t1008584\t1283777\tKLEBSTON\tRemuneração'
    ].join('\n');

    // In this example, let's suppose matrículas 1007280 and 1007338 are in the rescindidos list
    // (either in the column "Matricula r" or pasted)
    setTableRawText(exampleTable);
    setSelectedIdCol('Id');
    setSelectedMatriculaCol('Matrícula');
    setSelectedRescindidoCol('Matricula r');
    setRescindidosSource('column-in-table');
  };

  // Clear all
  const handleClearAll = () => {
    setTableRawText('');
    setExternalRescindidosText('');
    setManualIdsInput('');
    setManualMatriculasInput('');
    setManualRescindidosInput('');
  };

  // Handle file upload (.csv or .txt)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        setTableRawText(text);
        setWorkflowMode('paste-table');
      }
    };
    reader.readAsText(file, 'UTF-8');
  };

  // Paste from clipboard helper
  const handlePasteClipboard = async (setter: (v: string) => void) => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setter(text);
    } catch {
      alert('Use o atalho Ctrl+V dentro do campo para colar.');
    }
  };

  // Core Processing Engine
  const processedResult = useMemo(() => {
    if (workflowMode === 'paste-table') {
      if (!tableData || tableData.rows.length === 0) {
        return {
          totalRows: 0,
          rescindidosCount: 0,
          validIds: [],
          removedRows: [],
          auditRows: [],
        };
      }

      const headers = tableData.headers;
      const idColIdx = headers.indexOf(selectedIdCol);
      const matColIdx = headers.indexOf(selectedMatriculaCol);
      const resColIdx = headers.indexOf(selectedRescindidoCol);

      // Collect Rescindidos set
      const rescindidosNormSet = new Set<string>();
      let rawRescindidosCount = 0;

      if (rescindidosSource === 'column-in-table' && resColIdx !== -1) {
        for (const row of tableData.rows) {
          const val = row[resColIdx] ?? '';
          if (val.trim()) {
            rawRescindidosCount++;
            rescindidosNormSet.add(normalize(val));
          }
        }
      } else {
        const extLines = externalRescindidosText
          .split(/\r?\n/)
          .map(l => l.trim())
          .filter(Boolean);
        rawRescindidosCount = extLines.length;
        for (const line of extLines) {
          rescindidosNormSet.add(normalize(line));
        }
      }

      const validIds: string[] = [];
      const seenIds = new Set<string>();
      const removedRows: RemovedRow[] = [];
      const auditRows: AuditRow[] = [];

      const nomeColIdx = headers.findIndex(h => /nome/i.test(h));

      for (const row of tableData.rows) {
        const idVal = idColIdx !== -1 ? (row[idColIdx] ?? '').trim() : '';
        const matVal = matColIdx !== -1 ? (row[matColIdx] ?? '').trim() : '';
        const nomeVal = nomeColIdx !== -1 ? row[nomeColIdx] : '';

        if (!idVal && !matVal) continue;

        const matNorm = normalize(matVal);
        const isRescindido = matNorm !== '' && rescindidosNormSet.has(matNorm);
        const isDuplicateId = idVal !== '' && seenIds.has(idVal);

        if (isRescindido) {
          removedRows.push({
            id: idVal,
            matricula: matVal,
            nome: nomeVal,
            originalRow: row,
          });
          auditRows.push({
            id: idVal,
            matricula: matVal,
            nome: nomeVal,
            isRescindido: true,
            isDuplicateId,
            status: 'rescindido',
          });
        } else if (removeInternalDuplicates && isDuplicateId) {
          auditRows.push({
            id: idVal,
            matricula: matVal,
            nome: nomeVal,
            isRescindido: false,
            isDuplicateId: true,
            status: 'duplicate',
          });
        } else {
          if (idVal) {
            seenIds.add(idVal);
            validIds.push(idVal);
          }
          auditRows.push({
            id: idVal,
            matricula: matVal,
            nome: nomeVal,
            isRescindido: false,
            isDuplicateId: false,
            status: 'valid',
          });
        }
      }

      return {
        totalRows: tableData.rows.length,
        rescindidosCount: rawRescindidosCount,
        validIds,
        removedRows,
        auditRows,
      };
    } else {
      // Manual columns mode
      const rawIds = manualIdsInput.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const rawMats = manualMatriculasInput.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const rawRes = manualRescindidosInput.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

      const rescindidosNormSet = new Set(rawRes.map(normalize));
      const validIds: string[] = [];
      const seenIds = new Set<string>();
      const removedRows: RemovedRow[] = [];
      const auditRows: AuditRow[] = [];

      const count = Math.max(rawIds.length, rawMats.length);
      for (let i = 0; i < count; i++) {
        const idVal = rawIds[i] ?? '';
        const matVal = rawMats[i] ?? rawIds[i] ?? '';
        const matNorm = normalize(matVal);

        const isRescindido = matNorm !== '' && rescindidosNormSet.has(matNorm);
        const isDuplicateId = idVal !== '' && seenIds.has(idVal);

        if (isRescindido) {
          removedRows.push({ id: idVal, matricula: matVal, originalRow: [idVal, matVal] });
          auditRows.push({
            id: idVal,
            matricula: matVal,
            isRescindido: true,
            isDuplicateId,
            status: 'rescindido',
          });
        } else if (removeInternalDuplicates && isDuplicateId) {
          auditRows.push({
            id: idVal,
            matricula: matVal,
            isRescindido: false,
            isDuplicateId: true,
            status: 'duplicate',
          });
        } else {
          if (idVal) {
            seenIds.add(idVal);
            validIds.push(idVal);
          }
          auditRows.push({
            id: idVal,
            matricula: matVal,
            isRescindido: false,
            isDuplicateId: false,
            status: 'valid',
          });
        }
      }

      return {
        totalRows: count,
        rescindidosCount: rawRes.length,
        validIds,
        removedRows,
        auditRows,
      };
    }
  }, [
    workflowMode,
    tableData,
    selectedIdCol,
    selectedMatriculaCol,
    selectedRescindidoCol,
    rescindidosSource,
    externalRescindidosText,
    manualIdsInput,
    manualMatriculasInput,
    manualRescindidosInput,
    ignoreLeadingZeros,
    caseInsensitive,
    trimValues,
    removeInternalDuplicates,
  ]);

  // Formatted Output Text (IDs joined by separator)
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
      .map(r => `ID: ${r.id} | Matrícula: ${r.matricula}${r.nome ? ` | Nome: ${r.nome}` : ''}`)
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

  // Filtered audit list
  const filteredAuditRows = useMemo(() => {
    if (!auditSearch.trim()) return processedResult.auditRows;
    const term = auditSearch.toLowerCase();
    return processedResult.auditRows.filter(
      r =>
        r.id.toLowerCase().includes(term) ||
        r.matricula.toLowerCase().includes(term) ||
        (r.nome && r.nome.toLowerCase().includes(term)) ||
        r.status.includes(term)
    );
  }, [processedResult.auditRows, auditSearch]);

  return (
    <div className="compare-page">
      {/* Top Banner */}
      <div className="compare-top-actions">
        <div className="compare-info-text">
          <h2>Filtrar Rescindidos & Extrair IDs para Envio</h2>
          <p>
            Cole a planilha baixada do Excel com a coluna de rescisão ou faça upload do CSV.
            O sistema exclui automaticamente as linhas dos funcionários rescindidos e gera a lista dos <strong>IDs</strong> pronta com o separador <strong>dois pontos (:)</strong> para enviar ao sistema!
          </p>
        </div>
        <div className="compare-header-btns">
          <button
            type="button"
            className="action-btn-outline"
            onClick={handleLoadExcelExample}
            title="Preencher com exemplo idêntico à sua planilha"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
            </svg>
            Carregar Exemplo Real
          </button>

          {(tableRawText || manualIdsInput || manualMatriculasInput) && (
            <button
              type="button"
              className="action-btn-danger"
              onClick={handleClearAll}
              title="Limpar todos os campos"
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
          className={`mode-pill ${workflowMode === 'paste-table' ? 'active' : ''}`}
          onClick={() => setWorkflowMode('paste-table')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="3" y1="9" x2="21" y2="9"></line>
            <line x1="9" y1="21" x2="9" y2="9"></line>
          </svg>
          Colar Planilha do Excel / Subir CSV (Recomendado)
        </button>
        <button
          type="button"
          className={`mode-pill ${workflowMode === 'manual-columns' ? 'active' : ''}`}
          onClick={() => setWorkflowMode('manual-columns')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="8" height="18" rx="2"></rect>
            <rect x="13" y="3" width="8" height="18" rx="2"></rect>
          </svg>
          Colar Apenas as Colunas Separadas
        </button>
      </div>

      {/* Main Input Section */}
      {workflowMode === 'paste-table' ? (
        <div className="card compare-input-card">
          <div className="card-header-flex">
            <div>
              <span className="badge badge-primary">Planilha Completa</span>
              <h3 className="card-title-sm">Dados da Planilha Baixada (Excel ou CSV)</h3>
              <p className="card-help-text">
                Copie as linhas da planilha do Excel (com o cabeçalho) e cole diretamente abaixo, ou selecione o arquivo CSV/TXT.
              </p>
            </div>
            <div className="card-header-actions">
              <input
                type="file"
                ref={fileInputRef}
                accept=".csv,.txt"
                style={{ display: 'none' }}
                onChange={handleFileUpload}
              />
              <button
                type="button"
                className="btn-tiny"
                onClick={() => fileInputRef.current?.click()}
                title="Subir arquivo CSV ou TXT"
              >
                📁 Subir Arquivo CSV
              </button>
              <button
                type="button"
                className="btn-tiny"
                onClick={() => handlePasteClipboard(setTableRawText)}
                title="Colar da área de transferência"
              >
                📋 Colar do Excel
              </button>
              {tableRawText && (
                <button
                  type="button"
                  className="btn-tiny btn-tiny-danger"
                  onClick={() => setTableRawText('')}
                >
                  Limpar
                </button>
              )}
            </div>
          </div>

          <textarea
            className="text-input compare-textarea"
            style={{ minHeight: '160px' }}
            placeholder={`Cole aqui os dados copiados do Excel (Ctrl+C e Ctrl+V)...\nExemplo:\nId\tId concess\tÓrgão\tMatricula r\tMatrícula\tNome\n78319017\t0\tPREFEITURA\t3014702\t1007263\tCLAUDIA`}
            value={tableRawText}
            onChange={(e) => setTableRawText(e.target.value)}
          />

          {/* Column Selectors if table is loaded */}
          {tableData && tableData.headers.length > 0 && (
            <div className="table-column-mapping-box">
              <div className="mapping-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="4 14 10 14 10 20"></polyline>
                  <polyline points="20 10 14 10 14 4"></polyline>
                  <line x1="14" y1="10" x2="21" y2="3"></line>
                  <line x1="3" y1="21" x2="10" y2="14"></line>
                </svg>
                Configuração das Colunas Detectadas ({tableData.rows.length} linhas encontradas)
              </div>

              <div className="mapping-grid">
                {/* 1. Column to Extract (ID) */}
                <div className="mapping-item">
                  <label className="mapping-label">
                    1. Coluna que deseja extrair (ID para Envio):
                  </label>
                  <select
                    className="select-input mapping-select"
                    value={selectedIdCol}
                    onChange={(e) => setSelectedIdCol(e.target.value)}
                  >
                    {tableData.headers.map((h, i) => (
                      <option key={i} value={h}>
                        Coluna {i + 1}: {h || `(Sem título ${i + 1})`}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 2. Employee Matrícula column in table */}
                <div className="mapping-item">
                  <label className="mapping-label">
                    2. Coluna com a Matrícula do Funcionário no Evento:
                  </label>
                  <select
                    className="select-input mapping-select"
                    value={selectedMatriculaCol}
                    onChange={(e) => setSelectedMatriculaCol(e.target.value)}
                  >
                    {tableData.headers.map((h, i) => (
                      <option key={i} value={h}>
                        Coluna {i + 1}: {h || `(Sem título ${i + 1})`}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 3. Source of Rescindidos */}
                <div className="mapping-item">
                  <label className="mapping-label">
                    3. Onde estão as Matrículas dos Rescindidos?
                  </label>
                  <div className="source-choice-wrap">
                    <label className="radio-label">
                      <input
                        type="radio"
                        name="resSource"
                        checked={rescindidosSource === 'column-in-table'}
                        onChange={() => setRescindidosSource('column-in-table')}
                      />
                      <span>Em uma coluna na própria planilha</span>
                    </label>
                    <label className="radio-label">
                      <input
                        type="radio"
                        name="resSource"
                        checked={rescindidosSource === 'external-text'}
                        onChange={() => setRescindidosSource('external-text')}
                      />
                      <span>Vou colar a lista de rescindidos separada</span>
                    </label>
                  </div>

                  {rescindidosSource === 'column-in-table' ? (
                    <select
                      className="select-input mapping-select"
                      style={{ marginTop: '0.4rem' }}
                      value={selectedRescindidoCol}
                      onChange={(e) => setSelectedRescindidoCol(e.target.value)}
                    >
                      {tableData.headers.map((h, i) => (
                        <option key={i} value={h}>
                          Coluna {i + 1}: {h || `(Sem título ${i + 1})`}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <textarea
                      className="text-input"
                      style={{ marginTop: '0.4rem', minHeight: '80px', fontSize: '0.85rem' }}
                      placeholder="Cole aqui a lista de matrículas dos rescindidos..."
                      value={externalRescindidosText}
                      onChange={(e) => setExternalRescindidosText(e.target.value)}
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Mode 2: Manual 3 columns */
        <div className="compare-inputs-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {/* Column A: IDs */}
          <div className="card compare-input-card card-eventos">
            <div className="card-header-flex">
              <div>
                <span className="badge badge-primary">Coluna 1</span>
                <h3 className="card-title-sm">IDs dos Eventos</h3>
                <span className="count-sublabel">
                  {manualIdsInput.trim() ? `${manualIdsInput.split(/\r?\n/).filter(Boolean).length} IDs` : 'Vazio'}
                </span>
              </div>
              <button
                type="button"
                className="btn-tiny"
                onClick={() => handlePasteClipboard(setManualIdsInput)}
              >
                Colar
              </button>
            </div>
            <textarea
              className="text-input compare-textarea"
              placeholder={`Cole os IDs da Coluna A do Excel:\n78319017\n78310711\n78296049`}
              value={manualIdsInput}
              onChange={(e) => setManualIdsInput(e.target.value)}
            />
          </div>

          {/* Column B: Matrículas dos Eventos */}
          <div className="card compare-input-card">
            <div className="card-header-flex">
              <div>
                <span className="badge badge-warning">Coluna 2</span>
                <h3 className="card-title-sm">Matrículas no Evento</h3>
                <span className="count-sublabel">
                  {manualMatriculasInput.trim()
                    ? `${manualMatriculasInput.split(/\r?\n/).filter(Boolean).length} matrículas`
                    : 'Vazio'}
                </span>
              </div>
              <button
                type="button"
                className="btn-tiny"
                onClick={() => handlePasteClipboard(setManualMatriculasInput)}
              >
                Colar
              </button>
            </div>
            <textarea
              className="text-input compare-textarea"
              placeholder={`Cole as Matrículas da Coluna F do Excel:\n1007263\n1007280\n1008009`}
              value={manualMatriculasInput}
              onChange={(e) => setManualMatriculasInput(e.target.value)}
            />
          </div>

          {/* Column C: Matrículas dos Rescindidos */}
          <div className="card compare-input-card card-rescindidos">
            <div className="card-header-flex">
              <div>
                <span className="badge badge-danger">Para Excluir</span>
                <h3 className="card-title-sm">Matrículas Rescindidos</h3>
                <span className="count-sublabel">
                  {manualRescindidosInput.trim()
                    ? `${manualRescindidosInput.split(/\r?\n/).filter(Boolean).length} rescindidos`
                    : 'Vazio'}
                </span>
              </div>
              <button
                type="button"
                className="btn-tiny"
                onClick={() => handlePasteClipboard(setManualRescindidosInput)}
              >
                Colar
              </button>
            </div>
            <textarea
              className="text-input compare-textarea"
              placeholder={`Cole as Matrículas dos Rescindidos:\n1007280\n1008009`}
              value={manualRescindidosInput}
              onChange={(e) => setManualRescindidosInput(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Options & Settings Bar */}
      <div className="card compare-options-card">
        <div className="options-grid">
          {/* Normalization Toggles */}
          <div className="options-col">
            <label className="options-group-title">Ajustes & Comparação</label>
            <div className="options-toggles">
              <label className="toggle-label" title="Equipara por exemplo '001007263' com '1007263'">
                <input
                  type="checkbox"
                  checked={ignoreLeadingZeros}
                  onChange={(e) => setIgnoreLeadingZeros(e.target.checked)}
                />
                <span className="toggle-custom"></span>
                <span>Ignorar zeros à esquerda (ex: 00123 = 123)</span>
              </label>

              <label className="toggle-label" title="Remove espaços em branco acidentais nas bordas">
                <input
                  type="checkbox"
                  checked={trimValues}
                  onChange={(e) => setTrimValues(e.target.checked)}
                />
                <span className="toggle-custom"></span>
                <span>Remover espaços em branco (trim)</span>
              </label>

              <label className="toggle-label" title="Se um mesmo ID constar duplicado, deixa apenas uma vez na lista">
                <input
                  type="checkbox"
                  checked={removeInternalDuplicates}
                  onChange={(e) => setRemoveInternalDuplicates(e.target.checked)}
                />
                <span className="toggle-custom"></span>
                <span>Remover IDs repetidos da lista final</span>
              </label>

              <label className="toggle-label">
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
            <label className="options-group-title">Separador dos IDs para Envio ao Sistema</label>
            <div className="separator-pills-wrap">
              <button
                type="button"
                className={`pill-btn ${outputSeparator === 'colon' ? 'active' : ''}`}
                onClick={() => setOutputSeparator('colon')}
                title="Dois pontos: formato padrão para colar e filtrar no Centi"
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
            <span className="metric-title">Total de Linhas / Eventos</span>
            <span className="metric-icon">📄</span>
          </div>
          <div className="metric-value">{processedResult.totalRows}</div>
          <div className="metric-desc">Registros na planilha original</div>
        </div>

        <div className="metric-box">
          <div className="metric-header">
            <span className="metric-title">Rescindidos Informados</span>
            <span className="metric-icon">🚫</span>
          </div>
          <div className="metric-value">{processedResult.rescindidosCount}</div>
          <div className="metric-desc">Matrículas para corte/exclusão</div>
        </div>

        <div className="metric-box metric-danger">
          <div className="metric-header">
            <span className="metric-title">Linhas Excluídas</span>
            <span className="metric-icon">✂️</span>
          </div>
          <div className="metric-value">{processedResult.removedRows.length}</div>
          <div className="metric-desc">Rescindidos retirados com sucesso</div>
        </div>

        <div className="metric-box metric-success">
          <div className="metric-header">
            <span className="metric-title">IDs Prontos para Envio</span>
            <span className="metric-icon">🚀</span>
          </div>
          <div className="metric-value">{processedResult.validIds.length}</div>
          <div className="metric-desc">IDs limpos prontos para o sistema</div>
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
              IDs para Envio ao Sistema ({processedResult.validIds.length})
            </button>
            <button
              type="button"
              className={`result-tab-btn ${activeResultTab === 'removed-rows' ? 'active' : ''}`}
              onClick={() => setActiveResultTab('removed-rows')}
            >
              <span className="status-dot dot-danger"></span>
              Linhas Excluídas / Rescindidos ({processedResult.removedRows.length})
            </button>
            <button
              type="button"
              className={`result-tab-btn ${activeResultTab === 'audit' ? 'active' : ''}`}
              onClick={() => setActiveResultTab('audit')}
            >
              <span className="status-dot dot-info"></span>
              Auditoria Detalhada ({processedResult.auditRows.length})
            </button>
          </div>

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

          {activeResultTab === 'removed-rows' && (
            <div className="result-actions-flex">
              <button
                type="button"
                className={`btn-action-secondary ${copiedRemoved ? 'copied' : ''}`}
                onClick={handleCopyRemoved}
                disabled={processedResult.removedRows.length === 0}
              >
                {copiedRemoved ? 'Copiado!' : 'Copiar Rescindidos Excluídos'}
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
              placeholder="Cole a planilha acima para gerar os IDs limpos prontos para envio..."
            />
            <div className="result-footer-info">
              <span>{processedResult.validIds.length} IDs liberados para envio</span>
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

        {/* Tab 2: Removed Rescindidos Output */}
        {activeResultTab === 'removed-rows' && (
          <div className="result-content-wrap">
            {processedResult.removedRows.length === 0 ? (
              <div className="empty-notice">
                <p>Nenhuma linha com funcionário rescindido foi identificada.</p>
              </div>
            ) : (
              <>
                <textarea
                  readOnly
                  className="text-input compare-result-textarea textarea-danger"
                  value={removedOutputText}
                />
                <div className="result-footer-info danger-footer">
                  <span>{processedResult.removedRows.length} linhas de funcionários rescindidos foram excluídas</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Tab 3: Detailed Line-by-Line Audit */}
        {activeResultTab === 'audit' && (
          <div className="audit-table-wrap">
            <div className="audit-search-bar">
              <input
                type="text"
                className="text-input audit-search-input"
                placeholder="Buscar por ID, matrícula ou nome na auditoria..."
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
              />
              <span className="audit-counter">
                Exibindo {filteredAuditRows.length} de {processedResult.auditRows.length} linhas
              </span>
            </div>

            {processedResult.auditRows.length === 0 ? (
              <div className="empty-notice">
                <p>Insira a planilha acima para ver a auditoria detalhada.</p>
              </div>
            ) : (
              <div className="audit-table-container">
                <table className="audit-table">
                  <thead>
                    <tr>
                      <th style={{ width: '50px' }}>#</th>
                      <th>ID do Evento</th>
                      <th>Matrícula</th>
                      <th>Nome</th>
                      <th>Status da Linha</th>
                      <th>Ação Realizada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAuditRows.map((row, i) => (
                      <tr
                        key={i}
                        className={
                          row.status === 'rescindido'
                            ? 'row-rescindido'
                            : row.status === 'duplicate'
                            ? 'row-duplicate'
                            : 'row-valid'
                        }
                      >
                        <td>{i + 1}</td>
                        <td className="font-mono text-bright">
                          <strong>{row.id}</strong>
                        </td>
                        <td className="font-mono text-muted">{row.matricula}</td>
                        <td>{row.nome || '-'}</td>
                        <td>
                          {row.status === 'valid' && (
                            <span className="status-badge badge-success">✓ Liberado</span>
                          )}
                          {row.status === 'rescindido' && (
                            <span className="status-badge badge-danger">✕ Rescindido</span>
                          )}
                          {row.status === 'duplicate' && (
                            <span className="status-badge badge-warning">⚠️ ID Duplicado</span>
                          )}
                        </td>
                        <td>
                          {row.status === 'valid' && (
                            <span className="text-success-light">ID incluído para envio ao sistema</span>
                          )}
                          {row.status === 'rescindido' && (
                            <span className="text-danger-light">Linha excluída (Matrícula rescindida)</span>
                          )}
                          {row.status === 'duplicate' && (
                            <span className="text-warning-light">Linha ignorada (ID já constava)</span>
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
