import { useState } from "react";

const COLORS = {
  bg: "#1A1D23",
  card: "#22262E",
  cardHover: "#2A2F38",
  border: "#363B44",
  accent: "#0073EA",
  accentLight: "#0073EA22",
  green: "#00CA72",
  greenLight: "#00CA7222",
  red: "#E2445C",
  redLight: "#E2445C22",
  orange: "#FDAB3D",
  orangeLight: "#FDAB3D22",
  purple: "#A25DDC",
  purpleLight: "#A25DDC22",
  text: "#F5F6F8",
  textMuted: "#9699A0",
  textDim: "#676879",
};

const files = [
  {
    id: "index",
    name: "index.js",
    icon: "📦",
    color: COLORS.accent,
    colorLight: COLORS.accentLight,
    description: "נקודת הכניסה — מייצא הכל ממקום אחד",
    exports: [
      "mondayApi", "createMondayApiService", "API_VERSION",
      "logger", "createLogger",
      "errorHandler", "createErrorHandler", "ERROR_CODES", "MSG_HE", "MSG_EN",
      "ErrorBanner", "useErrorHandler",
    ],
  },
  {
    id: "mondayApi",
    name: "mondayApi.js",
    icon: "🔌",
    color: COLORS.accent,
    colorLight: COLORS.accentLight,
    description: "שירות API מאוחד — עוטף את שני ה-SDKs של Monday",
    sections: [
      {
        title: "Init",
        methods: [
          { name: "init(options)", desc: "אתחול שני SDKs + context + Supabase", badge: "async" },
        ],
      },
      {
        title: "Getters",
        methods: [
          { name: "monday", desc: "monday-sdk-js instance" },
          { name: "apiClient", desc: "SeamlessApiClient instance" },
          { name: "context", desc: "boardId, user, theme..." },
          { name: "boardId", desc: "מזהה הלוח הנוכחי" },
          { name: "user", desc: "המשתמש המחובר" },
          { name: "theme", desc: "light / dark / black" },
        ],
      },
      {
        title: "GraphQL",
        methods: [
          { name: "query(query, vars, opts)", desc: "ביצוע שאילתת GraphQL עם retry אוטומטי", badge: "async" },
        ],
      },
      {
        title: "Items CRUD",
        methods: [
          { name: "getItems(boardId, opts)", desc: "קריאת פריטים עם pagination", badge: "async" },
          { name: "getAllItems(boardId, opts)", desc: "כל הפריטים (auto-paginate)", badge: "async" },
          { name: "createItem(boardId, name, cols)", desc: "יצירת פריט חדש", badge: "async" },
          { name: "updateColumnValue(boardId, itemId, colId, val)", desc: "עדכון ערך עמודה (JSON)", badge: "async" },
          { name: "updateSimpleColumnValue(...)", desc: "עדכון ערך פשוט (טקסט/מספר)", badge: "async" },
          { name: "updateMultipleColumnValues(...)", desc: "עדכון מספר עמודות בבת אחת", badge: "async" },
          { name: "deleteItem(itemId)", desc: "מחיקת פריט", badge: "async" },
        ],
      },
      {
        title: "Board & Subitems",
        methods: [
          { name: "getBoard(boardId)", desc: "מטא-דאטה של הלוח (עמודות, קבוצות)", badge: "async" },
          { name: "createSubitem(parentId, name, cols)", desc: "יצירת תת-פריט", badge: "async" },
        ],
      },
      {
        title: "UI Helpers",
        methods: [
          { name: "notice(msg, type, timeout)", desc: "הודעת toast למשתמש", badge: "async" },
          { name: "confirm(msg, ok, cancel)", desc: "דיאלוג אישור", badge: "async" },
          { name: "onSettingsChange(cb)", desc: "האזנה לשינויי הגדרות" },
          { name: "onContextChange(cb)", desc: "האזנה לשינויי context" },
          { name: "getSettings()", desc: "קריאת הגדרות נוכחיות", badge: "async" },
        ],
      },
      {
        title: "Storage",
        methods: [
          { name: "storageGet(key)", desc: "קריאה מ-monday.storage", badge: "async" },
          { name: "storageSet(key, value)", desc: "כתיבה ל-monday.storage", badge: "async" },
        ],
      },
    ],
  },
  {
    id: "errorHandler",
    name: "errorHandler.js",
    icon: "🛡️",
    color: COLORS.red,
    colorLight: COLORS.redLight,
    description: "סיווג שגיאות, retry אוטומטי, הודעות למשתמש בעברית/אנגלית",
    sections: [
      {
        title: "Config",
        methods: [
          { name: "setMondayInstance(monday)", desc: "חיבור monday SDK להודעות" },
          { name: "setLanguage('he' | 'en')", desc: "שפת הודעות שגיאה" },
        ],
      },
      {
        title: "Core",
        methods: [
          { name: "handle(error, meta)", desc: "סיווג שגיאה → ErrorResult", returnType: "ErrorResult" },
          { name: "withRetry(fn, opts)", desc: "ביצוע עם retry אוטומטי על rate limits", badge: "async" },
          { name: "resetFailures(operation)", desc: "איפוס מונה כשלונות (אחרי הצלחה)" },
        ],
      },
      {
        title: "Error Categories",
        methods: [
          { name: "rate_limit", desc: "429 — COMPLEXITY, RATE_LIMIT, CONCURRENCY, IP", badge: "retryable" },
          { name: "auth", desc: "401/403 — UNAUTHORIZED, ACCESS_DENIED, PERMISSIONS", badge: "not retryable" },
          { name: "validation", desc: "200 — COLUMN_VALUE, INVALID_ID, PARSE_ERROR", badge: "not retryable" },
          { name: "server", desc: "500 — INTERNAL_SERVER_ERROR", badge: "retryable" },
          { name: "network", desc: "אין חיבור / timeout", badge: "retryable" },
        ],
      },
      {
        title: "ErrorResult Object",
        methods: [
          { name: "category", desc: "'rate_limit' | 'auth' | 'validation' | 'server' | 'network'" },
          { name: "code", desc: "קוד שגיאה של Monday (e.g. 'ColumnValueException')" },
          { name: "userMessage", desc: "הודעה ידידותית בעברית/אנגלית" },
          { name: "requestId", desc: "מזהה בקשה מ-Monday (לתמיכה)" },
          { name: "shouldRetry / canRetry", desc: "האם ניתן לנסות שוב" },
          { name: "retryAfterMs", desc: "כמה לחכות לפני retry" },
          { name: "consecutiveFailures", desc: "מספר כשלונות רצופים" },
          { name: "showSendReport", desc: "true אחרי 2+ כשלונות → הצג כפתור דיווח" },
        ],
      },
    ],
  },
  {
    id: "logger",
    name: "logger.js",
    icon: "📝",
    color: COLORS.orange,
    colorLight: COLORS.orangeLight,
    description: "לוגר מדורג + שליחה ידנית ל-Supabase (רק כשמשתמש לוחץ)",
    sections: [
      {
        title: "Config",
        methods: [
          { name: "initSupabase(url, key, opts)", desc: "הגדרת חיבור Supabase (לא שולח אוטומטית!)" },
          { name: "setLevel(level)", desc: "debug | info | warn | error | silent" },
          { name: "setContext(ctx)", desc: "הוספת userId, accountId, boardId לכל לוג" },
        ],
      },
      {
        title: "Log Methods",
        methods: [
          { name: "debug(msg, data)", desc: "מידע מפורט לפיתוח" },
          { name: "info(msg, data)", desc: "הודעות תפעוליות" },
          { name: "warn(msg, data)", desc: "אזהרות" },
          { name: "error(msg, data)", desc: "שגיאות" },
        ],
      },
      {
        title: "Monday API Logging",
        methods: [
          { name: "apiRequest(operation, vars)", desc: "לוג לפני קריאת API" },
          { name: "apiResponse(operation, res, ms)", desc: "לוג אחרי תגובה + request_id" },
          { name: "apiError(operation, error)", desc: "לוג שגיאת API + request_id" },
          { name: "rateLimit(code, seconds)", desc: "לוג אירוע rate limit" },
        ],
      },
      {
        title: "History & Reporting",
        methods: [
          { name: "getHistory(count)", desc: "כל היסטוריית הלוגים בזיכרון" },
          { name: "getErrorHistory(count)", desc: "רק שגיאות ואזהרות" },
          { name: "sendErrorReport(opts)", desc: "שליחה ל-Supabase — רק בלחיצת משתמש!", badge: "async → Supabase" },
          { name: "exportHistory()", desc: "JSON string לדיבוג" },
        ],
      },
    ],
  },
  {
    id: "errorBanner",
    name: "ErrorBanner.jsx",
    icon: "🎨",
    color: COLORS.purple,
    colorLight: COLORS.purpleLight,
    description: "קומפוננטת React — UX דו-שלבי לטיפול בשגיאות",
    sections: [
      {
        title: "Hook",
        methods: [
          { name: "useErrorHandler(opts)", desc: "React hook → { error, handleError, clearError, retry }", returnType: "Hook" },
        ],
      },
      {
        title: "Component",
        methods: [
          { name: "<ErrorBanner error onRetry onDismiss />", desc: "באנר שגיאה עם RTL + עברית" },
        ],
      },
      {
        title: "UX Flow",
        methods: [
          { name: "שלב 1 — כישלון ראשון", desc: "⚠️ 'משהו השתבש' + כפתור 'נסה שוב'", badge: "step 1" },
          { name: "שלב 2 — כישלון שני", desc: "⚠️ + כפתור 'שלח פרטי תקלה' → Supabase", badge: "step 2" },
          { name: "שלב 3 — נשלח בהצלחה", desc: "✅ 'נשלח בהצלחה! צוות הפיתוח יבדוק'", badge: "done" },
        ],
      },
    ],
  },
  {
    id: "supabase",
    name: "supabase-setup.sql",
    icon: "🗄️",
    color: COLORS.green,
    colorLight: COLORS.greenLight,
    description: "SQL להקמת טבלה ב-Supabase עם RLS — INSERT בלבד מהקליינט",
    sections: [
      {
        title: "Table: error_logs",
        methods: [
          { name: "id, timestamp, level, message", desc: "שדות בסיס" },
          { name: "user_id, account_id, board_id", desc: "Monday context" },
          { name: "request_id, error_code, operation", desc: "פרטי שגיאה" },
          { name: "report_id, user_note", desc: "קיבוץ דיווחים" },
          { name: "data (JSONB)", desc: "payload מלא" },
        ],
      },
      {
        title: "RLS Policies",
        methods: [
          { name: "INSERT → anon", desc: "כל משתמש יכול לכתוב (anon key)", badge: "public" },
          { name: "SELECT → authenticated (your UUID)", desc: "רק אתה יכול לקרוא", badge: "private" },
          { name: "UPDATE / DELETE → nobody", desc: "לוגים לא ניתנים לשינוי", badge: "blocked" },
        ],
      },
    ],
  },
];

