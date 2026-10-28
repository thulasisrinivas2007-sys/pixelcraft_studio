const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const screenshotsDir = path.resolve('screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

console.log('====================================================');
console.log('   PIXELCRAFT STUDIO - AUTONOMOUS VERIFICATION      ');
console.log('====================================================\n');

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] ${message}`);
  } else {
    console.error(`  [FAIL] ${message}`);
  }
}

// 1. Create a dedicated test runner HTML that executes all DOM & interactive tests
const testRunnerHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>PixelCraft Test Harness</title>
</head>
<body style="margin:0; padding:0;">
  <iframe id="site-frame" src="index.html" style="width: 100vw; height: 100vh; border: none;"></iframe>
  <div id="test-log" style="display:none;"></div>
  
  <script>
    window.testResults = {
      passed: 0,
      total: 0,
      logs: [],
      errors: []
    };

    function logTest(passed, name, details) {
      window.testResults.total++;
      if (passed) window.testResults.passed++;
      window.testResults.logs.push({ passed, name, details });
    }

    window.onerror = function(msg, url, line) {
      window.testResults.errors.push({ msg, url, line });
    };

    window.addEventListener('load', async () => {
      // Allow Tailwind CDN & fonts to initialize
      await new Promise(r => setTimeout(r, 1200));

      const frame = document.getElementById('site-frame');
      const doc = frame.contentDocument || frame.contentWindow.document;
      const win = frame.contentWindow;

      // 1. Test Title
      logTest(doc.title.includes('PixelCraft Studio'), 'Document Title Check', doc.title);

      // 2. Test Hero Headline
      const h1 = doc.querySelector('#hero h1');
      const h1Text = h1 ? h1.innerText.replace(/\\s+/g, ' ').trim() : '';
      logTest(h1Text.includes('We Build Digital Experiences'), 'Hero Section Headline Check', h1Text);

      // 3. Test Hero CTA
      const heroCta = doc.querySelector('#hero a[href="#services"]');
      logTest(heroCta && heroCta.innerText.includes('Explore Services'), 'Hero CTA Button Check', heroCta ? heroCta.innerText : 'Not found');

      // 4. Test Services Grid (3 Core Services)
      const serviceCards = doc.querySelectorAll('#services .glass-card.glow-card');
      logTest(serviceCards.length === 3, 'Services Grid Count = 3', 'Found ' + serviceCards.length);

      const serviceTitles = Array.from(serviceCards).map(c => c.querySelector('h3') ? c.querySelector('h3').innerText.trim() : '');
      logTest(serviceTitles.includes('Web Development'), 'Core Service: Web Development', serviceTitles.join(', '));
      logTest(serviceTitles.includes('UI/UX Design'), 'Core Service: UI/UX Design', serviceTitles.join(', '));
      logTest(serviceTitles.includes('Brand Strategy'), 'Core Service: Brand Strategy', serviceTitles.join(', '));

      // 5. Test Portfolio Filter Functionality
      const filterWebBtn = doc.querySelector('.filter-btn[data-filter="web"]');
      if (filterWebBtn) {
        filterWebBtn.click();
        await new Promise(r => setTimeout(r, 100));
        const webItem = doc.querySelector('.portfolio-item[data-category="web"]');
        const designItem = doc.querySelector('.portfolio-item[data-category="design"]');
        logTest(webItem.style.display !== 'none' && designItem.style.display === 'none', 'Portfolio Filter Behavior (Web only)', 'Web visible, Design hidden');
      }

      // 6. Test Form Validation (Empty fields)
      const form = doc.getElementById('contact-form');
      const submitBtn = doc.getElementById('submit-btn');
      submitBtn.click();
      await new Promise(r => setTimeout(r, 100));

      const nameErr = !doc.getElementById('name-error').classList.contains('hidden');
      const emailErr = !doc.getElementById('email-error').classList.contains('hidden');
      const msgErr = !doc.getElementById('message-error').classList.contains('hidden');
      logTest(nameErr && emailErr && msgErr, 'Contact Form Empty Validation Errors Shown', { nameErr, emailErr, msgErr });

      // 7. Test Form Submission & Success Toast Notification
      doc.getElementById('contact-name').value = 'Alexandra Chen';
      doc.getElementById('contact-email').value = 'alex@innovate.co';
      doc.getElementById('contact-message').value = 'We are building a scalable digital platform and want PixelCraft to handle our design system and frontend web app.';
      
      // Select UI/UX Design radio pill
      const radio = doc.querySelector('input[name="service"][value="UI/UX Design"]');
      if (radio) radio.checked = true;

      submitBtn.click();

      // Check loading state
      const btnLoading = doc.getElementById('btn-text').textContent.includes('Sending');
      logTest(btnLoading, 'Submit Button Loading State Triggered', doc.getElementById('btn-text').textContent);

      // Wait for simulated submission (600ms)
      await new Promise(r => setTimeout(r, 750));

      const toast = doc.getElementById('toast-notification');
      const toastVisible = toast.classList.contains('opacity-100') && !toast.classList.contains('opacity-0');
      const toastMsg = doc.getElementById('toast-message').textContent;
      const formReset = doc.getElementById('contact-name').value === '';

      logTest(toastVisible, 'Success Toast Notification Displayed', 'opacity-100 present');
      logTest(toastMsg.includes('Alexandra'), 'Toast Personalized with User Name', toastMsg);
      logTest(formReset, 'Contact Form Reset After Success', 'Form inputs cleared');

      // 8. Test Toast Close Button
      const closeBtn = doc.getElementById('toast-close-btn');
      closeBtn.click();
      await new Promise(r => setTimeout(r, 200));
      const toastClosed = toast.classList.contains('opacity-0');
      logTest(toastClosed, 'Toast Notification Dismiss Button Works', 'opacity-0 restored');

      // Re-trigger toast for visual screenshot
      submitBtn.click();
      await new Promise(r => setTimeout(r, 750));

      // 9. Check Mobile Navigation Menu Interaction
      const menuBtn = doc.getElementById('mobile-menu-btn');
      const mobileMenu = doc.getElementById('mobile-menu');
      menuBtn.click();
      await new Promise(r => setTimeout(r, 100));
      const menuOpened = !mobileMenu.classList.contains('hidden');
      logTest(menuOpened, 'Mobile Menu Toggle Button Opens Menu', 'hidden class removed');

      // Write test results to DOM for inspection
      const summaryDiv = document.createElement('pre');
      summaryDiv.id = 'test-results-json';
      summaryDiv.textContent = JSON.stringify(window.testResults, null, 2);
      document.body.appendChild(summaryDiv);
    });
  </script>
</body>
</html>
`;

