import { useState, useRef, useCallback } from "react";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";

const SUPPORTED_TYPES = {
  "application/pdf": "PDF",
  "image/png": "Image",
  "image/jpeg": "Image",
  "image/webp": "Image",
  "text/csv": "CSV",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
};

const CHART_COLORS = ["#7c6af7", "#4f8ef7", "#6ad9a0", "#f7c94f", "#f77c7c", "#c47cf7"];

const fileToBase64 = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = () => rej(new Error("Read failed"));
    r.readAsDataURL(file);
  });

const fileToText = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error("Read failed"));
    r.readAsText(file);
  });

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{
        background: "#1a1a27", border: "1px solid #2a2a3a",
        borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "#d0d0f0"
      }}>
        {label && <div style={{ color: "#8a8aaa", marginBottom: 4 }}>{label}</div>}
        {payload.map((p, i) => (
          <div key={i} style={{ color: p.color || "#7c6af7" }}>
            {p.name}: {typeof p.value === "number" ? p.value.toLocaleString() : p.value}
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
  const [chartData, setChartData] = useState(null);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState("explain");
  const inputRef = useRef();

  const handleFile = (f) => {
    if (!SUPPORTED_TYPES[f.type]) {
      setError("Unsupported file type. Upload a PDF, image, CSV, Excel, or Word doc.");
      return;
    }
    setFile(f);
    setResult(null);
    setChartData(null);
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

  const modePrompts = {
    explain: `You are Fimplify, a plain-language financial document assistant. Do two things:

1. EXPLANATION: Explain this financial document in simple, clear English. Break down jargon, key figures, and what it means for the reader. Use short paragraphs.

2. CHART_DATA: Extract numerical data suitable for charts. Return a JSON block at the end in this exact format:
<chart_data>
{
  "bar": [{"name": "Label", "value": 1234}, ...],
  "pie": [{"name": "Label", "value": 1234}, ...]
}
</chart_data>

For bar chart: use time-series data (e.g. revenue by year/quarter) or comparative figures (e.g. assets vs liabilities).
For pie chart: use compositional data (e.g. expense breakdown, asset allocation).
If a chart type has no relevant data, return an empty array for it.
All values must be numbers (no currency symbols). Use up to 6 items per chart.`,

    summarise: `You are Fimplify. Do two things:

1. SUMMARY: Summarise this financial document in 3-5 sentences. Focus on the most important numbers, dates, and conclusions. Plain English only.

2. CHART_DATA: Extract numerical data suitable for charts. Return a JSON block at the end in this exact format:
<chart_data>
{
  "bar": [{"name": "Label", "value": 1234}, ...],
  "pie": [{"name": "Label", "value": 1234}, ...]
}
</chart_data>

All values must be numbers. Use up to 6 items per chart. Empty array if no relevant data.`,

    extract: `You are Fimplify. Do two things:

1. EXTRACTION: Extract all key financial figures, dates, parties, and terms. Present as a clean readable breakdown with clear labels.

2. CHART_DATA: Extract numerical data suitable for charts. Return a JSON block at the end in this exact format:
<chart_data>
{
  "bar": [{"name": "Label", "value": 1234}, ...],
  "pie": [{"name": "Label", "value": 1234}, ...]
}
</chart_data>

All values must be numbers. Use up to 6 items per chart. Empty array if no relevant data.`,
  };

  const parseChartData = (text) => {
    try {
      const match = text.match(/<chart_data>([\s\S]*?)<\/chart_data>/);
      if (!match) return null;
      const json = JSON.parse(match[1].trim());
      return {
        bar: (json.bar || []).filter(d => d.name && typeof d.value === "number"),
        pie: (json.pie || []).filter(d => d.name && typeof d.value === "number"),
      };
    } catch { return null; }
  };

  const stripChartData = (text) => text.replace(/<chart_data>[\s\S]*?<\/chart_data>/, "").trim();

  const analyse = async () => {
    if (!file) return;
    setLoading(true);
    setResult(null);
    setChartData(null);
    setError(null);

    try {
      const isImage = file.type.startsWith("image/");
      const isPDF = file.type === "application/pdf";

      let messages;

      if (isImage) {
        const b64 = await fileToBase64(file);
        messages = [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: file.type, data: b64 } },
          { type: "text", text: modePrompts[mode] }
        ]}];
      } else if (isPDF) {
        const b64 = await fileToBase64(file);
        messages = [{ role: "user", content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
          { type: "text", text: modePrompts[mode] }
        ]}];
      } else {
        let text;
        try { text = await fileToText(file); } catch { text = "[Could not read file as text]"; }
        messages = [{ role: "user", content: `${modePrompts[mode]}\n\nFile content:\n${text.slice(0, 8000)}` }];
      }

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, messages }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const rawText = data.content?.find(b => b.type === "text")?.text || "No response.";
      const parsed = parseChartData(rawText);
      setChartData(parsed);
      setResult(stripChartData(rawText));
    } catch (e) {
      setError(e.message || "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setFile(null); setResult(null); setChartData(null); setError(null); };

  const hasCharts = chartData && (chartData.bar?.length > 0 || chartData.pie?.length > 0);

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
            {/* Mode selector */}
            <div style={{ display: "flex", gap: 8, marginBottom: 32, background: "#16161f", borderRadius: 10, padding: 4, border: "1px solid #1e1e2a" }}>
              {[{ key: "explain", label: "Explain" }, { key: "summarise", label: "Summarise" }, { key: "extract", label: "Extract Data" }].map(m => (
                <button key={m.key} onClick={() => setMode(m.key)} style={{
                  padding: "8px 18px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, transition: "all 0.15s",
                  background: mode === m.key ? "linear-gradient(135deg, #7c6af7, #4f8ef7)" : "transparent",
                  color: mode === m.key ? "#fff" : "#6a6a8a",
                }}>{m.label}</button>
              ))}
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
              <input ref={inputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xlsx,.docx" style={{ display: "none" }} onChange={e => e.target.files[0] && handleFile(e.target.files[0])} />
              {file ? (
                <>
                  <div style={{ background: "linear-gradient(135deg, #7c6af722, #4f8ef722)", border: "1px solid #7c6af744", borderRadius: 10, padding: "10px 18px", fontSize: 13, color: "#a0a0c8", display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 18 }}>📄</span>
                    <span style={{ fontWeight: 500, color: "#d0d0f0" }}>{file.name}</span>
                    <span style={{ color: "#5a5a7a" }}>{SUPPORTED_TYPES[file.type]}</span>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); reset(); }} style={{ background: "none", border: "none", color: "#5a5a7a", cursor: "pointer", fontSize: 12, marginTop: 4 }}>Remove file</button>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 36 }}>📂</div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 15, fontWeight: 500, color: "#c0c0e0" }}>Drop your document here</div>
                    <div style={{ fontSize: 12, color: "#4a4a6a", marginTop: 4 }}>PDF · Image · CSV · Excel · Word</div>
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
            {loading && <div style={{ marginTop: 20, color: "#5a5a7a", fontSize: 13 }}>Reading your document…</div>}
          </>
        ) : (
          <div style={{ width: "100%", maxWidth: 860 }}>
            {/* Result header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 11, color: "#5a5a7a", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  {mode === "explain" ? "Plain English Explanation" : mode === "summarise" ? "Summary" : "Extracted Data"}
                </div>
                <div style={{ fontSize: 13, color: "#6a6a8a", marginTop: 2 }}>{file?.name}</div>
              </div>
              <button onClick={reset} style={{ background: "#16161f", border: "1px solid #2a2a3a", color: "#8a8aaa", borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontSize: 12 }}>
                ← New document
              </button>
            </div>

            {/* Two column layout if charts exist */}
            <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
              {/* Explanation */}
              <div style={{ flex: "1 1 340px", background: "#12121a", border: "1px solid #1e1e2a", borderRadius: 14, padding: "24px 28px", lineHeight: 1.75, fontSize: 14, color: "#d0d0e8", whiteSpace: "pre-wrap" }}>
                {result}
              </div>

              {/* Charts */}
              {hasCharts && (
                <div style={{ flex: "1 1 340px", display: "flex", flexDirection: "column", gap: 16 }}>
                  {chartData.bar?.length > 0 && (
                    <div style={{ background: "#12121a", border: "1px solid #1e1e2a", borderRadius: 14, padding: "20px 24px" }}>
                      <div style={{ fontSize: 11, color: "#5a5a7a", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16 }}>Figures</div>
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={chartData.bar} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                          <XAxis dataKey="name" tick={{ fill: "#6a6a8a", fontSize: 11 }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fill: "#6a6a8a", fontSize: 11 }} axisLine={false} tickLine={false} width={50} tickFormatter={v => v >= 1000000 ? `${(v/1000000).toFixed(1)}M` : v >= 1000 ? `${(v/1000).toFixed(0)}K` : v} />
                          <Tooltip content={<CustomTooltip />} cursor={{ fill: "#1e1e2a" }} />
                          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                            {chartData.bar.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {chartData.pie?.length > 0 && (
                    <div style={{ background: "#12121a", border: "1px solid #1e1e2a", borderRadius: 14, padding: "20px 24px" }}>
                      <div style={{ fontSize: 11, color: "#5a5a7a", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16 }}>Breakdown</div>
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie data={chartData.pie} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                            {chartData.pie.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                          </Pie>
                          <Tooltip content={<CustomTooltip />} />
                          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: "#8a8aaa" }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Switch mode buttons */}
            <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
              {["explain", "summarise", "extract"].filter(m => m !== mode).map(m => (
                <button key={m} onClick={() => { setMode(m); setResult(null); setChartData(null); }} style={{ background: "#16161f", border: "1px solid #2a2a3a", color: "#8a8aaa", borderRadius: 8, padding: "7px 16px", cursor: "pointer", fontSize: 12 }}>
                  {m === "explain" ? "Explain instead" : m === "summarise" ? "Summarise instead" : "Extract data instead"}
                </button>
              ))}
            </div>
          </div>
        )}
      </main>

      <footer style={{ padding: "16px 32px", borderTop: "1px solid #1a1a24", textAlign: "center", fontSize: 11, color: "#3a3a5a" }}>
        Fimplify · Financial documents in plain English · Powered by Claude
      </footer>
    </div>
  );
}
