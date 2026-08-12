import { useState, useMemo, useRef, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface CsvData {
  headers: string[];
  rows: string[][];
}

type FormatMode = 'end' | 'row-join' | 'all-join' | 'start' | 'lines-only';

// ─── CSV Parser ───────────────────────────────────────────────────────────────
function parseCsv(text: string): CsvData {
  const firstLine = text.split(/\r?\n/)[0] ?? '';
  const delimiters = [',', ';', '\t'];
  let delimiter = ',';
  let maxCount = 0;
  for (const d of delimiters) {
    const count = (firstLine.match(new RegExp(`\\${d === '\t' ? 't' : d}`, 'g')) ?? []).length;
    if (count > maxCount) { maxCount = count; delimiter = d; }
  }

  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseRow = (line: string): string[] => {
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

// ─── Main Component ───────────────────────────────────────────────────────────
export default function CsvPage() {
  const [csvData, setCsvData] = useState<CsvData | null>(null);
  const [fileName, setFileName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState('');

  // Per-column filter text
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});

  // Selected columns
  const [selectedColumns, setSelectedColumns] = useState<Set<number>>(new Set());

  // Formatting Options
  const [formatMode, setFormatMode] = useState<FormatMode>('end');
  const [separatorPill, setSeparatorPill] = useState<string>(':');
  const [customSeparator, setCustomSeparator] = useState('');
  const [ignoreEmpty, setIgnoreEmpty] = useState(true);
  const [removeDuplicates, setRemoveDuplicates] = useState(false);
  const [exactMatch, setExactMatch] = useState(true);

  // Format result
  const [formatResult, setFormatResult] = useState('');
  const [copied, setCopied] = useState(false);
  const [showResult, setShowResult] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeSeparator = useMemo(() => {
    if (separatorPill === 'custom') return customSeparator;
    return separatorPill;
  }, [separatorPill, customSeparator]);

  const resetState = () => {
    setColumnFilters({});
    setSelectedColumns(new Set());
    setFormatResult('');
    setShowResult(false);
    setError('');
    setCopied(false);
  };

  const loadFile = (file: File) => {
    if (!file.name.match(/\.(csv|txt)$/i)) {
      setError('Por favor, selecione um arquivo CSV ou TXT.');
      return;
    }
    resetState();
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const data = parseCsv(text);
      if (data.headers.length === 0) {
        setError('Arquivo vazio ou inválido.');
        return;
      }
      setCsvData(data);
      // Auto-select all columns initially
      setSelectedColumns(new Set(data.headers.map((_, i) => i)));
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  };

  // Filtered rows based on per-column filter (supports multiple items separated by comma, space, ;, | or newline)
  const filteredRows = useMemo(() => {
    if (!csvData) return [];
    return csvData.rows.filter(row =>
      csvData.headers.every((header, colIdx) => {
        const rawFilter = (columnFilters[header] ?? '').toLowerCase().trim();
        if (!rawFilter) return true;

        // Split by comma, semicolon, pipe or newline
        let terms = rawFilter.split(/[,;|\n]+/).map(t => t.trim()).filter(Boolean);
        // If user typed space-separated items (e.g. "101 102 103") without delimiters
        if (terms.length === 1 && terms[0].includes(' ')) {
          terms = terms[0].split(/\s+/).map(t => t.trim()).filter(Boolean);
        }

        const cellVal = (row[colIdx] ?? '').toLowerCase().trim();
        // Matches if cell matches ANY of the filter terms (exact or partial based on exactMatch setting)
        return terms.some(term => exactMatch ? cellVal === term : cellVal.includes(term));
      })
    );
  }, [csvData, columnFilters, exactMatch]);

  // Toggle column selection
  const toggleColumn = (idx: number) => {
    setSelectedColumns(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const selectAllColumns = () => {
    if (!csvData) return;
    setSelectedColumns(new Set(csvData.headers.map((_, i) => i)));
  };

  const clearAllColumns = () => {
    setSelectedColumns(new Set());
  };

  // Formatting logic
  const handleFormat = useCallback(() => {
    if (!csvData || selectedColumns.size === 0) return;
    const colIndices = Array.from(selectedColumns).sort((a, b) => a - b);
    const sep = activeSeparator;

    let items: string[] = [];

    if (formatMode === 'row-join') {
      // Join selected columns for each row with separator
      items = filteredRows.map(row =>
        colIndices.map(i => (row[i] ?? '').trim()).filter(val => !ignoreEmpty || val !== '').join(sep)
      );
    } else if (formatMode === 'all-join') {
      // Flatten all selected values across all rows and join in 1 single line with separator
      const allValues: string[] = [];
      filteredRows.forEach(row => {
        colIndices.forEach(i => {
          const val = (row[i] ?? '').trim();
          if (!ignoreEmpty || val !== '') allValues.push(val);
        });
      });
      items = [allValues.join(sep)];
    } else if (formatMode === 'end') {
      // Each value / row followed by separator
      filteredRows.forEach(row => {
        const rowStr = colIndices.map(i => (row[i] ?? '').trim()).filter(val => !ignoreEmpty || val !== '').join(sep);
        if (rowStr || !ignoreEmpty) items.push(rowStr + sep);
      });
    } else if (formatMode === 'start') {
      // Each value / row preceded by separator
      filteredRows.forEach(row => {
        const rowStr = colIndices.map(i => (row[i] ?? '').trim()).filter(val => !ignoreEmpty || val !== '').join(sep);
        if (rowStr || !ignoreEmpty) items.push(sep + rowStr);
      });
    } else if (formatMode === 'lines-only') {
      // Just break line for each selected value
      filteredRows.forEach(row => {
        const rowStr = colIndices.map(i => (row[i] ?? '').trim()).filter(val => !ignoreEmpty || val !== '').join(' ');
        if (rowStr || !ignoreEmpty) items.push(rowStr);
      });
    }

    if (ignoreEmpty) {
      items = items.filter(item => item.trim() !== '');
    }

    if (removeDuplicates) {
      items = Array.from(new Set(items));
    }

    setFormatResult(items.join('\n'));
    setShowResult(true);
  }, [csvData, selectedColumns, filteredRows, formatMode, activeSeparator, ignoreEmpty, removeDuplicates]);

  // Auto-update result when format options change if result is already shown
  useEffect(() => {
    if (showResult) {
      handleFormat();
    }
  }, [formatMode, activeSeparator, ignoreEmpty, removeDuplicates, exactMatch, columnFilters, selectedColumns, showResult, handleFormat]);

  const handleCopy = async () => {
    if (!formatResult) return;
    try {
      await navigator.clipboard.writeText(formatResult);
      setCopied(true);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (copied) {
      const t = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(t);
    }
  }, [copied]);

  // Metrics
  const totalRows = csvData?.rows.length ?? 0;
  const visibleRows = filteredRows.length;
  const activeFilters = Object.values(columnFilters).filter(v => v.trim()).length;

  return (
    <div className="csv-page">
      {/* ── Upload Zone ── */}
      {!csvData ? (
        <div
          className={`csv-dropzone ${isDragging ? 'dragging' : ''}`}
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <div className="dropzone-icon">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <p className="dropzone-title">Arraste e solte seu arquivo CSV aqui</p>
          <p className="dropzone-sub">ou clique para selecionar · .csv ou .txt</p>
          {error && <p className="dropzone-error">{error}</p>}
        </div>
      ) : (
        <div className="csv-workspace">
          {/* ── File Info Bar ── */}
          <div className="csv-file-bar">
            <div className="file-bar-info">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span className="file-bar-name">{fileName}</span>
              <span className="file-bar-badge">{totalRows} linhas · {csvData.headers.length} colunas</span>
              {activeFilters > 0 && (
                <span className="file-bar-badge filter-badge">
                  {activeFilters} filtro{activeFilters > 1 ? 's' : ''} ativo{activeFilters > 1 ? 's' : ''} · {visibleRows} visíveis
                </span>
              )}
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => { setCsvData(null); setFileName(''); resetState(); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              Trocar arquivo
            </button>
          </div>

          {/* ── Layout: sidebar + table ── */}
          <div className="csv-layout">
            {/* ── Options & Column Selector Sidebar ── */}
            <aside className="card csv-sidebar">
              {/* Formatter Settings */}
              <div className="form-group">
                <label className="form-label">Modo de Formatação</label>
                <select
                  className="select-input"
                  value={formatMode}
                  onChange={(e) => setFormatMode(e.target.value as FormatMode)}
                >
                  <option value="end">Adicionar ao FINAL de cada linha (val1:)</option>
                  <option value="row-join">Unir colunas por linha (col1:col2)</option>
                  <option value="all-join">Unir tudo em 1 linha (val1:val2:val3)</option>
                  <option value="start">Adicionar no INÍCIO de cada linha (:val1)</option>
                  <option value="lines-only">Apenas quebrar linha (sem ":")</option>
                </select>
              </div>

              {/* Separator Selection */}
              {formatMode !== 'lines-only' && (
                <div className="form-group">
                  <label className="form-label">Separador</label>
                  <div className="separator-pills">
                    <button
                      type="button"
                      className={`pill-btn ${separatorPill === ':' ? 'active' : ''}`}
                      onClick={() => setSeparatorPill(':')}
                    >:</button>
                    <button
                      type="button"
                      className={`pill-btn ${separatorPill === ',' ? 'active' : ''}`}
                      onClick={() => setSeparatorPill(',')}
                    >,</button>
                    <button
                      type="button"
                      className={`pill-btn ${separatorPill === ';' ? 'active' : ''}`}
                      onClick={() => setSeparatorPill(';')}
                    >;</button>
                    <button
                      type="button"
                      className={`pill-btn ${separatorPill === '|' ? 'active' : ''}`}
                      onClick={() => setSeparatorPill('|')}
                    >|</button>
                    <button
                      type="button"
                      className={`pill-btn ${separatorPill === 'custom' ? 'active' : ''}`}
                      onClick={() => setSeparatorPill('custom')}
                    >Outro</button>
                  </div>
                  {separatorPill === 'custom' && (
                    <input
                      type="text"
                      className="text-input"
                      placeholder="Ex: - ou /"
                      value={customSeparator}
                      onChange={(e) => setCustomSeparator(e.target.value)}
                    />
                  )}
                </div>
              )}

              {/* Checkboxes */}
              <div className="checkbox-group">
                <label className="checkbox-label" title="Exigir que o valor da célula seja exatamente igual ao termo digitado">
                  <input
                    type="checkbox"
                    checked={exactMatch}
                    onChange={(e) => setExactMatch(e.target.checked)}
                  />
                  Filtro Exato (Igualdade exata)
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={ignoreEmpty}
                    onChange={(e) => setIgnoreEmpty(e.target.checked)}
                  />
                  Ignorar vazios
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={removeDuplicates}
                    onChange={(e) => setRemoveDuplicates(e.target.checked)}
                  />
                  Remover duplicados
                </label>
              </div>

              {/* Column Selection Header */}
              <div className="csv-sidebar-header" style={{ marginTop: '0.5rem' }}>
                <h3 className="csv-sidebar-title">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /><path d="M15 3v18" />
                  </svg>
                  Colunas
                </h3>
                <div className="csv-col-actions">
                  <button className="micro-btn" onClick={selectAllColumns}>Todas</button>
                  <button className="micro-btn" onClick={clearAllColumns}>Nenhuma</button>
                </div>
              </div>

              <div className="csv-col-list">
                {csvData.headers.map((header, idx) => (
                  <label key={idx} className={`csv-col-item ${selectedColumns.has(idx) ? 'selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selectedColumns.has(idx)}
                      onChange={() => toggleColumn(idx)}
                    />
                    <span className="col-index">{idx + 1}</span>
                    <span className="col-name" title={header}>{header}</span>
                  </label>
                ))}
              </div>

              <div className="csv-format-section">
                <div className="csv-format-info">
                  <span>{selectedColumns.size} coluna{selectedColumns.size !== 1 ? 's' : ''} selecionada{selectedColumns.size !== 1 ? 's' : ''}</span>
                </div>
                <button
                  className="btn btn-primary pulse-glow"
                  style={{ width: '100%' }}
                  onClick={handleFormat}
                  disabled={selectedColumns.size === 0}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" />
                  </svg>
                  Formatar Dados
                </button>
              </div>
            </aside>

            {/* ── Main Content: Table + Result ── */}
            <div className="csv-main-content">
              {/* Table */}
              <div className="card csv-table-card">
                <div className="csv-table-wrapper">
                  <table className="csv-table">
                    <thead>
                      <tr>
                        {csvData.headers.map((header, idx) => (
                          <th
                            key={idx}
                            className={selectedColumns.has(idx) ? 'col-selected' : ''}
                            onClick={() => toggleColumn(idx)}
                            title={`Clique para ${selectedColumns.has(idx) ? 'des' : ''}selecionar coluna`}
                          >
                            <div className="th-inner">
                              <span className="th-check">
                                {selectedColumns.has(idx) ? (
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                ) : null}
                              </span>
                              <span>{header}</span>
                            </div>
                            {/* Per-column filter */}
                            <input
                              type="text"
                              className="col-filter-input"
                              placeholder="Filtrar (ex: 10, 20, 30)..."
                              title="Separe múltiplos itens por vírgula, espaço, ponto e vírgula ou pipe"
                              value={columnFilters[header] ?? ''}
                              onClick={e => e.stopPropagation()}
                              onChange={e => setColumnFilters(prev => ({ ...prev, [header]: e.target.value }))}
                            />
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.length === 0 ? (
                        <tr>
                          <td colSpan={csvData.headers.length} className="csv-empty-row">
                            Nenhum resultado para os filtros aplicados.
                          </td>
                        </tr>
                      ) : (
                        filteredRows.slice(0, 500).map((row, rIdx) => (
                          <tr key={rIdx} className={rIdx % 2 === 0 ? 'row-even' : 'row-odd'}>
                            {csvData.headers.map((_, cIdx) => (
                              <td key={cIdx} className={selectedColumns.has(cIdx) ? 'col-selected-cell' : ''}>
                                {row[cIdx] ?? ''}
                              </td>
                            ))}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                  {filteredRows.length > 500 && (
                    <p className="csv-limit-msg">Mostrando 500 de {filteredRows.length} linhas.</p>
                  )}
                </div>
              </div>

              {/* Result Panel */}
              {showResult && (
                <div className="card csv-result-card">
                  <div className="csv-result-header">
                    <h3 className="csv-result-title">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                      </svg>
                      Resultado
                    </h3>
                    <button
                      className={`btn btn-primary pulse-glow ${copied ? 'toast-success' : ''}`}
                      onClick={handleCopy}
                      disabled={!formatResult}
                    >
                      {copied ? (
                        <>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          Copiado!
                        </>
                      ) : (
                        <>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                          Copiar Resultado
                        </>
                      )}
                    </button>
                  </div>
                  <textarea
                    className="editor-textarea output csv-result-textarea"
                    readOnly
                    value={formatResult}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
