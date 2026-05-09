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

// Photo storage (in-memory for now, keyed by client name)
const photoStore = {};

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
      const photos = photoStore[customerKey] || {};
      const beforeImg = photos.before ? `<img src="/photos/${customerKey}/before" style="max-width:120px; max-height:90px; border-radius:4px;">` : '<span style="color:#ccc; font-size:12px;">No photo</span>';
      const afterImg = photos.after ? `<img src="/photos/${customerKey}/after" style="max-width:120px; max-height:90px; border-radius:4px;">` : '<span style="color:#ccc; font-size:12px;">No photo</span>';

      appointmentRows += `
        <tr class="appointment-row">
          <td style="padding:12px 15px; border-bottom:1px solid #eee; white-space:nowrap;">
            <strong>${(appt.appointmentOn || '').split(/\s{2,}/).pop()}</strong>
          </td>
          <td style="padding:12px 15px; border-bottom:1px solid #eee; max-width:220px; word-wrap:break-word; overflow-wrap:anywhere;">
            ${appt.serviceName || ''}
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
        <tr class="photo-row">
          <td colspan="5" style="padding:8px 15px 16px; border-bottom:2px solid #ddd; background:#fafafa;">
            <div style="display:flex; gap:20px; align-items:flex-start;">
              <div style="text-align:center;">
                <div style="font-size:12px; font-weight:600; color:#666; margin-bottom:4px;">BEFORE</div>
                ${beforeImg}
                <div style="display:flex; gap:4px; margin-top:6px; justify-content:center;">
                  <form method="POST" action="/upload-photo" enctype="multipart/form-data" style="margin:0;">
                    <input type="hidden" name="customerKey" value="${customerKey}">
                    <input type="hidden" name="type" value="before">
                    <input type="hidden" name="staffKey" value="${staffKey}">
                    <input type="hidden" name="customerName" value="${appt.customerFirstName || appt.customerName || ''}">
                    <label style="padding:4px 10px; background:#95a5a6; color:white; border-radius:4px; cursor:pointer; font-size:12px;">
                      📷 Camera
                      <input type="file" name="photo" accept="image/*" capture="environment" onchange="this.form.submit()" style="display:none;">
                    </label>
                  </form>
                  <form method="POST" action="/upload-photo" enctype="multipart/form-data" style="margin:0;">
                    <input type="hidden" name="customerKey" value="${customerKey}">
                    <input type="hidden" name="type" value="before">
                    <input type="hidden" name="staffKey" value="${staffKey}">
                    <input type="hidden" name="customerName" value="${appt.customerFirstName || appt.customerName || ''}">
                    <label style="padding:4px 10px; background:#3498db; color:white; border-radius:4px; cursor:pointer; font-size:12px;">
                      🖼 Browse
                      <input type="file" name="photo" accept="image/*" onchange="this.form.submit()" style="display:none;">
                    </label>
                  </form>
                </div>
              </div>
              <div style="text-align:center;">
                <div style="font-size:12px; font-weight:600; color:#666; margin-bottom:4px;">AFTER</div>
                ${afterImg}
                <div style="display:flex; gap:4px; margin-top:6px; justify-content:center;">
                  <form method="POST" action="/upload-photo" enctype="multipart/form-data" style="margin:0;">
                    <input type="hidden" name="customerKey" value="${customerKey}">
                    <input type="hidden" name="type" value="after">
                    <input type="hidden" name="staffKey" value="${staffKey}">
                    <input type="hidden" name="customerName" value="${appt.customerFirstName || appt.customerName || ''}">
                    <label style="padding:4px 10px; background:#95a5a6; color:white; border-radius:4px; cursor:pointer; font-size:12px;">
                      📷 Camera
                      <input type="file" name="photo" accept="image/*" capture="environment" onchange="this.form.submit()" style="display:none;">
                    </label>
                  </form>
                  <form method="POST" action="/upload-photo" enctype="multipart/form-data" style="margin:0;">
                    <input type="hidden" name="customerKey" value="${customerKey}">
                    <input type="hidden" name="type" value="after">
                    <input type="hidden" name="staffKey" value="${staffKey}">
                    <input type="hidden" name="customerName" value="${appt.customerFirstName || appt.customerName || ''}">
                    <label style="padding:4px 10px; background:#3498db; color:white; border-radius:4px; cursor:pointer; font-size:12px;">
                      🖼 Browse
                      <input type="file" name="photo" accept="image/*" onchange="this.form.submit()" style="display:none;">
                    </label>
                  </form>
                </div>
              </div>
            </div>
          </td>
        </tr>`;
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
          "guest entry";
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
      tr.appointment-row > td:nth-child(4) { grid-area: notes; }
      tr.appointment-row > td:nth-child(5) { grid-area: entry; }
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
      /* Column widths tuned for landscape letter */
      tr.appointment-row > td:nth-child(1) { width: 9%; white-space: nowrap; }
      tr.appointment-row > td:nth-child(2) { width: 16%; }
      tr.appointment-row > td:nth-child(3) { width: 14%; font-weight: 600; }
      tr.appointment-row > td:nth-child(4) { width: 41%; }
      tr.appointment-row > td:nth-child(5) { width: 20%; }
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
    .container { padding: 20px; max-width: 600px; margin: 0 auto; }
    .data-info { text-align: center; color: #999; font-size: 12px; margin-top: 15px; }
  </style>
</head>
<body>
  <div class="header">
    <img src="${LOGO_URL}" alt="DC Lash Bar" style="height:60px; margin-bottom:10px; filter:brightness(0) invert(1);">
    <p>Select your name to view today's schedule</p>
  </div>
  <div class="container">
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

    // Serve photos
    if (reqPath.startsWith('/photos/')) {
      const parts = reqPath.split('/');
      const customerKey = parts[2];
      const type = parts[3]; // before or after
      const photo = photoStore[customerKey]?.[type];
      if (photo) {
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        res.end(photo);
      } else {
        res.writeHead(404);
        res.end();
      }
      return;
    }

    // Auth check
    if (!isAuthenticated(req)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(renderLoginPage(false));
      return;
    }

    // Upload photo
    if (reqPath === '/upload-photo' && req.method === 'POST') {
      const body = await parseFormData(req);
      const customerKey = body.customerKey;
      const type = body.type; // before or after
      const staffKey = body.staffKey;
      const customerName = body.customerName;

      if (body.photo && body.photo.data) {
        if (!photoStore[customerKey]) photoStore[customerKey] = {};
        photoStore[customerKey][type] = body.photo.data;
        console.log(`Photo uploaded: ${customerName} (${type}) - ${body.photo.data.length} bytes`);
      }

      res.writeHead(302, { 'Location': `/${staffKey}` });
      res.end();
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
