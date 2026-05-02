// Renders the intake form HTML
const LOGO_URL = 'https://images.squarespace-cdn.com/content/v1/572ba1b72fe13138bc8e1fe9/92764f7d-c61c-4ef2-89f9-f0bf8444215a/Transparent+Logo+%282%29.png';

function renderIntakeForm(staffKey, clientName) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DC Lash Bar - Client Intake Form</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; }
    .header { background: linear-gradient(135deg, #2c3e50, #3498db); color: white; padding: 20px 25px; text-align: center; }
    .header img { height: 40px; margin-bottom: 6px; filter: brightness(0) invert(1); }
    .header h1 { font-size: 20px; }
    .header p { font-size: 14px; opacity: 0.9; margin-top: 4px; }
    .form-container { max-width: 700px; margin: 0 auto; padding: 20px; }
    .section { background: white; border-radius: 8px; padding: 20px; margin-bottom: 15px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .section h2 { font-size: 18px; color: #2c3e50; margin-bottom: 15px; padding-bottom: 8px; border-bottom: 2px solid #eee; }
    .section h3 { font-size: 15px; color: #555; margin: 15px 0 8px; }
    .field { margin-bottom: 14px; }
    .field label { display: block; font-size: 14px; font-weight: 600; color: #555; margin-bottom: 4px; }
    .field label .req { color: #e74c3c; }
    .field input[type="text"], .field input[type="email"], .field input[type="tel"], .field input[type="date"],
    .field select, .field textarea {
      width: 100%; padding: 10px; font-size: 16px; border: 1px solid #ddd; border-radius: 6px;
      font-family: inherit; -webkit-appearance: none;
    }
    .field textarea { min-height: 80px; resize: vertical; }
    .field select { background: white; }
    .row { display: flex; gap: 12px; }
    .row .field { flex: 1; }
    .checkbox-group { margin: 8px 0; }
    .checkbox-group label { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 15px; font-weight: normal; cursor: pointer; }
    .checkbox-group input[type="checkbox"], .checkbox-group input[type="radio"] {
      width: 20px; height: 20px; cursor: pointer;
    }
    .policy-box { background: #f8f9fa; border: 1px solid #eee; border-radius: 6px; padding: 15px; font-size: 13px; line-height: 1.6; color: #555; max-height: 300px; overflow-y: auto; margin-bottom: 15px; }
    .policy-box h4 { font-size: 15px; color: #333; margin: 10px 0 5px; }
    .policy-box ul { padding-left: 20px; margin: 5px 0; }
    .consent-item { display: flex; align-items: flex-start; gap: 8px; padding: 4px 0; font-size: 14px; }
    .consent-item input { margin-top: 3px; min-width: 18px; min-height: 18px; }
    #signature-pad { border: 2px solid #ddd; border-radius: 8px; background: white; touch-action: none; width: 100%; height: 200px; cursor: crosshair; }
    .sig-controls { display: flex; justify-content: flex-end; margin-top: 8px; }
    .sig-controls button { padding: 6px 16px; background: #95a5a6; color: white; border: none; border-radius: 4px; font-size: 14px; cursor: pointer; }
    .submit-btn { width: 100%; padding: 16px; font-size: 18px; background: linear-gradient(135deg, #2c3e50, #3498db); color: white; border: none; border-radius: 8px; cursor: pointer; margin-top: 10px; }
    .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .back-link { display: block; text-align: center; margin-top: 15px; color: #888; font-size: 14px; }
  </style>
</head>
<body>
  <div class="header">
    <img src="${LOGO_URL}" alt="DC Lash Bar">
    <h1>General Intake Form 2026</h1>
    <p>Thank you for choosing DC Lash Bar. Our goal is to provide a safe, customized and high-quality experience.</p>
  </div>

  <form method="POST" action="/submit-intake" class="form-container" id="intakeForm">
    <input type="hidden" name="staffKey" value="${staffKey}">

    <!-- Personal Information -->
    <div class="section">
      <h2>Personal Information</h2>
      <div class="row">
        <div class="field">
          <label>First name <span class="req">*</span></label>
          <input type="text" name="firstName" value="${clientName || ''}" required>
        </div>
        <div class="field">
          <label>Last name <span class="req">*</span></label>
          <input type="text" name="lastName" required>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label>Phone number <span class="req">*</span></label>
          <input type="tel" name="phone" required>
        </div>
        <div class="field">
          <label>Email <span class="req">*</span></label>
          <input type="email" name="email" required>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label>Preferred contact method <span class="req">*</span></label>
          <select name="contactMethod" required>
            <option value="">Select</option>
            <option value="Phone">Phone</option>
            <option value="Email">Email</option>
            <option value="Text">Text</option>
          </select>
        </div>
        <div class="field">
          <label>Date of birth <span class="req">*</span></label>
          <input type="date" name="dob" required>
        </div>
      </div>
      <div class="field">
        <label>Emergency Contact Name & Phone <span class="req">*</span></label>
        <input type="text" name="emergencyContact" required>
      </div>
    </div>

    <!-- How did you hear about us -->
    <div class="section">
      <h2>How did you hear about us? <span class="req">*</span></h2>
      <div class="checkbox-group">
        <label><input type="checkbox" name="hearAbout" value="Internet Search"> Internet Search</label>
        <label><input type="checkbox" name="hearAbout" value="Referral"> Referral</label>
        <label><input type="checkbox" name="hearAbout" value="Social Media"> Social Media</label>
        <label><input type="checkbox" name="hearAbout" value="Walked/Drove by location"> Walked/Drove by location</label>
        <label><input type="checkbox" name="hearAbout" value="Other"> Other</label>
      </div>
    </div>

    <!-- Photo Permission -->
    <div class="section">
      <h2>Photo & Video Permission</h2>
      <p style="font-size:14px; color:#555; margin-bottom:10px;">We love showcasing our work and celebrating our clients. Do you give permission for DC Lash Bar to share photos or videos of your results on social media and marketing platforms? <span class="req">*</span></p>
      <div class="checkbox-group">
        <label><input type="radio" name="photoPermission" value="Yes" required> Yes, I'd love to be featured</label>
        <label><input type="radio" name="photoPermission" value="No"> No, thank you.</label>
      </div>
    </div>

    <!-- Services -->
    <div class="section">
      <h2>What services are you receiving today? <span class="req">*</span></h2>
      <div class="checkbox-group">
        <label><input type="checkbox" name="services" value="Lash extensions (Half/Full Sets and Fills)"> Lash extensions (Half/Full Sets and Fills)</label>
        <label><input type="checkbox" name="services" value="Lash Lift & Tint (Signature or Vegan)"> Lash Lift & Tint (Signature or Vegan)</label>
        <label><input type="checkbox" name="services" value="Brow Services (Wax/Thread/Sculpt)"> Brow Services (Wax/Thread/Sculpt)</label>
        <label><input type="checkbox" name="services" value="Spray Tan"> Spray Tan</label>
      </div>
    </div>

    <!-- Medical -->
    <div class="section">
      <h2>Health & Medical Information</h2>
      <h3>Check all that apply: <span class="req">*</span></h3>
      <div class="checkbox-group">
        <label><input type="checkbox" name="medical" value="Current eye irritation, infection, sensitivities or skin conditions"> Current eye irritation, infection, sensitivities or skin conditions</label>
        <label><input type="checkbox" name="medical" value="Known allergies (seasonal, topical, food)"> Known allergies (seasonal, topical, food)</label>
        <label><input type="checkbox" name="medical" value="Hormone-related conditions"> Hormone-related conditions</label>
        <label><input type="checkbox" name="medical" value="Chemotherapy treatment (now or before)"> Chemotherapy treatment (now or before)</label>
        <label><input type="checkbox" name="medical" value="Recent eye, facial or head surgeries, fillers, Botox or permanent makeup in the last 6 months (any lashes?)"> Recent eye, facial or head surgeries, fillers, Botox or permanent makeup in the last 6 months</label>
        <label><input type="checkbox" name="medical" value="None of the above"> None of the above</label>
      </div>

      <div class="field">
        <label>If you selected any responses in the last question, when was the last date of application, use or treatment?</label>
        <input type="text" name="medicalDate">
      </div>

      <div class="field">
        <label>Have you ever experienced a reaction to a lash, brow, facial or cosmetic service (especially a similar service)? <span class="req">*</span></label>
        <div class="checkbox-group">
          <label><input type="radio" name="priorReaction" value="Yes" required> Yes</label>
          <label><input type="radio" name="priorReaction" value="No"> No</label>
        </div>
      </div>

      <div class="field">
        <label>If you answered yes to the previous question please describe:</label>
        <textarea name="reactionDescription"></textarea>
      </div>
    </div>

    <!-- Patch Test -->
    <div class="section">
      <h2>Patch Test Information</h2>
      <p style="font-size:13px; color:#555; margin-bottom:12px;">A patch test is recommended for services involving contact or exposure to professional adhesives, solutions, dyes, and conditioners especially for first-time clients or those with sensitivities. Patch tests involve application of a small amount of product to test for sensitivity. We recommend you check for a reaction within 24 hours. While it may reduce risk, it does not guarantee prevention of a reaction.</p>
      <div class="checkbox-group">
        <label><input type="checkbox" name="patchTest" value="I understand what a patch test is"> I understand what a patch test is</label>
        <label><input type="checkbox" name="patchTest" value="I have completed a patch test"> I have completed a patch test</label>
        <label><input type="checkbox" name="patchTest" value="I want to opt for a patch test today"> I want to opt for a patch test today</label>
        <label><input type="checkbox" name="patchTest" value="I decline a patch test and understand the risk"> I decline a patch test and understand there may be a risk due to a sensitivity. DC Lash Bar is not responsible for any reaction as a result. I understand that I was given the option to receive a patch test and chose to decline.</label>
      </div>
    </div>

    <!-- Business Policies -->
    <div class="section">
      <h2>Business Policies</h2>
      <div class="policy-box">
        <h4>Cancellation Policy</h4>
        <ul>
          <li>Appointments require a credit card on file and may be charged in the event of <strong>missed late cancellations, reschedules or missed appointments</strong>.</li>
          <li>We require at least 24 hours' notice to cancel or reschedule.</li>
          <li>We will make one attempt to call within 30 minutes of a late or rescheduled service. Please notify us as soon as possible if you expect any delay.</li>
        </ul>

        <h4>Services & Pricing</h4>
        <ul>
          <li>All services are non-refundable.</li>
          <li>All service pricing varies based on time, artist experience and environment. Additional services may apply.</li>
          <li>Services may be declined or modified based on hair, skin or health conditions, including hair removal minimums. Lash extension fills require at least 30% retention.</li>
          <li>Results vary based on individual anatomy, lifestyle, and adherence to aftercare. Aftercare instructions will be discussed during treatment and must be followed.</li>
        </ul>

        <h4>Satisfaction Guarantee</h4>
        <p>If you have concerns, please contact us within:</p>
        <ul>
          <li>Lash extensions: up to 5 days</li>
          <li>Lash Lifts & Tints: up to 2 weeks</li>
          <li>Brows: up to 3 days</li>
          <li>Spray Tans: up to 2 days</li>
        </ul>
      </div>
    </div>

    <!-- Consent -->
    <div class="section">
      <h2>Consent</h2>
      <p style="font-size:14px; color:#555; margin-bottom:12px;">By signing below and proceeding with the service, you acknowledge:</p>
      <div style="font-size:13px; line-height:1.8; color:#555;">
        <div class="consent-item"><input type="checkbox" name="consent" value="disclosed" required> You have disclosed all relevant medical conditions, treatments and prior reactions, and all information provided is accurate and complete.</div>
        <div class="consent-item"><input type="checkbox" name="consent" value="risks" required> You understand that services involve potential risks including irritation or allergic reaction.</div>
        <div class="consent-item"><input type="checkbox" name="consent" value="notify" required> You understand services should not be painful and agree to notify your technician immediately if discomfort occurs.</div>
        <div class="consent-item"><input type="checkbox" name="consent" value="aftercare" required> You understand that your selected service determines the associated risks and aftercare. You understand that corrections, credits or refunds are not guaranteed and are determined at DC Lash Bar's discretion.</div>
        <div class="consent-item"><input type="checkbox" name="consent" value="refuse" required> You understand that DC Lash Bar may refuse or discontinue service for safety, quality or professional reasons.</div>
        <div class="consent-item"><input type="checkbox" name="consent" value="photos" required> Our practices require before and after photos for internal notes and records. Your images and information are kept confidential and for internal-use only.</div>
      </div>
    </div>

    <!-- Signature -->
    <div class="section">
      <h2>Signature</h2>
      <p style="font-size:14px; color:#555; margin-bottom:12px;">Please sign here to consent to cancellation and liability information <span class="req">*</span></p>
      <canvas id="signature-pad"></canvas>
      <input type="hidden" name="signature" id="signatureData">
      <div class="sig-controls">
        <button type="button" onclick="clearSignature()">Clear</button>
      </div>
    </div>

    <button type="submit" class="submit-btn" id="submitBtn">Done</button>
    <a href="/${staffKey}" class="back-link">Cancel and go back</a>
  </form>

  <script>
    // Signature pad
    const canvas = document.getElementById('signature-pad');
    const ctx = canvas.getContext('2d');
    let isDrawing = false;
    let hasSignature = false;

    function resizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * 2;
      canvas.height = rect.height * 2;
      ctx.scale(2, 2);
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }
    resizeCanvas();

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      const touch = e.touches ? e.touches[0] : e;
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    }

    canvas.addEventListener('mousedown', (e) => { isDrawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
    canvas.addEventListener('mousemove', (e) => { if (!isDrawing) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); hasSignature = true; });
    canvas.addEventListener('mouseup', () => { isDrawing = false; });

    canvas.addEventListener('touchstart', (e) => { e.preventDefault(); isDrawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }, { passive: false });
    canvas.addEventListener('touchmove', (e) => { e.preventDefault(); if (!isDrawing) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); hasSignature = true; }, { passive: false });
    canvas.addEventListener('touchend', (e) => { e.preventDefault(); isDrawing = false; }, { passive: false });

    function clearSignature() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasSignature = false;
    }

    document.getElementById('intakeForm').addEventListener('submit', function(e) {
      if (!hasSignature) {
        e.preventDefault();
        alert('Please provide your signature.');
        return;
      }
      document.getElementById('signatureData').value = canvas.toDataURL('image/png');
    });
  </script>
</body>
</html>`;
}

module.exports = { renderIntakeForm };