function Badge({ text, color }) {
  const bgMap = {
    async: COLORS.accentLight,
    retryable: COLORS.greenLight,
    "not retryable": COLORS.redLight,
    "async → Supabase": COLORS.greenLight,
    "step 1": COLORS.orangeLight,
    "step 2": COLORS.redLight,
    done: COLORS.greenLight,
    public: COLORS.greenLight,
    private: COLORS.orangeLight,
    blocked: COLORS.redLight,
  };
  const fgMap = {
    async: COLORS.accent,
    retryable: COLORS.green,
    "not retryable": COLORS.red,
    "async → Supabase": COLORS.green,
    "step 1": COLORS.orange,
    "step 2": COLORS.red,
    done: COLORS.green,
    public: COLORS.green,
    private: COLORS.orange,
    blocked: COLORS.red,
  };
  return (
    <span
      style={{
        background: bgMap[text] || COLORS.accentLight,
        color: fgMap[text] || COLORS.accent,
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 6px",
        borderRadius: 4,
        marginRight: 6,
        whiteSpace: "nowrap",
        fontFamily: "monospace",
      }}
    >
      {text}
    </span>
  );
}

function FileCard({ file, isExpanded, onToggle }) {
  return (
    <div
      style={{
        background: isExpanded ? COLORS.cardHover : COLORS.card,
        border: `1px solid ${isExpanded ? file.color : COLORS.border}`,
        borderRadius: 10,
        overflow: "hidden",
        transition: "all 0.2s",
        cursor: "pointer",
      }}
    >
      <div
        onClick={onToggle}
        style={{
          padding: "14px 18px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span style={{ fontSize: 22 }}>{file.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: COLORS.text, fontFamily: "monospace" }}>
            {file.name}
          </div>
          <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 2, direction: "rtl", textAlign: "right" }}>
            {file.description}
          </div>
        </div>
        <span
          style={{
            color: file.color,
            fontSize: 18,
            fontWeight: 700,
            transition: "transform 0.2s",
            transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
          }}
        >
          ▶
        </span>
      </div>

      {isExpanded && file.sections && (
        <div style={{ padding: "0 18px 16px 18px" }}>
          {file.sections.map((section, si) => (
            <div key={si} style={{ marginTop: si === 0 ? 0 : 14 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 1.2,
                  color: file.color,
                  marginBottom: 6,
                  paddingBottom: 4,
                  borderBottom: `1px solid ${COLORS.border}`,
                }}
              >
                {section.title}
              </div>
              {section.methods.map((m, mi) => (
                <div
                  key={mi}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    padding: "5px 0",
                    borderBottom: mi < section.methods.length - 1 ? `1px solid ${COLORS.bg}` : "none",
                  }}
                >
                  <code
                    style={{
                      fontSize: 12,
                      color: COLORS.text,
                      fontFamily: "monospace",
                      flexShrink: 0,
                      maxWidth: "55%",
                      wordBreak: "break-all",
                    }}
                  >
                    {m.name}
                  </code>
                  <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, direction: "rtl" }}>
                    {m.badge && <Badge text={m.badge} />}
                    <span style={{ fontSize: 11, color: COLORS.textDim, textAlign: "right" }}>{m.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {isExpanded && file.exports && (
        <div style={{ padding: "0 18px 16px 18px" }}>
          <div
            style={{
              fontSize: 11, fontWeight: 700, textTransform: "uppercase",
              letterSpacing: 1.2, color: file.color, marginBottom: 6,
              paddingBottom: 4, borderBottom: `1px solid ${COLORS.border}`,
            }}
          >
            EXPORTS
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {file.exports.map((e, i) => (
              <code
                key={i}
                style={{
                  fontSize: 11, background: file.colorLight,
                  color: file.color, padding: "3px 8px",
                  borderRadius: 4, fontFamily: "monospace",
                }}
              >
                {e}
              </code>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FlowDiagram() {
  const steps = [
    { icon: "🔌", label: "mondayApi.query()", sub: "קריאת API", color: COLORS.accent },
    { icon: "⚡", label: "SeamlessApiClient", sub: "ללא טוקן", color: COLORS.accent },
    { icon: "❌", label: "שגיאה?", sub: "catch", color: COLORS.red },
    { icon: "🔄", label: "errorHandler.withRetry()", sub: "retry אוטומטי על rate limits", color: COLORS.orange },
    { icon: "⚠️", label: "ErrorBanner שלב 1", sub: "\"משהו השתבש\" + נסה שוב", color: COLORS.orange },
    { icon: "🔄", label: "משתמש לוחץ נסה שוב", sub: "כישלון נוסף", color: COLORS.red },
    { icon: "📨", label: "ErrorBanner שלב 2", sub: "\"שלח פרטי תקלה\"", color: COLORS.red },
    { icon: "🗄️", label: "Supabase INSERT", sub: "רק עכשיו נשלח!", color: COLORS.green },
  ];

  return (
    <div style={{ margin: "20px 0", direction: "rtl" }}>
      <div style={{
        fontSize: 13, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: 1.2, color: COLORS.textMuted, marginBottom: 12,
      }}>
        תהליך טיפול בשגיאות
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {steps.map((step, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: "50%",
              background: step.color + "22", border: `2px solid ${step.color}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, flexShrink: 0,
            }}>
              {step.icon}
            </div>
            {i < steps.length - 1 && (
              <div style={{
                position: "absolute", marginRight: 16, marginTop: 38,
                width: 2, height: 10, background: COLORS.border,
              }} />
            )}
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>{step.label}</div>
              <div style={{ fontSize: 11, color: COLORS.textDim }}>{step.sub}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DependencyGraph() {
  const deps = [
    { from: "index.js", to: "mondayApi.js", color: COLORS.accent },
    { from: "index.js", to: "errorHandler.js", color: COLORS.red },
    { from: "index.js", to: "logger.js", color: COLORS.orange },
    { from: "index.js", to: "ErrorBanner.jsx", color: COLORS.purple },
    { from: "mondayApi.js", to: "logger.js", color: COLORS.orange },
    { from: "mondayApi.js", to: "errorHandler.js", color: COLORS.red },
    { from: "mondayApi.js", to: "monday-sdk-js", color: COLORS.textDim, external: true },
    { from: "mondayApi.js", to: "@mondaydotcomorg/api", color: COLORS.textDim, external: true },
    { from: "errorHandler.js", to: "logger.js", color: COLORS.orange },
    { from: "ErrorBanner.jsx", to: "errorHandler.js", color: COLORS.red },
    { from: "ErrorBanner.jsx", to: "logger.js", color: COLORS.orange },
    { from: "logger.js", to: "Supabase REST API", color: COLORS.green, external: true },
  ];

  return (
    <div style={{ margin: "20px 0", direction: "rtl" }}>
      <div style={{
        fontSize: 13, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: 1.2, color: COLORS.textMuted, marginBottom: 12,
      }}>
        תלויות בין קבצים
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {deps.map((d, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontFamily: "monospace" }}>
            <span style={{ color: COLORS.text, minWidth: 130 }}>{d.from}</span>
            <span style={{ color: d.color }}>→</span>
            <span style={{ color: d.external ? COLORS.textDim : COLORS.text, fontStyle: d.external ? "italic" : "normal" }}>
              {d.to}
            </span>
            {d.external && <span style={{ fontSize: 9, color: COLORS.textDim, background: COLORS.border, padding: "1px 5px", borderRadius: 3 }}>external</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PackageArchitecture() {
  const [expanded, setExpanded] = useState(new Set(["mondayApi"]));
  const [tab, setTab] = useState("files");

  const toggle = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(files.map((f) => f.id)));
  const collapseAll = () => setExpanded(new Set());

  return (
    <div style={{
      background: COLORS.bg, minHeight: "100vh", padding: "24px 20px",
      fontFamily: "'Figtree', 'Segoe UI', sans-serif", color: COLORS.text,
    }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: COLORS.text, direction: "rtl" }}>
          📦 Monday.com Services — מבנה החבילה
        </h1>
        <p style={{ fontSize: 13, color: COLORS.textMuted, margin: "6px 0 0", direction: "rtl" }}>
          API version 2026-01 • Client-side only • Supabase error reporting
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, justifyContent: "center" }}>
        {[
          { id: "files", label: "📂 קבצים ופונקציות" },
          { id: "flow", label: "🔄 תהליך שגיאות" },
          { id: "deps", label: "🔗 תלויות" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: tab === t.id ? COLORS.accent : COLORS.card,
              color: tab === t.id ? "white" : COLORS.textMuted,
              border: `1px solid ${tab === t.id ? COLORS.accent : COLORS.border}`,
              borderRadius: 6, padding: "8px 16px", fontSize: 13,
              fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              direction: "rtl",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === "files" && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, justifyContent: "center" }}>
            <button onClick={expandAll} style={{ background: "none", border: `1px solid ${COLORS.border}`, color: COLORS.textMuted, borderRadius: 4, padding: "4px 12px", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
              פתח הכל
            </button>
            <button onClick={collapseAll} style={{ background: "none", border: `1px solid ${COLORS.border}`, color: COLORS.textMuted, borderRadius: 4, padding: "4px 12px", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
              סגור הכל
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 700, margin: "0 auto" }}>
            {files.map((file) => (
              <FileCard key={file.id} file={file} isExpanded={expanded.has(file.id)} onToggle={() => toggle(file.id)} />
            ))}
          </div>
        </>
      )}

      {tab === "flow" && (
        <div style={{ maxWidth: 500, margin: "0 auto" }}>
          <FlowDiagram />
        </div>
      )}

      {tab === "deps" && (
        <div style={{ maxWidth: 500, margin: "0 auto" }}>
          <DependencyGraph />
        </div>
      )}

      {/* Footer */}
      <div style={{
        textAlign: "center", marginTop: 32, fontSize: 11, color: COLORS.textDim,
        direction: "rtl",
      }}>
        npm i monday-sdk-js @mondaydotcomorg/api • 6 קבצים • 0 תלויות נוספות (Supabase via fetch)
      </div>
    </div>
  );
}
