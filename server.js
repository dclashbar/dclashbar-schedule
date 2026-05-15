const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { renderIntakeForm } = require('./intake-form');

const CONFIG = {
  port: process.env.PORT || 8080,
  accessCode: process.env.ACCESS_CODE || 'dclash2026',
  useApi: process.env.USE_API === 'true',
  apiKey: process.env.MB_API_KEY || '',
  siteId: process.env.MB_SITE_ID || '-99',
  username: process.env.MB_USERNAME || '',
  password: process.env.MB_PASSWORD || '',
  googleDriveFolder: process.env.GOOGLE_DRIVE_FOLDER || '',
};

const STAFF = {
  'emily': { name: 'Emily Abramson', id: null },
  'hollyn': { name: 'Hollyn Wooldridge', id: null },
  'shauntice': { name: 'Shauntice Skye', id: null },
  'hiba': { name: 'Hiba Fadel', id: null },
};

const LOGO_URL = 'https://images.squarespace-cdn.com/content/v1/572ba1b72fe13138bc8e1fe9/92764f7d-c61c-4ef2-89f9-f0bf8444215a/Transparent+Logo+%282%29.png';

// Booker product variant IDs for inventory sync.
// Each "product" maps to all the step variants that make up its kit — when the
// manager records "Profusion ended at 5", we set BackbarInventory=5 on BOTH
// Profusion step 1 and step 2 (since they're consumed as a pair).
const INVENTORY_PRODUCTS = {
  'One Shot': [
    { label: 'One Shot step 1', productId: 12627635, variantId: 18568173 },
    { label: 'One Shot step 2', productId: 12623182, variantId: 18553876 },
  ],
  'Profusion': [
    { label: 'Profusion 1',     productId: 12621612, variantId: 18550376 },
    { label: 'Profusion 2',     productId: 12623179, variantId: 18553873 },
  ],
  'BBL': [
    { label: 'BBL step 1',      productId: 12623185, variantId: 18553879 },
    { label: 'BBL step 2',      productId: 12627564, variantId: 18567902 },
    { label: 'BBL step 3',      productId: 12623186, variantId: 18553880 },
  ],
};

async function getBookerToken() {
  const res = await fetch(`${process.env.BOOKER_AUTH_BASE}/v5/auth/connect/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Ocp-Apim-Subscription-Key': process.env.BOOKER_MERCHANT_API_KEY,
    },
    body: new URLSearchParams({
      grant_type: 'personal_access_token',
      client_id: process.env.BOOKER_CLIENT_ID,
      client_secret: process.env.BOOKER_CLIENT_SECRET,
      scope: 'merchant',
      personal_access_token: process.env.BOOKER_PAT,
    }),
  });
  if (!res.ok) throw new Error(`Booker token failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function setBackbarInventory(token, productId, variantId, count) {
  const url = `${process.env.BOOKER_API_BASE}/v4.1/merchant/product/${productId}/update?access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Ocp-Apim-Subscription-Key': process.env.BOOKER_MERCHANT_API_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      access_token: token,
      ID: productId,
      Product: {
        ID: productId,
        ProductVariantsToUpdate: [{ ID: variantId, BackbarInventory: count }],
      },
    }),
  });
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { return { ok: false, message: text.slice(0, 200) }; }
  return { ok: j.IsSuccess === true, message: j.ErrorMessage || j.DetailedErrorMessage };
}

// Check if a client has submitted an intake form
function hasIntakeForm(customerName) {
  const intakeDir = path.join(__dirname, 'intakes');
  if (!fs.existsSync(intakeDir)) return false;
  const files = fs.readdirSync(intakeDir).filter(f => f.endsWith('.json'));
  const nameLower = (customerName || '').toLowerCase().replace(/\s+/g, '_');
  return files.some(f => f.toLowerCase().startsWith(nameLower));
}

// Status storage (in-memory, keyed by appointment identifier)
const statusStore = {};

const STATUS_OPTIONS = [
  { value: '', label: 'Not Set', color: '#ccc' },
  { value: 'confirmed', label: 'Confirmed', color: '#3498db' },
  { value: 'arrived', label: 'Arrived', color: '#27ae60' },
  { value: 'in-progress', label: 'In Progress', color: '#f39c12' },
  { value: 'complete', label: 'Complete', color: '#2ecc71' },
  { value: 'no-show', label: 'No Show', color: '#e74c3c' },
];

// --- Data Source ---
let appointmentsData = null;
let emailSummaryData = null;

function loadEmailSummary() {
  const dataFile = path.join(__dirname, 'email-summary.json');
  if (fs.existsSync(dataFile)) {
    try {
      emailSummaryData = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
    } catch (err) {
      console.error('Failed to load email summary:', err.message);
    }
  }
}

function loadAppointmentsData() {
  const dataFile = path.join(__dirname, 'appointments-data.json');
  if (fs.existsSync(dataFile)) {
    try {
      appointmentsData = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
      console.log(`Loaded appointments data from ${appointmentsData.date}`);
    } catch (err) {
      console.error('Failed to load appointments data:', err.message);
    }
  }
}

// Late-chase log lives at ~/booker-reports/data/late-chase-log.json and is
// updated every 5 min by late-guest-chaser.js. Read fresh on each render so
// the dashboard reflects the latest state without restarts.
function loadChaseLog() {
  const candidates = [
    path.join(__dirname, '..', 'data', 'late-chase-log.json'),
    path.join(__dirname, 'data', 'late-chase-log.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return {}; }
    }
  }
  return {};
}

function getStaffAppointments(staffName) {
  if (!appointmentsData || !appointmentsData.staff) return [];
  return appointmentsData.staff[staffName] || [];
}

// --- API functions (for when live API is available) ---
let cachedToken = null;
let tokenExpiry = 0;
let sessionTypeCache = {};

function apiRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.mindbodyonline.com',
      path: `/public/v6/${apiPath}`,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Api-Key': CONFIG.apiKey,
        'SiteId': CONFIG.siteId,
      },
    };
    if (cachedToken) options.headers['Authorization'] = `Bearer ${cachedToken}`;

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Invalid JSON`)); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const result = await apiRequest('POST', 'usertoken/issue', { Username: CONFIG.username, Password: CONFIG.password });
  cachedToken = result.AccessToken;
  tokenExpiry = new Date(result.Expires).getTime() - 60000;
  return cachedToken;
}

