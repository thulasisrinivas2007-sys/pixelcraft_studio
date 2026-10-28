const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

console.log('====================================================');
console.log('  PIXELCRAFT STUDIO - DEEP DOM & INTERACTIVE TEST   ');
console.log('====================================================\n');

// 1. Read index.html and inject test assertions script
let html = fs.readFileSync(path.resolve('index.html'), 'utf8');

const testScript = `
<div id="test-output"></div>
<script>
window.testReport = { total: 0, passed: 0, list: [] };
function record(ok, name, detail) {
  window.testReport.total++;
  if (ok) window.testReport.passed++;
  window.testReport.list.push({ ok, name, detail: String(detail || '') });
}

window.addEventListener('load', async () => {
  // Let styles and DOM settle
  await new Promise(r => setTimeout(r, 600));

  // 1. Headline Check
  const h1 = document.querySelector('#hero h1');
  const h1Text = h1 ? h1.innerText.replace(/\\s+/g, ' ').trim() : '';
  record(h1Text.includes('We Build Digital Experiences'), 'Hero Headline: "We Build Digital Experiences"', h1Text);

  // 2. CTA Button Check
  const cta = document.querySelector('#hero a[href="#services"]');
  record(cta && cta.innerText.includes('Explore Services'), 'Hero CTA Button: "Explore Services"', cta ? cta.innerText.trim() : 'missing');

  // 3. Services Grid Check (3 Core Services)
  const cards = document.querySelectorAll('#services .glass-card.glow-card');
  record(cards.length === 3, 'Services Grid Card Count = 3', cards.length);

  const titles = Array.from(cards).map(c => c.querySelector('h3') ? c.querySelector('h3').innerText.trim() : '');
  record(titles.includes('Web Development'), 'Service 1: Web Development', titles[0]);
  record(titles.includes('UI/UX Design'), 'Service 2: UI/UX Design', titles[1]);
  record(titles.includes('Brand Strategy'), 'Service 3: Brand Strategy', titles[2]);

  // 4. Form Validation Check on Empty Fields
  const submitBtn = document.getElementById('submit-btn');
  submitBtn.click();
  await new Promise(r => setTimeout(r, 80));
  const nErr = !document.getElementById('name-error').classList.contains('hidden');
  const eErr = !document.getElementById('email-error').classList.contains('hidden');
  const mErr = !document.getElementById('message-error').classList.contains('hidden');
  record(nErr && eErr && mErr, 'Contact Form Empty Input Validation Flags', { name: nErr, email: eErr, msg: mErr });

  // 5. Valid Submission & Toast Notification Check
  document.getElementById('contact-name').value = 'Marcus Vance';
  document.getElementById('contact-email').value = 'marcus@pixelcraft.studio';
  document.getElementById('contact-message').value = 'We need a high-scale Next.js platform built with custom UI/UX design tokens.';
  
  submitBtn.click();

  // Button loading state
  const isSending = document.getElementById('btn-text').textContent.includes('Sending');
  record(isSending, 'Submit Button Loading State Triggered', document.getElementById('btn-text').textContent);

  // Wait for submission response (600ms network simulation)
  await new Promise(r => setTimeout(r, 750));

  const toast = document.getElementById('toast-notification');
  const toastVisible = toast.classList.contains('opacity-100') && !toast.classList.contains('opacity-0');
  const toastText = document.getElementById('toast-message').innerText;
  const formReset = document.getElementById('contact-name').value === '';

  record(toastVisible, 'Success Toast Notification Displayed (opacity-100)', toast.className);
  record(toastText.includes('Marcus'), 'Toast Message Personalized with User Name', toastText);
  record(formReset, 'Form Fields Reset After Successful Submission', 'Cleared');

  // 6. Mobile Menu Toggle Check
  const menuBtn = document.getElementById('mobile-menu-btn');
  const mobileMenu = document.getElementById('mobile-menu');
  
  menuBtn.click();
  await new Promise(r => setTimeout(r, 60));
  record(!mobileMenu.classList.contains('hidden'), 'Mobile Hamburger Menu Expands on Click', 'visible');

  menuBtn.click();
  await new Promise(r => setTimeout(r, 60));
  record(mobileMenu.classList.contains('hidden'), 'Mobile Menu Collapses on Close', 'hidden');

  // Output test report as JSON into DOM
  const pre = document.createElement('pre');
  pre.id = 'suite-results';
  pre.textContent = JSON.stringify(window.testReport, null, 2);
  document.body.appendChild(pre);
});
</script>
`;

const testHtml = html.replace('</body>', `${testScript}\n</body>`);
const tempFile = path.resolve('test-index.html');
fs.writeFileSync(tempFile, testHtml, 'utf8');

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const fileUrl = 'file:///' + tempFile.replace(/\\/g, '/');

const res = spawnSync(CHROME, [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  '--window-size=1440,900',
  '--virtual-time-budget=6000',
  '--dump-dom',
  fileUrl
], { maxBuffer: 15 * 1024 * 1024 });

const domOutput = res.stdout.toString();
const match = domOutput.match(/<pre id="suite-results">([\s\S]*?)<\/pre>/);

if (fs.existsSync(tempFile)) {
  fs.unlinkSync(tempFile);
}

if (match) {
  const report = JSON.parse(match[1]);
  console.log(`[Results] Passed: ${report.passed} / ${report.total} checks (${Math.round(report.passed / report.total * 100)}%)\n`);
  report.list.forEach(item => {
    console.log(`  ${item.ok ? '[PASS]' : '[FAIL]'} ${item.name} -> ${item.detail}`);
  });
  console.log('\n====================================================');
  console.log(report.passed === report.total ? 'ALL IN-BROWSER TESTS PASSED FLAWLESSLY!' : 'SOME TESTS FAILED');
  console.log('====================================================\n');
  process.exit(report.passed === report.total ? 0 : 1);
} else {
  console.error('Could not extract #suite-results from Chrome output.');
  process.exit(1);
}
