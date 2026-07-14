import { useState, useMemo, useEffect } from 'react';

function App() {
  const [inputText, setInputText] = useState('');
  const [formatMode, setFormatMode] = useState<'join' | 'end'>('join');
  const [activeSepPill, setActiveSepPill] = useState<string>(':');
  const [customSeparator, setCustomSeparator] = useState('');
  const [ignoreEmpty, setIgnoreEmpty] = useState(true);
  const [trimSpaces, setTrimSpaces] = useState(true);
  const [removeDuplicates, setRemoveDuplicates] = useState(false);
  const [textCase, setTextCase] = useState<'original' | 'upper' | 'lower' | 'title'>('original');
  const [copied, setCopied] = useState(false);

  // Helper to get the actual separator to use
  const separatorToUse = useMemo(() => {
    if (activeSepPill === 'custom') {
      return customSeparator;
    }
    if (activeSepPill === '\\t') {
      return '\t';
    }
    return activeSepPill;
  }, [activeSepPill, customSeparator]);

  // Statistics for Input Text
  const inputStats = useMemo(() => {
    if (!inputText) return { lines: 0, chars: 0 };
    const lines = inputText.split(/\r?\n/);
    return {
      lines: lines.length,
      chars: inputText.length,
    };
  }, [inputText]);

  // Main formatting logic
  const formattedData = useMemo(() => {
    if (!inputText) return { text: '', linesCount: 0, duplicatesRemoved: 0 };

    let lines = inputText.split(/\r?\n/);

    // 1. Trim spaces
    if (trimSpaces) {
      lines = lines.map(line => line.trim());
    }

    // 2. Ignore empty lines
    if (ignoreEmpty) {
      lines = lines.filter(line => line !== '');
    }

    // 3. Text case transformation
    lines = lines.map(line => {
      switch (textCase) {
        case 'upper':
          return line.toUpperCase();
        case 'lower':
          return line.toLowerCase();
        case 'title':
          return line
            .toLowerCase()
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
        default:
          return line;
      }
    });

    // 4. Remove duplicates
    let duplicatesRemoved = 0;
    if (removeDuplicates) {
      const uniqueLines = Array.from(new Set(lines));
      duplicatesRemoved = lines.length - uniqueLines.length;
      lines = uniqueLines;
    }

    // 5. Apply formatting mode
    let resultText = '';
    if (formatMode === 'join') {
      resultText = lines.join(separatorToUse);
    } else {
      // 'end' mode
      resultText = lines.map(line => line + separatorToUse).join('\n');
    }

    return {
      text: resultText,
      linesCount: lines.length,
      duplicatesRemoved,
    };
  }, [inputText, formatMode, separatorToUse, ignoreEmpty, trimSpaces, removeDuplicates, textCase]);

  // Handle Clipboard Copy
  const handleCopy = async () => {
    if (!formattedData.text) return;
    try {
      await navigator.clipboard.writeText(formattedData.text);
      setCopied(true);
    } catch (err) {
      console.error('Falha ao copiar texto: ', err);
    }
  };

  // Reset copy state after 2 seconds
  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  // Insert Mock Data for demo/ease of testing
  const handleInsertExample = () => {
    setInputText('Coca-cola 350ml\n  Guaraná Antarctica 2L\nFanta Laranja 600ml\n\nCoca-cola 350ml\n  Sprite lata');
    setRemoveDuplicates(true);
  };

  const handleClear = () => {
    setInputText('');
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1 className="app-title">Formatador de Colunas do Excel</h1>
        <p className="app-subtitle">Cole sua coluna do Excel e formate os dados instantaneamente em tempo real</p>
      </header>

      <main className="app-grid">
        {/* Left column: Configurations */}
        <aside className="card">
          <h2 className="card-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
            Configurações
          </h2>

          {/* Mode Selection */}
          <div className="form-group">
            <label className="form-label">Modo de Formatação</label>
            <select 
              className="select-input" 
              value={formatMode} 
              onChange={(e) => setFormatMode(e.target.value as 'join' | 'end')}
            >
              <option value="join">Unir tudo em uma linha (Separado por)</option>
              <option value="end">Adicionar ao fim de cada linha</option>
            </select>
          </div>

          {/* Separator Selection */}
          <div className="form-group">
            <label className="form-label">Separador</label>
            <div className="separator-pills">
              <button 
                type="button" 
                className={`pill-btn ${activeSepPill === ':' ? 'active' : ''}`}
                onClick={() => setActiveSepPill(':')}
                title="Dois pontos"
              >:</button>
              <button 
                type="button" 
                className={`pill-btn ${activeSepPill === ',' ? 'active' : ''}`}
                onClick={() => setActiveSepPill(',')}
                title="Vírgula"
              >,</button>
              <button 
                type="button" 
                className={`pill-btn ${activeSepPill === ';' ? 'active' : ''}`}
                onClick={() => setActiveSepPill(';')}
                title="Ponto e vírgula"
              >;</button>
              <button 
                type="button" 
                className={`pill-btn ${activeSepPill === '|' ? 'active' : ''}`}
                onClick={() => setActiveSepPill('|')}
                title="Pipe"
              >|</button>
              <button 
                type="button" 
                className={`pill-btn ${activeSepPill === 'custom' ? 'active' : ''}`}
                onClick={() => setActiveSepPill('custom')}
                title="Personalizado"
              >Outro</button>
            </div>

            {activeSepPill === 'custom' && (
              <input 
                type="text" 
                className="text-input" 
                placeholder="Ex: - ou / ou espaço" 
                value={customSeparator}
                onChange={(e) => setCustomSeparator(e.target.value)}
              />
            )}
          </div>

          {/* Case Transformation */}
          <div className="form-group">
            <label className="form-label">Transformar Caixa</label>
            <select 
              className="select-input"
              value={textCase}
              onChange={(e) => setTextCase(e.target.value as any)}
            >
              <option value="original">Manter Original</option>
              <option value="upper">MAIÚSCULO</option>
              <option value="lower">minúsculo</option>
              <option value="title">Primeira Letra Maiúscula</option>
            </select>
          </div>

          {/* Additional Options */}
          <div className="form-group">
            <label className="form-label">Ajustes Adicionais</label>
            <div className="checkbox-group">
              <label className="checkbox-label">
                <input 
                  type="checkbox" 
                  checked={ignoreEmpty} 
                  onChange={(e) => setIgnoreEmpty(e.target.checked)} 
                />
                Ignorar linhas vazias
              </label>

              <label className="checkbox-label">
                <input 
                  type="checkbox" 
                  checked={trimSpaces} 
                  onChange={(e) => setTrimSpaces(e.target.checked)} 
                />
                Remover espaços (Trim)
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
          </div>

          <div style={{ marginTop: 'auto', paddingTop: '1rem' }}>
            <button 
              type="button" 
              className="btn btn-secondary" 
              style={{ width: '100%' }}
              onClick={handleInsertExample}
            >
              Inserir Exemplo
            </button>
          </div>
        </aside>

        {/* Right column: Editors */}
        <section className="editors-grid">
          {/* Input Panel */}
          <div className="card editor-card">
            <div className="editor-header">
              <h2 className="card-title" style={{ border: 'none', padding: '0', marginBottom: '0' }}>
                Entrada (Colar aqui)
              </h2>
              <span className="editor-badge">
                {inputStats.lines} {inputStats.lines === 1 ? 'linha' : 'linhas'}
              </span>
            </div>

            <div className="textarea-container">
              <textarea
                className="editor-textarea"
                placeholder="Cole aqui a coluna copiada do Excel..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                autoFocus
              />
            </div>

            <div className="actions-row">
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={handleClear}
                disabled={!inputText}
                style={{ flex: 1 }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
                Limpar
              </button>
            </div>
          </div>

          {/* Output Panel */}
          <div className="card editor-card">
            <div className="editor-header">
              <h2 className="card-title" style={{ border: 'none', padding: '0', marginBottom: '0' }}>
                Resultado
              </h2>
              <span className="editor-badge">
                {formattedData.linesCount} {formattedData.linesCount === 1 ? 'item' : 'itens'}
              </span>
            </div>

            <div className="textarea-container">
              <textarea
                className="editor-textarea output"
                readOnly
                placeholder="O resultado formatado aparecerá aqui..."
                value={formattedData.text}
              />
            </div>

            <div className="actions-row">
              <button 
                type="button" 
                className={`btn btn-primary pulse-glow ${copied ? 'toast-success' : ''}`}
                onClick={handleCopy}
                disabled={!formattedData.text}
              >
                {copied ? (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    Copiado com Sucesso!
                  </>
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    Copiar Resultado
                  </>
                )}
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Stats Counter Footer */}
      <footer className="stats-container">
        <div className="stat-item">
          <div className="stat-value">{inputStats.lines}</div>
          <div className="stat-label">Linhas Iniciais</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{formattedData.linesCount}</div>
          <div className="stat-label">Itens Finais</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{formattedData.duplicatesRemoved}</div>
          <div className="stat-label">Duplicados Removidos</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{formattedData.text.length}</div>
          <div className="stat-label">Total Caracteres</div>
        </div>
      </footer>

      <div className="app-footer">
        <p>Desenvolvido com carinho para otimização de fluxo de trabalho do Excel.</p>
      </div>
    </div>
  );
}

export default App;
