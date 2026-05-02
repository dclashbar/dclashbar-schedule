const http = require('http');
const https = require('https');

// Configuration from environment variables
const CONFIG = {
  apiKey: process.env.MB_API_KEY || 'ded7781d9127467a955b61d7e1d17f4c',
  siteId: process.env.MB_SITE_ID || '-99',
  username: process.env.MB_USERNAME || 'mindbodysandboxsite@gmail.com',
  password: process.env.MB_PASSWORD || 'Apitest1234',
  port: process.env.PORT || 8080,
  accessCode: process.env.ACCESS_CODE || 'dclash2026',
};

// Staff mapping - update with live staff IDs when going live
const STAFF = {
  'emily': { name: 'Emily Abramson', id: null },
  'hollyn': { name: 'Hollyn Wooldridge', id: null },
  'shauntice': { name: 'Shauntice Skye', id: null },
  'hiba': { name: 'Hiba Fadel', id: null },
};

let cachedToken = null;
let tokenExpiry = 0;
let sessionTypeCache = {};

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.mindbodyonline.com',
      path: `/public/v6/${path}`,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Api-Key': CONFIG.apiKey,
        'SiteId': CONFIG.siteId,
      },
    };

    if (cachedToken) {
      options.headers['Authorization'] = `Bearer ${cachedToken}`;
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Invalid JSON: ${data.substring(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const result = await apiRequest('POST', 'usertoken/issue', {
    Username: CONFIG.username,
    Password: CONFIG.password,
  });

  cachedToken = result.AccessToken;
  tokenExpiry = new Date(result.Expires).getTime() - 60000;
  return cachedToken;
}

async function getStaffList() {
  await getToken();
  const result = await apiRequest('GET', 'staff/staff?limit=100');
  return result.StaffMembers || [];
}

async function getSessionTypes() {
  if (Object.keys(sessionTypeCache).length > 0) return sessionTypeCache;
  await getToken();
  const result = await apiRequest('GET', 'site/sessiontypes?limit=200');
  const types = result.SessionTypes || [];
  for (const t of types) {
    sessionTypeCache[t.Id] = t.Name;
  }
  return sessionTypeCache;
}

async function getClientInfo(clientId) {
  await getToken();
  const result = await apiRequest('GET', `client/clients?ClientIds=${clientId}`);
  const clients = result.Clients || [];
  return clients[0] || null;
}

async function getAppointments(staffId, date) {
  await getToken();
  let path = `appointment/staffappointments?startDate=${date}&endDate=${date}`;
  if (staffId) path += `&staffIds=${staffId}`;
  const result = await apiRequest('GET', path);
  return (result.Appointments || [])
    .filter(a => a.Status !== 'Cancelled')
    .sort((a, b) => new Date(a.StartDateTime) - new Date(b.StartDateTime));
}

async function updateAppointmentNotes(appointmentId, notes) {
  await getToken();
  const result = await apiRequest('POST', 'appointment/addappointment', {
    AppointmentId: appointmentId,
    Notes: notes,
  });
  return result;
}

async function enrichAppointments(appointments) {
  const sessionTypes = await getSessionTypes();
  const clientCache = {};

  const enriched = [];
  for (const appt of appointments) {
    // Get client info
    let client = clientCache[appt.ClientId];
    if (!client && appt.ClientId) {
      try {
        client = await getClientInfo(appt.ClientId);
        clientCache[appt.ClientId] = client;
      } catch (err) {
        console.error(`Could not fetch client ${appt.ClientId}:`, err.message);
      }
    }

    enriched.push({
      id: appt.Id,
      startDateTime: appt.StartDateTime,
      endDateTime: appt.EndDateTime,
      duration: appt.Duration,
      serviceName: sessionTypes[appt.SessionTypeId] || appt.OnlineDescription || `Service #${appt.SessionTypeId}`,
      staffName: appt.Staff ? `${appt.Staff.FirstName} ${appt.Staff.LastName}` : 'Unknown',
      customerName: client ? `${client.FirstName} ${client.LastName}` : `Client #${appt.ClientId}`,
      notes: appt.Notes || '',
      status: appt.Status,
      firstAppointment: appt.FirstAppointment,
    });
  }

  return enriched;
}

function formatDateTime(dateStr) {
  const d = new Date(dateStr);
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return { date, time };
}

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
    for (const appt of appointments) {
      const { date: apptDate, time: apptTime } = formatDateTime(appt.startDateTime);
      const newBadge = appt.firstAppointment ? ' <span style="background:#e67e22;color:white;padding:1px 6px;border-radius:8px;font-size:11px;">NEW</span>' : '';

      appointmentRows += `
        <tr>
          <td style="padding:12px 15px; border-bottom:1px solid #eee; white-space:nowrap;">
            <strong>${apptTime}</strong><br>
            <small style="color:#888;">${apptDate}</small><br>
            <small style="color:#aaa;">${appt.duration} min</small>
          </td>
          <td style="padding:12px 15px; border-bottom:1px solid #eee;">
            ${appt.serviceName}
          </td>
          <td style="padding:12px 15px; border-bottom:1px solid #eee;">
            ${appt.staffName}
          </td>
          <td style="padding:12px 15px; border-bottom:1px solid #eee;">
            ${appt.customerName}${newBadge}
          </td>
          <td style="padding:12px 15px; border-bottom:1px solid #eee;">
            <div style="max-height:120px; overflow-y:auto; font-size:13px; color:#555; white-space:pre-wrap; margin-bottom:8px;">${appt.notes || '<em style="color:#ccc;">No notes yet</em>'}</div>
            <form method="POST" action="/add-note" style="display:flex; gap:6px;">
              <input type="hidden" name="appointmentId" value="${appt.id}">
              <input type="hidden" name="existingNotes" value="${(appt.notes || '').replace(/"/g, '&quot;')}">
              <input type="hidden" name="staffKey" value="${Object.entries(STAFF).find(([k, s]) => s.name === staffName)?.[0] || ''}">
              <textarea name="newNote" placeholder="Add note..." style="flex:1; padding:6px; border:1px solid #ddd; border-radius:4px; font-size:13px; font-family:inherit; resize:vertical; min-height:36px;"></textarea>
              <button type="submit" style="padding:6px 12px; background:#3498db; color:white; border:none; border-radius:4px; cursor:pointer; font-size:13px; white-space:nowrap;">Add</button>
            </form>
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
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      color: #333;
    }
    .header {
      background: linear-gradient(135deg, #2c3e50, #3498db);
      color: white;
      padding: 20px 25px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header h1 { font-size: 22px; font-weight: 600; }
    .header .date { font-size: 14px; opacity: 0.9; margin-top: 4px; }
    .header .count { font-size: 13px; opacity: 0.8; margin-top: 4px; }
    .header .back { color: white; text-decoration: none; font-size: 14px; opacity: 0.8; }
    .header .back:hover { opacity: 1; }
    .container { padding: 15px; overflow-x: auto; }
    table {
      width: 100%;
      border-collapse: collapse;
      background: white;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      min-width: 800px;
    }
    thead th {
      background: #f8f9fa;
      padding: 12px 15px;
      text-align: left;
      font-weight: 600;
      font-size: 13px;
      text-transform: uppercase;
      color: #666;
      border-bottom: 2px solid #eee;
      white-space: nowrap;
    }
    .footer {
      text-align: center;
      padding: 15px;
      color: #999;
      font-size: 12px;
    }
    .success-banner {
      background: #27ae60;
      color: white;
      padding: 10px 20px;
      text-align: center;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${staffName}</h1>
      <div class="date">${today}</div>
      <div class="count">${appointments.length} appointment${appointments.length !== 1 ? 's' : ''} today</div>
    </div>
    <a href="/" class="back">All Staff</a>
  </div>
  <div class="container">
    <table>
      <thead>
        <tr>
          <th>Appointment On</th>
          <th>Service Name</th>
          <th>Staff Name</th>
          <th>Customer Name</th>
          <th style="min-width:250px;">Customer Progress Notes</th>
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

function renderHomePage() {
  let staffLinks = '';
  for (const [key, staff] of Object.entries(STAFF)) {
    staffLinks += `
      <a href="/${key}" style="display:block; padding:20px; margin:10px 0; background:white; border-radius:8px; text-decoration:none; color:#333; box-shadow:0 1px 3px rgba(0,0,0,0.1); font-size:18px;">
        ${staff.name}
      </a>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DC Lash Bar - Daily Schedules</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      color: #333;
    }
    .header {
      background: linear-gradient(135deg, #2c3e50, #3498db);
      color: white;
      padding: 25px;
      text-align: center;
    }
    .header h1 { font-size: 28px; }
    .header p { margin-top: 8px; opacity: 0.9; }
    .container { padding: 20px; max-width: 500px; margin: 0 auto; }
  </style>
</head>
<body>
  <div class="header">
    <h1>DC Lash Bar</h1>
    <p>Select your name to view today's schedule</p>
  </div>
  <div class="container">
    ${staffLinks}
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
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }
    .login-box {
      background: white;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      width: 90%;
      max-width: 400px;
      text-align: center;
    }
    h1 { font-size: 24px; margin-bottom: 8px; color: #2c3e50; }
    p { color: #888; margin-bottom: 24px; }
    input {
      width: 100%;
      padding: 14px;
      font-size: 16px;
      border: 1px solid #ddd;
      border-radius: 8px;
      margin-bottom: 16px;
    }
    button {
      width: 100%;
      padding: 14px;
      font-size: 16px;
      background: linear-gradient(135deg, #2c3e50, #3498db);
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
    }
    .error { color: #e74c3c; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="login-box">
    <h1>DC Lash Bar</h1>
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

function parseCookies(req) {
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const [key, val] = c.trim().split('=');
    if (key) cookies[key] = val;
  });
  return cookies;
}

function isAuthenticated(req) {
  const cookies = parseCookies(req);
  return cookies.access === CONFIG.accessCode;
}

function parseBody(req) {
  return new Promise((resolve) => {
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
  });
}

async function initStaffIds() {
  try {
    const staffList = await getStaffList();
    for (const member of staffList) {
      const fullName = `${member.FirstName} ${member.LastName}`;
      for (const [key, staff] of Object.entries(STAFF)) {
        if (staff.name === fullName) {
          staff.id = member.Id;
          console.log(`  Found staff: ${fullName} (ID: ${member.Id})`);
        }
      }
    }
  } catch (err) {
    console.error('Could not load staff IDs:', err.message);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${CONFIG.port}`);
  const reqPath = url.pathname.replace(/\/$/, '') || '/';

  try {
    // Handle login
    if (reqPath === '/login' && req.method === 'POST') {
      const body = await parseBody(req);
      if (body.code === CONFIG.accessCode) {
        res.writeHead(302, {
          'Set-Cookie': `access=${CONFIG.accessCode}; Path=/; Max-Age=31536000; SameSite=Strict`,
          'Location': '/',
        });
        res.end();
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(renderLoginPage(true));
      }
      return;
    }

    // Handle add note
    if (reqPath === '/add-note' && req.method === 'POST') {
      if (!isAuthenticated(req)) {
        res.writeHead(302, { 'Location': '/' });
        res.end();
        return;
      }

      const body = await parseBody(req);
      const appointmentId = parseInt(body.appointmentId);
      const existingNotes = body.existingNotes || '';
      const newNote = body.newNote || '';
      const staffKey = body.staffKey || '';

      if (newNote.trim()) {
        const today = new Date().toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
        const updatedNotes = existingNotes
          ? `${existingNotes}\n${today} ${newNote.trim()}`
          : `${today} ${newNote.trim()}`;

        try {
          await getToken();
          await apiRequest('POST', 'appointment/addappointmentnotes', {
            AppointmentId: appointmentId,
            Notes: updatedNotes,
          });
          console.log(`Note added to appointment ${appointmentId}`);
        } catch (err) {
          console.error(`Failed to add note: ${err.message}`);
        }
      }

      res.writeHead(302, { 'Location': `/${staffKey}` });
      res.end();
      return;
    }

    // Check authentication
    if (!isAuthenticated(req)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(renderLoginPage(false));
      return;
    }

    if (reqPath === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(renderHomePage());
      return;
    }

    const staffKey = reqPath.substring(1).toLowerCase();
    const staff = STAFF[staffKey];

    if (!staff) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<h1>Staff not found</h1><p><a href="/">Go back</a></p>');
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    const rawAppointments = await getAppointments(staff.id, today);
    const appointments = await enrichAppointments(rawAppointments);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(renderSchedulePage(staff.name, appointments, today));
  } catch (err) {
    console.error('Error:', err.message);
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<h1>Error</h1><p>${err.message}</p>`);
  }
});

async function start() {
  console.log('DC Lash Bar - Artist Schedule Server\n');
  console.log('Loading staff IDs...');
  await initStaffIds();
  await getSessionTypes();

  server.listen(CONFIG.port, () => {
    console.log(`\nServer running at http://localhost:${CONFIG.port}`);
    console.log('\nBookmark these links on each iPad:');
    for (const [key, staff] of Object.entries(STAFF)) {
      console.log(`  ${staff.name}: http://localhost:${CONFIG.port}/${key}`);
    }
  });
}

start();
