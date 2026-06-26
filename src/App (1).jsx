import { useState, useRef, useCallback } from "react";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import Papa from "papaparse";
import * as XLSX from "xlsx";

const SUPPORTED_TYPES = {
  "text/csv": "CSV",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
  "application/vnd.ms-excel": "Excel",
};

const CHART_COLORS = ["#7c6af7", "#4f8ef7", "#6ad9a0", "#f7c94f", "#f77c7c", "#c47cf7"];

const FINANCIAL_KEYWORDS = {
  revenue: ["revenue", "sales", "turnover", "income from operations", "net sales", "gross sales"],
  profit: ["profit", "net income", "earnings", "net profit", "operating profit", "ebit", "ebitda"],
  expenses: ["expense", "cost", "expenditure", "overheads", "operating costs", "cogs", "cost of goods"],
  assets: ["assets", "total assets", "current assets", "fixed assets", "non-current assets"],
  liabilities: ["liabilities", "total liabilities", "current liabilities", "long-term liabilities", "debt"],
  equity: ["equity", "shareholders equity", "net worth", "retained earnings", "capital"],
  cash: ["cash", "cash flow", "cash and equivalents", "liquid assets"],
  tax: ["tax", "taxation", "income tax", "deferred tax"],
};

const fmt = (v) => {
  if (Math.abs(v) >= 1000000) return `${(v / 1000000).toFixed(2)}M`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return v.toFixed(2);
};

const isNumeric = (val) => {
  if (val === null || val === undefined || val === "") return false;
  const cleaned = String(val).replace(/[$,£€%\s]/g, "");
  return !isNaN(parseFloat(cleaned)) && isFinite(cleaned);
};

const parseNum = (val) => {
  const cleaned = String(val).replace(/[$,£€%\s]/g, "");
  return parseFloat(cleaned);
};

const categorise = (label) => {
  const lower = String(label).toLowerCase();
  for (const [cat, keywords] of Object.entries(FINANCIAL_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) return cat;
  }
  return null;
};

const analyseData = (rows) => {
  // Try to detect structure: rows with label + numeric columns
  if (!rows || rows.length === 0) return null;

  const headers = Object.keys(rows[0]);
  const labelCol = headers[0];
  const numericCols = headers.filter(h => h !== labelCol && rows.some(r => isNumeric(r[h])));

  if (numericCols.length === 0) return { error: "No numeric data found. Make sure your file has numbers." };

  // Categorise rows
  const categorised = {};
  const allRows = [];

  rows.forEach(row => {
    const label = String(row[labelCol] || "").trim();
    if (!label) return;
    const cat = categorise(label);
    const values = {};
    numericCols.forEach(c => {
      if (isNumeric(row[c])) values[c] = parseNum(row[c]);
    });
    if (Object.keys(values).length === 0) return;
    allRows.push({ label, cat, values });
    if (cat) {
      if (!categorised[cat]) categorised[cat] = [];
      categorised[cat].push({ label, values });
    }
  });

  if (allRows.length === 0) return { error: "Couldn't find labelled financial data. Check your file format." };

  // Build insights
  const insights = [];
  const firstNumCol = numericCols[0];
  const lastNumCol = numericCols[numericCols.length - 1];
  const isMultiPeriod = numericCols.length > 1;

  // Revenue insight
  const revRows = categorised["revenue"] || [];
  const profitRows = categorised["profit"] || [];
  const expRows = categorised["expenses"] || [];
  const assetRows = categorised["assets"] || [];
  const liabRows = categorised["liabilities"] || [];

  if (revRows.length > 0) {
    const rev = revRows[0].values[firstNumCol];
    insights.push(`💰 Revenue stands at ${fmt(rev)}.`);
    if (isMultiPeriod) {
      const revLast = revRows[0].values[lastNumCol];
      const change = ((rev - revLast) / Math.abs(revLast)) * 100;
      insights.push(`📈 Revenue changed by ${change.toFixed(1)}% from ${fmt(revLast)} to ${fmt(rev)} over the period.`);
    }
  }

  if (profitRows.length > 0) {
    const profit = profitRows[0].values[firstNumCol];
    insights.push(`${profit >= 0 ? "✅" : "🔴"} Net profit is ${fmt(profit)}${profit < 0 ? " — the business is running at a loss." : "."}`);
    if (revRows.length > 0) {
      const rev = revRows[0].values[firstNumCol];
      const margin = (profit / rev) * 100;
      insights.push(`📊 Profit margin is ${margin.toFixed(1)}% — ${margin > 20 ? "healthy" : margin > 10 ? "moderate" : margin > 0 ? "thin" : "negative"}.`);
    }
  }

  if (expRows.length > 0) {
    const exp = expRows[0].values[firstNumCol];
    insights.push(`🧾 Total expenses are ${fmt(exp)}.`);
  }

  if (assetRows.length > 0 && liabRows.length > 0) {
    const assets = assetRows[0].values[firstNumCol];
    const liabs = liabRows[0].values[firstNumCol];
    const equity = assets - liabs;
    insights.push(`🏦 Assets: ${fmt(assets)}, Liabilities: ${fmt(liabs)}, Net equity: ${fmt(equity)}.`);
    const ratio = liabs / assets;
    insights.push(`⚖️ Debt-to-asset ratio is ${ratio.toFixed(2)} — ${ratio < 0.4 ? "low leverage, financially stable" : ratio < 0.7 ? "moderate leverage" : "high leverage, watch the debt levels"}.`);
  }

  if (insights.length === 0) {
    // Generic fallback
    allRows.slice(0, 5).forEach(r => {
      const val = Object.values(r.values)[0];
      insights.push(`• ${r.label}: ${fmt(val)}`);
    });
  }

  // Build bar chart — top numeric rows
  const barData = isMultiPeriod
    ? allRows.slice(0, 6).map(r => {
        const obj = { label: r.label.length > 15 ? r.label.slice(0, 15) + "…" : r.label };
        numericCols.slice(0, 3).forEach(c => { if (r.values[c] !== undefined) obj[c] = r.values[c]; });
        return obj;
      })
    : allRows.slice(0, 8).map(r => ({
        label: r.label.length > 15 ? r.label.slice(0, 15) + "…" : r.label,
        value: Object.values(r.values)[0],
      }));

  const barKeys = isMultiPeriod ? numericCols.slice(0, 3) : ["value"];

  // Build pie chart — categorised items
  const pieData = Object.entries(categorised)
    .map(([cat, items]) => ({
      name: cat.charAt(0).toUpperCase() + cat.slice(1),
      value: Math.abs(items[0].values[firstNumCol] || 0),
    }))
    .filter(d => d.value > 0)
    .slice(0, 6);

  return { insights, barData, barKeys, pieData, numericCols, isMultiPeriod };
};

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{ background: "#1a1a27", border: "1px solid #2a2a3a", borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "#d0d0f0" }}>
        {label && <div style={{ color: "#8a8aaa", marginBottom: 4 }}>{label}</div>}
        {payload.map((p, i) => (
          <div key={i} style={{ color: p.color || "#7c6af7" }}>
            {p.name}: {typeof p.value === "number" ? fmt(p.value) : p.value}
          </div>
        ))}
      </div>
    );
  }
  return null;
};

