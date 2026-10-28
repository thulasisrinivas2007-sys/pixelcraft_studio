const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const TEMP_USER_DATA = path.join(process.env.TEMP || 'C:\\Windows\\Temp', `chrome-test-${Date.now()}`);

// Helper to delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
    this.events = [];
    this.consoleErrors = [];
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);
        if (data.id && this.callbacks.has(data.id)) {
          const cb = this.callbacks.get(data.id);
          this.callbacks.delete(data.id);
          if (data.error) cb.reject(new Error(data.error.message || JSON.stringify(data.error)));
          else cb.resolve(data.result);
        } else if (data.method) {
          if (data.method === 'Runtime.consoleAPICalled') {
            const type = data.params.type;
            const text = data.params.args.map(a => a.value || a.description || '').join(' ');
            if (type === 'error') {
              this.consoleErrors.push(text);
              console.error('[Browser Console Error]:', text);
            }
          }
          if (data.method === 'Runtime.exceptionThrown') {
            const desc = data.params.exceptionDetails?.exception?.description || data.params.exceptionDetails?.text;
            this.consoleErrors.push(desc);
            console.error('[Browser Exception]:', desc);
          }
        }
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expr) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error in "${expr}": ${res.exceptionDetails.text}`);
    }
    return res.result?.value;
  }

  async setViewport(width, height, isMobile = false) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: isMobile ? 2 : 1,
      mobile: isMobile
    });
    await this.send('Emulation.setVisibleSize', { width, height });
  }

  async captureScreenshot(outputPath, clip = null) {
    const params = { format: 'png' };
    if (clip) params.clip = clip;
    const res = await this.send('Page.captureScreenshot', params);
    fs.writeFileSync(outputPath, Buffer.from(res.data, 'base64'));
    console.log(`[Screenshot Saved] -> ${path.relative(__dirname, outputPath)}`);
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function runTestSuite() {
  console.log('==================================================');
  console.log('   PIXELCRAFT STUDIO - AUTONOMOUS TEST SUITE      ');
  console.log('==================================================\n');

  // 1. Start Local Preview Server
  console.log('[Phase 3.1] Starting preview server on port 3000...');
  const serverProcess = spawn('node', ['server.js'], { stdio: 'inherit' });
  await sleep(1000);

  // 2. Launch Headless Chrome with Remote Debugging
  console.log('[Phase 3.2] Launching headless Chrome with remote debugging on port 9222...');
  const chromeProcess = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9222',
    `--user-data-dir=${TEMP_USER_DATA}`,
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    'about:blank'
  ]);

  let cdp = null;
  let testsPassed = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      testsPassed++;
      console.log(`  PASS: ${message}`);
    } else {
      console.error(`  FAIL: ${message}`);
    }
  }

  try {
    // Wait for Chrome remote debugging port to open
    let wsUrl = null;
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch('http://127.0.0.1:9222/json');
        const list = await res.json();
        if (list && list.length > 0 && list[0].webSocketDebuggerUrl) {
          wsUrl = list[0].webSocketDebuggerUrl;
          break;
        }
      } catch (e) {
        await sleep(500);
      }
    }

    if (!wsUrl) throw new Error('Could not obtain Chrome WebSocket URL after 10s');
    console.log(`[Phase 3.3] Connected to Chrome DevTools Protocol at ${wsUrl}`);

    cdp = new CDPClient(wsUrl);
    await cdp.connect();

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');

    // ----------------------------------------------------
    // TEST SUITE 1: DESKTOP VIEWPORT (1440px)
    // ----------------------------------------------------
    console.log('\n--- Running Desktop Tests (Viewport: 1440 x 900) ---');
    await cdp.setViewport(1440, 900, false);
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
    
    // Wait for network and Tailwind to load
    await sleep(2000);

    // Verify Title
    const title = await cdp.eval('document.title');
    assert(title.includes('PixelCraft Studio'), `Page title contains "PixelCraft Studio": "${title}"`);

    // Verify Hero Section
    const headlineText = await cdp.eval('document.querySelector("#hero h1").innerText.replace(/\\s+/g, " ").trim()');
    assert(headlineText.includes('We Build Digital Experiences'), `Hero headline is "We Build Digital Experiences": "${headlineText}"`);

    const heroCta = await cdp.eval(`(() => {
      const btn = document.querySelector('#hero a[href="#services"]');
      return btn ? btn.innerText.trim() : null;
    })()`);
    assert(heroCta && heroCta.includes('Explore Services'), `Hero has "Explore Services" CTA button: "${heroCta}"`);

    // Capture Desktop Hero Screenshot
    await cdp.captureScreenshot(path.join(__dirname, 'screenshots', 'desktop-hero-1440.png'), {
      x: 0, y: 0, width: 1440, height: 800, scale: 1
    });

    // Verify Services Grid (Core Requirement)
    console.log('\n--- Verifying Services Grid (Desktop 3-Column Layout) ---');
    const servicesData = await cdp.eval(`(() => {
      const cards = Array.from(document.querySelectorAll('#services .glass-card.glow-card'));
      return cards.map(c => {
        const title = c.querySelector('h3') ? c.querySelector('h3').innerText.trim() : '';
        const rect = c.getBoundingClientRect();
        return { title, top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width) };
      });
    })()`);

    assert(servicesData.length === 3, `Services section contains exactly 3 core service cards: found ${servicesData.length}`);
    const serviceTitles = servicesData.map(s => s.title);
    assert(serviceTitles.includes('Web Development'), 'Services Grid contains "Web Development"');
    assert(serviceTitles.includes('UI/UX Design'), 'Services Grid contains "UI/UX Design"');
    assert(serviceTitles.includes('Brand Strategy'), 'Services Grid contains "Brand Strategy"');

    // Verify 3-Column horizontal alignment on Desktop
    const sameRow = Math.abs(servicesData[0].top - servicesData[1].top) < 10 && Math.abs(servicesData[1].top - servicesData[2].top) < 10;
    assert(sameRow, `Services are aligned in a 3-column row on Desktop (Tops: ${servicesData.map(s => s.top).join(', ')})`);

    // Capture Services Grid Screenshot
    const servicesRect = await cdp.eval(`(() => {
      const el = document.getElementById('services');
      const r = el.getBoundingClientRect();
      return { x: 0, y: Math.max(0, Math.round(r.top + window.scrollY)), width: 1440, height: Math.round(r.height) };
    })()`);
    await cdp.captureScreenshot(path.join(__dirname, 'screenshots', 'desktop-services-1440.png'), servicesRect);

    // Verify Interactive Contact Form & Toast Notification (Core Requirement)
    console.log('\n--- Verifying Interactive Contact Form & Toast Notification ---');
    
    // Check initial toast state (should be hidden)
    const initialToastVisible = await cdp.eval(`(() => {
      const toast = document.getElementById('toast-notification');
      return toast.classList.contains('opacity-100') && !toast.classList.contains('opacity-0');
    })()`);
    assert(!initialToastVisible, 'Toast notification is initially hidden');

    // Test Validation: Submit Empty Form
    await cdp.eval(`document.getElementById('submit-btn').click()`);
    await sleep(200);

    const nameErrorShown = await cdp.eval(`!document.getElementById('name-error').classList.contains('hidden')`);
    const emailErrorShown = await cdp.eval(`!document.getElementById('email-error').classList.contains('hidden')`);
    const messageErrorShown = await cdp.eval(`!document.getElementById('message-error').classList.contains('hidden')`);
    assert(nameErrorShown, 'Validation error displayed for empty Name field');
    assert(emailErrorShown, 'Validation error displayed for empty Email field');
    assert(messageErrorShown, 'Validation error displayed for empty Message field');

    // Test Invalid Email
    await cdp.eval(`
      document.getElementById('contact-name').value = 'Test User';
      document.getElementById('contact-email').value = 'invalid-email-string';
      document.getElementById('contact-message').value = 'Valid message content goes here';
      document.getElementById('submit-btn').click();
    `);
    await sleep(200);

    const emailInvalidCheck = await cdp.eval(`!document.getElementById('email-error').classList.contains('hidden')`);
    assert(emailInvalidCheck, 'Validation triggers for improperly formatted email');

    // Test Successful Submission with Toast Notification
    console.log('  Submitting valid form data to trigger Toast Notification...');
    await cdp.eval(`
      document.getElementById('contact-name').value = 'Marcus Vance';
      document.getElementById('contact-email').value = 'marcus@pixelcraft.studio';
      document.querySelector('input[name="service"][value="Web Development"]').checked = true;
      document.getElementById('contact-message').value = 'We need a high-scale Next.js platform built with custom UI/UX design tokens for our Q4 product launch.';
      document.getElementById('contact-form').scrollIntoView({ behavior: 'instant', block: 'center' });
      document.getElementById('submit-btn').click();
    `);

    // Check Button loading state
    await sleep(200);
    const isSending = await cdp.eval(`document.getElementById('btn-text').textContent.includes('Sending')`);
    assert(isSending, 'Submit button transitions to "Sending Message..." loading state');

    // Wait for simulated network delay (600ms)
    await sleep(800);

    // Verify Toast Notification is displayed
    const toastStatus = await cdp.eval(`(() => {
      const toast = document.getElementById('toast-notification');
      const toastMsg = document.getElementById('toast-message').innerText;
      const hasOpacity100 = toast.classList.contains('opacity-100');
      const formReset = document.getElementById('contact-name').value === '';
      return { hasOpacity100, toastMsg, formReset };
    })()`);

    assert(toastStatus.hasOpacity100, 'Success Toast notification is active with opacity-100');
    assert(toastStatus.toastMsg.includes('Marcus'), `Toast personalized with user name: "${toastStatus.toastMsg}"`);
    assert(toastStatus.formReset, 'Form inputs automatically reset after submission');

    // Capture Toast Screenshot on Desktop
    await cdp.captureScreenshot(path.join(__dirname, 'screenshots', 'desktop-contact-toast-1440.png'), {
      x: 0, y: 0, width: 1440, height: 900, scale: 1
    });

    // Test Toast Dismiss button
    await cdp.eval(`document.getElementById('toast-close-btn').click()`);
    await sleep(400);
    const toastDismissed = await cdp.eval(`document.getElementById('toast-notification').classList.contains('opacity-0')`);
    assert(toastDismissed, 'Toast dismiss button correctly closes the notification');


    // ----------------------------------------------------
    // TEST SUITE 2: MOBILE VIEWPORT (390px - iPhone 14/15/16)
    // ----------------------------------------------------
    console.log('\n--- Running Mobile Tests (Viewport: 390 x 844) ---');
    await cdp.setViewport(390, 844, true);
    await cdp.eval(`window.scrollTo(0, 0)`);
    await sleep(500);

    // Test Horizontal Overflow Check
    const overflowCheck = await cdp.eval(`(() => {
      const scrollW = document.documentElement.scrollWidth;
      const clientW = document.documentElement.clientWidth;
      return { scrollW, clientW, noOverflow: scrollW <= clientW };
    })()`);
    assert(overflowCheck.noOverflow, `Zero horizontal scroll overflow on mobile (scrollWidth: ${overflowCheck.scrollW}px, clientWidth: ${overflowCheck.clientW}px)`);

    // Verify Services Stack Vertically on Mobile
    const mobileServices = await cdp.eval(`(() => {
      const cards = Array.from(document.querySelectorAll('#services .glass-card.glow-card'));
      return cards.map(c => {
        const r = c.getBoundingClientRect();
        return { top: Math.round(r.top + window.scrollY), height: Math.round(r.height) };
      });
    })()`);
    const isStacked = mobileServices[1].top >= (mobileServices[0].top + mobileServices[0].height - 20);
    assert(isStacked, `Services grid stacks into a single responsive column on Mobile`);

    // Test Mobile Navigation Hamburger Menu
    console.log('\n--- Testing Mobile Hamburger Navigation ---');
    const menuInitiallyHidden = await cdp.eval(`document.getElementById('mobile-menu').classList.contains('hidden')`);
    assert(menuInitiallyHidden, 'Mobile navigation menu is initially closed');

    // Click Hamburger
    await cdp.eval(`document.getElementById('mobile-menu-btn').click()`);
    await sleep(200);
    const menuNowOpen = await cdp.eval(`!document.getElementById('mobile-menu').classList.contains('hidden')`);
    assert(menuNowOpen, 'Clicking hamburger button opens mobile navigation drawer');

    // Capture Mobile Screenshot with Open Navigation
    await cdp.captureScreenshot(path.join(__dirname, 'screenshots', 'mobile-viewport-390.png'), {
      x: 0, y: 0, width: 390, height: 844, scale: 2
    });

    // Click a mobile link to verify auto-close
    await cdp.eval(`document.querySelector('.mobile-link[href="#services"]').click()`);
    await sleep(300);
    const menuAutoClosed = await cdp.eval(`document.getElementById('mobile-menu').classList.contains('hidden')`);
    assert(menuAutoClosed, 'Clicking mobile nav link automatically closes navigation drawer');

    // Verify 0 Console Errors
    console.log('\n--- Console Health & Stability Check ---');
    assert(cdp.consoleErrors.length === 0, `Page ran with 0 console errors (found: ${cdp.consoleErrors.length})`);

    console.log('\n==================================================');
    console.log(`   TEST RESULTS: ${testsPassed} / ${totalTests} TESTS PASSED (${Math.round((testsPassed / totalTests) * 100)}%)`);
    console.log('==================================================\n');

  } catch (err) {
    console.error('[Test Suite Error]:', err);
    process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    if (chromeProcess) chromeProcess.kill('SIGKILL');
    if (serverProcess) serverProcess.kill('SIGKILL');
    
    // Clean up temp chrome dir
    try {
      fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
    } catch (e) {}

    process.exit(process.exitCode || 0);
  }
}

runTestSuite();
