import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, orderBy, addDoc } from "firebase/firestore";

/* ─────────────────────────────────────────────
   FIREBASE CONFIG
───────────────────────────────────────────── */
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY            || "AIzaSyAQYtoQBZ4_dYI98UQoFgf4M1wis9laSMA",
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN        || "freqschool.firebaseapp.com",
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID         || "freqschool",
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET     || "freqschool.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID|| "438288830739",
  appId:             import.meta.env.VITE_FIREBASE_APP_ID             || "1:438288830739:web:2cd17a173deac64634cae6",
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

/* ─────────────────────────────────────────────
   SEGURANÇA — Hash de senha (SHA-256 nativo)
───────────────────────────────────────────── */
async function hashPassword(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

function isHashed(str) {
  // SHA-256 hashes are always 64 hex chars
  return typeof str === "string" && /^[a-f0-9]{64}$/.test(str);
}

async function generateSessionToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, "0")).join("");
}

/* ─────────────────────────────────────────────
   EXPORTAR PDF (jsPDF + autotable via CDN)
───────────────────────────────────────────── */
async function loadJsPDF() {
  if (window.jspdf) return window.jspdf.jsPDF;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js";
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  return window.jspdf.jsPDF;
}

async function exportRelatorioPDF({ school, activeEmployees, activeOthers, activeApoio, reportDates, reportType, records, monthName, getEmpSummary }) {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  let y = 0;

  const primary   = [99, 102, 241];
  const green     = [34, 197, 94];
  const red       = [239, 68, 68];
  const amber     = [245, 158, 11];
  const purple    = [139, 92, 246];
  const grayDark  = [30, 41, 59];
  const grayMid   = [71, 85, 105];
  const grayLight = [148, 163, 184];
  const white     = [255, 255, 255];

  const STATUS_COLORS_PDF = { presente: green, ausente: red, justificado: amber, folga: purple };

  // Cabeçalho
  doc.setFillColor(...primary);
  doc.rect(0, 0, W, 32, "F");
  doc.setFontSize(18);
  doc.setTextColor(...white);
  doc.setFont("helvetica", "bold");
  doc.text(school.name || "FreqSchool", 14, 13);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(200, 200, 255);
  doc.text("Relatorio de Frequencia Escolar", 14, 20);
  if (school.city) doc.text(school.city, 14, 26);

  const fmtD = (s) => { const [yy,mm,dd]=s.split("-"); return `${dd}/${mm}/${yy}`; };
  const fmtS = (s) => { const [,mm,dd]=s.split("-"); return `${dd}/${mm}`; };

  const periodo = reportType === "semanal"
    ? `Semana: ${fmtD(reportDates[0])} a ${fmtD(reportDates[reportDates.length-1])}`
    : `Mes: ${monthName}`;
  doc.setFontSize(9);
  doc.setTextColor(...white);
  doc.text(periodo, W-14, 13, { align:"right" });
  doc.text(`Gerado em: ${new Date().toLocaleString("pt-BR")}`, W-14, 20, { align:"right" });
  if (school.director) doc.text(`Direcao: ${school.director}`, W-14, 26, { align:"right" });
  y = 40;

  // Totais
  const totals = { presente:0, ausente:0, justificado:0, folga:0 };
  reportDates.forEach(d => {
    activeOthers.forEach(e => { const s=records[`${d}_${e.id}`]; if(s) totals[s]++; });
    activeApoio.forEach(e => {
      ["manha","tarde"].forEach(t => { const s=records[`${d}_${e.id}_${t}`]; if(s) totals[s]++; });
    });
  });

  const boxW = (W-28-9)/4;
  const labels = { presente:"Presente", ausente:"Ausente", justificado:"Justificado", folga:"Folga" };
  Object.entries(totals).forEach(([k,v],i) => {
    const x = 14+i*(boxW+3), col=STATUS_COLORS_PDF[k];
    doc.setFillColor(Math.min(col[0]+180,255), Math.min(col[1]+180,255), Math.min(col[2]+180,255));
    doc.setDrawColor(...col);
    doc.roundedRect(x, y, boxW, 18, 3, 3, "FD");
    doc.setFontSize(18); doc.setFont("helvetica","bold"); doc.setTextColor(...col);
    doc.text(String(v), x+boxW/2, y+11, { align:"center" });
    doc.setFontSize(8); doc.setFont("helvetica","normal"); doc.setTextColor(...grayMid);
    doc.text(labels[k], x+boxW/2, y+16, { align:"center" });
  });
  y += 26;

  // Tabela resumo
  doc.setFontSize(11); doc.setFont("helvetica","bold"); doc.setTextColor(...grayDark);
  doc.text("Resumo por Funcionario", 14, y); y += 6;

  const tableBody = [];
  activeEmployees.forEach(emp => {
    const apoio = emp.role === "Profissional de Apoio";
    const sm = getEmpSummary(emp);
    if (!apoio) {
      const g = sm.geral;
      tableBody.push([emp.name, emp.role, String(g.presente), String(g.ausente), String(g.justificado), String(g.folga), g.pct!==null?`${g.pct}%`:"-"]);
    } else {
      ["manha","tarde"].forEach((turno,ti) => {
        const td = sm[turno];
        tableBody.push([ti===0?emp.name:"", ti===0?emp.role:`  ${turno==="manha"?"Manha":"Tarde"}`, String(td.presente), String(td.ausente), String(td.justificado), String(td.folga), td.pct!==null?`${td.pct}%`:"-"]);
      });
    }
  });

  doc.autoTable({
    startY: y,
    head: [["Funcionario","Cargo / Turno","Presente","Ausente","Justif.","Folga","% Presenca"]],
    body: tableBody,
    styles: { fontSize:9, cellPadding:3, textColor:grayDark },
    headStyles: { fillColor:primary, textColor:white, fontStyle:"bold", fontSize:9 },
    alternateRowStyles: { fillColor:[241,245,249] },
    columnStyles: {
      0: { fontStyle:"bold", cellWidth:50 },
      1: { cellWidth:38 },
      2: { halign:"center", textColor:green },
      3: { halign:"center", textColor:red },
      4: { halign:"center", textColor:amber },
      5: { halign:"center", textColor:purple },
      6: { halign:"center", fontStyle:"bold" },
    },
    didParseCell: (data) => {
      if (data.section==="body" && data.column.index===6 && data.cell.raw!=="-") {
        const pct=parseInt(data.cell.raw);
        data.cell.styles.textColor = pct>=75?green:pct>=50?amber:red;
      }
    },
    margin: { left:14, right:14 },
  });
  y = doc.lastAutoTable.finalY+10;

  // Heatmap semanal
  if (reportType==="semanal" && activeEmployees.length>0) {
    if (y>230) { doc.addPage(); y=20; }
    doc.setFontSize(11); doc.setFont("helvetica","bold"); doc.setTextColor(...grayDark);
    doc.text("Visao Diaria da Semana", 14, y); y+=6;

    const DS=["Dom","Seg","Ter","Qua","Qui","Sex","Sab"];
    const hHead=["Funcionario",...reportDates.map(d=>`${DS[new Date(d+"T12:00:00").getDay()]}\n${fmtS(d)}`)];
    const abbr={presente:"P",ausente:"F",justificado:"J",folga:"X"};
    const hBody=[];
    activeOthers.forEach(e=>{hBody.push([e.name.split(" ")[0],...reportDates.map(d=>abbr[records[`${d}_${e.id}`]]||"")]);});
    activeApoio.forEach(e=>{["manha","tarde"].forEach((t,ti)=>{hBody.push([ti===0?e.name.split(" ")[0]:`  ${t==="manha"?"M":"T"}`,...reportDates.map(d=>abbr[records[`${d}_${e.id}_${t}`]]||"")]);});});

    doc.autoTable({
      startY:y, head:[hHead], body:hBody,
      styles:{fontSize:8,cellPadding:2,halign:"center"},
      headStyles:{fillColor:[51,65,85],textColor:white,fontSize:8},
      columnStyles:{0:{halign:"left",fontStyle:"bold",cellWidth:30}},
      didParseCell:(data)=>{
        if(data.section==="body"&&data.column.index>0){
          const v=data.cell.raw;
          if(v==="P") data.cell.styles.textColor=green;
          else if(v==="F") data.cell.styles.textColor=red;
          else if(v==="J") data.cell.styles.textColor=amber;
          else if(v==="X") data.cell.styles.textColor=purple;
        }
      },
      alternateRowStyles:{fillColor:[241,245,249]},
      margin:{left:14,right:14},
    });
  }

  // Rodapé
  const pages=doc.internal.getNumberOfPages();
  for(let i=1;i<=pages;i++){
    doc.setPage(i);
    doc.setFontSize(8); doc.setTextColor(...grayLight);
    doc.text(`FreqSchool - ${school.name||""}`,14,292);
    doc.text(`Pagina ${i} de ${pages}`,W-14,292,{align:"right"});
    doc.setDrawColor(...grayLight); doc.line(14,288,W-14,288);
  }

  doc.save(`frequencia_${reportType}_${new Date().toISOString().split("T")[0]}.pdf`);
}


/* ─────────────────────────────────────────────
   CONSTANTES
───────────────────────────────────────────── */
const DEFAULT_SCHOOL = {
  name: "Escola Municipal",
  address: "",
  city: "",
  phone: "",
  email: "",
  director: "",
  logo: "",
};

const DEFAULT_EMPLOYEES = [
  { id: 1, name: "Ana Paula Silva",       role: "Professor(a)",         phone: "", email: "", active: true },
  { id: 2, name: "Carlos Eduardo Santos", role: "Professor(a)",         phone: "", email: "", active: true },
  { id: 3, name: "Fernanda Lima",         role: "Coordenador(a)",       phone: "", email: "", active: true },
  { id: 4, name: "Ricardo Alves",         role: "Profissional de Apoio",phone: "", email: "", active: true },
];

const ROLES = [
  "Professor(a)", "Coordenador(a)", "Diretor(a)", "Secretário(a)",
  "Auxiliar", "Inspetor(a)", "Merendeiro(a)", "Zelador(a)",
  "Profissional de Apoio", "Monitor(a)", "Outro",
];

const IS_APOIO    = (r) => r === "Profissional de Apoio";
const TURNOS      = ["manha", "tarde"];
const TURNO_LABEL = { manha: "Manhã 🌅", tarde: "Tarde 🌇" };
const TURNO_COLOR = { manha: "#f59e0b", tarde: "#6366f1" };

const STATUS_CONFIG = {
  presente:    { label: "Presente",    color: "#22c55e", icon: "✅" },
  ausente:     { label: "Ausente",     color: "#ef4444", icon: "❌" },
  justificado: { label: "Justificado", color: "#f59e0b", icon: "⚠️" },
  folga:       { label: "Folga",       color: "#8b5cf6", icon: "🔵" },
};

const STATUS_ICON_DISPLAY = {
  presente:    "✓",
  ausente:     "✗",
  justificado: "!",
  folga:       "◎",
};

/* ─────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────── */
const getTodayStr = () => new Date().toISOString().split("T")[0];

function getWeekDates() {
  const today = new Date(), day = today.getDay();
  const mon = new Date(today);
  mon.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    return d.toISOString().split("T")[0];
  });
}

function getMonthDates() {
  const t = new Date(), days = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  return Array.from({ length: days }, (_, i) =>
    new Date(t.getFullYear(), t.getMonth(), i + 1).toISOString().split("T")[0]);
}