export default function Fimplify() {
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const inputRef = useRef();

  const handleFile = (f) => {
    if (!SUPPORTED_TYPES[f.type] && !f.name.endsWith(".csv") && !f.name.endsWith(".xlsx") && !f.name.endsWith(".xls")) {
      setError("Upload a CSV or Excel file (.csv, .xlsx). PDF and image support requires an AI connection.");
      return;
    }
    setFile(f);
    setResult(null);
    setError(null);
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, []);

  const onDragOver = (e) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);

  const analyse = async () => {
    if (!file) return;
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      let rows = [];

      if (file.name.endsWith(".csv") || file.type === "text/csv") {
        const text = await file.text();
        const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
        rows = parsed.data;
      } else {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
      }

      const analysis = analyseData(rows);
      if (analysis?.error) {
        setError(analysis.error);
      } else {
        setResult(analysis);
      }
    } catch (e) {
      setError("Could not read file. Make sure it's a valid CSV or Excel file.");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setFile(null); setResult(null); setError(null); };

  return (
    <div style={{ minHeight: "100vh", background: "#0e0e11", color: "#e8e8f0", fontFamily: "'Inter', 'Segoe UI', sans-serif", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <header style={{ padding: "20px 32px", borderBottom: "1px solid #1e1e2a", display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{ width: 32, height: 32, background: "linear-gradient(135deg, #7c6af7, #4f8ef7)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>₣</div>
        <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px" }}>Fimplify</span>
        <span style={{ fontSize: 12, color: "#5a5a7a", marginLeft: 4, marginTop: 2 }}>Financial docs, in plain English</span>
      </header>

      <main style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 24px" }}>
        {!result ? (
          <>
            <div style={{ marginBottom: 32, textAlign: "center" }}>
              <div style={{ fontSize: 13, color: "#5a5a7a", background: "#16161f", border: "1px solid #1e1e2a", borderRadius: 8, padding: "8px 16px" }}>
                📂 Supports CSV and Excel files
              </div>
            </div>

            {/* Drop zone */}
            <div
              onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
              onClick={() => !file && inputRef.current.click()}
              style={{
                width: "100%", maxWidth: 520, minHeight: 220,
                border: `2px dashed ${dragging ? "#7c6af7" : file ? "#4f8ef7" : "#2a2a3a"}`,
                borderRadius: 16, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                gap: 12, cursor: file ? "default" : "pointer",
                background: dragging ? "#13131e" : "#12121a", transition: "all 0.2s", padding: 32,
              }}
            >
              <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }} onChange={e => e.target.files[0] && handleFile(e.target.files[0])} />
              {file ? (
                <>
                  <div style={{ background: "linear-gradient(135deg, #7c6af722, #4f8ef722)", border: "1px solid #7c6af744", borderRadius: 10, padding: "10px 18px", fontSize: 13, color: "#a0a0c8", display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 18 }}>📄</span>
                    <span style={{ fontWeight: 500, color: "#d0d0f0" }}>{file.name}</span>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); reset(); }} style={{ background: "none", border: "none", color: "#5a5a7a", cursor: "pointer", fontSize: 12, marginTop: 4 }}>Remove file</button>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 36 }}>📂</div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 15, fontWeight: 500, color: "#c0c0e0" }}>Drop your spreadsheet here</div>
                    <div style={{ fontSize: 12, color: "#4a4a6a", marginTop: 4 }}>CSV · Excel (.xlsx)</div>
                  </div>
                  <div style={{ fontSize: 12, color: "#7c6af7", marginTop: 4, border: "1px solid #7c6af744", borderRadius: 6, padding: "5px 14px" }}>or click to browse</div>
                </>
              )}
            </div>

            {error && (
              <div style={{ marginTop: 16, padding: "10px 18px", background: "#1e0e0e", border: "1px solid #4a1a1a", borderRadius: 8, color: "#f07070", fontSize: 13, maxWidth: 520, width: "100%" }}>{error}</div>
            )}

            <button onClick={analyse} disabled={!file || loading} style={{
              marginTop: 24, padding: "13px 40px", borderRadius: 10, border: "none",
              cursor: file && !loading ? "pointer" : "not-allowed",
              background: file && !loading ? "linear-gradient(135deg, #7c6af7, #4f8ef7)" : "#1e1e2a",
              color: file && !loading ? "#fff" : "#3a3a5a",
              fontSize: 15, fontWeight: 600, letterSpacing: "-0.2px", transition: "all 0.2s",
            }}>
              {loading ? "Analysing…" : "Analyse Document"}
            </button>
          </>
        ) : (
          <div style={{ width: "100%", maxWidth: 900 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 11, color: "#5a5a7a", textTransform: "uppercase", letterSpacing: "0.08em" }}>Analysis Results</div>
                <div style={{ fontSize: 13, color: "#6a6a8a", marginTop: 2 }}>{file?.name}</div>
              </div>
              <button onClick={reset} style={{ background: "#16161f", border: "1px solid #2a2a3a", color: "#8a8aaa", borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontSize: 12 }}>← New document</button>
            </div>

            <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
              {/* Insights panel */}
              <div style={{ flex: "1 1 300px", background: "#12121a", border: "1px solid #1e1e2a", borderRadius: 14, padding: "24px 28px" }}>
                <div style={{ fontSize: 11, color: "#5a5a7a", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16 }}>Key Insights</div>
                {result.insights.map((ins, i) => (
                  <div key={i} style={{ fontSize: 14, color: "#d0d0e8", lineHeight: 1.7, marginBottom: 12, paddingBottom: 12, borderBottom: i < result.insights.length - 1 ? "1px solid #1a1a26" : "none" }}>
                    {ins}
                  </div>
                ))}
              </div>

              {/* Charts */}
              <div style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: 16 }}>
                {result.barData?.length > 0 && (
                  <div style={{ background: "#12121a", border: "1px solid #1e1e2a", borderRadius: 14, padding: "20px 24px" }}>
                    <div style={{ fontSize: 11, color: "#5a5a7a", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16 }}>
                      {result.isMultiPeriod ? "Period Comparison" : "Figures"}
                    </div>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={result.barData} margin={{ top: 4, right: 8, left: 0, bottom: 24 }} barCategoryGap="30%" barGap={3}>
                        <XAxis dataKey="label" tick={{ fill: "#6a6a8a", fontSize: 10 }} axisLine={false} tickLine={false} angle={-20} textAnchor="end" />
                        <YAxis tick={{ fill: "#6a6a8a", fontSize: 11 }} axisLine={false} tickLine={false} width={52} tickFormatter={fmt} />
                        <Tooltip content={<CustomTooltip />} cursor={{ fill: "#1a1a26" }} />
                        {result.barKeys.length > 1 && <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11, color: "#8a8aaa", paddingTop: 8 }} />}
                        {result.barKeys.map((key, i) => (
                          <Bar key={key} dataKey={key} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[3, 3, 0, 0]} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {result.pieData?.length > 1 && (
                  <div style={{ background: "#12121a", border: "1px solid #1e1e2a", borderRadius: 14, padding: "20px 24px" }}>
                    <div style={{ fontSize: 11, color: "#5a5a7a", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16 }}>Breakdown</div>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={result.pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                          {result.pieData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                        </Pie>
                        <Tooltip content={<CustomTooltip />} />
                        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: "#8a8aaa" }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      <footer style={{ padding: "16px 32px", borderTop: "1px solid #1a1a24", textAlign: "center", fontSize: 11, color: "#3a3a5a" }}>
        Fimplify · Financial documents in plain English
      </footer>
    </div>
  );
}