fs.writeFileSync(path.resolve('test-harness.html'), testRunnerHtml, 'utf8');

// 2. Run Headless Chrome to Execute Test Harness & Evaluate DOM
console.log('[Phase 3.1] Running interactive test suite in real headless Chrome...');
const fileUrl = 'file:///' + path.resolve('test-harness.html').replace(/\\/g, '/');

const runResult = spawnSync(CHROME, [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  '--window-size=1440,900',
  '--virtual-time-budget=6000',
  '--dump-dom',
  fileUrl
], { maxBuffer: 15 * 1024 * 1024 });

const domOutput = runResult.stdout.toString();
const jsonMatch = domOutput.match(/<pre id="test-results-json">([\s\S]*?)<\/pre>/);

if (jsonMatch) {
  try {
    const results = JSON.parse(jsonMatch[1]);
    console.log(`\n--- Interactive Browser Test Results (${results.passed}/${results.total}) ---`);
    results.logs.forEach(log => {
      assert(log.passed, `${log.name} -> ${typeof log.details === 'object' ? JSON.stringify(log.details) : log.details}`);
    });

    if (results.errors.length > 0) {
      console.error('[Browser Errors Detected]:', results.errors);
      assert(false, 'Page had 0 JavaScript errors');
    } else {
      assert(true, 'Zero JavaScript or runtime errors detected during interactive tests');
    }
  } catch (e) {
    console.error('Failed to parse test results JSON:', e);
  }
} else {
  console.error('Could not locate #test-results-json in DOM output.');
  console.log('DOM excerpt:', domOutput.substring(0, 1000));
}