const formatDate      = (s) => { const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; };
const formatDateShort = (s) => { const [, m, d] = s.split("-"); return `${d}/${m}`; };
const DAYS_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const getInitials = (n) => n.split(" ").map(x => x[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

const AVATAR_COLORS = [
  "linear-gradient(135deg,#6366f1,#8b5cf6)",
  "linear-gradient(135deg,#06b6d4,#6366f1)",
  "linear-gradient(135deg,#f59e0b,#ef4444)",
  "linear-gradient(135deg,#22c55e,#06b6d4)",
  "linear-gradient(135deg,#ec4899,#8b5cf6)",
  "linear-gradient(135deg,#f97316,#f59e0b)",
  "linear-gradient(135deg,#14b8a6,#6366f1)",
  "linear-gradient(135deg,#a855f7,#ec4899)",
];
const avatarColor = (id) => AVATAR_COLORS[id % AVATAR_COLORS.length];
const recordKey    = (date, id, turno = null) => turno ? `${date}_${id}_${turno}` : `${date}_${id}`;
const genId        = () => crypto.randomUUID();
const monthKey     = (date) => date.substring(0, 7); // "YYYY-MM-DD" → "YYYY-MM"
const currentMonth = () => new Date().toISOString().substring(0, 7);

/* ─────────────────────────────────────────────
   WHATSAPP MESSAGE BUILDER
───────────────────────────────────────────── */
function buildWhatsAppMessage(emp, records, date, school) {
  const apoio     = IS_APOIO(emp.role);
  const dateLabel = formatDate(date);
  const dayOfWeek = DAYS_PT[new Date(date + "T12:00:00").getDay()];

  // records pode ser { "YYYY-MM": { chave: status } } ou já o mapa plano { chave: status }
  // Normalizamos para sempre usar o mapa plano do mês correto
  const month = date.substring(0, 7);
  const flatRecords = (records && records[month] && typeof records[month] === "object")
    ? records[month]
    : records;

  const getR = (key) => flatRecords[key] || null;

  let lines = [];
  lines.push(`📋 *${school.name || "FreqSchool"}* — ${dayOfWeek}, ${dateLabel}`);
  lines.push(`👤 ${emp.name} (${emp.role})`);
  lines.push(``);

  const LINK_JUSTIFICATIVA = window.location.origin + window.location.pathname;
  let temFalta = false;

  if (apoio) {
    TURNOS.forEach(turno => {
      const s   = getR(recordKey(date, emp.id, turno));
      const cfg = s ? STATUS_CONFIG[s] : null;
      const turnoLabel = turno === "manha" ? "Manhã" : "Tarde";
      lines.push(`${turnoLabel}: ${cfg ? `${cfg.icon} ${cfg.label}` : "➖ Não registrado"}`);
      if (s === "ausente") temFalta = true;
    });
  } else {
    const s   = getR(recordKey(date, emp.id));
    const cfg = s ? STATUS_CONFIG[s] : null;
    lines.push(`Frequência: ${cfg ? `${cfg.icon} ${cfg.label}` : "➖ Não registrado"}`);
    if (s === "ausente") temFalta = true;
  }

  if (temFalta) {
    lines.push(``);
    lines.push(`⚠️ Falta registrada. Para justificar acesse:`);
    lines.push(LINK_JUSTIFICATIVA);
  }

  if (school.director) lines.push(`\n👩‍💼 ${school.director}`);


  return lines.join("\n");
}

/* Limpa número para apenas dígitos */
function cleanPhone(phone) {
  return phone.replace(/\D/g, "");
}

/* Abre WhatsApp com a mensagem */
function sendWhatsApp(phone, message) {
  const number  = cleanPhone(phone);
  const encoded = encodeURIComponent(message);
  // Adiciona código do Brasil se não tiver DDI
  const fullNumber = number.startsWith("55") ? number : `55${number}`;
  window.open(`https://wa.me/${fullNumber}?text=${encoded}`, "_blank");
}

/* ─────────────────────────────────────────────
   MINI COMPONENTS
───────────────────────────────────────────── */
function Field({ label, value, onChange, type = "text", placeholder, required, as, options }) {
  const base = {
    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 10, padding: "11px 14px", color: "#f1f5f9", fontSize: 14,
    fontFamily: "sans-serif", outline: "none", width: "100%", boxSizing: "border-box",
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={{ fontFamily: "sans-serif", fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1 }}>
        {label}{required && <span style={{ color: "#ef4444" }}> *</span>}
      </label>
      {as === "select" ? (
        <select value={value} onChange={e => onChange(e.target.value)} style={{ ...base, background: "#1e293b", cursor: "pointer" }}>
          <option value="" disabled>Selecione...</option>
          {(options || ROLES).map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      ) : (
        <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={base}
          onFocus={e => e.target.style.border = "1px solid #6366f1"}
          onBlur={e => e.target.style.border = "1px solid rgba(255,255,255,0.12)"}
        />
      )}
    </div>
  );
}

function Toggle({ label, sub, value, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "12px 16px" }}>
      <div>
        <div style={{ fontFamily: "sans-serif", fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{label}</div>
        {sub && <div style={{ fontFamily: "sans-serif", fontSize: 11, color: "#64748b" }}>{sub}</div>}
      </div>
      <div onClick={() => onChange(!value)} style={{ width: 44, height: 24, borderRadius: 12, cursor: "pointer", transition: "background 0.2s", position: "relative", background: value ? "#6366f1" : "rgba(255,255,255,0.12)" }}>
        <div style={{ position: "absolute", top: 3, left: value ? 22 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
      </div>
    </div>
  );
}

function StatusBtns({ current, onSelect, compact }) {
  return (
    <div style={{ display: "flex", gap: compact ? 4 : 5, flexWrap: "wrap" }}>
      {Object.entries(STATUS_CONFIG).map(([k, v]) => (
        <button key={k} onClick={() => onSelect(k)} style={{
          padding: compact ? "4px 9px" : "6px 12px", borderRadius: 8, border: "none", cursor: "pointer",
          fontFamily: "sans-serif", fontSize: compact ? 11 : 12, fontWeight: 600, transition: "all 0.15s",
          background: current === k ? v.color : "rgba(255,255,255,0.07)",
          color: current === k ? "#fff" : "#94a3b8",
          boxShadow: current === k ? `0 0 10px ${v.color}50` : "none",
          transform: current === k ? "scale(1.05)" : "scale(1)",
        }}>{STATUS_ICON_DISPLAY[k]} {v.label}</button>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────
   APP PRINCIPAL
───────────────────────────────────────────── */
/* ─────────────────────────────────────────────
   FORMULÁRIO PÚBLICO DE JUSTIFICATIVA
───────────────────────────────────────────── */
const PUB_MAX_SUBMISSIONS = 3;
const PUB_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function getPubSubmissions() {
  try {
    const raw = localStorage.getItem("freqschool_pub_submissions");
    const list = raw ? JSON.parse(raw) : [];
    // Keep only submissions within the last hour
    const cutoff = Date.now() - PUB_WINDOW_MS;
    return list.filter(ts => ts > cutoff);
  } catch { return []; }
}

function recordPubSubmission() {
  try {
    const list = getPubSubmissions();
    list.push(Date.now());
    localStorage.setItem("freqschool_pub_submissions", JSON.stringify(list));
  } catch {}
}

function PublicJustForm({ employees, justificativas, addJustificativa }) {
  const [pubForm, setPubForm] = useState({ empId: "", datas: "", motivo: "", documento: "" });
  const [pubError, setPubError] = useState("");
  const [pubSent, setPubSent] = useState(false);
  const pubSubmissionsLeft = PUB_MAX_SUBMISSIONS - getPubSubmissions().length;

  const activeEmployees = employees.filter(e => e.active !== false);

  function handlePublicSubmit() {
    // Rate limit check
    const submissions = getPubSubmissions();
    if (submissions.length >= PUB_MAX_SUBMISSIONS) {
      const oldestTs = Math.min(...submissions);
      const minutesLeft = Math.ceil((oldestTs + PUB_WINDOW_MS - Date.now()) / 60000);
      setPubError(`Limite de ${PUB_MAX_SUBMISSIONS} envios por hora atingido. Tente novamente em ${minutesLeft} minuto(s).`);
      return;
    }
    if (!pubForm.empId) { setPubError("Selecione seu nome na lista."); return; }
    if (!pubForm.datas.trim()) { setPubError("Informe a(s) data(s) de ausência."); return; }
    if (!pubForm.motivo.trim()) { setPubError("Informe o motivo."); return; }
    setPubError("");
    const emp = employees.find(e => e.id === Number(pubForm.empId));
    const nova = {
      empId: Number(pubForm.empId),
      nomeManual: emp ? emp.name : "",
      cargo: emp ? emp.role : "",
      datas: pubForm.datas.trim(),
      motivo: pubForm.motivo.trim(),
      documento: pubForm.documento.trim(),
      status: "pendente",
      criadoEm: new Date().toISOString(),
    };
    addJustificativa(nova);
    recordPubSubmission();
    setPubSent(true);
    setPubForm({ empId: "", datas: "", motivo: "", documento: "" });
  }

  const inputStyle = { width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "12px 14px", color: "#f1f5f9", fontSize: 14, outline: "none" };
  const labelStyle = { fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 };

  if (pubSent) return (
    <div style={{ textAlign: "center", padding: "20px 0" }}>
      <div style={{ fontSize: 50, marginBottom: 16 }}>✅</div>
      <div style={{ fontSize: 18, fontWeight: "bold", marginBottom: 8 }}>Justificativa enviada!</div>
      <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 20 }}>Sua justificativa foi recebida e será analisada pelo gestor.</div>
      <button onClick={() => setPubSent(false)} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Enviar outra justificativa</button>
    </div>
  );

  const selectedEmp = employees.find(e => e.id === Number(pubForm.empId));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Seleção do funcionário por dropdown */}
      <div>
        <label style={labelStyle}>Seu Nome <span style={{ color: "#ef4444" }}>*</span></label>
        <select
          value={pubForm.empId}
          onChange={e => setPubForm(f => ({ ...f, empId: e.target.value }))}
          style={{ ...inputStyle, cursor: "pointer", appearance: "none" }}
        >
          <option value="">— Selecione seu nome —</option>
          {activeEmployees.map(e => (
            <option key={e.id} value={e.id}>{e.name} — {e.role}</option>
          ))}
        </select>
      </div>

      {/* Mostra o cargo automaticamente após selecionar */}
      {selectedEmp && (
        <div style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#a5b4fc", display: "flex", gap: 8, alignItems: "center" }}>
          👤 <strong>{selectedEmp.name}</strong> — {selectedEmp.role}
        </div>
      )}

      <div>
        <label style={labelStyle}>Data(s) da Ausência <span style={{ color: "#ef4444" }}>*</span></label>
        <input
          type="date"
          value={pubForm.datas}
          onChange={e => setPubForm(f => ({ ...f, datas: e.target.value }))}
          max={new Date().toISOString().split("T")[0]}
          style={{ ...inputStyle, colorScheme: "dark", cursor: "pointer" }}
        />
        <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>Para múltiplas datas, envie uma justificativa por data</div>
      </div>

      <div>
        <label style={labelStyle}>Motivo da Ausência <span style={{ color: "#ef4444" }}>*</span></label>
        <textarea value={pubForm.motivo} onChange={e => setPubForm(f => ({ ...f, motivo: e.target.value }))} placeholder="Descreva o motivo da ausência com detalhes..." rows={4} style={{ ...inputStyle, resize: "vertical", fontFamily: "sans-serif" }} />
      </div>
      <div>
        <label style={labelStyle}>Anexar Documento <span style={{ color: "#64748b", fontWeight: 400, textTransform: "none" }}>(opcional)</span></label>
        <input type="url" value={pubForm.documento} onChange={e => setPubForm(f => ({ ...f, documento: e.target.value }))} placeholder="Cole o link do documento (Google Drive, etc.)" style={inputStyle} />
        <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>Compartilhe o arquivo no Google Drive e cole o link aqui</div>
      </div>
      {pubError && <div style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#f87171" }}>⚠️ {pubError}</div>}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4, gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "sans-serif", fontSize: 11, color: pubSubmissionsLeft <= 1 ? "#f59e0b" : "#475569" }}>
          {pubSubmissionsLeft > 0
            ? `${pubSubmissionsLeft} envio(s) restante(s) nesta hora`
            : "⚠️ Limite de envios atingido"}
        </span>
        <button onClick={handlePublicSubmit} disabled={pubSubmissionsLeft <= 0} style={{ flex: 1, minWidth: 180, padding: "14px", borderRadius: 12, border: "none", cursor: pubSubmissionsLeft <= 0 ? "not-allowed" : "pointer", background: pubSubmissionsLeft <= 0 ? "rgba(100,116,139,0.3)" : "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", fontSize: 15, fontWeight: 700, boxShadow: pubSubmissionsLeft > 0 ? "0 4px 18px rgba(99,102,241,0.4)" : "none", opacity: pubSubmissionsLeft <= 0 ? 0.6 : 1 }}>
          📤 Enviar Justificativa
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(() => {
    try { return sessionStorage.getItem("freqschool_authed") === "1"; } catch { return false; }
  });
  const [sessionToken, setSessionTokenState] = useState(() => {
    try { return sessionStorage.getItem("freqschool_token") || null; } catch { return null; }
  });

  const setSessionToken = (token) => {
    setSessionTokenState(token);
    try {
      if (token) sessionStorage.setItem("freqschool_token", token);
      else sessionStorage.removeItem("freqschool_token");
    } catch {}
  };
  const [currentUser, setCurrentUserState] = useState(() => {
    try { const s = sessionStorage.getItem("freqschool_user"); return s ? JSON.parse(s) : null; } catch { return null; }
  });

  // Wrap setCurrentUser to also persist to sessionStorage
  const setCurrentUser = (user) => {
    setCurrentUserState(user);
    try {
      if (user) sessionStorage.setItem("freqschool_user", JSON.stringify(user));
      else sessionStorage.removeItem("freqschool_user");
    } catch {}
  };

  // Wrap setAuthed to also persist
  const setAuthedPersisted = (val) => {
    setAuthed(val);
    try {
      if (val) sessionStorage.setItem("freqschool_authed", "1");
      else sessionStorage.removeItem("freqschool_authed");
    } catch {}
  };

  // Fix tela cheia no computador
  useEffect(() => {
    const style = document.createElement("style");
    style.innerHTML = `*, *::before, *::after { box-sizing: border-box; } html, body, #root { margin: 0; padding: 0; width: 100%; min-height: 100vh; }`;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);
  const [showLoginForm, setShowLoginForm] = useState(false);
  const [loginUser, setLoginUser]       = useState("");
  const [loginPass, setLoginPass]       = useState("");
  const [loginError, setLoginError]     = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginAttempts, setLoginAttempts]       = useState(0);
  const [loginBlockedUntil, setLoginBlockedUntil] = useState(null); // Date object
  const [credentials, setCredentials]   = useState({ user: "admin", pass: "escola123" });
  const [systemUsers, setSystemUsers]   = useState([]);
  const [showChangeCreds, setShowChangeCreds] = useState(false);
  const [userForm, setUserForm]         = useState({ name: "", user: "", pass: "", pass2: "", role: "Diretor", permissions: { registro: true, relatorio: false, justificativas: false, cadastro: false, escola: false } });
  const [editingUser, setEditingUser]   = useState(null);
  const [userFormError, setUserFormError] = useState("");
  const [showUserModal, setShowUserModal] = useState(false);
  const [newUser, setNewUser]       = useState("");
  const [newPass, setNewPass]       = useState("");
  const [newPass2, setNewPass2]     = useState("");
  const [tab, setTab]               = useState("registro");
  const [school, setSchool]         = useState(DEFAULT_SCHOOL);
  const [employees, setEmployees]   = useState(DEFAULT_EMPLOYEES);
  const [records, setRecords]       = useState({}); // { "YYYY-MM": { key: status, ... } }
  const [loadedMonths, setLoadedMonths] = useState(new Set()); // which months have Firebase listeners
  const [selectedDate, setSelectedDate] = useState(getTodayStr());
  const [reportType, setReportType]     = useState("semanal");
  const [reportView, setReportView]       = useState("cards");   // "cards" | "tabela"
  const [reportSearch, setReportSearch]   = useState("");
  const [reportFilter, setReportFilter]   = useState("todos");   // "todos"|"ausentes"|"abaixo75"|"semregistro"
  const [saved, setSaved]           = useState(false);
  const [pdfLoading, setPdfLoading]   = useState(false);

  // Justificativas
  const [justificativas, setJustificativas] = useState([]);
  const [showJustModal, setShowJustModal]   = useState(false);
  const [justForm, setJustForm]             = useState({ empId: "", datas: "", motivo: "", documento: "" });
  const [justError, setJustError]           = useState("");
  const [justFilter, setJustFilter]         = useState("todas");
  const [showReprovarModal, setShowReprovarModal] = useState(false);
  const [reprovarTarget, setReprovarTarget]       = useState(null);
  const [reprovarMotivo, setReprovarMotivo]       = useState("");
  const [deleteJustConfirm, setDeleteJustConfirm] = useState(null); // just.id

  // Cadastro
  const [showForm, setShowForm]         = useState(false);
  const [editingEmp, setEditingEmp]     = useState(null);
  const [form, setForm]                 = useState({ name: "", role: "", phone: "", email: "", active: true });
  const [formError, setFormError]       = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [searchCad, setSearchCad]       = useState("");
  const [searchRegistro, setSearchRegistro] = useState("");

  // Escola
  const [showSchoolModal, setShowSchoolModal] = useState(false);
  const [schoolForm, setSchoolForm]           = useState(DEFAULT_SCHOOL);
  const logoInputRef                          = useRef();

  // WhatsApp modal
  const [waModal, setWaModal]   = useState(null); // emp object
  const [waPhone, setWaPhone]   = useState("");   // número editável no modal
  const [waSent, setWaSent]     = useState(false);

  // Toast
  const [toast, setToast] = useState({ msg: "", type: "ok" });
  const [dataLoaded, setDataLoaded] = useState(false); // true after Firebase sends first snapshot
  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg: "", type: "ok" }), 3000);
  };

  /* ── Firebase Realtime Sync ── */
  useEffect(() => {
    // Escola
    const unsubSchool = onSnapshot(doc(db, "config", "school"), (snap) => {
      if (snap.exists()) setSchool(snap.data());
    });
    // Funcionários
    const unsubEmps = onSnapshot(doc(db, "config", "employees"), (snap) => {
      if (snap.exists()) setEmployees(snap.data().list || []);
    });
    // Registros — listener setup handled by subscribeToMonth() below
    // Credenciais — mark data as loaded once this arrives (needed for correct permission checks)
    const unsubCreds = onSnapshot(doc(db, "config", "credentials"), (snap) => {
      if (snap.exists()) setCredentials(snap.data());
      setDataLoaded(true);
    });
    // Justificativas — subcoleção individual para crescimento ilimitado
    const justQuery = query(collection(db, "justificativas"), orderBy("criadoEm", "desc"));
    const unsubJust = onSnapshot(justQuery, (snap) => {
      setJustificativas(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    // System Users
    const unsubUsers = onSnapshot(doc(db, "config", "systemUsers"), (snap) => {
      if (snap.exists()) setSystemUsers(snap.data().list || []);
    });
    return () => { unsubSchool(); unsubEmps(); unsubCreds(); unsubJust(); unsubUsers(); };
  }, []);

  const saveSchool    = async (s) => { setSchool(s);    try { await setDoc(doc(db, "config", "school"),    s);          } catch(e) { console.error("erro escola:", e); } };
  const saveEmployees = async (l) => { setEmployees(l); try { await setDoc(doc(db, "config", "employees"), { list: l }); } catch(e) { console.error("erro employees:", e); } };
  // Records now stored per-month — see setRecordAtomic2 / setRecordsAtomic2 below
  const saveCreds     = async (c) => { setCredentials(c); try { await setDoc(doc(db, "config", "credentials"), c); } catch(e) { console.error("erro creds:", e); } };

  // Add a new justificativa document
  const addJustificativa = async (nova) => {
    try {
      const ref = await addDoc(collection(db, "justificativas"), nova);
      // onSnapshot will update state automatically
      return ref.id;
    } catch(e) { console.error("erro addJust:", e); }
  };

  // Update a single justificativa field(s)
  const updateJustificativa = async (id, patch) => {
    setJustificativas(prev => prev.map(j => j.id === id ? { ...j, ...patch } : j));
    try { await updateDoc(doc(db, "justificativas", id), patch); }
    catch(e) { console.error("erro updateJust:", e); }
  };

  // Delete a single justificativa
  const removeJustificativaDoc = async (id) => {
    setJustificativas(prev => prev.filter(j => j.id !== id));
    try { await deleteDoc(doc(db, "justificativas", id)); }
    catch(e) { console.error("erro deleteJust:", e); }
  };

  const saveSystemUsers = async (list) => {
    setSystemUsers(list);
    try { await setDoc(doc(db, "config", "systemUsers"), { list }); } catch(e) { console.error("erro users:", e); }
  };

  /* ── Records por mês ── */
  const monthUnsubscribers = useRef({});

  const subscribeToMonth = (month) => {
    if (monthUnsubscribers.current[month]) return; // already subscribed
    const unsub = onSnapshot(doc(db, "records", month), (snap) => {
      setRecords(prev => ({ ...prev, [month]: snap.exists() ? (snap.data().data || {}) : {} }));
    });
    monthUnsubscribers.current[month] = unsub;
    setLoadedMonths(prev => new Set([...prev, month]));
  };

  // Subscribe to current month on mount + cleanup on unmount
  useEffect(() => {
    const m = currentMonth();
    subscribeToMonth(m);
    return () => {
      Object.values(monthUnsubscribers.current).forEach(fn => fn());
      monthUnsubscribers.current = {};
    };
  }, []); // eslint-disable-line

  // Subscribe to selected date's month whenever it changes
  useEffect(() => { subscribeToMonth(selectedDate.substring(0, 7)); }, [selectedDate]); // eslint-disable-line

  // Get the flat record value for a given key (key includes date)
  const getRecordValue = (key) => {
    const month = key.substring(0, 7);
    return records[month]?.[key] || null;
  };

  // Save a single record atomically to the correct month document
  const setRecordAtomic2 = async (key, value) => {
    const month = key.substring(0, 7);
    subscribeToMonth(month); // ensure we're listening
    setRecords(prev => ({ ...prev, [month]: { ...(prev[month] || {}), [key]: value } }));
    try {
      await updateDoc(doc(db, "records", month), { [`data.${key}`]: value });
    } catch {
      try { await setDoc(doc(db, "records", month), { data: { ...(records[month] || {}), [key]: value } }); }
      catch(e2) { console.error("erro setRecordAtomic2:", e2); }
    }
  };

  // Save multiple records atomically (used when approving justificativas)
  const setRecordsAtomic2 = async (keysObj) => {
    // Group keys by month
    const byMonth = {};
    Object.entries(keysObj).forEach(([k, v]) => {
      const m = k.substring(0, 7);
      if (!byMonth[m]) byMonth[m] = {};
      byMonth[m][k] = v;
    });
    // Update state and Firestore for each month
    setRecords(prev => {
      const next = { ...prev };
      Object.entries(byMonth).forEach(([m, keys]) => { next[m] = { ...(prev[m] || {}), ...keys }; });
      return next;
    });
    for (const [month, keys] of Object.entries(byMonth)) {
      subscribeToMonth(month);
      const patch = Object.fromEntries(Object.entries(keys).map(([k, v]) => [`data.${k}`, v]));
      try {
        await updateDoc(doc(db, "records", month), patch);
      } catch {
        try { await setDoc(doc(db, "records", month), { data: { ...(records[month] || {}), ...keys } }); }
        catch(e2) { console.error("erro setRecordsAtomic2:", e2); }
      }
    }
  };

  // Delete records for a specific employee (when removing employee)
  const deleteEmployeeRecords = async (empId) => {
    const updates = {};
    for (const [month, monthData] of Object.entries(records)) {
      const filtered = Object.fromEntries(
        Object.entries(monthData).filter(([k]) => !k.includes(`_${empId}_`) && !k.endsWith(`_${empId}`))
      );
      if (Object.keys(filtered).length !== Object.keys(monthData).length) {
        updates[month] = filtered;
        try { await setDoc(doc(db, "records", month), { data: filtered }); } catch {}
      }
    }
    if (Object.keys(updates).length > 0) {
      setRecords(prev => ({ ...prev, ...updates }));
    }
  };

  /* ── Helpers de permissão ── */
  const isGestor = () => !currentUser || currentUser.role === "Gestor";
  const can = (perm) => isGestor() || !!(currentUser?.permissions?.[perm]);

  /* ── Justificativas ── */
  function handleAddJustificativa() {
    if (!justForm.empId) { setJustError("Selecione o funcionário."); return; }
    if (!justForm.datas.trim()) { setJustError("Informe a(s) data(s)."); return; }
    if (!justForm.motivo.trim()) { setJustError("Informe o motivo."); return; }
    setJustError("");
    const nova = {
      empId: Number(justForm.empId),
      datas: justForm.datas.trim(),
      motivo: justForm.motivo.trim(),
      documento: justForm.documento || "",
      status: "pendente",
      criadoEm: new Date().toISOString(),
    };
    addJustificativa(nova);
    setJustForm({ empId: "", datas: "", motivo: "", documento: "" });
    setShowJustModal(false);
    showToast("Justificativa registrada!");
  }

  function aprovarJustificativa(just) {
    updateJustificativa(just.id, { status: "aprovada", aprovadoPor: currentUser?.name || "Gestor", aprovadoEm: new Date().toISOString() });
    // Dates are now always in YYYY-MM-DD format (date picker enforces this)
    const datas = just.datas.split(",").map(d => d.trim()).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
    const emp = employees.find(e => e.id === just.empId);
    const keysToUpdate = {};
    datas.forEach(dateKey => {
      if (emp && IS_APOIO(emp.role)) {
        TURNOS.forEach(t => { keysToUpdate[recordKey(dateKey, just.empId, t)] = "justificado"; });
      } else {
        keysToUpdate[recordKey(dateKey, just.empId)] = "justificado";
      }
    });
    if (Object.keys(keysToUpdate).length > 0) setRecordsAtomic2(keysToUpdate);
    showToast("Justificativa aprovada!");
    // Notificar via WhatsApp se tiver telefone
    if (emp && emp.phone) {
      const msg = [
        `✅ *JUSTIFICATIVA APROVADA*`,
        `🏫 *${school.name || "FreqSchool"}*`,
        ``,
        `👤 *${emp.name}*`,
        `📅 Data(s): ${just.datas}`,
        `📝 Motivo: ${just.motivo}`,
        ``,
        `Sua justificativa foi *aprovada* pela direção.`,
        school.director ? `👩‍💼 Direção: ${school.director}` : "",
      ].filter(Boolean).join("\n");
      sendWhatsApp(emp.phone, msg);
    }
  }

  function abrirReprovarModal(just) {
    setReprovarTarget(just);
    setReprovarMotivo("");
    setShowReprovarModal(true);
  }

  function confirmarReprovacao() {
    if (!reprovarTarget) return;
    updateJustificativa(reprovarTarget.id, { status: "reprovada", motivoReprovacao: reprovarMotivo.trim(), reprovadoPor: currentUser?.name || "Gestor", reprovadoEm: new Date().toISOString() });
    showToast("Justificativa reprovada.");
    // Notificar via WhatsApp se tiver telefone
    const emp = employees.find(e => e.id === reprovarTarget.empId);
    if (emp && emp.phone) {
      const msg = [
        `❌ *JUSTIFICATIVA REPROVADA*`,
        `🏫 *${school.name || "FreqSchool"}*`,
        ``,
        `👤 *${emp.name}*`,
        `📅 Data(s): ${reprovarTarget.datas}`,
        `📝 Motivo informado: ${reprovarTarget.motivo}`,
        ``,
        `Sua justificativa foi *reprovada* pela direção.`,
        reprovarMotivo.trim() ? `📋 Motivo da reprovação: ${reprovarMotivo.trim()}` : "",
        school.director ? `👩‍💼 Direção: ${school.director}` : "",
      ].filter(Boolean).join("\n");
      sendWhatsApp(emp.phone, msg);
    }
    setShowReprovarModal(false);
    setReprovarTarget(null);
    setReprovarMotivo("");
  }

  function reprovarJustificativa(just) {
    abrirReprovarModal(just);
  }

  function removerJustificativa(id) {
    removeJustificativaDoc(id);
    showToast("Justificativa removida.");
  }

  /* ── Login ── */
  const MAX_LOGIN_ATTEMPTS = 5;
  const BLOCK_DURATION_MS  = 5 * 60 * 1000; // 5 minutes

  async function handleLogin() {
    // Check if currently blocked
    if (loginBlockedUntil && new Date() < loginBlockedUntil) {
      const secsLeft = Math.ceil((loginBlockedUntil - new Date()) / 1000);
      const mins = Math.floor(secsLeft / 60);
      const secs = secsLeft % 60;
      setLoginError(`Muitas tentativas. Aguarde ${mins}:${String(secs).padStart(2,"0")} para tentar novamente.`);
      return;
    }

    setLoginLoading(true);
    setLoginError("");
    const inputHash = await hashPassword(loginPass);

    // Check gestor (master)
    const gestorPassOk = isHashed(credentials.pass)
      ? credentials.pass === inputHash          // already hashed
      : credentials.pass === loginPass;         // plain-text (migrates below)

    if (loginUser.trim() === credentials.user && gestorPassOk) {
      // Migrate plain-text gestor password to hash on first login
      if (!isHashed(credentials.pass)) {
        saveCreds({ user: credentials.user, pass: inputHash });
      }
      const gestorToken = await generateSessionToken();
      setSessionToken(gestorToken);
      try { await setDoc(doc(db, "sessions", gestorToken), { role: "Gestor", user: credentials.user, createdAt: new Date().toISOString() }); } catch {}
      setLoginAttempts(0);
      setLoginBlockedUntil(null);
      setCurrentUser({ user: credentials.user, role: "Gestor", name: "Gestor", permissions: { registro: true, relatorio: true, justificativas: true, cadastro: true, escola: true } });
      setAuthedPersisted(true);
      setShowLoginForm(false);
      setLoginError("");
      setLoginLoading(false);
      return;
    }

    // Check system users
    const found = systemUsers.find(u => {
      if (u.user.toLowerCase() !== loginUser.trim().toLowerCase()) return false;
      return isHashed(u.pass) ? u.pass === inputHash : u.pass === loginPass;
    });

    if (found) {
      // Migrate plain-text sub-user password to hash on first login
      if (!isHashed(found.pass)) {
        const migrated = systemUsers.map(u => u.id === found.id ? { ...u, pass: inputHash } : u);
        saveSystemUsers(migrated);
      }
      const userToken = await generateSessionToken();
      setSessionToken(userToken);
      try { await setDoc(doc(db, "sessions", userToken), { role: found.role, user: found.user, createdAt: new Date().toISOString() }); } catch {}
      setLoginAttempts(0);
      setLoginBlockedUntil(null);
      setCurrentUser(found);
      setAuthedPersisted(true);
      setShowLoginForm(false);
      setLoginError("");
    } else {
      const newAttempts = loginAttempts + 1;
      setLoginAttempts(newAttempts);
      if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
        const blockedUntil = new Date(Date.now() + BLOCK_DURATION_MS);
        setLoginBlockedUntil(blockedUntil);
        setLoginError(`Conta bloqueada por 5 minutos após ${MAX_LOGIN_ATTEMPTS} tentativas incorretas.`);
      } else {
        setLoginError(`Usuário ou senha incorretos. ${MAX_LOGIN_ATTEMPTS - newAttempts} tentativa(s) restante(s).`);
      }
    }
    setLoginLoading(false);
  }

  async function handleChangeCreds() {
    if (!newUser.trim()) { setLoginError("Informe o novo usuário."); return; }
    if (newPass.length < 6) { setLoginError("A senha deve ter pelo menos 6 caracteres."); return; }
    if (newPass !== newPass2) { setLoginError("As senhas não coincidem."); return; }
    const hashed = await hashPassword(newPass);
    saveCreds({ user: newUser.trim(), pass: hashed });
    setShowChangeCreds(false);
    setNewUser(""); setNewPass(""); setNewPass2("");
    showToast("Credenciais atualizadas!");
  }

  /* ── Escola ── */
  function openSchoolModal() { setSchoolForm({ ...school }); setShowSchoolModal(true); }
  function handleSchoolSave() { saveSchool(schoolForm); setShowSchoolModal(false); showToast("Dados da escola salvos!"); }
  function handleLogoChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setSchoolForm(f => ({ ...f, logo: ev.target.result }));
    reader.readAsDataURL(file);
  }

  /* ── Cadastro ── */
  const openNew  = () => { setEditingEmp(null); setForm({ name: "", role: "", phone: "", email: "", active: true }); setFormError(""); setShowForm(true); };
  const openEdit = (emp) => { setEditingEmp(emp); setForm({ name: emp.name, role: emp.role, phone: emp.phone || "", email: emp.email || "", active: emp.active }); setFormError(""); setShowForm(true); };

  function handleFormSubmit() {
    if (!form.name.trim()) { setFormError("O nome é obrigatório."); return; }
    if (!form.role)         { setFormError("Selecione o cargo."); return; }
    setFormError("");
    if (editingEmp) {
      saveEmployees(employees.map(e => e.id === editingEmp.id ? { ...e, ...form } : e));
      showToast("Funcionário atualizado!");
    } else {
      saveEmployees([...employees, { id: genId(), ...form }]);
      showToast("Funcionário cadastrado!");
    }
    setShowForm(false);
  }

  function handleDelete(id) {
    saveEmployees(employees.filter(e => e.id !== id));
    deleteEmployeeRecords(id);
    setDeleteConfirm(null);
    showToast("Funcionário removido.");
  }

  const toggleActive = (id) => saveEmployees(employees.map(e => e.id === id ? { ...e, active: !e.active } : e));

  /* ── Registro ── */
  const setStatus   = (empId, status, turno = null) => setRecordAtomic2(recordKey(selectedDate, empId, turno), status);
  const getStatus   = (empId, date = selectedDate, turno = null) => getRecordValue(recordKey(date, empId, turno));
  const apoioFilled = (empId, date = selectedDate) => TURNOS.every(t => !!getStatus(empId, date, t));

  /* ── WhatsApp ── */
  function openWaModal(emp) {
    setWaModal(emp);
    setWaPhone(emp.phone || "");
    setWaSent(false);
  }

  function handleSendWhatsApp() {
    if (!waPhone || cleanPhone(waPhone).length < 10) {
      showToast("Informe um número de WhatsApp válido.", "err");
      return;
    }
    const monthRecords = records[selectedDate.substring(0, 7)] || {};
    const message = buildWhatsAppMessage(waModal, monthRecords, selectedDate, school);
    sendWhatsApp(waPhone, message);
    setWaSent(true);
    // Salva o telefone no funcionário se ele não tinha
    if (!waModal.phone && waPhone) {
      saveEmployees(employees.map(e => e.id === waModal.id ? { ...e, phone: waPhone } : e));
    }
  }

  /* ── Derived ── */
  const activeEmployees = employees.filter(e => e.active);
  const activeApoio     = activeEmployees.filter(e => IS_APOIO(e.role));
  const activeOthers    = activeEmployees.filter(e => !IS_APOIO(e.role));
  const totalSlots      = activeOthers.length + activeApoio.length * 2;
  const filledSlots     = activeOthers.filter(e => getStatus(e.id)).length
                        + activeApoio.reduce((a, e) => a + TURNOS.filter(t => getStatus(e.id, selectedDate, t)).length, 0);

  const reportDates = reportType === "semanal" ? getWeekDates() : getMonthDates();
  // Subscribe to all months needed for current report view
  useEffect(() => {
    const months = [...new Set(reportDates.map(d => d.substring(0, 7)))];
    months.forEach(subscribeToMonth);
  }, [reportType, reportDates.join(",")]); // eslint-disable-line
  const today       = new Date();
  const monthName   = today.toLocaleString("pt-BR", { month: "long", year: "numeric" });
  const filteredCad = employees.filter(e =>
    e.name.toLowerCase().includes(searchCad.toLowerCase()) ||
    e.role.toLowerCase().includes(searchCad.toLowerCase()));

  function getEmpSummary(emp) {
    const apoio = IS_APOIO(emp.role), res = {};
    const compute = (keys) => {
      let p = 0, a = 0, j = 0, f = 0;
      keys.forEach(k => {
        const s = getRecordValue(k);
        if (s === "presente") p++; else if (s === "ausente") a++; else if (s === "justificado") j++; else if (s === "folga") f++;
      });
      const total = p + a + j + f;
      return { presente: p, ausente: a, justificado: j, folga: f, total, pct: total > 0 ? Math.round((p / total) * 100) : null };
    };
    if (apoio) {
      TURNOS.forEach(turno => res[turno] = compute(reportDates.map(d => recordKey(d, emp.id, turno))));
    } else {
      res.geral = compute(reportDates.map(d => recordKey(d, emp.id)));
    }
    return res;
  }

  /* ── Styles ── */
  const card = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 };
  const TABS = [
    can("registro")       && { id: "registro",       label: "📝 Registro" },
    can("relatorio")      && { id: "relatorio",      label: "📊 Relatório" },
    can("cadastro")       && { id: "cadastro",       label: "👥 Cadastro" },
    can("justificativas") && { id: "justificativas", label: "📋 Justificativas", badge: justificativas.filter(j => j.status === "pendente").length },
    can("escola")         && { id: "escola",         label: "🏫 Escola" },
    isGestor()            && { id: "usuarios",       label: "👥 Usuários" },
  ].filter(Boolean);

  /* ── WhatsApp send btn ── */
  const WaBtn = ({ emp }) => (
    <button
      onClick={() => openWaModal(emp)}
      title="Enviar frequência por WhatsApp"
      style={{
        padding: "6px 11px", borderRadius: 8, border: "none", cursor: "pointer",
        background: "rgba(37,211,102,0.15)", color: "#25d366", fontSize: 16,
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "background 0.2s",
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="#25d366">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
      </svg>
    </button>
  );

  /* ══════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════ */
  /* ── Loading enquanto Firebase carrega ── */
  if (authed && !dataLoaded) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#0f172a,#1e293b)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, fontFamily: "sans-serif", color: "#f1f5f9" }}>
        <div style={{ width: 48, height: 48, border: "4px solid rgba(99,102,241,0.2)", borderTop: "4px solid #6366f1", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ fontSize: 14, color: "#94a3b8" }}>Carregando...</div>
      </div>
    );
  }

  /* ── Tela de Login ── */
  if (!authed) {
    // Página pública: login + formulário de justificativa
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#0f172a 100%)", fontFamily: "sans-serif", color: "#f1f5f9" }}>

        {/* Toast público */}
        {toast.msg && (
          <div style={{ position: "fixed", top: 20, right: 20, zIndex: 9999, background: toast.type === "err" ? "#ef4444" : "#22c55e", color: "#fff", borderRadius: 12, padding: "12px 22px", fontSize: 14, fontWeight: 600, boxShadow: "0 8px 30px rgba(0,0,0,0.3)" }}>
            {toast.type === "err" ? "✗" : "✓"} {toast.msg}
          </div>
        )}

        {/* Header público */}
        <div style={{ background: "rgba(255,255,255,0.04)", borderBottom: "1px solid rgba(255,255,255,0.08)", padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {school.logo
              ? <img src={school.logo} alt="logo" style={{ width: 42, height: 42, borderRadius: 10, objectFit: "cover" }} />
              : <div style={{ width: 42, height: 42, borderRadius: 12, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>📋</div>
            }
            <div>
              <div style={{ fontSize: 18, fontWeight: "bold", letterSpacing: 1, fontFamily: "Georgia,serif" }}>{school.name || "FreqSchool"}</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>{school.city || "Sistema de Frequência Escolar"}</div>
            </div>
          </div>
          <button onClick={() => { setShowLoginForm(true); setLoginError(""); }} style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid rgba(99,102,241,0.4)", background: "rgba(99,102,241,0.1)", color: "#a5b4fc", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
            🔐 Acesso do Gestor
          </button>
        </div>

        <div style={{ padding: "32px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>

          {/* Se clicou em "Acesso do Gestor", mostra o form de login */}
          {showLoginForm && (
            <div style={{ width: "100%", maxWidth: 420, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 20, padding: "28px 26px", boxShadow: "0 25px 60px rgba(0,0,0,0.4)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <div style={{ fontSize: 17, fontWeight: "bold" }}>🔐 Login do Gestor</div>
                <button onClick={() => { setShowLoginForm(false); setLoginError(""); }} style={{ width: 30, height: 30, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.07)", color: "#94a3b8", cursor: "pointer", fontSize: 16 }}>×</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Usuário</label>
                  <input type="text" value={loginUser} onChange={e => setLoginUser(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} placeholder="Digite o usuário" style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "12px 14px", color: "#f1f5f9", fontSize: 14, outline: "none" }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Senha</label>
                  <input type="password" value={loginPass} onChange={e => setLoginPass(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} placeholder="Digite a senha" style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "12px 14px", color: "#f1f5f9", fontSize: 14, outline: "none" }} />
                </div>
                {loginError && <div style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#f87171", textAlign: "center" }}>⚠️ {loginError}</div>}
                {loginBlockedUntil && new Date() < loginBlockedUntil && (
                  <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#f87171", textAlign: "center", fontFamily: "sans-serif" }}>
                    🔒 Acesso temporariamente bloqueado. Tente novamente em alguns minutos.
                  </div>
                )}
                <button onClick={handleLogin} disabled={loginLoading || (loginBlockedUntil && new Date() < loginBlockedUntil)} style={{ padding: "13px", borderRadius: 12, border: "none", cursor: (loginLoading || (loginBlockedUntil && new Date() < loginBlockedUntil)) ? "not-allowed" : "pointer", background: (loginBlockedUntil && new Date() < loginBlockedUntil) ? "rgba(100,116,139,0.3)" : "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", fontSize: 15, fontWeight: 700, boxShadow: "0 4px 18px rgba(99,102,241,0.4)", opacity: (loginLoading || (loginBlockedUntil && new Date() < loginBlockedUntil)) ? 0.6 : 1 }}>
                  {loginLoading ? "⏳ Verificando..." : (loginBlockedUntil && new Date() < loginBlockedUntil) ? "🔒 Bloqueado" : "🔐 Entrar"}
                </button>
              </div>
            </div>
          )}

          {/* Formulário público de justificativa */}
          <div style={{ width: "100%", maxWidth: 560 }}>
            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
              <div style={{ fontSize: 22, fontWeight: "bold", fontFamily: "Georgia,serif", marginBottom: 6 }}>Formulário de Justificativa</div>
              <div style={{ fontSize: 13, color: "#64748b" }}>Preencha os campos abaixo para justificar sua ausência</div>
            </div>

            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 20, padding: "28px 26px", boxShadow: "0 15px 40px rgba(0,0,0,0.3)" }}>
              <PublicJustForm employees={employees} justificativas={justificativas} addJustificativa={addJustificativa} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#0f172a 100%)", fontFamily: "Georgia,serif", color: "#f1f5f9" }}>

      {/* Toast */}
      {toast.msg && (
        <div style={{ position: "fixed", top: 20, right: 20, zIndex: 9999, background: toast.type === "err" ? "#ef4444" : "#22c55e", color: "#fff", borderRadius: 12, padding: "12px 22px", fontFamily: "sans-serif", fontSize: 14, fontWeight: 600, boxShadow: "0 8px 30px rgba(0,0,0,0.3)", zIndex: 10000 }}>
          {toast.type === "err" ? "✗" : "✓"} {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ background: "rgba(255,255,255,0.04)", borderBottom: "1px solid rgba(255,255,255,0.08)", padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {school.logo
            ? <img src={school.logo} alt="logo" style={{ width: 42, height: 42, borderRadius: 10, objectFit: "cover" }} />
            : <div style={{ width: 42, height: 42, borderRadius: 12, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>📋</div>
          }
          <div>
            <div style={{ fontSize: 18, fontWeight: "bold", letterSpacing: 1 }}>{school.name || "FreqSchool"}</div>
            <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "sans-serif" }}>{school.city || "Sistema de Frequência Escolar"}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 8, padding: "6px 14px", fontSize: 12, color: "#a5b4fc", fontFamily: "sans-serif" }}>
            {today.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
          </div>
          <button onClick={openSchoolModal} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: "#94a3b8", fontFamily: "sans-serif", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
            ✏️ Editar Escola
          </button>
          {currentUser && (
            <div style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "5px 12px", fontFamily: "sans-serif", fontSize: 12, color: "#94a3b8", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: isGestor() ? "#a5b4fc" : "#22c55e", fontWeight: 700 }}>{isGestor() ? "👑" : "👤"}</span>
              <span>{currentUser.name || currentUser.user}</span>
              <span style={{ background: isGestor() ? "rgba(99,102,241,0.2)" : "rgba(34,197,94,0.15)", color: isGestor() ? "#a5b4fc" : "#22c55e", borderRadius: 5, padding: "1px 7px", fontSize: 10, fontWeight: 700 }}>{currentUser.role}</span>
            </div>
          )}
          {isGestor() && (
            <button onClick={() => { setShowChangeCreds(true); setNewUser(credentials.user); setNewPass(""); setNewPass2(""); setLoginError(""); }} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: "#94a3b8", fontFamily: "sans-serif", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
              🔑 Alterar Senha
            </button>
          )}
          <button onClick={() => { (() => { if (sessionToken) { deleteDoc(doc(db, "sessions", sessionToken)).catch(() => {}); setSessionToken(null); } setAuthedPersisted(false); setCurrentUser(null); setShowLoginForm(false); setLoginUser(""); setLoginPass(""); })() }} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.1)", color: "#f87171", fontFamily: "sans-serif", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
            🚪 Sair
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ padding: "20px 28px 0" }}>
        <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,0.05)", borderRadius: 12, padding: 4, width: "fit-content", flexWrap: "wrap" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "9px 20px", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "sans-serif", fontSize: 13, fontWeight: 600, transition: "all 0.2s", background: tab === t.id ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "transparent", color: tab === t.id ? "#fff" : "#94a3b8", boxShadow: tab === t.id ? "0 4px 15px rgba(99,102,241,0.4)" : "none", position: "relative", display: "flex", alignItems: "center", gap: 6 }}>
              {t.label}
              {t.badge > 0 && (
                <span style={{ background: "#ef4444", color: "#fff", borderRadius: 10, fontSize: 10, fontWeight: 900, padding: "1px 6px", lineHeight: "16px", minWidth: 16, textAlign: "center" }}>{t.badge}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "20px 28px" }}>

        {/* ══════════ REGISTRO ══════════ */}
        {tab === "registro" && (
          <div>

            {/* ── Cabeçalho do Registro ── */}
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 16, marginBottom: 20, alignItems: "stretch" }}>
              {/* Seletor de data */}
              <div style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.25)", borderRadius: 16, padding: "16px 20px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
                <label style={{ fontFamily: "sans-serif", fontSize: 10, color: "#a5b4fc", display: "block", textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 700 }}>📅 Data do Registro</label>
                <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} style={{ background: "transparent", border: "none", color: "#f1f5f9", fontSize: 18, fontFamily: "sans-serif", fontWeight: 700, outline: "none", cursor: "pointer" }} />
                <div style={{ fontFamily: "sans-serif", fontSize: 11, color: "#64748b" }}>
                  {DAYS_PT[new Date(selectedDate + "T12:00:00").getDay()]}, {formatDate(selectedDate)}
                </div>
              </div>

              {/* Painel de progresso */}
              <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "16px 20px", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontFamily: "sans-serif", fontSize: 12, color: "#94a3b8" }}>Progresso do dia</span>
                  <span style={{ fontFamily: "sans-serif", fontSize: 13, fontWeight: 700, color: filledSlots === totalSlots && totalSlots > 0 ? "#22c55e" : "#a5b4fc" }}>
                    {filledSlots}/{totalSlots} {filledSlots === totalSlots && totalSlots > 0 ? "✓ Completo!" : "registros"}
                  </span>
                </div>
                <div style={{ height: 10, background: "rgba(255,255,255,0.06)", borderRadius: 6, overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 6, background: filledSlots === totalSlots && totalSlots > 0 ? "linear-gradient(90deg,#22c55e,#16a34a)" : "linear-gradient(90deg,#6366f1,#8b5cf6)", width: `${totalSlots > 0 ? (filledSlots / totalSlots) * 100 : 0}%`, transition: "width 0.5s ease" }} />
                </div>
                {/* Mini legenda de status */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <div key={k} style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: "sans-serif", fontSize: 11 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: v.color }} />
                      <span style={{ color: "#64748b" }}>{v.label}</span>
                    </div>
                  ))}
                  <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, fontFamily: "sans-serif", fontSize: 11, color: "#475569" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="#25d366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    <span>WhatsApp</span>
                  </div>
                </div>
              </div>
            </div>

            {activeEmployees.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "#475569", fontFamily: "sans-serif" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>👥</div>
                <div>Nenhum funcionário ativo. Cadastre na aba <strong style={{ color: "#a5b4fc" }}>Cadastro</strong>.</div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 14 }}>

                {/* Busca rápida */}
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", fontSize: 16, pointerEvents: "none" }}>🔍</span>
                  <input
                    type="text"
                    placeholder="Buscar funcionário pelo nome..."
                    value={searchRegistro}
                    onChange={e => setSearchRegistro(e.target.value)}
                    autoComplete="off"
                    style={{ width: "100%", boxSizing: "border-box", background: "rgba(99,102,241,0.08)", border: searchRegistro ? "1px solid rgba(99,102,241,0.5)" : "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "12px 40px 12px 40px", color: "#f1f5f9", fontSize: 14, fontFamily: "sans-serif", outline: "none", transition: "border 0.2s" }}
                  />
                  {searchRegistro && (
                    <button onClick={() => setSearchRegistro("")} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,0.1)", border: "none", borderRadius: "50%", width: 24, height: 24, cursor: "pointer", color: "#94a3b8", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
                  )}
                </div>

                {/* Regulares */}
                {activeOthers.filter(e => e.name.toLowerCase().includes(searchRegistro.toLowerCase())).length > 0 && (
                  <div>
                    <div style={{ fontFamily: "sans-serif", fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Funcionários</div>
                    <div style={{ display: "grid", gap: 8 }}>
                      {activeOthers.filter(e => e.name.toLowerCase().includes(searchRegistro.toLowerCase())).map(emp => {
                        const status = getStatus(emp.id); const cfg = status ? STATUS_CONFIG[status] : null;
                        return (
                          <div key={emp.id} style={{ background: status ? `${cfg.color}0d` : "rgba(255,255,255,0.04)", border: `1px solid ${status ? cfg.color + "40" : "rgba(255,255,255,0.08)"}`, borderRadius: 14, overflow: "hidden", transition: "all 0.2s" }}>
                            {/* Topo do card */}
                            <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, borderBottom: status ? `1px solid ${cfg.color}20` : "1px solid rgba(255,255,255,0.05)" }}>
                              <div style={{ width: 40, height: 40, borderRadius: "50%", background: avatarColor(emp.id), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: "bold", flexShrink: 0, boxShadow: status ? `0 0 12px ${cfg.color}50` : "none", transition: "box-shadow 0.3s" }}>{getInitials(emp.name)}</div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{emp.name}</div>
                                <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "sans-serif" }}>{emp.role}</div>
                              </div>
                              {status && (
                                <div style={{ background: `${cfg.color}20`, border: `1px solid ${cfg.color}50`, borderRadius: 8, padding: "3px 10px", fontFamily: "sans-serif", fontSize: 11, fontWeight: 700, color: cfg.color, whiteSpace: "nowrap" }}>
                                  {cfg.icon} {cfg.label}
                                </div>
                              )}
                              <WaBtn emp={emp} />
                            </div>
                            {/* Botões de status */}
                            <div style={{ padding: "10px 16px", background: "rgba(0,0,0,0.1)" }}>
                              <StatusBtns current={status} onSelect={s => setStatus(emp.id, s)} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Profissionais de Apoio */}
                {activeApoio.filter(e => e.name.toLowerCase().includes(searchRegistro.toLowerCase())).length > 0 && (
                  <div>
                    <div style={{ fontFamily: "sans-serif", fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                      <span>Profissionais de Apoio</span>
                      <span style={{ background: "rgba(99,102,241,0.2)", borderRadius: 6, padding: "2px 8px", fontSize: 10, color: "#a5b4fc" }}>Frequência por turno</span>
                    </div>
                    <div style={{ display: "grid", gap: 10 }}>
                      {activeApoio.filter(e => e.name.toLowerCase().includes(searchRegistro.toLowerCase())).map(emp => {
                        const allFilled = apoioFilled(emp.id);
                        return (
                          <div key={emp.id} style={{ ...card, borderColor: allFilled ? "rgba(34,197,94,0.3)" : "rgba(255,255,255,0.08)", borderRadius: 16, overflow: "hidden", transition: "border-color 0.3s" }}>
                            <div style={{ padding: "12px 18px", background: allFilled ? "rgba(34,197,94,0.06)" : "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", gap: 12 }}>
                              <div style={{ width: 36, height: 36, borderRadius: "50%", background: avatarColor(emp.id), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: "bold", flexShrink: 0 }}>{getInitials(emp.name)}</div>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 14, fontWeight: 600 }}>{emp.name}</div>
                                <div style={{ fontFamily: "sans-serif", fontSize: 11, color: "#a5b4fc" }}>Profissional de Apoio</div>
                              </div>
                              <WaBtn emp={emp} />
                              {allFilled && <div style={{ fontFamily: "sans-serif", fontSize: 11, color: "#22c55e", fontWeight: 700 }}>✓ Completo</div>}
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
                              {TURNOS.map((turno, ti) => {
                                const status = getStatus(emp.id, selectedDate, turno); const cfg = status ? STATUS_CONFIG[status] : null;
                                return (
                                  <div key={turno} style={{ padding: "12px 16px", borderRight: ti === 0 ? "1px solid rgba(255,255,255,0.06)" : "none", background: status ? `${cfg.color}08` : "transparent", transition: "background 0.2s" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 9 }}>
                                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: TURNO_COLOR[turno] }} />
                                      <span style={{ fontFamily: "sans-serif", fontSize: 12, fontWeight: 700, color: TURNO_COLOR[turno] }}>{TURNO_LABEL[turno]}</span>
                                      {status && <span style={{ marginLeft: "auto", fontFamily: "sans-serif", fontSize: 11, color: cfg.color, fontWeight: 600 }}>{STATUS_ICON_DISPLAY[status]} {cfg.label}</span>}
                                    </div>
                                    <StatusBtns current={status} onSelect={s => setStatus(emp.id, s, turno)} compact />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Sem resultados */}
                {searchRegistro && activeEmployees.filter(e => e.name.toLowerCase().includes(searchRegistro.toLowerCase())).length === 0 && (
                  <div style={{ textAlign: "center", padding: "40px 20px", color: "#475569", fontFamily: "sans-serif" }}>
                    <div style={{ fontSize: 32, marginBottom: 10 }}>🔍</div>
                    <div>Nenhum funcionário encontrado para <strong style={{ color: "#a5b4fc" }}>"{searchRegistro}"</strong></div>
                  </div>
                )}

              </div>
            )}

            <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 2000); }} style={{ padding: "11px 28px", borderRadius: 12, border: "none", cursor: "pointer", background: saved ? "#22c55e" : "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", fontSize: 14, fontWeight: 700, fontFamily: "sans-serif", boxShadow: "0 4px 18px rgba(99,102,241,0.4)", transition: "all 0.3s" }}>
                {saved ? "✓ Salvo!" : "💾 Salvar Frequência"}
              </button>
            </div>
          </div>
        )}

        {/* ══════════ RELATÓRIO ══════════ */}
        {tab === "relatorio" && (() => {
          /* ─── computed ─── */
          const empsSm = activeEmployees.map(emp => ({ emp, sm: getEmpSummary(emp) }));
          const getAvgPct = (emp, sm) => IS_APOIO(emp.role)
            ? (sm.manha?.pct != null && sm.tarde?.pct != null ? Math.round((sm.manha.pct + sm.tarde.pct) / 2) : sm.manha?.pct ?? sm.tarde?.pct)
            : sm.geral?.pct;

          const totals = {};
          Object.keys(STATUS_CONFIG).forEach(k => {
            totals[k] = reportDates.reduce((acc, d) => {
              const o = activeOthers.filter(e => getRecordValue(recordKey(d, e.id)) === k).length;
              const a = activeApoio.reduce((s, e) => s + TURNOS.filter(t => getRecordValue(recordKey(d, e.id, t)) === k).length, 0);
              return acc + o + a;
            }, 0);
          });
          const totalSlots = reportDates.length * (activeOthers.length + activeApoio.length * 2);
          const taxaGeral  = totalSlots > 0 ? Math.round(((totals.presente || 0) / totalSlots) * 100) : null;
          const alertCount = empsSm.filter(({ emp, sm }) => { const p = getAvgPct(emp, sm); return p !== null && p < 75; }).length;

          /* ─── filter + search ─── */
          const filtered = empsSm.filter(({ emp, sm }) => {
            const pct = getAvgPct(emp, sm);
            const q   = reportSearch.toLowerCase();
            const matchSearch = !q || emp.name.toLowerCase().includes(q) || emp.role.toLowerCase().includes(q);
            const matchFilter =
              reportFilter === "ausentes"    ? (IS_APOIO(emp.role) ? (sm.manha?.ausente > 0 || sm.tarde?.ausente > 0) : sm.geral?.ausente > 0) :
              reportFilter === "abaixo75"    ? (pct !== null && pct < 75) :
              reportFilter === "semregistro" ? (pct === null) : true;
            return matchSearch && matchFilter;
          });

          const pctBar = (pct) => {
            if (pct === null) return null;
            const col = pct >= 75 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: col, borderRadius: 2 }} />
                </div>
                <span style={{ fontFamily: "sans-serif", fontSize: 12, fontWeight: 800, color: col, minWidth: 34, textAlign: "right" }}>{pct}%</span>
              </div>
            );
          };

          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

              {/* ══ Toolbar ══ */}
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {/* período */}
                <div style={{ display: "flex", gap: 3, background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: 3 }}>
                  {[["semanal","📅 Semanal"],["mensal","🗓️ Mensal"]].map(([r, lb]) => (
                    <button key={r} onClick={() => setReportType(r)} style={{ padding: "7px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "sans-serif", fontSize: 13, fontWeight: 600, background: reportType === r ? "#6366f1" : "transparent", color: reportType === r ? "#fff" : "#94a3b8" }}>{lb}</button>
                  ))}
                </div>
                <span style={{ fontFamily: "sans-serif", fontSize: 12, color: "#475569", background: "rgba(255,255,255,0.04)", padding: "6px 11px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.07)", whiteSpace: "nowrap" }}>
                  {reportType === "semanal" ? `${formatDate(reportDates[0])} – ${formatDate(reportDates[reportDates.length-1])}` : monthName}
                </span>
                {/* view toggle */}
                <div style={{ display: "flex", gap: 3, background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: 3, marginLeft: "auto" }}>
                  {[["cards","▦"],["tabela","⊞"]].map(([v, ic]) => (
                    <button key={v} title={v === "cards" ? "Cards" : "Tabela"} onClick={() => setReportView(v)} style={{ padding: "7px 13px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 15, background: reportView === v ? "rgba(99,102,241,0.35)" : "transparent", color: reportView === v ? "#e0e7ff" : "#64748b" }}>{ic}</button>
                  ))}
                </div>
                {/* PDF */}
                <button onClick={async () => { setPdfLoading(true); try { await exportRelatorioPDF({ school, activeEmployees, activeOthers, activeApoio, reportDates, reportType, records, monthName, getEmpSummary }); showToast("PDF exportado!"); } catch { showToast("Erro ao gerar PDF.", "err"); } finally { setPdfLoading(false); } }} disabled={pdfLoading} style={{ padding: "8px 18px", borderRadius: 10, border: "none", cursor: pdfLoading ? "not-allowed" : "pointer", background: pdfLoading ? "rgba(239,68,68,0.3)" : "linear-gradient(135deg,#ef4444,#dc2626)", color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: "sans-serif", boxShadow: pdfLoading ? "none" : "0 4px 12px rgba(239,68,68,0.3)", whiteSpace: "nowrap" }}>
                  {pdfLoading ? "⏳ Gerando..." : "📄 PDF"}
                </button>
              </div>

              {/* ══ KPIs ══ */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(100px,1fr))", gap: 8 }}>
                <div style={{ background: "linear-gradient(135deg,rgba(99,102,241,0.18),rgba(139,92,246,0.12))", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 14, padding: "14px 12px", textAlign: "center" }}>
                  <div style={{ fontSize: 26, fontWeight: 900, color: taxaGeral === null ? "#334155" : taxaGeral >= 75 ? "#22c55e" : taxaGeral >= 50 ? "#f59e0b" : "#ef4444" }}>{taxaGeral !== null ? `${taxaGeral}%` : "—"}</div>
                  <div style={{ fontFamily: "sans-serif", fontSize: 10, color: "#64748b", marginTop: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>Taxa Geral</div>
                </div>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                  <div key={k} style={{ background: `${v.color}10`, border: `1px solid ${v.color}30`, borderRadius: 14, padding: "14px 12px", textAlign: "center" }}>
                    <div style={{ fontSize: 26, fontWeight: 900, color: v.color }}>{totals[k] || 0}</div>
                    <div style={{ fontFamily: "sans-serif", fontSize: 10, color: "#64748b", marginTop: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>{v.label}</div>
                  </div>
                ))}
                <div style={{ background: "rgba(239,68,68,0.08)", border: `1px solid rgba(239,68,68,${alertCount > 0 ? "0.4" : "0.15"})`, borderRadius: 14, padding: "14px 12px", textAlign: "center" }}>
                  <div style={{ fontSize: 26, fontWeight: 900, color: alertCount > 0 ? "#ef4444" : "#334155" }}>{alertCount}</div>
                  <div style={{ fontFamily: "sans-serif", fontSize: 10, color: "#64748b", marginTop: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>Abaixo 75%</div>
                </div>
              </div>

              {/* ══ Busca + Filtros ══ */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <input type="text" placeholder="🔍 Buscar funcionário ou cargo..." value={reportSearch} onChange={e => setReportSearch(e.target.value)} style={{ flex: 1, minWidth: 180, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 9, padding: "8px 13px", color: "#f1f5f9", fontSize: 13, outline: "none", fontFamily: "sans-serif" }} />
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {[["todos","Todos"],["ausentes","Com Falta"],["abaixo75","< 75%"],["semregistro","Sem Registro"]].map(([f, lb]) => (
                    <button key={f} onClick={() => setReportFilter(f)} style={{ padding: "7px 12px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "sans-serif", fontSize: 12, fontWeight: 600, background: reportFilter === f ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.05)", color: reportFilter === f ? "#c7d2fe" : "#64748b" }}>{lb}{reportFilter === f && f !== "todos" ? ` (${filtered.length})` : ""}</button>
                  ))}
                </div>
              </div>

              {/* ══ Conteúdo ══ */}
              {filtered.length === 0 ? (
                <div style={{ textAlign: "center", padding: "48px 20px", color: "#334155", fontFamily: "sans-serif", fontSize: 14 }}>
                  {activeEmployees.length === 0 ? "Nenhum funcionário ativo." : "Nenhum resultado com esses filtros."}
                </div>

              ) : reportView === "cards" ? (
                /* ── Cards ── */
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {filtered.map(({ emp, sm }) => {
                    const apoio = IS_APOIO(emp.role);
                    const pct   = getAvgPct(emp, sm);
                    const pctColor = pct === null ? "#334155" : pct >= 75 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";
                    return (
                      <div key={emp.id} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, overflow: "hidden", transition: "border-color 0.15s" }}>
                        {/* cabeçalho do card */}
                        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
                          <div style={{ width: 38, height: 38, borderRadius: "50%", background: avatarColor(emp.id), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: "bold", flexShrink: 0 }}>{getInitials(emp.name)}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              {emp.name}
                              {apoio && <span style={{ fontSize: 10, background: "rgba(99,102,241,0.2)", color: "#a5b4fc", borderRadius: 5, padding: "2px 7px", fontFamily: "sans-serif" }}>Apoio</span>}
                              {pct !== null && pct < 75 && <span style={{ fontSize: 10, background: "rgba(239,68,68,0.15)", color: "#f87171", borderRadius: 5, padding: "2px 7px", fontFamily: "sans-serif" }}>⚠ Abaixo 75%</span>}
                            </div>
                            <div style={{ fontSize: 11, color: "#64748b", fontFamily: "sans-serif", marginTop: 2 }}>{emp.role}</div>
                          </div>
                          <div style={{ textAlign: "right", minWidth: 56 }}>
                            <div style={{ fontSize: 22, fontWeight: 900, color: pctColor, lineHeight: 1 }}>{pct !== null ? `${pct}%` : "—"}</div>
                            <div style={{ fontSize: 10, color: "#475569", fontFamily: "sans-serif", marginTop: 1 }}>presença</div>
                          </div>
                        </div>
                        {/* barra geral */}
                        {pct !== null && (
                          <div style={{ height: 3, background: "rgba(255,255,255,0.06)", margin: "0 0 0 0" }}>
                            <div style={{ height: "100%", width: `${pct}%`, background: pctColor }} />
                          </div>
                        )}
                        {/* chips status — funcionário normal */}
                        {!apoio && (
                          <div style={{ display: "flex", gap: 5, padding: "10px 16px", flexWrap: "wrap" }}>
                            {Object.entries(STATUS_CONFIG).map(([k, v]) => sm.geral[k] > 0 && (
                              <span key={k} style={{ background: `${v.color}15`, border: `1px solid ${v.color}30`, borderRadius: 20, padding: "3px 10px", fontFamily: "sans-serif", fontSize: 11, color: v.color, fontWeight: 700 }}>{v.icon} {sm.geral[k]}× {v.label}</span>
                            ))}
                            {sm.geral.total === 0 && <span style={{ fontFamily: "sans-serif", fontSize: 11, color: "#334155" }}>Sem registros no período</span>}
                          </div>
                        )}
                        {/* turnos — apoio */}
                        {apoio && (
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "10px 16px" }}>
                            {TURNOS.map(turno => {
                              const td = sm[turno];
                              return (
                                <div key={turno} style={{ background: `${TURNO_COLOR[turno]}08`, border: `1px solid ${TURNO_COLOR[turno]}25`, borderRadius: 10, padding: "9px 12px" }}>
                                  <div style={{ fontFamily: "sans-serif", fontSize: 11, fontWeight: 700, color: TURNO_COLOR[turno], marginBottom: 6 }}>{TURNO_LABEL[turno]}</div>
                                  <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginBottom: 6 }}>
                                    {Object.entries(STATUS_CONFIG).map(([k, v]) => td[k] > 0 && (
                                      <span key={k} style={{ background: `${v.color}18`, borderRadius: 5, padding: "2px 7px", fontFamily: "sans-serif", fontSize: 10, color: v.color, fontWeight: 700 }}>{v.icon} {td[k]}</span>
                                    ))}
                                  </div>
                                  {pctBar(td.pct)}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

              ) : (
                /* ── Tabela ── */
                <div style={{ ...card, overflow: "hidden" }}>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ borderCollapse: "collapse", width: "100%", fontFamily: "sans-serif", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: "rgba(99,102,241,0.08)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                          <th style={{ padding: "10px 14px", textAlign: "left", color: "#94a3b8", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>Funcionário</th>
                          {reportDates.map(d => {
                            const dow = new Date(d + "T12:00:00").getDay();
                            const isHoje = d === getTodayStr();
                            const isWknd = dow === 0 || dow === 6;
                            return (
                              <th key={d} style={{ padding: "10px 5px", textAlign: "center", color: isHoje ? "#a5b4fc" : isWknd ? "#2d3748" : "#64748b", fontWeight: 600, fontSize: 11, background: isHoje ? "rgba(99,102,241,0.12)" : "transparent", minWidth: 30, whiteSpace: "nowrap" }}>
                                <div>{DAYS_PT[dow]}</div>
                                <div style={{ fontSize: 9, opacity: 0.6, marginTop: 1 }}>{formatDateShort(d)}</div>
                              </th>
                            );
                          })}
                          <th style={{ padding: "10px 14px", textAlign: "center", color: "#94a3b8", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map(({ emp, sm }, ri) => {
                          const apoio = IS_APOIO(emp.role);
                          const rowBg = ri % 2 === 0 ? "transparent" : "rgba(255,255,255,0.012)";
                          const avatar = (
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ width: 26, height: 26, borderRadius: "50%", background: avatarColor(emp.id), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: "bold", flexShrink: 0 }}>{getInitials(emp.name)}</div>
                              <div>
                                <div style={{ color: "#e2e8f0", fontWeight: 600 }}>{emp.name}</div>
                                <div style={{ color: "#475569", fontSize: 10 }}>{emp.role}</div>
                              </div>
                            </div>
                          );
                          const cell = (st, isHoje) => {
                            const cfg = st ? STATUS_CONFIG[st] : null;
                            return (
                              <td style={{ padding: "5px", textAlign: "center", background: isHoje ? "rgba(99,102,241,0.06)" : "transparent" }}>
                                {cfg
                                  ? <span title={cfg.label} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: 6, background: cfg.color + "22", color: cfg.color, fontWeight: 800, fontSize: 12, border: `1px solid ${cfg.color}38` }}>{STATUS_ICON_DISPLAY[st]}</span>
                                  : <span style={{ display: "inline-block", width: 24, height: 24, borderRadius: 6, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }} />}
                              </td>
                            );
                          };
                          if (!apoio) {
                            const pct = sm.geral?.pct;
                            return (
                              <tr key={emp.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", background: rowBg }}>
                                <td style={{ padding: "8px 14px", whiteSpace: "nowrap" }}>{avatar}</td>
                                {reportDates.map(d => cell(getRecordValue(recordKey(d, emp.id)), d === getTodayStr()))}
                                <td style={{ padding: "8px 14px", textAlign: "center", whiteSpace: "nowrap" }}>
                                  {pct !== null ? <span style={{ fontWeight: 800, color: pct >= 75 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444" }}>{pct}%</span> : <span style={{ color: "#334155" }}>—</span>}
                                </td>
                              </tr>
                            );
                          }
                          return TURNOS.map((turno, ti) => {
                            const td = sm[turno];
                            return (
                              <tr key={`${emp.id}_${turno}`} style={{ borderBottom: ti === 1 ? "1px solid rgba(255,255,255,0.04)" : "none", background: rowBg }}>
                                <td style={{ padding: ti === 0 ? "7px 14px 2px" : "2px 14px 7px", whiteSpace: "nowrap" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    {ti === 0
                                      ? <div style={{ width: 26, height: 26, borderRadius: "50%", background: avatarColor(emp.id), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: "bold" }}>{getInitials(emp.name)}</div>
                                      : <div style={{ width: 26 }} />}
                                    <div>
                                      {ti === 0 && <div style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 12 }}>{emp.name}</div>}
                                      <div style={{ color: TURNO_COLOR[turno], fontSize: 10, fontWeight: 600 }}>{TURNO_LABEL[turno]}</div>
                                    </div>
                                  </div>
                                </td>
                                {reportDates.map(d => cell(getRecordValue(recordKey(d, emp.id, turno)), d === getTodayStr()))}
                                <td style={{ padding: "6px 14px", textAlign: "center" }}>
                                  {td.pct !== null ? <span style={{ fontWeight: 700, color: td.pct >= 75 ? "#22c55e" : td.pct >= 50 ? "#f59e0b" : "#ef4444" }}>{td.pct}%</span> : <span style={{ color: "#334155" }}>—</span>}
                                </td>
                              </tr>
                            );
                          });
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

            </div>
          );
        })()}

        {/* ══════════ CADASTRO ══════════ */}
        {tab === "cadastro" && (
          <div>
            <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
              <input type="text" placeholder="🔍 Buscar por nome ou cargo..." value={searchCad} onChange={e => setSearchCad(e.target.value)} style={{ flex: 1, minWidth: 200, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 14px", color: "#f1f5f9", fontSize: 13, fontFamily: "sans-serif", outline: "none" }} />
              <button onClick={openNew} style={{ padding: "10px 22px", borderRadius: 10, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: "sans-serif", boxShadow: "0 4px 15px rgba(99,102,241,0.4)", whiteSpace: "nowrap" }}>+ Novo Funcionário</button>
            </div>
            <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
              {[{ label: "Total", value: employees.length, c: "#6366f1" }, { label: "Ativos", value: employees.filter(e => e.active).length, c: "#22c55e" }, { label: "Inativos", value: employees.filter(e => !e.active).length, c: "#64748b" }, { label: "Prof. Apoio", value: employees.filter(e => IS_APOIO(e.role)).length, c: "#f59e0b" }].map(it => (
                <div key={it.label} style={{ background: `${it.c}15`, border: `1px solid ${it.c}30`, borderRadius: 10, padding: "9px 16px", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: "sans-serif", fontSize: 20, fontWeight: 900, color: it.c }}>{it.value}</span>
                  <span style={{ fontFamily: "sans-serif", fontSize: 11, color: "#94a3b8" }}>{it.label}</span>
                </div>
              ))}
            </div>
            {filteredCad.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "#475569", fontFamily: "sans-serif" }}><div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div><div>Nenhum funcionário encontrado.</div></div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {filteredCad.map(emp => {
                  const apoio = IS_APOIO(emp.role);
                  return (
                    <div key={emp.id} style={{ ...card, borderColor: apoio ? "rgba(245,158,11,0.25)" : "rgba(255,255,255,0.08)", padding: "16px 20px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", opacity: emp.active ? 1 : 0.6, transition: "all 0.2s" }}>
                      <div style={{ width: 46, height: 46, borderRadius: "50%", background: emp.active ? avatarColor(emp.id) : "#334155", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: "bold", flexShrink: 0, position: "relative" }}>
                        {getInitials(emp.name)}
                        <span style={{ position: "absolute", bottom: 1, right: 1, width: 12, height: 12, borderRadius: "50%", background: emp.active ? "#22c55e" : "#64748b", border: "2px solid #0f172a" }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 150 }}>
                        <div style={{ fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          {emp.name}
                          {!emp.active && <span style={{ fontFamily: "sans-serif", fontSize: 10, background: "rgba(100,116,139,0.3)", color: "#94a3b8", borderRadius: 6, padding: "2px 7px" }}>Inativo</span>}
                        </div>
                        <div style={{ fontFamily: "sans-serif", fontSize: 12, marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ color: apoio ? "#f59e0b" : "#94a3b8" }}>{emp.role}</span>
                          {apoio && <span style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b", borderRadius: 5, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>Manhã e tarde</span>}
                        </div>
                        {(emp.phone || emp.email) && (
                          <div style={{ fontFamily: "sans-serif", fontSize: 11, color: "#64748b", marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap" }}>
                            {emp.phone && <span>📞 {emp.phone}</span>}
                            {emp.email && <span>✉️ {emp.email}</span>}
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                        <button onClick={() => toggleActive(emp.id)} style={{ padding: "7px 13px", borderRadius: 8, border: "none", cursor: "pointer", background: emp.active ? "rgba(34,197,94,0.15)" : "rgba(100,116,139,0.15)", color: emp.active ? "#22c55e" : "#94a3b8", fontSize: 12, fontFamily: "sans-serif", fontWeight: 600 }}>{emp.active ? "✓ Ativo" : "○ Inativo"}</button>
                        <button onClick={() => openEdit(emp)} style={{ padding: "7px 13px", borderRadius: 8, border: "none", cursor: "pointer", background: "rgba(99,102,241,0.15)", color: "#a5b4fc", fontSize: 12, fontFamily: "sans-serif", fontWeight: 600 }}>✏️ Editar</button>
                        <button onClick={() => setDeleteConfirm(emp.id)} style={{ padding: "7px 13px", borderRadius: 8, border: "none", cursor: "pointer", background: "rgba(239,68,68,0.15)", color: "#ef4444", fontSize: 12, fontFamily: "sans-serif", fontWeight: 600 }}>🗑️ Remover</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === "justificativas" && (
          <div>

            {/* ── Header com botão ── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "start", marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: "bold", marginBottom: 4 }}>📋 Justificativas</div>
                <div style={{ fontFamily: "sans-serif", fontSize: 12, color: "#64748b" }}>Gerencie as justificativas de ausência dos funcionários</div>
              </div>
              <button onClick={() => { setJustForm({ empId: "", datas: "", motivo: "", documento: "" }); setJustError(""); setShowJustModal(true); }} style={{ padding: "11px 22px", borderRadius: 12, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: "sans-serif", boxShadow: "0 4px 15px rgba(99,102,241,0.4)", whiteSpace: "nowrap" }}>
                + Nova Justificativa
              </button>
            </div>

            {/* ── Cards de resumo / filtros ── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 20 }}>
              {[
                { val: "todas",     label: "Total",      color: "#6366f1", icon: "📋" },
                { val: "pendente",  label: "Pendentes",  color: "#f59e0b", icon: "⏳" },
                { val: "aprovada",  label: "Aprovadas",  color: "#22c55e", icon: "✅" },
                { val: "reprovada", label: "Reprovadas", color: "#ef4444", icon: "❌" },
              ].map(({ val, label, color, icon }) => {
                const count = val === "todas" ? justificativas.length : justificativas.filter(j => j.status === val).length;
                const active = justFilter === val;
                return (
                  <button key={val} onClick={() => setJustFilter(val)} style={{ background: active ? `${color}20` : "rgba(255,255,255,0.03)", border: `1px solid ${active ? color + "60" : "rgba(255,255,255,0.08)"}`, borderRadius: 14, padding: "14px 16px", cursor: "pointer", textAlign: "left", transition: "all 0.2s", outline: "none" }}>
                    <div style={{ fontSize: 20, marginBottom: 6 }}>{icon}</div>
                    <div style={{ fontFamily: "sans-serif", fontSize: 24, fontWeight: 900, color: active ? color : "#f1f5f9", lineHeight: 1 }}>{count}</div>
                    <div style={{ fontFamily: "sans-serif", fontSize: 11, color: active ? color : "#64748b", marginTop: 4, fontWeight: 600 }}>{label}</div>
                  </button>
                );
              })}
            </div>

            {/* ── Alerta: faltas sem justificativa ── */}
            {(() => {
              const semJust = activeEmployees.filter(emp => {
                const temFalta = Object.entries(records).some(([k, v]) => {
                  if (v !== "ausente") return false;
                  if (IS_APOIO(emp.role)) return TURNOS.some(t => k === `${k.split("_")[0]}_${emp.id}_${t}`) && k.includes(`_${emp.id}_`);
                  return k.endsWith(`_${emp.id}`) && !k.includes(`_${emp.id}_`);
                });
                if (!temFalta) return false;
                return !justificativas.some(j => j.empId === emp.id && (j.status === "pendente" || j.status === "aprovada"));
              });
              if (semJust.length === 0) return null;
              return (
                <div style={{ marginBottom: 20, borderRadius: 14, background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.3)", padding: "16px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 18 }}>⚠️</span>
                    <span style={{ fontFamily: "sans-serif", fontSize: 13, fontWeight: 700, color: "#fcd34d" }}>
                      {semJust.length} funcionário{semJust.length > 1 ? "s" : ""} com falta{semJust.length > 1 ? "s" : ""} sem justificativa
                    </span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {semJust.map(emp => (
                      <div key={emp.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 10, padding: "7px 12px" }}>
                        <div style={{ width: 28, height: 28, borderRadius: "50%", background: avatarColor(emp.id), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: "bold" }}>{getInitials(emp.name)}</div>
                        <div>
                          <div style={{ fontFamily: "sans-serif", fontSize: 12, fontWeight: 600, color: "#f1f5f9" }}>{emp.name.split(" ")[0]}</div>
                          <div style={{ fontFamily: "sans-serif", fontSize: 11, color: "#f59e0b" }}>Sem justificativa</div>
                        </div>
                        <button onClick={() => { setJustForm({ empId: String(emp.id), datas: "", motivo: "", documento: "" }); setJustError(""); setShowJustModal(true); }} style={{ padding: "4px 10px", borderRadius: 7, border: "none", cursor: "pointer", background: "rgba(245,158,11,0.25)", color: "#f59e0b", fontSize: 11, fontWeight: 700, fontFamily: "sans-serif" }}>+ Justificar</button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* ── Lista de justificativas ── */}
            {justificativas.filter(j => justFilter === "todas" || j.status === justFilter).length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "#475569", fontFamily: "sans-serif" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                <div>Nenhuma justificativa {justFilter !== "todas" ? justFilter : "registrada"} ainda.</div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {justificativas
                  .filter(j => justFilter === "todas" || j.status === justFilter)
                  .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm))
                  .map(just => {
                    const emp = employees.find(e => e.id === just.empId);
                    const statusCfg = {
                      pendente:  { label: "Pendente",  color: "#f59e0b", bg: "rgba(245,158,11,0.06)",  border: "rgba(245,158,11,0.25)",  icon: "⏳" },
                      aprovada:  { label: "Aprovada",  color: "#22c55e", bg: "rgba(34,197,94,0.06)",   border: "rgba(34,197,94,0.25)",   icon: "✅" },
                      reprovada: { label: "Reprovada", color: "#ef4444", bg: "rgba(239,68,68,0.06)",   border: "rgba(239,68,68,0.25)",   icon: "❌" },
                    }[just.status];
                    const dataRegistro = new Date(just.criadoEm).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
                    return (
                      <div key={just.id} style={{ background: statusCfg.bg, border: `1px solid ${statusCfg.border}`, borderRadius: 16, overflow: "hidden", transition: "all 0.2s" }}>

                        {/* Topo: identidade + status */}
                        <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 12, borderBottom: `1px solid ${statusCfg.border}` }}>
                          <div style={{ width: 42, height: 42, borderRadius: "50%", background: emp ? avatarColor(emp.id) : "#334155", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: "bold", flexShrink: 0 }}>
                            {emp ? getInitials(emp.name) : "?"}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{emp ? emp.name : "Funcionário removido"}</div>
                            {emp && <div style={{ fontFamily: "sans-serif", fontSize: 11, color: "#94a3b8" }}>{emp.role}</div>}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                            <span style={{ fontFamily: "sans-serif", fontSize: 11, background: `${statusCfg.color}25`, color: statusCfg.color, borderRadius: 20, padding: "3px 10px", fontWeight: 700, whiteSpace: "nowrap" }}>{statusCfg.icon} {statusCfg.label}</span>
                            <span style={{ fontFamily: "sans-serif", fontSize: 11, color: "#475569" }}>{dataRegistro}</span>
                          </div>
                        </div>

                        {/* Corpo: datas + motivo */}
                        <div style={{ padding: "12px 18px", display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 14px", fontFamily: "sans-serif", fontSize: 13, alignItems: "start" }}>
                          <span style={{ color: "#64748b", fontWeight: 600, whiteSpace: "nowrap" }}>📅 Data(s)</span>
                          <span style={{ color: "#e2e8f0" }}>{just.datas}</span>
                          <span style={{ color: "#64748b", fontWeight: 600, whiteSpace: "nowrap" }}>📝 Motivo</span>
                          <span style={{ color: "#cbd5e1" }}>{just.motivo}</span>
                          {just.documento && (<>
                            <span style={{ color: "#64748b", fontWeight: 600 }}>📎 Doc</span>
                            <a href={just.documento} target="_blank" rel="noreferrer" style={{ color: "#a5b4fc", textDecoration: "underline" }}>Ver documento</a>
                          </>)}
                          {just.motivoReprovacao && (<>
                            <span style={{ color: "#f87171", fontWeight: 600 }}>❌ Reprovado</span>
                            <span style={{ color: "#fca5a5" }}>{just.motivoReprovacao}</span>
                          </>)}
                          {just.aprovadoPor && (<>
                            <span style={{ color: "#64748b", fontWeight: 600 }}>👤 Aprovado por</span>
                            <span style={{ color: "#86efac", fontSize: 12 }}>{just.aprovadoPor} · {new Date(just.aprovadoEm).toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" })}</span>
                          </>)}
                          {just.reprovadoPor && (<>
                            <span style={{ color: "#64748b", fontWeight: 600 }}>👤 Reprovado por</span>
                            <span style={{ color: "#fca5a5", fontSize: 12 }}>{just.reprovadoPor} · {new Date(just.reprovadoEm).toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" })}</span>
                          </>)}
                        </div>

                        {/* Rodapé: ações */}
                        <div style={{ padding: "10px 18px", background: "rgba(0,0,0,0.12)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                          {just.status === "pendente" && (<>
                            <button onClick={() => aprovarJustificativa(just)} style={{ padding: "7px 18px", borderRadius: 8, border: "none", cursor: "pointer", background: "rgba(34,197,94,0.2)", color: "#22c55e", fontSize: 12, fontFamily: "sans-serif", fontWeight: 700, whiteSpace: "nowrap" }}>✅ Aprovar{emp?.phone ? " + 📲" : ""}</button>
                            <button onClick={() => reprovarJustificativa(just)} style={{ padding: "7px 18px", borderRadius: 8, border: "none", cursor: "pointer", background: "rgba(239,68,68,0.15)", color: "#ef4444", fontSize: 12, fontFamily: "sans-serif", fontWeight: 700, whiteSpace: "nowrap" }}>❌ Reprovar{emp?.phone ? " + 📲" : ""}</button>
                          </>)}
                          {just.status !== "pendente" && (
                            <button onClick={() => { updateJustificativa(just.id, { status: "pendente" }); showToast("Reaberta para análise."); }} style={{ padding: "7px 18px", borderRadius: 8, border: "none", cursor: "pointer", background: "rgba(245,158,11,0.15)", color: "#f59e0b", fontSize: 12, fontFamily: "sans-serif", fontWeight: 700, whiteSpace: "nowrap" }}>↩ Reabrir</button>
                          )}
                          <button onClick={() => setDeleteJustConfirm(just.id)} style={{ marginLeft: "auto", padding: "7px 14px", borderRadius: 8, border: "none", cursor: "pointer", background: "rgba(100,116,139,0.1)", color: "#64748b", fontSize: 12, fontFamily: "sans-serif", fontWeight: 700 }}>🗑️</button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}

                        {/* Modal Nova Justificativa */}
            {showJustModal && (
              <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
                <div onClick={() => setShowJustModal(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(5px)" }} />
                <div style={{ position: "relative", width: "100%", maxWidth: 500, background: "#1a2640", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 20, padding: "28px 26px 24px", boxShadow: "0 25px 60px rgba(0,0,0,0.6)", maxHeight: "90vh", overflowY: "auto" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
                    <div style={{ fontSize: 17, fontWeight: "bold" }}>📋 Nova Justificativa</div>
                    <button onClick={() => setShowJustModal(false)} style={{ width: 32, height: 32, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.07)", color: "#94a3b8", cursor: "pointer", fontSize: 18 }}>×</button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14, fontFamily: "sans-serif" }}>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Funcionário *</label>
                      <select value={justForm.empId} onChange={e => setJustForm(f => ({ ...f, empId: e.target.value }))} style={{ width: "100%", background: "#1e293b", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "11px 14px", color: justForm.empId ? "#f1f5f9" : "#64748b", fontSize: 14, outline: "none", cursor: "pointer" }}>
                        <option value="">Selecione o funcionário...</option>
                        {employees.filter(e => e.active).map(e => <option key={e.id} value={e.id}>{e.name} — {e.role}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Data(s) da Ausência *</label>
                      <input type="date" value={justForm.datas} onChange={e => setJustForm(f => ({ ...f, datas: e.target.value }))} max={new Date().toISOString().split("T")[0]} style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "11px 14px", color: "#f1f5f9", fontSize: 14, outline: "none", colorScheme: "dark", cursor: "pointer" }} />
                      <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>Para múltiplas datas, separe por vírgula</div>
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Motivo da Ausência *</label>
                      <textarea value={justForm.motivo} onChange={e => setJustForm(f => ({ ...f, motivo: e.target.value }))} placeholder="Descreva o motivo da ausência..." rows={3} style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "11px 14px", color: "#f1f5f9", fontSize: 14, outline: "none", resize: "vertical", fontFamily: "sans-serif" }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Link do Documento (opcional)</label>
                      <input type="url" value={justForm.documento} onChange={e => setJustForm(f => ({ ...f, documento: e.target.value }))} placeholder="Cole o link do documento aqui" style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "11px 14px", color: "#f1f5f9", fontSize: 14, outline: "none" }} />
                      <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>Ex: link do Google Drive, WhatsApp, etc.</div>
                    </div>
                    {justError && <div style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#f87171" }}>⚠️ {justError}</div>}
                    <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                      <button onClick={() => setShowJustModal(false)} style={{ flex: 1, padding: "11px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "#94a3b8", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
                      <button onClick={handleAddJustificativa} style={{ flex: 2, padding: "11px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 15px rgba(99,102,241,0.4)" }}>✓ Registrar Justificativa</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Modal Reprovar com motivo */}
            {showReprovarModal && reprovarTarget && (
              <div style={{ position: "fixed", inset: 0, zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
                <div onClick={() => setShowReprovarModal(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(5px)" }} />
                <div style={{ position: "relative", width: "100%", maxWidth: 420, background: "#1a2640", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 20, padding: "26px 24px", boxShadow: "0 25px 60px rgba(0,0,0,0.6)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
                    <div style={{ fontSize: 16, fontWeight: "bold", color: "#f87171" }}>❌ Reprovar Justificativa</div>
                    <button onClick={() => setShowReprovarModal(false)} style={{ width: 32, height: 32, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.07)", color: "#94a3b8", cursor: "pointer", fontSize: 18 }}>×</button>
                  </div>
                  {(() => {
                    const emp = employees.find(e => e.id === reprovarTarget.empId);
                    return emp ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, padding: "10px 14px", background: "rgba(255,255,255,0.04)", borderRadius: 10 }}>
                        <div style={{ width: 34, height: 34, borderRadius: "50%", background: avatarColor(emp.id), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: "bold" }}>{getInitials(emp.name)}</div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{emp.name}</div>
                          <div style={{ fontFamily: "sans-serif", fontSize: 11, color: "#94a3b8" }}>📅 {reprovarTarget.datas}</div>
                        </div>
                      </div>
                    ) : null;
                  })()}
                  <div style={{ fontFamily: "sans-serif", marginBottom: 16 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Motivo da Reprovação (opcional)</label>
                    <textarea value={reprovarMotivo} onChange={e => setReprovarMotivo(e.target.value)} placeholder="Ex: documento inválido, prazo expirado..." rows={3} style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "11px 14px", color: "#f1f5f9", fontSize: 13, outline: "none", resize: "vertical", fontFamily: "sans-serif" }} />
                    {employees.find(e => e.id === reprovarTarget.empId)?.phone && (
                      <div style={{ marginTop: 8, fontSize: 12, color: "#94a3b8", display: "flex", alignItems: "center", gap: 6 }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="#25d366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                        O funcionário será notificado via WhatsApp automaticamente
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button onClick={() => setShowReprovarModal(false)} style={{ flex: 1, padding: "11px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "#94a3b8", fontSize: 13, fontWeight: 600, fontFamily: "sans-serif", cursor: "pointer" }}>Cancelar</button>
                    <button onClick={confirmarReprovacao} style={{ flex: 2, padding: "11px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#ef4444,#dc2626)", color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: "sans-serif", cursor: "pointer", boxShadow: "0 4px 15px rgba(239,68,68,0.4)" }}>❌ Confirmar Reprovação</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════ ESCOLA ══════════ */}
        {tab === "escola" && (
          <div style={{ maxWidth: 640 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: "bold" }}>Dados da Escola</div>
                <div style={{ fontFamily: "sans-serif", fontSize: 12, color: "#64748b", marginTop: 2 }}>Informações exibidas no app e nas mensagens do WhatsApp</div>
              </div>
              <button onClick={openSchoolModal} style={{ padding: "9px 20px", borderRadius: 10, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: "sans-serif", boxShadow: "0 4px 15px rgba(99,102,241,0.4)" }}>✏️ Editar</button>
            </div>
            <div style={{ ...card, padding: "24px", marginBottom: 22 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
                {school.logo
                  ? <img src={school.logo} alt="logo" style={{ width: 60, height: 60, borderRadius: 12, objectFit: "cover", border: "2px solid rgba(99,102,241,0.4)" }} />
                  : <div style={{ width: 60, height: 60, borderRadius: 12, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>🏫</div>
                }
                <div>
                  <div style={{ fontSize: 20, fontWeight: "bold" }}>{school.name || "—"}</div>
                  {school.city && <div style={{ fontFamily: "sans-serif", fontSize: 13, color: "#94a3b8", marginTop: 2 }}>{school.city}</div>}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontFamily: "sans-serif", fontSize: 13 }}>
                {[{ label: "Endereço", val: school.address }, { label: "Cidade", val: school.city }, { label: "Telefone", val: school.phone }, { label: "E-mail", val: school.email }, { label: "Diretor(a)", val: school.director }].map(({ label, val }) => (
                  <div key={label} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "10px 14px" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{label}</div>
                    <div style={{ color: val ? "#e2e8f0" : "#475569" }}>{val || "Não informado"}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* WhatsApp info */}
            <div style={{ ...card, padding: "22px" }}>
              <div style={{ fontSize: 15, fontWeight: "bold", marginBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#25d366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" /></svg>
                Envio por WhatsApp
              </div>
              <div style={{ background: "rgba(37,211,102,0.08)", border: "1px solid rgba(37,211,102,0.2)", borderRadius: 10, padding: "14px 16px", fontFamily: "sans-serif", fontSize: 13, color: "#94a3b8", lineHeight: 1.7 }}>
                <strong style={{ color: "#4ade80" }}>✓ Sem configuração necessária!</strong><br />
                Clique no botão <svg style={{ verticalAlign: "middle" }} width="14" height="14" viewBox="0 0 24 24" fill="#25d366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" /></svg> ao lado de cada funcionário na aba <strong style={{ color: "#c7d2fe" }}>Registro</strong>.<br />
                O WhatsApp abrirá automaticamente com a mensagem de frequência já preenchida, pronta para enviar.<br />
                Certifique-se de cadastrar o <strong style={{ color: "#c7d2fe" }}>telefone (WhatsApp)</strong> de cada funcionário.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ══ MODAL WHATSAPP ══ */}
      {waModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={() => setWaModal(null)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(5px)" }} />
          <div style={{ position: "relative", width: "100%", maxWidth: 420, background: "#1a2640", border: "1px solid rgba(37,211,102,0.3)", borderRadius: 20, padding: "28px 26px 24px", boxShadow: "0 25px 60px rgba(0,0,0,0.6)" }}>

            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="#25d366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" /></svg>
                <div style={{ fontSize: 17, fontWeight: "bold" }}>Enviar por WhatsApp</div>
              </div>
              <button onClick={() => setWaModal(null)} style={{ width: 32, height: 32, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.07)", color: "#94a3b8", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
            </div>

            {/* Funcionário */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, padding: "12px 14px", background: "rgba(255,255,255,0.04)", borderRadius: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: avatarColor(waModal.id), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: "bold", flexShrink: 0 }}>{getInitials(waModal.name)}</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{waModal.name}</div>
                <div style={{ fontFamily: "sans-serif", fontSize: 12, color: "#94a3b8" }}>{waModal.role}</div>
              </div>
            </div>

            {/* Aviso de falta */}
            {(() => {
              const apoio = IS_APOIO(waModal.role);
              const temFalta = apoio
                ? TURNOS.some(t => getStatus(waModal.id, selectedDate, t) === "ausente")
                : getStatus(waModal.id) === "ausente";
              return temFalta ? (
                <div style={{ marginBottom: 14, padding: "12px 16px", borderRadius: 12, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)", fontFamily: "sans-serif", fontSize: 13, color: "#fca5a5", display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>⚠️</span>
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Falta registrada nesta data</div>
                    <div style={{ fontSize: 12, color: "#f87171" }}>O link do formulário de justificativa será incluído automaticamente na mensagem.</div>
                    <a href="https://forms.gle/h4hUwBNVJv7hRzSF7" target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 8, fontSize: 11, color: "#a5b4fc", textDecoration: "underline" }}>
                      📝 Ver formulário de justificativa
                    </a>
                  </div>
                </div>
              ) : null;
            })()}

            {/* Preview da mensagem */}
            <div style={{ marginBottom: 18, background: "#0d1929", borderRadius: 12, padding: "14px 16px", border: "1px solid rgba(255,255,255,0.07)" }}>
              <div style={{ fontFamily: "sans-serif", fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Prévia da mensagem</div>
              <pre style={{ margin: 0, fontFamily: "sans-serif", fontSize: 12, color: "#cbd5e1", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {buildWhatsAppMessage(waModal, records, selectedDate, school)}
              </pre>
            </div>

            {/* Telefone */}
            <div style={{ marginBottom: 18 }}>
              <label style={{ fontFamily: "sans-serif", fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>
                Número do WhatsApp <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                type="tel" value={waPhone} onChange={e => setWaPhone(e.target.value)}
                placeholder="Ex: (11) 99999-9999"
                style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(37,211,102,0.3)", borderRadius: 10, padding: "11px 14px", color: "#f1f5f9", fontSize: 14, fontFamily: "sans-serif", outline: "none" }}
              />
              <div style={{ fontFamily: "sans-serif", fontSize: 11, color: "#64748b", marginTop: 5 }}>
                O código do Brasil (+55) será adicionado automaticamente se não informado.
              </div>
            </div>

            {waSent && (
              <div style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 10, background: "rgba(37,211,102,0.12)", border: "1px solid rgba(37,211,102,0.3)", fontFamily: "sans-serif", fontSize: 13, color: "#4ade80" }}>
                ✓ WhatsApp aberto! Verifique o aplicativo e confirme o envio.
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setWaModal(null)} style={{ flex: 1, padding: "11px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "#94a3b8", fontSize: 13, fontWeight: 600, fontFamily: "sans-serif", cursor: "pointer" }}>Cancelar</button>
              <button onClick={handleSendWhatsApp} style={{ flex: 2, padding: "11px", borderRadius: 10, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#25d366,#128c7e)", color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: "sans-serif", boxShadow: "0 4px 15px rgba(37,211,102,0.35)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" /></svg>
                {waSent ? "Abrir novamente" : "Enviar pelo WhatsApp"}
              </button>
            </div>
          </div>
        </div>
      )}

        {/* ══════════ USUÁRIOS ══════════ */}
        {tab === "usuarios" && isGestor() && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "start", marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: "bold", marginBottom: 4 }}>👥 Gerenciar Usuários</div>
                <div style={{ fontFamily: "sans-serif", fontSize: 12, color: "#64748b" }}>Crie usuários e defina o que cada um pode acessar no sistema</div>
              </div>
              <button onClick={() => { setUserForm({ name: "", user: "", pass: "", pass2: "", role: "Diretor", permissions: { registro: true, relatorio: false, justificativas: false, cadastro: false, escola: false } }); setEditingUser(null); setUserFormError(""); setShowUserModal(true); }} style={{ padding: "11px 22px", borderRadius: 12, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: "sans-serif", boxShadow: "0 4px 15px rgba(99,102,241,0.4)", whiteSpace: "nowrap" }}>
                + Novo Usuário
              </button>
            </div>

            {/* Gestor card */}
            <div style={{ marginBottom: 10, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 16, overflow: "hidden" }}>
              <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 42, height: 42, borderRadius: "50%", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>👑</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{credentials.user}</div>
                  <div style={{ fontFamily: "sans-serif", fontSize: 11, color: "#94a3b8" }}>Login master do sistema</div>
                </div>
                <span style={{ fontFamily: "sans-serif", fontSize: 11, background: "rgba(99,102,241,0.25)", color: "#a5b4fc", borderRadius: 20, padding: "3px 12px", fontWeight: 700 }}>👑 Gestor</span>
              </div>
              <div style={{ padding: "8px 18px 12px", display: "flex", flexWrap: "wrap", gap: 6 }}>
                {[["registro","📝 Registro"],["relatorio","📊 Relatório"],["justificativas","📋 Justificativas"],["cadastro","👥 Cadastro"],["escola","🏫 Escola"]].map(([k, label]) => (
                  <span key={k} style={{ fontFamily: "sans-serif", fontSize: 11, background: "rgba(34,197,94,0.15)", color: "#22c55e", borderRadius: 6, padding: "2px 9px", fontWeight: 600 }}>✓ {label}</span>
                ))}
              </div>
            </div>

            {/* System users list */}
            {systemUsers.length === 0 ? (
              <div style={{ textAlign: "center", padding: "50px 20px", color: "#475569", fontFamily: "sans-serif" }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>👤</div>
                <div>Nenhum usuário criado ainda. Clique em <strong style={{ color: "#a5b4fc" }}>+ Novo Usuário</strong> para começar.</div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                {systemUsers.map(u => {
                  const PERM_LABELS = { registro: "📝 Registro", relatorio: "📊 Relatório", justificativas: "📋 Justificativas", cadastro: "👥 Cadastro", escola: "🏫 Escola" };
                  const activePerms = Object.entries(u.permissions || {}).filter(([, v]) => v);
                  return (
                    <div key={u.id} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, overflow: "hidden" }}>
                      <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                        <div style={{ width: 42, height: 42, borderRadius: "50%", background: avatarColor(u.id), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: "bold", flexShrink: 0 }}>{getInitials(u.name || u.user)}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700 }}>{u.name || u.user}</div>
                          <div style={{ fontFamily: "sans-serif", fontSize: 11, color: "#94a3b8" }}>@{u.user} · {u.role}</div>
                        </div>
                        <span style={{ fontFamily: "sans-serif", fontSize: 11, background: u.role === "Diretor" ? "rgba(239,68,68,0.2)" : u.role === "Coordenador" ? "rgba(99,102,241,0.2)" : u.role === "Secretário(a)" ? "rgba(20,184,166,0.2)" : "rgba(245,158,11,0.2)", color: u.role === "Diretor" ? "#f87171" : u.role === "Coordenador" ? "#a5b4fc" : u.role === "Secretário(a)" ? "#2dd4bf" : "#f59e0b", borderRadius: 20, padding: "3px 12px", fontWeight: 700, flexShrink: 0 }}>{u.role}</span>
                      </div>
                      <div style={{ padding: "10px 18px", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                        {activePerms.length === 0
                          ? <span style={{ fontFamily: "sans-serif", fontSize: 11, color: "#475569" }}>Sem permissões ativas</span>
                          : activePerms.map(([k]) => (
                              <span key={k} style={{ fontFamily: "sans-serif", fontSize: 11, background: "rgba(34,197,94,0.12)", color: "#22c55e", borderRadius: 6, padding: "2px 9px", fontWeight: 600 }}>✓ {PERM_LABELS[k]}</span>
                            ))}
                        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                          <button onClick={() => { setEditingUser(u); setUserForm({ name: u.name || "", user: u.user, pass: "", pass2: "", role: u.role, permissions: { ...u.permissions } }); setUserFormError(""); setShowUserModal(true); }} style={{ padding: "5px 12px", borderRadius: 7, border: "none", cursor: "pointer", background: "rgba(99,102,241,0.15)", color: "#a5b4fc", fontSize: 12, fontFamily: "sans-serif", fontWeight: 600 }}>✏️ Editar</button>
                          <button onClick={() => { saveSystemUsers(systemUsers.filter(x => x.id !== u.id)); showToast("Usuário removido."); }} style={{ padding: "5px 12px", borderRadius: 7, border: "none", cursor: "pointer", background: "rgba(239,68,68,0.12)", color: "#f87171", fontSize: 12, fontFamily: "sans-serif", fontWeight: 600 }}>🗑️</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Modal criar/editar usuário */}
            {showUserModal && (
              <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
                <div onClick={() => setShowUserModal(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(5px)" }} />
                <div style={{ position: "relative", width: "100%", maxWidth: 500, background: "#1a2640", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 20, padding: "28px 26px 24px", boxShadow: "0 25px 60px rgba(0,0,0,0.6)", maxHeight: "90vh", overflowY: "auto" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
                    <div style={{ fontSize: 17, fontWeight: "bold" }}>{editingUser ? "✏️ Editar Usuário" : "👤 Novo Usuário"}</div>
                    <button onClick={() => setShowUserModal(false)} style={{ width: 32, height: 32, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.07)", color: "#94a3b8", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 14, fontFamily: "sans-serif" }}>
                    {/* Nome e usuário */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Nome *</label>
                        <input value={userForm.name} onChange={e => setUserForm(f => ({...f, name: e.target.value}))} placeholder="Nome completo" style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "11px 14px", color: "#f1f5f9", fontSize: 14, outline: "none" }} />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Usuário (login) *</label>
                        <input value={userForm.user} onChange={e => setUserForm(f => ({...f, user: e.target.value}))} placeholder="ex: coord.ana" style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "11px 14px", color: "#f1f5f9", fontSize: 14, outline: "none" }} />
                      </div>
                    </div>

                    {/* Perfil */}
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Perfil *</label>
                      <select value={userForm.role} onChange={e => setUserForm(f => ({...f, role: e.target.value}))} style={{ width: "100%", background: "#1e293b", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "11px 14px", color: "#f1f5f9", fontSize: 14, outline: "none", cursor: "pointer" }}>
                        <option value="Diretor">Diretor</option>
                        <option value="Coordenador">Coordenador</option>
                        <option value="Secretário(a)">Secretário(a)</option>
                        <option value="Assistente Administrativo">Assistente Administrativo</option>
                      </select>
                    </div>

                    {/* Senha */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>{editingUser ? "Nova Senha" : "Senha *"}</label>
                        <input type="password" value={userForm.pass} onChange={e => setUserForm(f => ({...f, pass: e.target.value}))} placeholder={editingUser ? "Deixe vazio para manter" : "Mínimo 6 caracteres"} style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "11px 14px", color: "#f1f5f9", fontSize: 14, outline: "none" }} />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Confirmar</label>
                        <input type="password" value={userForm.pass2} onChange={e => setUserForm(f => ({...f, pass2: e.target.value}))} placeholder="Repita a senha" style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "11px 14px", color: "#f1f5f9", fontSize: 14, outline: "none" }} />
                      </div>
                    </div>

                    {/* Permissões */}
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 10 }}>🔐 Permissões de Acesso</label>
                      <div style={{ display: "grid", gap: 8 }}>
                        {[
                          { key: "registro",       icon: "📝", label: "Lançar Presença",       desc: "Pode registrar frequência dos funcionários" },
                          { key: "relatorio",      icon: "📊", label: "Ver Relatórios",         desc: "Acesso à aba de relatórios e exportação PDF" },
                          { key: "justificativas", icon: "📋", label: "Gerenciar Justificativas",desc: "Pode aprovar e reprovar justificativas" },
                          { key: "cadastro",       icon: "👥", label: "Cadastrar Funcionários", desc: "Pode adicionar, editar e remover funcionários" },
                          { key: "escola",         icon: "🏫", label: "Editar Dados da Escola", desc: "Pode editar nome, cidade e informações da escola" },
                        ].map(({ key, icon, label, desc }) => {
                          const active = userForm.permissions[key];
                          return (
                            <div key={key} onClick={() => setUserForm(f => ({...f, permissions: {...f.permissions, [key]: !f.permissions[key]}}))} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, cursor: "pointer", background: active ? "rgba(99,102,241,0.12)" : "rgba(255,255,255,0.04)", border: `1px solid ${active ? "rgba(99,102,241,0.4)" : "rgba(255,255,255,0.08)"}`, transition: "all 0.15s" }}>
                              <div style={{ width: 36, height: 36, borderRadius: 8, background: active ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{icon}</div>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: active ? "#e2e8f0" : "#94a3b8" }}>{label}</div>
                                <div style={{ fontSize: 11, color: "#475569", marginTop: 1 }}>{desc}</div>
                              </div>
                              <div style={{ width: 20, height: 20, borderRadius: "50%", border: `2px solid ${active ? "#6366f1" : "#334155"}`, background: active ? "#6366f1" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s" }}>
                                {active && <span style={{ color: "#fff", fontSize: 12, lineHeight: 1 }}>✓</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {userFormError && <div style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#f87171" }}>⚠️ {userFormError}</div>}

                    <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                      <button onClick={() => setShowUserModal(false)} style={{ flex: 1, padding: "11px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "#94a3b8", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
                      <button onClick={() => {
                        if (!userForm.name.trim()) { setUserFormError("Informe o nome."); return; }
                        if (!userForm.user.trim()) { setUserFormError("Informe o usuário de login."); return; }
                        if (!editingUser && userForm.pass.length < 6) { setUserFormError("A senha deve ter pelo menos 6 caracteres."); return; }
                        if (userForm.pass && userForm.pass !== userForm.pass2) { setUserFormError("As senhas não coincidem."); return; }
                        const conflict = systemUsers.find(u => u.user.toLowerCase() === userForm.user.trim().toLowerCase() && (!editingUser || u.id !== editingUser.id));
                        if (conflict) { setUserFormError("Esse usuário de login já existe."); return; }
                        if (userForm.user.trim().toLowerCase() === credentials.user.toLowerCase()) { setUserFormError("Esse usuário já pertence ao Gestor."); return; }
                        setUserFormError("");
                        // Hash password before saving
                        const saveUser = async () => {
                          const passHash = userForm.pass ? await hashPassword(userForm.pass) : null;
                          if (editingUser) {
                            const updated = systemUsers.map(u => u.id === editingUser.id ? { ...u, name: userForm.name.trim(), user: userForm.user.trim(), role: userForm.role, permissions: userForm.permissions, ...(passHash ? { pass: passHash } : {}) } : u);
                            saveSystemUsers(updated);
                            showToast("Usuário atualizado!");
                          } else {
                            saveSystemUsers([...systemUsers, { id: genId(), name: userForm.name.trim(), user: userForm.user.trim(), pass: passHash, role: userForm.role, permissions: userForm.permissions }]);
                            showToast("Usuário criado!");
                          }
                          setShowUserModal(false);
                        };
                        saveUser();
                      }} style={{ flex: 2, padding: "11px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 15px rgba(99,102,241,0.4)" }}>
                        {editingUser ? "💾 Salvar Alterações" : "✓ Criar Usuário"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

          {/* Modal Confirmar Exclusão de Justificativa */}
          {deleteJustConfirm && (
            <div style={{ position: "fixed", inset: 0, zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
              <div onClick={() => setDeleteJustConfirm(null)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }} />
              <div style={{ position: "relative", background: "#1a2640", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 16, padding: "28px 24px", maxWidth: 380, width: "100%", boxShadow: "0 20px 50px rgba(0,0,0,0.5)" }}>
                <div style={{ fontSize: 36, textAlign: "center", marginBottom: 12 }}>🗑️</div>
                <div style={{ fontSize: 16, fontWeight: 700, textAlign: "center", marginBottom: 8, fontFamily: "sans-serif" }}>Excluir justificativa?</div>
                <div style={{ fontSize: 13, color: "#94a3b8", textAlign: "center", marginBottom: 24, fontFamily: "sans-serif" }}>Essa ação não pode ser desfeita.</div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => setDeleteJustConfirm(null)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#94a3b8", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "sans-serif" }}>Cancelar</button>
                  <button onClick={() => { removerJustificativa(deleteJustConfirm); setDeleteJustConfirm(null); }} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#ef4444,#dc2626)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "sans-serif" }}>Excluir</button>
                </div>
              </div>
            </div>
          )}
          </div>
        )}

      {/* ══ MODAL EDITAR ESCOLA ══ */}
      {showSchoolModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={() => setShowSchoolModal(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(5px)" }} />
          <div style={{ position: "relative", width: "100%", maxWidth: 520, background: "#1a2640", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 20, padding: "28px 26px 24px", boxShadow: "0 25px 60px rgba(0,0,0,0.6)", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: "bold" }}>🏫 Editar Dados da Escola</div>
                <div style={{ fontFamily: "sans-serif", fontSize: 12, color: "#64748b", marginTop: 2 }}>Aparece no cabeçalho e nas mensagens do WhatsApp</div>
              </div>
              <button onClick={() => setShowSchoolModal(false)} style={{ width: 32, height: 32, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.07)", color: "#94a3b8", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
            </div>

            {/* Logo */}
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 22, padding: "16px", background: "rgba(255,255,255,0.03)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)" }}>
              {schoolForm.logo
                ? <img src={schoolForm.logo} alt="logo" style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover", border: "2px solid rgba(99,102,241,0.4)" }} />
                : <div style={{ width: 56, height: 56, borderRadius: 10, background: "rgba(99,102,241,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>🏫</div>
              }
              <div>
                <div style={{ fontFamily: "sans-serif", fontSize: 13, fontWeight: 600, color: "#e2e8f0", marginBottom: 6 }}>Logo da Escola</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => logoInputRef.current.click()} style={{ padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer", background: "rgba(99,102,241,0.2)", color: "#a5b4fc", fontSize: 12, fontFamily: "sans-serif", fontWeight: 600 }}>📁 Escolher</button>
                  {schoolForm.logo && <button onClick={() => setSchoolForm(f => ({ ...f, logo: "" }))} style={{ padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer", background: "rgba(239,68,68,0.15)", color: "#f87171", fontSize: 12, fontFamily: "sans-serif", fontWeight: 600 }}>✗ Remover</button>}
                </div>
                <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoChange} style={{ display: "none" }} />
              </div>
            </div>

            <div style={{ display: "grid", gap: 14 }}>
              <Field label="Nome da Escola" value={schoolForm.name} onChange={v => setSchoolForm(f => ({ ...f, name: v }))} placeholder="Ex: Escola Municipal João da Silva" required />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Cidade / UF" value={schoolForm.city} onChange={v => setSchoolForm(f => ({ ...f, city: v }))} placeholder="Ex: São Paulo - SP" />
                <Field label="Telefone" value={schoolForm.phone} onChange={v => setSchoolForm(f => ({ ...f, phone: v }))} placeholder="(00) 0000-0000" type="tel" />
              </div>
              <Field label="Endereço" value={schoolForm.address} onChange={v => setSchoolForm(f => ({ ...f, address: v }))} placeholder="Rua, número, bairro" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="E-mail da Escola" value={schoolForm.email} onChange={v => setSchoolForm(f => ({ ...f, email: v }))} placeholder="escola@email.com" type="email" />
                <Field label="Diretor(a)" value={schoolForm.director} onChange={v => setSchoolForm(f => ({ ...f, director: v }))} placeholder="Nome do(a) diretor(a)" />
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <button onClick={() => setShowSchoolModal(false)} style={{ flex: 1, padding: "11px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "#94a3b8", fontSize: 13, fontWeight: 600, fontFamily: "sans-serif", cursor: "pointer" }}>Cancelar</button>
                <button onClick={handleSchoolSave} style={{ flex: 2, padding: "11px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: "sans-serif", cursor: "pointer", boxShadow: "0 4px 15px rgba(99,102,241,0.4)" }}>💾 Salvar Dados</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL CADASTRO FORM ══ */}
      {showForm && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={() => setShowForm(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(5px)" }} />
          <div style={{ position: "relative", width: "100%", maxWidth: 480, background: "#1a2640", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 20, padding: "28px 26px 24px", boxShadow: "0 25px 60px rgba(0,0,0,0.6)", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: "bold" }}>{editingEmp ? "Editar Funcionário" : "Novo Funcionário"}</div>
                <div style={{ fontFamily: "sans-serif", fontSize: 12, color: "#64748b", marginTop: 2 }}>Preencha os dados abaixo</div>
              </div>
              <button onClick={() => setShowForm(false)} style={{ width: 32, height: 32, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.07)", color: "#94a3b8", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
            </div>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
              <div style={{ width: 66, height: 66, borderRadius: "50%", background: editingEmp ? avatarColor(editingEmp.id) : "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: "bold", border: "3px solid rgba(99,102,241,0.5)" }}>
                {form.name ? getInitials(form.name) : "?"}
              </div>
            </div>
            {IS_APOIO(form.role) && (
              <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontFamily: "sans-serif", fontSize: 12, color: "#fcd34d", display: "flex", gap: 8 }}>
                <span>🌅</span><span>A frequência será registrada separadamente para <strong>manhã</strong> e <strong>tarde</strong>.</span>
              </div>
            )}
            <div style={{ display: "grid", gap: 14 }}>
              <Field label="Nome Completo" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Ex: Maria da Silva" required />
              <Field label="Cargo" value={form.role} onChange={v => setForm(f => ({ ...f, role: v }))} as="select" required />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Telefone / WhatsApp" value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} placeholder="(00) 00000-0000" type="tel" />
                <Field label="E-mail" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} placeholder="email@escola.com" type="email" />
              </div>
              <Toggle label="Funcionário Ativo" sub="Aparece na lista de frequência" value={form.active} onChange={v => setForm(f => ({ ...f, active: v }))} />
              {formError && <div style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "10px 14px", fontFamily: "sans-serif", fontSize: 13, color: "#f87171" }}>⚠️ {formError}</div>}
              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <button onClick={() => setShowForm(false)} style={{ flex: 1, padding: "11px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "#94a3b8", fontSize: 13, fontWeight: 600, fontFamily: "sans-serif", cursor: "pointer" }}>Cancelar</button>
                <button onClick={handleFormSubmit} style={{ flex: 2, padding: "11px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: "sans-serif", cursor: "pointer", boxShadow: "0 4px 15px rgba(99,102,241,0.4)" }}>
                  {editingEmp ? "💾 Salvar Alterações" : "✓ Cadastrar Funcionário"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL ALTERAR CREDENCIAIS ══ */}
      {showChangeCreds && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={() => setShowChangeCreds(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(5px)" }} />
          <div style={{ position: "relative", width: "100%", maxWidth: 400, background: "#1a2640", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 20, padding: "28px 26px 24px", boxShadow: "0 25px 60px rgba(0,0,0,0.6)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
              <div style={{ fontSize: 17, fontWeight: "bold", color: "#f1f5f9" }}>🔑 Alterar Credenciais</div>
              <button onClick={() => setShowChangeCreds(false)} style={{ width: 32, height: 32, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.07)", color: "#94a3b8", cursor: "pointer", fontSize: 18 }}>×</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, fontFamily: "sans-serif" }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Novo Usuário</label>
                <input type="text" value={newUser} onChange={e => setNewUser(e.target.value)} placeholder="Digite o novo usuário" style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "11px 14px", color: "#f1f5f9", fontSize: 14, outline: "none" }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Nova Senha</label>
                <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="Mínimo 6 caracteres" style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "11px 14px", color: "#f1f5f9", fontSize: 14, outline: "none" }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Confirmar Nova Senha</label>
                <input type="password" value={newPass2} onChange={e => setNewPass2(e.target.value)} placeholder="Repita a senha" style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "11px 14px", color: "#f1f5f9", fontSize: 14, outline: "none" }} />
              </div>
              {loginError && (
                <div style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#f87171" }}>⚠️ {loginError}</div>
              )}
              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <button onClick={() => setShowChangeCreds(false)} style={{ flex: 1, padding: "11px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "#94a3b8", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
                <button onClick={handleChangeCreds} style={{ flex: 2, padding: "11px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 15px rgba(99,102,241,0.4)" }}>💾 Salvar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL CONFIRMAR EXCLUSÃO ══ */}
      {deleteConfirm && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={() => setDeleteConfirm(null)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(5px)" }} />
          <div style={{ position: "relative", width: "100%", maxWidth: 370, background: "#1a2640", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 18, padding: "28px 24px", boxShadow: "0 25px 60px rgba(0,0,0,0.6)", textAlign: "center" }}>
            <div style={{ fontSize: 42, marginBottom: 12 }}>⚠️</div>
            <div style={{ fontSize: 17, fontWeight: "bold", marginBottom: 8 }}>Remover Funcionário?</div>
            <div style={{ fontFamily: "sans-serif", fontSize: 13, color: "#94a3b8", marginBottom: 22 }}>Esta ação removerá todos os registros de frequência. Não pode ser desfeita.</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setDeleteConfirm(null)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "#94a3b8", fontSize: 13, fontWeight: 600, fontFamily: "sans-serif", cursor: "pointer" }}>Cancelar</button>
              <button onClick={() => handleDelete(deleteConfirm)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: "#ef4444", color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: "sans-serif", cursor: "pointer" }}>Sim, Remover</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