// --- HTML Rendering ---

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function renderSchedulePage(staffName, appointments, date) {
  const today = formatDate(date);
  const chaseLog = loadChaseLog();

  let appointmentRows = '';
  if (appointments.length === 0) {
    appointmentRows = `
      <tr>
        <td colspan="5" style="text-align:center; padding:40px; color:#888; font-style:italic;">
          No appointments scheduled for today.
        </td>
      </tr>`;
  } else {
    const staffKey = Object.entries(STAFF).find(([k, s]) => s.name === staffName)?.[0] || '';

    for (const appt of appointments) {
      const customerKey = (appt.customerFirstName || appt.customerName || '').toLowerCase().replace(/\s+/g, '_');

      appointmentRows += `
        <tr class="appointment-row">
          <td style="padding:12px 15px; border-bottom:1px solid #eee; white-space:nowrap;">
            <strong>${(appt.appointmentOn || '').split(/\s{2,}/).pop()}</strong>
          </td>
          <td style="padding:12px 15px; border-bottom:1px solid #eee; max-width:220px; word-wrap:break-word; overflow-wrap:anywhere;">
            ${appt.serviceName || ''}
            ${appt.serviceMismatch ? `<div style="margin-top:4px;font-size:11px;color:#c0392b;background:#fdecea;border:1px solid #f5b7b1;border-radius:6px;padding:2px 6px;display:inline-block;" title="${appt.serviceMismatch.reason}">likely <strong>${appt.serviceMismatch.suggestion}</strong></div>` : ''}
          </td>
          <td style="padding:12px 15px; border-bottom:1px solid #eee;">
            ${appt.customerFirstName || appt.customerName || ''}${appt.firstAppointment ? ' <span style="background:#e67e22;color:white;padding:1px 6px;border-radius:8px;font-size:11px;">NEW</span>' : ''}${(() => {
              const s = appt.status || '';
              if (!s) return '';
              const colors = {
                'Booked': '#95a5a6',
                'Confirmed': '#3498db',
                'Guest Checked-in': '#27ae60',
                'Checked In': '#27ae60',
                'In Service': '#f39c12',
                'Paid/Complete': '#2ecc71',
                'Complete': '#2ecc71',
              };
              const color = colors[s] || '#888';
              return ` <span style="background:${color};color:white;padding:1px 6px;border-radius:8px;font-size:11px;">${s}</span>`;
            })()}${(() => {
              const chase = chaseLog[appt.appointmentId];
              if (!chase) return '';
              const t = new Date(chase.sentAt);
              const hh = t.getHours();
              const mm = String(t.getMinutes()).padStart(2, '0');
              const ampm = hh >= 12 ? 'pm' : 'am';
              const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
              const dryTag = chase.dryRun ? ' (dry-run)' : '';
              return ` <span title="Late-guest message sent${dryTag} at ${h12}:${mm}${ampm}" style="background:#e67e22;color:white;padding:1px 6px;border-radius:8px;font-size:11px;">messaged ${h12}:${mm}${ampm}${chase.dryRun ? '*' : ''}</span>`;
            })()}
            ${appt.customerId ? ` <a href="https://app.secure-booker.com/App/SpaAdmin/Customers/EditCustomer/EditPhotos.aspx?CustomerID=${appt.customerId}" target="_blank" rel="noopener" title="Manage photos in Booker" style="text-decoration:none;font-size:14px;margin-left:4px;" class="no-print">📷</a>` : ''}
            ${(appt.photos && appt.photos.length) ? `
              <div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap;">
                ${appt.photos.map(p => `<a href="${p.url}" target="_blank" rel="noopener" title="${p.uploadedOffset ? p.uploadedOffset.slice(0,10) : ''}"><img src="${p.url}" loading="lazy" style="width:48px;height:48px;object-fit:cover;border-radius:4px;border:1px solid #ddd;display:block;" alt=""></a>`).join('')}
              </div>
            ` : ''}
          </td>
          <td style="padding:12px 15px; border-bottom:1px solid #eee; font-size:13px; color:#555; white-space:nowrap;">
            ${(() => {
              const display = appt.lastVisitDisplay || '';
              if (!display) return '<em style="color:#ccc;">—</em>';
              if (appt.isFirstVisit) return '<span style="color:#e67e22; font-weight:600;">First visit</span>';
              const days = appt.lastVisitDays;
              const color = days >= 35 ? '#e74c3c' : days >= 21 ? '#f39c12' : '#555';
              return `<span style="color:${color};">${display}</span>`;
            })()}
          </td>
          <td style="padding:12px 15px; border-bottom:1px solid #eee;">
            ${(() => {
              const latest = appt.latestProgressNote || '';
              const older = Array.isArray(appt.olderProgressNotes) ? appt.olderProgressNotes : [];
              const legacy = appt.progressNotes || '';
              // No data at all
              if (!latest && older.length === 0 && !legacy) {
                return '<em style="color:#ccc; font-size:13px;">No progress notes</em>';
              }
              // Old-format data file (single string only) — fallback
              if (!latest && legacy) {
                return `<div style="max-height:150px; overflow-y:auto; font-size:13px; color:#555; white-space:pre-wrap;">${legacy}</div>`;
              }
              let html = `<div style="max-height:150px; overflow-y:auto; font-size:13px; color:#555; white-space:pre-wrap;">${latest}</div>`;
              const skipped = appt.sameMarkersSkipped || 0;
              if (skipped > 0) {
                html += `<div style="margin-top:4px; font-size:11px; color:#888; font-style:italic;">Last ${skipped} visit${skipped === 1 ? '' : 's'}: same</div>`;
              }
              if (older.length) {
                const olderHtml = older.join('<hr style="border:none;border-top:1px dashed #ccc;margin:8px 0;">');
                html += `<details style="margin-top:6px;">
                  <summary style="cursor:pointer;color:#3498db;font-size:12px;user-select:none;list-style:none;">+ ${older.length} older note${older.length === 1 ? '' : 's'}</summary>
                  <div style="max-height:240px;overflow-y:auto;margin-top:6px;padding-left:10px;border-left:2px solid #ddd;font-size:12px;color:#777;white-space:pre-wrap;">${olderHtml}</div>
                </details>`;
              }
              return html;
            })()}
          </td>
          <td style="padding:12px 15px; border-bottom:1px solid #eee;">
            <div style="max-height:80px; overflow-y:auto; font-size:13px; color:#555; white-space:pre-wrap; margin-bottom:8px;">${appt.appointmentNotes || appt.notes || '<em style="color:#ccc;">No notes</em>'}</div>
            <form method="POST" action="/add-note" style="display:flex; gap:6px;">
              <input type="hidden" name="staffKey" value="${staffKey}">
              <input type="hidden" name="customerKey" value="${customerKey}">
              <textarea name="newNote" placeholder="Add note..." style="flex:1; padding:6px; border:1px solid #ddd; border-radius:4px; font-size:13px; font-family:inherit; resize:vertical; min-height:36px;"></textarea>
              <button type="submit" style="padding:6px 12px; background:#3498db; color:white; border:none; border-radius:4px; cursor:pointer; font-size:13px; white-space:nowrap;">Add</button>
            </form>
          </td>
        </tr>
`;
    }
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="300">
  <title>${staffName} - Today's Schedule</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; }
    .header { background: linear-gradient(135deg, #2c3e50, #3498db); color: white; padding: 20px 25px; display: flex; justify-content: space-between; align-items: center; }
    .header h1 { font-size: 22px; font-weight: 600; }
    .header .date { font-size: 14px; opacity: 0.9; margin-top: 4px; }
    .header .count { font-size: 13px; opacity: 0.8; margin-top: 4px; }
    .header .back { color: white; text-decoration: none; font-size: 14px; opacity: 0.8; }
    .container { padding: 15px; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); min-width: 800px; }
    thead th { background: #f8f9fa; padding: 12px 15px; text-align: left; font-weight: 600; font-size: 13px; text-transform: uppercase; color: #666; border-bottom: 2px solid #eee; white-space: nowrap; }
    .footer { text-align: center; padding: 15px; color: #999; font-size: 12px; }

    /* Mobile: collapse the 5-column table into a stacked 2-column card per appointment.
       Left column: time / service / guest stacked.
       Right column: progress notes (with +older expand) / appointment notes + add-note. */
    @media (max-width: 768px) {
      .container { padding: 8px; overflow-x: visible; }
      table { min-width: 0; box-shadow: none; background: transparent; }
      thead { display: none; }
      tbody { display: block; }
      tr.appointment-row {
        display: grid;
        grid-template-columns: 1fr 1.3fr;
        grid-template-areas:
          "time notes"
          "service notes"
          "guest notes"
          "lastvisit entry";
        gap: 6px 10px;
        padding: 12px 10px 10px;
        background: white;
        border-radius: 8px;
        margin-top: 10px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      }
      tr.appointment-row > td { padding: 0 !important; border: 0 !important; max-width: none !important; }
      tr.appointment-row > td:nth-child(1) { grid-area: time; }
      tr.appointment-row > td:nth-child(2) { grid-area: service; font-size: 13px; color: #666; }
      tr.appointment-row > td:nth-child(3) { grid-area: guest; font-weight: 600; }
      tr.appointment-row > td:nth-child(4) { grid-area: lastvisit; font-size: 12px; }
      tr.appointment-row > td:nth-child(5) { grid-area: notes; }
      tr.appointment-row > td:nth-child(6) { grid-area: entry; }
      tr.photo-row { display: block; }
      tr.photo-row > td { display: block; padding: 8px 10px 10px !important; background: white; border-radius: 0 0 8px 8px; margin-top: -10px; border-bottom: 0 !important; }
    }

    /* Print: clean agenda for the HP MFP. The print viewport is narrow, so
       the (max-width: 768px) mobile rules above also match — we explicitly
       reset them back to a real table layout for paper output. */
    @media print {
      @page { size: landscape; margin: 0.4in; }
      body { background: white; font-size: 11px; }
      .header { background: white !important; color: #000 !important; padding: 0 0 8px; border-bottom: 2px solid #000; display: block; }
      .header img { filter: none !important; height: 28px !important; }
      .header h1 { color: #000 !important; font-size: 18px; }
      .header .date, .header .count { color: #000 !important; font-size: 11px; }
      .header .back, .no-print { display: none !important; }
      .container { padding: 0; overflow: visible; }

      /* Undo mobile-stack: force normal table layout with full-width columns */
      table { box-shadow: none !important; min-width: 0 !important; background: white !important;
              border: 1px solid #999; width: 100% !important; table-layout: fixed; margin-top: 8px; }
      thead { display: table-header-group !important; }
      tbody { display: table-row-group !important; }
      thead th { background: #f8f9fa !important; padding: 5px 6px !important; font-size: 10px !important; }
      tr.appointment-row {
        display: table-row !important;
        grid-template-areas: none !important;
        grid-template-columns: none !important;
        background: white !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        margin: 0 !important;
        padding: 0 !important;
        page-break-inside: avoid;
      }
      tr.appointment-row > td {
        display: table-cell !important;
        padding: 5px 6px !important;
        border-bottom: 1px solid #ccc !important;
        border-top: 0 !important;
        vertical-align: top !important;
        max-width: none !important;
        font-size: 11px !important;
      }
      /* Column widths tuned for landscape letter (now 6 cols incl. Last Visit) */
      tr.appointment-row > td:nth-child(1) { width: 8%; white-space: nowrap; }
      tr.appointment-row > td:nth-child(2) { width: 14%; }
      tr.appointment-row > td:nth-child(3) { width: 12%; font-weight: 600; }
      tr.appointment-row > td:nth-child(4) { width: 10%; }
      tr.appointment-row > td:nth-child(5) { width: 38%; }
      tr.appointment-row > td:nth-child(6) { width: 18%; }
      tr.photo-row { display: none !important; }
      form, button, textarea { display: none !important; }
      /* Expand collapsed older notes so the full history prints */
      details { display: block; }
      details > summary { display: none; }
      details > div { max-height: none !important; padding-left: 0 !important; border-left: 0 !important; }
      td > div { max-height: none !important; overflow: visible !important; }
      /* Email summary banner — keep but slimmer */
      .email-summary, .container > div:first-child { font-size: 10px !important; padding: 6px 8px !important; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <img src="${LOGO_URL}" alt="DC Lash Bar" style="height:35px; margin-bottom:6px; filter:brightness(0) invert(1);">
      <h1>${staffName}</h1>
      <div class="date">${today}</div>
      <div class="count">${appointments.length} appointment${appointments.length !== 1 ? 's' : ''} today</div>
    </div>
    <div style="text-align:right;" class="no-print">
      <button onclick="window.print()" style="padding:8px 16px; background:white; color:#2c3e50; border:none; border-radius:6px; font-size:14px; font-weight:600; cursor:pointer; margin-right:6px;">🖨 Print</button>
      <a href="/intake?staff=${Object.entries(STAFF).find(([k, s]) => s.name === staffName)?.[0] || ''}" style="display:inline-block; padding:8px 16px; background:white; color:#2c3e50; border-radius:6px; text-decoration:none; font-size:14px; font-weight:600; margin-bottom:8px;">+ New Client Intake</a><br>
      <a href="/" class="back">All Staff</a>
    </div>
  </div>
  <div class="container">
    ${renderEmailSummary() || '<div style="background:#d4edda; border:1px solid #28a745; border-radius:8px; padding:12px 15px; margin-bottom:15px; color:#155724; font-size:14px;">All overnight messages have been checked and incorporated into today\'s agenda.</div>'}
    <table>
      <thead>
        <tr>
          <th>Appointment On</th>
          <th>Service Name</th>
          <th>Customer</th>
          <th>Last Visit</th>
          <th style="min-width:200px;">Customer Progress Notes</th>
          <th style="min-width:250px;">Notes</th>
        </tr>
      </thead>
      <tbody>
        ${appointmentRows}
      </tbody>
    </table>
  </div>
  <div class="footer">
    Auto-refreshes every 5 minutes &bull; Last updated: ${new Date().toLocaleTimeString('en-US')}
  </div>
</body>
</html>`;
}

// Determine which chemical solution(s) an appointment will consume, based on
// service name + the customer's most recent note + first-visit status.
//
// Rules from Stephanie:
//   - Lash Lift booked + last note "OS" → One Shot
//   - Lash Lift booked + last note "PF" → Profusion (likely should be Vegan)
//   - Vegan Lash Lift → Profusion
//   - First-visit Lash Lift (no history) → BOTH One Shot + Profusion (return unused)
//   - Brow Sculpt → BBL (half-packet each)
//   - Vegan Brow Sculpt → Profusion (half-packet each)
//   - Lash & Brow Package containing a lift → same lift logic
//
// Returns array of { product, halfPacket, isNewGuest } objects.
function solutionsNeeded(serviceName, latestNote, isFirstVisit) {
  if (!serviceName) return [];
  const sLower = serviceName.toLowerCase();
  const isCorrection = sLower.includes('correction');
  // Match "lash lift" explicitly OR a package that includes a lift
  const usesLashLift = sLower.includes('lash lift')
    || (sLower.includes('lift') && (sLower.includes('lash') || sLower.includes('package')));
  const usesBrowSculpt = sLower.includes('brow sculpt');
  const isVegan = sLower.includes('vegan');
  const noteHasPF = latestNote && /\bpf\b/i.test(latestNote);
  const noteHasOS = latestNote && /\bos\b/i.test(latestNote);

  const out = [];
  // Corrections lift (e.g., "Corrections Lash Lift & Tint") → ½ packet of Profusion.
  // Detect first so it doesn't fall into the general lash-lift bucket below.
  if (isCorrection && usesLashLift) {
    out.push({ product: 'Profusion', halfPacket: true, isNewGuest: false });
    if (usesBrowSculpt) {
      out.push({ product: isVegan ? 'Profusion' : 'BBL', halfPacket: true, isNewGuest: false });
    }
    return out;
  }
  if (usesLashLift) {
    if (isVegan) {
      out.push({ product: 'Profusion', halfPacket: false, isNewGuest: false });
    } else if (isFirstVisit) {
      // Distribute both; one is returned at end of service
      out.push({ product: 'One Shot', halfPacket: false, isNewGuest: true });
      out.push({ product: 'Profusion', halfPacket: false, isNewGuest: true });
    } else if (noteHasPF && !noteHasOS) {
      out.push({ product: 'Profusion', halfPacket: false, isNewGuest: false });
    } else {
      // OS noted, or no clear marker → default to One Shot
      out.push({ product: 'One Shot', halfPacket: false, isNewGuest: false });
    }
  }
  if (usesBrowSculpt) {
    out.push({
      product: isVegan ? 'Profusion' : 'BBL',
      halfPacket: true,
      isNewGuest: false,
    });
  }
  return out;
}

// Manager oversight view for the home page. Three sections:
//   1. Service breakdown by product (counts by category)
//   2. Distribution plan (who gets which packet, handoffs)
//   3. Beginning/Ending balance form (autosaved to localStorage per day)
function renderManagerSummary() {
  if (!appointmentsData || !appointmentsData.staff) return '';

  // Flatten all appointments with artist + needed solutions attached
  const all = [];
  for (const [artist, rows] of Object.entries(appointmentsData.staff)) {
    for (const r of rows) {
      const sols = solutionsNeeded(r.serviceName, r.latestProgressNote, r.isFirstVisit);
      all.push({ ...r, artist, sols });
    }
  }
  all.sort((a, b) => (a.appointmentOn || '').localeCompare(b.appointmentOn || ''));

  // Categorize services for the breakdown table
  const categories = {
    'Lash Lift (One Shot)': [],
    'Lash Lift (Profusion)': [],
    'Lash Lift (NEW guest — both packets, one returned)': [],
    'Corrections Lash Lift (Profusion — ½ packet each)': [],
    'Brow Sculpt (BBL — ½ packet each)': [],
    'Vegan Brow Sculpt (Profusion — ½ packet each)': [],
  };
  for (const a of all) {
    if (!a.sols.length) continue;
    const isNewLift = a.sols.some(s => s.isNewGuest);
    const sLower = (a.serviceName || '').toLowerCase();
    const isCorrection = sLower.includes('correction');
    const usesLift = sLower.includes('lash lift')
      || (sLower.includes('lift') && (sLower.includes('lash') || sLower.includes('package')));
    const usesSculpt = sLower.includes('brow sculpt');
    const isVegan = sLower.includes('vegan');
    if (usesLift) {
      if (isCorrection) categories['Corrections Lash Lift (Profusion — ½ packet each)'].push(a);
      else if (isNewLift) categories['Lash Lift (NEW guest — both packets, one returned)'].push(a);
      else if (isVegan || a.sols.some(s => s.product === 'Profusion' && !s.halfPacket)) categories['Lash Lift (Profusion)'].push(a);
      else categories['Lash Lift (One Shot)'].push(a);
    }
    if (usesSculpt) {
      if (isVegan) categories['Vegan Brow Sculpt (Profusion — ½ packet each)'].push(a);
      else categories['Brow Sculpt (BBL — ½ packet each)'].push(a);
    }
  }

  // Tally: for each product, total full-packet services + half-packet services
  // Recommended packets: 1 packet covers 2 full-packet services OR 2 half-packet services
  const productTally = { 'One Shot': { full: 0, half: 0, newGuest: 0 }, 'Profusion': { full: 0, half: 0, newGuest: 0 }, 'BBL': { full: 0, half: 0, newGuest: 0 } };
  for (const a of all) {
    for (const s of a.sols) {
      const t = productTally[s.product] || (productTally[s.product] = { full: 0, half: 0, newGuest: 0 });
      if (s.halfPacket) t.half++;
      else t.full++;
      if (s.isNewGuest) t.newGuest++;
    }
  }

  function packetsNeeded(t) {
    // 1 packet = 2 services (full or half). Round up.
    const totalServices = t.full + t.half;
    return Math.ceil(totalServices / 2);
  }

  // Distribution plan: pair within-artist first (no handoff needed), then
  // pool leftovers across artists chronologically (handoff required).
  // Goal: minimize handoffs. Hollyn with 4 lifts → 2 packets she keeps;
  // Hiba with 2 lifts → 1 packet she keeps; no handoffs at all.
  function distributionPlan(product) {
    const services = all.filter(a => a.sols.some(s => s.product === product && !s.halfPacket));
    const byArtist = {};
    for (const s of services) {
      (byArtist[s.artist] = byArtist[s.artist] || []).push(s);
    }
    const packets = [];
    const leftovers = [];
    for (const items of Object.values(byArtist)) {
      // Items are already in chronological order from the `all` sort above
      for (let i = 0; i < items.length - 1; i += 2) {
        packets.push({ first: items[i], second: items[i + 1] }); // same-artist pair
      }
      if (items.length % 2 === 1) leftovers.push(items[items.length - 1]);
    }
    // Pool leftovers chronologically across artists (handoffs)
    leftovers.sort((a, b) => (a.appointmentOn || '').localeCompare(b.appointmentOn || ''));
    for (let i = 0; i < leftovers.length; i += 2) {
      packets.push(leftovers[i + 1]
        ? { first: leftovers[i], second: leftovers[i + 1] }
        : { first: leftovers[i] });
    }
    // Sort all packets by first-appointment time for stable display
    packets.sort((a, b) => (a.first.appointmentOn || '').localeCompare(b.first.appointmentOn || ''));
    return packets;
  }

  const dateStr = appointmentsData.date
    ? new Date(appointmentsData.date + 'T12:00:00').toLocaleDateString('en-US',
        { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : 'today';
  const artistsToday = Object.keys(appointmentsData.staff).filter(n => appointmentsData.staff[n].length > 0);
  const artistList = artistsToday.length === 0 ? 'no artists'
    : artistsToday.length === 1 ? artistsToday[0]
    : artistsToday.length === 2 ? `${artistsToday[0]} and ${artistsToday[1]}`
    : `${artistsToday.slice(0, -1).join(', ')}, and ${artistsToday.slice(-1)}`;

  const palette = { 'One Shot': '#3498db', 'Profusion': '#27ae60', 'BBL': '#e67e22' };

  // Section 1: Service breakdown
  let breakdownRows = '';
  for (const [label, items] of Object.entries(categories)) {
    if (items.length === 0) continue;
    breakdownRows += `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #eee;font-size:13px;">
      <span style="color:#555;">${label}</span>
      <strong style="color:#2c3e50;">${items.length}</strong>
    </div>`;
  }
  if (!breakdownRows) breakdownRows = '<div style="color:#999;font-style:italic;font-size:13px;">No solution-using services today.</div>';

  // Section 2: Distribution plan per product
  let distPlanSections = '';
  for (const product of ['One Shot', 'Profusion', 'BBL']) {
    const plan = distributionPlan(product);
    if (plan.length === 0) continue;
    const color = palette[product];
    let lines = '';
    plan.forEach((p, idx) => {
      const firstArtist = p.first.artist.split(' ')[0];
      const firstTime = (p.first.appointmentOn || '').split(/\s{2,}/).pop();
      if (!p.second) {
        lines += `<div style="margin:3px 0;font-size:12px;color:#444;"><strong>Packet ${idx + 1}</strong> → ${firstArtist} (${firstTime})</div>`;
      } else {
        const secondArtist = p.second.artist.split(' ')[0];
        const secondTime = (p.second.appointmentOn || '').split(/\s{2,}/).pop();
        const handoff = firstArtist === secondArtist
          ? `also use ${secondTime}`
          : `<strong style="color:${color};">hand off to ${secondArtist} by ${secondTime}</strong>`;
        lines += `<div style="margin:3px 0;font-size:12px;color:#444;"><strong>Packet ${idx + 1}</strong> → ${firstArtist} (${firstTime}), ${handoff}</div>`;
      }
    });
    distPlanSections += `<div style="margin-top:10px;">
      <div style="font-size:12px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:1px;">${product}</div>
      ${lines}
    </div>`;
  }

  // Section 3: Beginning/Ending balance — autosaved per-day to localStorage
  let balanceRows = '';
  for (const product of ['One Shot', 'Profusion', 'BBL']) {
    const t = productTally[product];
    if (t.full + t.half === 0) continue;
    const color = palette[product];
    const recommended = packetsNeeded(t);
    const summary = [
      t.full ? `${t.full} full` : '',
      t.half ? `${t.half} ½` : '',
      t.newGuest ? `${t.newGuest} NEW guest` : '',
    ].filter(Boolean).join(', ');
    balanceRows += `<div style="display:grid;grid-template-columns:1fr auto auto auto auto;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid #eee;">
      <div>
        <div style="font-size:13px;font-weight:700;color:${color};">${product}</div>
        <div style="font-size:11px;color:#888;">${summary} → recommend ${recommended} packet${recommended === 1 ? '' : 's'}</div>
      </div>
      <div style="font-size:11px;color:#888;text-align:right;">
        Beginning<br>
        <input type="number" min="0" data-balance-key="${product}-begin" style="width:60px;padding:4px 6px;border:1px solid #ccc;border-radius:4px;font-size:13px;text-align:center;" placeholder="—">
      </div>
      <div style="font-size:11px;color:#888;text-align:right;">
        Ending<br>
        <input type="number" min="0" data-balance-key="${product}-end" style="width:60px;padding:4px 6px;border:1px solid #ccc;border-radius:4px;font-size:13px;text-align:center;" placeholder="—">
      </div>
      <div style="font-size:11px;color:#888;text-align:right;min-width:60px;">
        Δ<br>
        <span data-balance-delta="${product}" style="font-size:14px;font-weight:600;color:#555;">—</span>
      </div>
      <div style="text-align:right;">
        <button disabled style="padding:6px 10px;background:#ccc;color:#666;border:none;border-radius:4px;font-size:12px;cursor:not-allowed;font-weight:600;" title="In development — direct Booker sync still being wired up">🔄 Sync (WIP)</button>
        <div style="font-size:10px;color:#888;margin-top:3px;min-height:12px;"></div>
      </div>
    </div>`;
  }
  const balanceSection = balanceRows ? `
    <div style="font-size:11px;color:#7d4f10;text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-top:18px;margin-bottom:6px;">
      Inventory tracking
    </div>
    <div style="background:white;border:1px solid #eee;border-radius:6px;padding:8px 12px;">${balanceRows}</div>
    <div style="font-size:11px;color:#888;margin-top:6px;font-style:italic;">Autosaves to this device for today.</div>
  ` : '';

  // Inline JS for localStorage autosave + delta calculation + Booker sync
  const balanceScript = `<script>(function(){
    var today = "${appointmentsData.date}";
    var key = "dclb-balance-" + today;
    var saved = JSON.parse(localStorage.getItem(key) || "{}");
    document.querySelectorAll("[data-balance-key]").forEach(function(input){
      var k = input.getAttribute("data-balance-key");
      if (saved[k] != null) input.value = saved[k];
      input.addEventListener("input", function(){
        saved[k] = input.value;
        localStorage.setItem(key, JSON.stringify(saved));
        recalc();
      });
    });
    function recalc(){
      document.querySelectorAll("[data-balance-delta]").forEach(function(span){
        var product = span.getAttribute("data-balance-delta");
        var begin = saved[product+"-begin"], end = saved[product+"-end"];
        if (begin !== "" && end !== "" && begin != null && end != null) {
          var delta = Number(begin) - Number(end);
          span.textContent = "−" + delta;
          span.style.color = delta > 0 ? "#27ae60" : "#888";
        } else { span.textContent = "—"; span.style.color = "#888"; }
      });
    }
    recalc();
    // Booker inventory sync
    document.querySelectorAll("[data-sync-product]").forEach(function(btn){
      btn.addEventListener("click", async function(){
        var product = btn.getAttribute("data-sync-product");
        var endingInput = document.querySelector('[data-balance-key="' + product + '-end"]');
        var ending = endingInput && endingInput.value;
        var status = document.querySelector('[data-sync-status="' + product + '"]');
        if (ending === "" || ending == null) {
          status.textContent = "Enter ending first";
          status.style.color = "#e74c3c";
          return;
        }
        if (!confirm("Update Booker inventory: " + product + " → " + ending + "?")) return;
        status.textContent = "Syncing…";
        status.style.color = "#888";
        btn.disabled = true;
        try {
          var fd = new FormData();
          fd.append("product", product);
          fd.append("ending", ending);
          var r = await fetch("/sync-inventory", { method: "POST", body: fd });
          var j = await r.json();
          if (j.ok) {
            status.textContent = "✓ Synced " + j.results.length + " variant" + (j.results.length === 1 ? "" : "s");
            status.style.color = "#27ae60";
          } else {
            status.textContent = "⚠ " + (j.error || (j.results || []).filter(function(x){return !x.ok}).map(function(x){return x.label + ": " + x.message}).join("; ") || "Failed");
            status.style.color = "#e74c3c";
          }
        } catch (err) { status.textContent = "⚠ " + err.message; status.style.color = "#e74c3c"; }
        finally { btn.disabled = false; }
      });
    });
  })();</script>`;

  return `<div style="background:#fff8e1;border:1px solid #ffc107;border-radius:8px;padding:14px 18px;margin-bottom:18px;">
    <div style="font-size:15px;color:#5d3a05;line-height:1.5;">
      Good morning! Today is <strong>${dateStr}</strong> and <strong>${artistList}</strong> ${artistsToday.length === 1 ? 'is' : 'are'} scheduled for service.
    </div>

    <div style="font-size:11px;color:#7d4f10;text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-top:14px;margin-bottom:6px;">
      Service breakdown
    </div>
    <div style="background:white;border:1px solid #eee;border-radius:6px;padding:8px 12px;">${breakdownRows}</div>

  </div>`;
}

function renderEmailSummary() {
  if (!emailSummaryData || !emailSummaryData.actions || emailSummaryData.actions.length === 0) {
    return '';
  }

  const typeIcons = {
    cancellation: '❌',
    reschedule: '🔄',
    new_request: '📞',
    customer_service: '💬',
    voicemail_other: '📱',
    other: '📧',
  };

  const typeColors = {
    cancellation: '#e74c3c',
    reschedule: '#f39c12',
    new_request: '#3498db',
    customer_service: '#9b59b6',
    voicemail_other: '#1abc9c',
    other: '#95a5a6',
  };

  let items = '';
  for (const action of emailSummaryData.actions) {
    const icon = typeIcons[action.type] || '📧';
    const color = typeColors[action.type] || '#95a5a6';
    const label = action.type.replace(/_/g, ' ').toUpperCase();
    const name = action.customerName || action.from || 'Unknown';
    const message = action.voicemailMessage || action.customerMessage || action.subject || '';

    items += `
      <div style="padding:12px; margin:8px 0; background:white; border-left:4px solid ${color}; border-radius:4px; box-shadow:0 1px 2px rgba(0,0,0,0.05);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <strong style="font-size:14px;">${icon} ${label}</strong>
          ${action.phone ? `<span style="font-size:12px; color:#888;">${action.phone}</span>` : ''}
        </div>
        <div style="font-size:14px; font-weight:500; margin-bottom:2px;">${name}</div>
        ${message ? `<div style="font-size:13px; color:#666; font-style:italic;">"${message.substring(0, 150)}${message.length > 150 ? '...' : ''}"</div>` : ''}
        <div style="font-size:12px; color:#e74c3c; margin-top:4px; font-weight:500;">${action.actionNeeded}</div>
      </div>`;
  }

  return `
    <div style="background:#fff3cd; border:1px solid #ffc107; border-radius:8px; padding:15px; margin-bottom:15px;">
      <h3 style="font-size:16px; margin-bottom:10px; color:#856404;">Overnight Messages (${emailSummaryData.actions.length})</h3>
      ${items}
    </div>`;
}

function renderHomePage() {
  let staffLinks = '';
  for (const [key, staff] of Object.entries(STAFF)) {
    const appointments = getStaffAppointments(staff.name);
    const count = appointments.length;
    staffLinks += `
      <a href="/${key}" style="display:flex; justify-content:space-between; align-items:center; padding:20px; margin:10px 0; background:white; border-radius:8px; text-decoration:none; color:#333; box-shadow:0 1px 3px rgba(0,0,0,0.1); font-size:18px;">
        <span>${staff.name}</span>
        <span style="background:#3498db; color:white; padding:4px 12px; border-radius:12px; font-size:14px;">${count}</span>
      </a>`;
  }

  const dataDate = appointmentsData ? appointmentsData.date : 'No data loaded';
  const emailSummaryHtml = renderEmailSummary();

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="300">
  <title>DC Lash Bar - Daily Schedules</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; }
    .header { background: linear-gradient(135deg, #2c3e50, #3498db); color: white; padding: 25px; text-align: center; }
    .header p { margin-top: 8px; opacity: 0.9; }
    .container { padding: 20px; max-width: 800px; margin: 0 auto; }
    .data-info { text-align: center; color: #999; font-size: 12px; margin-top: 15px; }
  </style>
</head>
<body>
  <div class="header">
    <img src="${LOGO_URL}" alt="DC Lash Bar" style="height:60px; margin-bottom:10px; filter:brightness(0) invert(1);">
    <p>Select your name to view today's schedule</p>
  </div>
  <div class="container">
    ${renderManagerSummary()}
    ${emailSummaryHtml}
    ${staffLinks}
    <div class="data-info">Schedule data: ${dataDate}</div>
  </div>
</body>
</html>`;
}

function renderLoginPage(error) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DC Lash Bar - Staff Login</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .login-box { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); width: 90%; max-width: 400px; text-align: center; }
    h1 { font-size: 24px; margin-bottom: 8px; color: #2c3e50; }
    p { color: #888; margin-bottom: 24px; }
    input { width: 100%; padding: 14px; font-size: 16px; border: 1px solid #ddd; border-radius: 8px; margin-bottom: 16px; }
    button { width: 100%; padding: 14px; font-size: 16px; background: linear-gradient(135deg, #2c3e50, #3498db); color: white; border: none; border-radius: 8px; cursor: pointer; }
    .error { color: #e74c3c; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="login-box">
    <img src="${LOGO_URL}" alt="DC Lash Bar" style="height:50px; margin-bottom:10px;">
    <p>Enter access code to view schedules</p>
    ${error ? '<div class="error">Incorrect code. Try again.</div>' : ''}
    <form method="POST" action="/login">
      <input type="password" name="code" placeholder="Access code" autofocus>
      <button type="submit">Enter</button>
    </form>
  </div>
</body>
</html>`;
}

// --- Utilities ---

function parseCookies(req) {
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const [key, val] = c.trim().split('=');
    if (key) cookies[key] = val;
  });
  return cookies;
}

function isAuthenticated(req) {
  return parseCookies(req).access === CONFIG.accessCode;
}

function parseFormData(req) {
  return new Promise((resolve) => {
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('multipart/form-data')) {
      const boundary = contentType.split('boundary=')[1];
      let body = Buffer.alloc(0);
      req.on('data', chunk => { body = Buffer.concat([body, chunk]); });
      req.on('end', () => {
        const parts = {};
        const bodyStr = body.toString('latin1');
        const sections = bodyStr.split('--' + boundary);

        for (const section of sections) {
          const nameMatch = section.match(/name="([^"]+)"/);
          if (!nameMatch) continue;
          const name = nameMatch[0].match(/name="([^"]+)"/)[1];

          const filenameMatch = section.match(/filename="([^"]+)"/);
          if (filenameMatch) {
            const headerEnd = section.indexOf('\r\n\r\n');
            const dataStart = headerEnd + 4;
            const dataEnd = section.lastIndexOf('\r\n');
            const fileData = body.slice(
              bodyStr.indexOf(section.substring(dataStart, dataStart + 20), bodyStr.indexOf(nameMatch[0])) - 0,
              bodyStr.indexOf(section.substring(dataStart, dataStart + 20), bodyStr.indexOf(nameMatch[0])) + (dataEnd - dataStart)
            );
            // Simpler: just get the raw bytes between header and end
            const fullSectionStart = body.indexOf(Buffer.from(nameMatch[0]));
            const rawHeaderEnd = body.indexOf(Buffer.from('\r\n\r\n'), fullSectionStart) + 4;
            const rawDataEnd = body.indexOf(Buffer.from('\r\n--' + boundary), rawHeaderEnd);
            parts[name] = {
              filename: filenameMatch[1],
              data: body.slice(rawHeaderEnd, rawDataEnd),
            };
          } else {
            const headerEnd = section.indexOf('\r\n\r\n');
            if (headerEnd > -1) {
              const value = section.substring(headerEnd + 4).replace(/\r\n$/, '');
              parts[name] = value;
            }
          }
        }
        resolve(parts);
      });
    } else {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const params = {};
        body.split('&').forEach(pair => {
          const [key, val] = pair.split('=');
          if (key) params[decodeURIComponent(key)] = decodeURIComponent((val || '').replace(/\+/g, ' '));
        });
        resolve(params);
      });
    }
  });
}

// --- Server ---

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${CONFIG.port}`);
  const reqPath = url.pathname.replace(/\/$/, '') || '/';

  try {
    // Login
    if (reqPath === '/login' && req.method === 'POST') {
      const body = await parseFormData(req);
      if (body.code === CONFIG.accessCode) {
        res.writeHead(302, {
          'Set-Cookie': `access=${CONFIG.accessCode}; Path=/; Max-Age=31536000; SameSite=Strict`,
          'Location': '/',
        });
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(renderLoginPage(true));
        return;
      }
      res.end();
      return;
    }

    // Auth check
    if (!isAuthenticated(req)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(renderLoginPage(false));
      return;
    }

    // Sync inventory to Booker (one click per product on the manager view)
    if (reqPath === '/sync-inventory' && req.method === 'POST') {
      const body = await parseFormData(req);
      const product = body.product;
      const ending = parseInt(body.ending, 10);
      const variants = INVENTORY_PRODUCTS[product];
      if (!variants || isNaN(ending) || ending < 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'invalid product or ending balance' }));
        return;
      }
      try {
        const token = await getBookerToken();
        const results = [];
        for (const v of variants) {
          const r = await setBackbarInventory(token, v.productId, v.variantId, ending);
          results.push({ label: v.label, ok: r.ok, message: r.message });
        }
        const allOk = results.every(r => r.ok);
        console.log(`Inventory sync: ${product} → ${ending}  (${results.filter(r=>r.ok).length}/${results.length} variants ok)`);
        res.writeHead(allOk ? 200 : 207, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: allOk, results }));
      } catch (err) {
        console.error('Inventory sync error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    // Add note
    if (reqPath === '/add-note' && req.method === 'POST') {
      const body = await parseFormData(req);
      const staffKey = body.staffKey;
      // Note: in scraper mode, notes aren't saved back to Booker yet
      console.log(`Note added for ${body.customerKey}: ${body.newNote}`);
      res.writeHead(302, { 'Location': `/${staffKey}` });
      res.end();
      return;
    }

    // Intake form
    if (reqPath === '/intake') {
      const staffKey = url.searchParams.get('staff') || '';
      const clientName = url.searchParams.get('client') || '';
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(renderIntakeForm(staffKey, clientName));
      return;
    }

    // Submit intake form
    if (reqPath === '/submit-intake' && req.method === 'POST') {
      const body = await parseFormData(req);
      const staffKey = body.staffKey || '';

      // Save intake data to file
      const intakeDir = path.join(__dirname, 'intakes');
      if (!fs.existsSync(intakeDir)) fs.mkdirSync(intakeDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${body.firstName || 'unknown'}_${body.lastName || 'unknown'}_${timestamp}.json`;

      // Extract signature image
      const signatureData = body.signature || '';

      const intakeData = {
        submittedAt: new Date().toISOString(),
        staffKey,
        personalInfo: {
          firstName: body.firstName,
          lastName: body.lastName,
          phone: body.phone,
          email: body.email,
          contactMethod: body.contactMethod,
          dob: body.dob,
          emergencyContact: body.emergencyContact,
        },
        hearAbout: Array.isArray(body.hearAbout) ? body.hearAbout : (body.hearAbout ? [body.hearAbout] : []),
        photoPermission: body.photoPermission,
        services: Array.isArray(body.services) ? body.services : (body.services ? [body.services] : []),
        medical: Array.isArray(body.medical) ? body.medical : (body.medical ? [body.medical] : []),
        medicalDate: body.medicalDate,
        priorReaction: body.priorReaction,
        reactionDescription: body.reactionDescription,
        patchTest: Array.isArray(body.patchTest) ? body.patchTest : (body.patchTest ? [body.patchTest] : []),
        signature: signatureData ? true : false,
      };

      // Save JSON data
      fs.writeFileSync(path.join(intakeDir, filename), JSON.stringify(intakeData, null, 2));

      // Save signature image separately
      if (signatureData && signatureData.startsWith('data:image')) {
        const base64Data = signatureData.replace(/^data:image\/png;base64,/, '');
        const sigFilename = filename.replace('.json', '_signature.png');
        fs.writeFileSync(path.join(intakeDir, sigFilename), Buffer.from(base64Data, 'base64'));
      }

      console.log(`Intake form submitted: ${body.firstName} ${body.lastName}`);

      // Show success page
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Thank You - DC Lash Bar</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .box { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
    h1 { color: #27ae60; font-size: 24px; margin-bottom: 10px; }
    p { color: #666; margin-bottom: 20px; }
    a { display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #2c3e50, #3498db); color: white; text-decoration: none; border-radius: 8px; }
  </style>
</head>
<body>
  <div class="box">
    <h1>Thank You, ${body.firstName}!</h1>
    <p>Your intake form has been submitted successfully. Your artist will be with you shortly.</p>
    <a href="/${staffKey}">Back to Schedule</a>
  </div>
</body>
</html>`);
      return;
    }

    // Home page
    if (reqPath === '/') {
      // Reload data on each request to pick up fresh scrapes
      loadAppointmentsData();
      loadEmailSummary();
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(renderHomePage());
      return;
    }

    // Staff schedule
    const staffKey = reqPath.substring(1).toLowerCase();
    const staff = STAFF[staffKey];

    if (!staff) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<h1>Staff not found</h1><p><a href="/">Go back</a></p>');
      return;
    }

    loadAppointmentsData();
    loadEmailSummary();
    const appointments = getStaffAppointments(staff.name);
    const date = appointmentsData?.date || new Date().toISOString().split('T')[0];

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(renderSchedulePage(staff.name, appointments, date));
  } catch (err) {
    console.error('Error:', err.message);
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<h1>Error</h1><p>${err.message}</p>`);
  }
});

// --- Start ---

loadAppointmentsData();

server.listen(CONFIG.port, () => {
  console.log(`DC Lash Bar Schedule Server running on port ${CONFIG.port}`);
  console.log(`Data source: ${CONFIG.useApi ? 'Mindbody API' : 'Scraped data file'}`);
});