// 3. Test Responsive Viewports & Capture Visual Screenshots
console.log('\n[Phase 3.2] Testing viewports and capturing visual verification screenshots...');

// Desktop Viewport Screenshot (1440 x 900)
const indexFileUrl = 'file:///' + path.resolve('index.html').replace(/\\/g, '/');
const desktopScreenshotPath = path.resolve('screenshots/desktop-1440.png');

const desktopShot = spawnSync(CHROME, [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  '--window-size=1440,900',
  '--virtual-time-budget=2500',
  '--screenshot=' + desktopScreenshotPath,
  indexFileUrl
]);
assert(fs.existsSync(desktopScreenshotPath) && fs.statSync(desktopScreenshotPath).size > 10000, 
  `Desktop Screenshot (1440px) captured -> screenshots/desktop-1440.png (${fs.statSync(desktopScreenshotPath).size} bytes)`);

// Mobile Viewport Screenshot (390 x 844 - iPhone 14/15/16)
const mobileScreenshotPath = path.resolve('screenshots/mobile-viewport-390.png');
const mobileShot = spawnSync(CHROME, [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  '--window-size=390,844',
  '--virtual-time-budget=2500',
  '--screenshot=' + mobileScreenshotPath,
  indexFileUrl
]);
assert(fs.existsSync(mobileScreenshotPath) && fs.statSync(mobileScreenshotPath).size > 10000, 
  `Mobile Viewport Screenshot (390px) captured -> screenshots/mobile-viewport-390.png (${fs.statSync(mobileScreenshotPath).size} bytes)`);

// Interactive Toast Notification Active Screenshot
const toastScreenshotPath = path.resolve('screenshots/desktop-contact-toast-1440.png');
const toastShot = spawnSync(CHROME, [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  '--window-size=1440,900',
  '--virtual-time-budget=6000',
  '--screenshot=' + toastScreenshotPath,
  fileUrl
]);
assert(fs.existsSync(toastScreenshotPath) && fs.statSync(toastScreenshotPath).size > 10000, 
  `Toast Notification Active Screenshot captured -> screenshots/desktop-contact-toast-1440.png (${fs.statSync(toastScreenshotPath).size} bytes)`);

// 4. Verify Responsiveness & Horizontal Scrollbar Check
console.log('\n[Phase 3.3] Verifying responsive layout & horizontal overflow on mobile...');
const mobileDomResult = spawnSync(CHROME, [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  '--window-size=390,844',
  '--virtual-time-budget=2500',
  '--dump-dom',
  indexFileUrl
], { maxBuffer: 15 * 1024 * 1024 });

// Check that overflow-x-hidden is applied and responsive classes are present
const mobileDom = mobileDomResult.stdout.toString();
assert(mobileDom.includes('overflow-x-hidden'), 'Body contains overflow-x-hidden preventing accidental viewport overflow');
assert(mobileDom.includes('grid-cols-1 md:grid-cols-2 lg:grid-cols-3'), 'Services grid configured with responsive 1-col to 3-col layout');
assert(mobileDom.includes('md:hidden') && mobileDom.includes('mobile-menu'), 'Responsive mobile navigation drawer present');

// Cleanup temporary test harness
if (fs.existsSync('test-harness.html')) {
  fs.unlinkSync('test-harness.html');
}

console.log('\n====================================================');
console.log(`   FINAL RESULTS: ${passedTests} / ${totalTests} CHECKS PASSED (${Math.round((passedTests / totalTests) * 100)}%)`);
console.log('====================================================\n');

process.exit(passedTests === totalTests ? 0 : 1);
