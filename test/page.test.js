const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const sourceScript = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));

function jsonResponse(status, body) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  });
}

function task(name, week, extra) {
  return Object.assign({
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    name,
    description: '',
    type: 'Checkbox',
    week
  }, extra || {});
}

const TORONTO_TASKS = [
  task('Read the guide handbook', 1),
  task('Reviewed contractor payroll SOP', 5),
  task('Shadow a ship', 5),
  task('Floor ready check-in', 6),
  task('Final debrief', 6)
];

const NYC_TASKS = [
  task('Welcome to the wave', 1),
  task('Practice class', 2),
  task('Floor ready check-in', 3),
  task('Read the NYC payroll guide (ADP)', 3),
  task('Team check-in', 3),
  task('Lead a section', 4),
  task('Floor weeks', 5)
];

const NYC_WEEKS = [
  { week: 1, label: 'Foundations', dates: 'Nov 9–15' },
  { week: 2, label: 'Practice', dates: 'Nov 16–22' },
  { week: 3, label: 'Support Guide', dates: 'Nov 23–29 · Floor ready Dec 1' },
  { week: 4, label: 'Lead weeks', dates: 'Dec 1–7' },
  { week: 5, label: 'Floor weeks', dates: 'Dec 8–14' }
];

function progressBody(city, name) {
  return {
    success: true,
    city,
    floorReady: false,
    resolved: [],
    progress: {
      intakeComplete: true,
      notionPageId: 'card-1',
      tasks: {},
      guideName: name,
      preferredName: name,
      legalName: name,
      marianaTekEmail: 'guide@example.com',
      needsNames: false
    }
  };
}

function waveBody(leads) {
  const nyc = { city: 'NYC', waveNumber: '6', season: 'Fall', year: '2026', trainingDays: 2, startDate: '2026-11-09' };
  const to = { city: 'Toronto', waveNumber: '12', season: 'Fall', year: '2026', trainingDays: 3, startDate: '2026-09-08' };
  if (!leads) {
    nyc.discordLeads = ['lead.nyc'];
    to.discordLeads = ['lead.toronto'];
  } else {
    if (Object.prototype.hasOwnProperty.call(leads, 'nyc')) nyc.discordLeads = leads.nyc;
    if (Object.prototype.hasOwnProperty.call(leads, 'toronto')) to.discordLeads = leads.toronto;
  }
  return { success: true, waves: [nyc, to] };
}

function apiFor(scenario) {
  return (url, opts) => {
    const parsed = new URL(String(url));
    const pathName = parsed.pathname;
    scenario.calls.push({ path: pathName, method: (opts && opts.method) || 'GET', body: opts && opts.body });
    if (scenario.status === 401) return jsonResponse(401, { success: false, error: 'Sign in required.' });
    if (pathName === '/api/progress/load') return jsonResponse(200, progressBody(scenario.cityName, scenario.guideName));
    if (pathName === '/api/tasks') return jsonResponse(200, scenario.tasks);
    if (pathName === '/api/wave-settings') return jsonResponse(200, scenario.waves || waveBody());
    if (pathName === '/api/newsletters') return jsonResponse(200, { success: true, newsletters: [] });
    if (pathName === '/api/guides') return jsonResponse(200, { success: true, guides: scenario.guides || [] });
    if (pathName === '/api/manager/sg-ready') return jsonResponse(scenario.sgStatus || 200, scenario.sgBody || { success: true });
    if (pathName === '/api/floor-ready') return jsonResponse(200, { success: true });
    return jsonResponse(404, { success: false, error: 'missing ' + pathName });
  };
}

async function boot(scenario) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', err => errors.push(String(err && err.message || err)));
  virtualConsole.on('error', err => errors.push(String(err && err.stack || err)));
  scenario.calls = [];
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.fetch = apiFor(scenario);
      if (scenario.signedIn !== false) {
        window.localStorage.setItem('othership_guide_token', 'test-token');
        window.localStorage.setItem('othership_guide_email', 'guide@example.com');
        window.localStorage.setItem('othership_guide_state:guide@example.com', JSON.stringify({
          guideEmail: 'guide@example.com',
          city: scenario.cityCode,
          intakeComplete: true,
          preferredName: scenario.guideName,
          guideName: scenario.guideName,
          legalName: scenario.guideName,
          marianaTekEmail: 'guide@example.com',
          needsNames: false,
          tasks: {}
        }));
      }
    }
  });
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (scenario.ready(dom.window)) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(errors.filter(msg => !/Could not load/i.test(msg)).length, 0, errors.join('\n'));
  assert.equal(scenario.ready(dom.window), true);
  return dom.window;
}

function weekLabels(window) {
  return [...window.document.querySelectorAll('.week')].map(week => ({
    label: week.querySelector('.week-label').textContent,
    dates: week.querySelector('.week-dates').textContent,
    tasks: [...week.querySelectorAll('.task-name')].map(node => node.textContent)
  }));
}

test('the page source no longer hardcodes Week 8 or Discord lead usernames', () => {
  assert.equal(/week\s*8/i.test(sourceScript), false);
  assert.equal(html.includes('tanyacurley'), false);
  assert.equal(html.includes('lindsey_69123'), false);
  assert.equal(html.includes('Lawrencekiki'), false);
  assert.equal(html.includes('amandalaine'), false);
});

test('Toronto guide keeps Week N headers, floor ready at the end of week 6, and rates after payroll', async () => {
  const window = await boot({
    cityCode: 'toronto',
    cityName: 'Toronto',
    guideName: 'Casey Morgan',
    tasks: { success: true, tasks: TORONTO_TASKS },
    ready: win => win.document.querySelectorAll('.week').length === 3
  });
  const weeks = weekLabels(window);
  assert.deepEqual(weeks.map(week => week.label), ['Week 1', 'Week 5', 'Week 6']);
  assert.deepEqual(weeks.map(week => week.dates), ['', '', '']);
  assert.deepEqual(weeks[1].tasks, ['Reviewed contractor payroll SOP', 'Review Guide Rates', 'Shadow a ship']);
  assert.deepEqual(weeks[2].tasks, ['Final debrief', 'Floor ready check-in']);
  assert.equal(window.document.getElementById('meta-city').textContent, 'Toronto');
  window.applyCprContent();
  assert.match(window.document.getElementById('cpr-content').textContent, /required before you can work on the floor/i);
  assert.doesNotMatch(window.document.getElementById('cpr-content').textContent, /week 8/i);
  assert.equal(window.document.getElementById('cpr-sub').textContent, 'Required before you can work on the floor. Read the instructions for your city.');
  window.acknowledgeCpr();
  assert.equal(window.document.getElementById('toast').textContent, 'CPR noted — required before you can work on the floor');
});

test('NYC Path 1 uses week labels and keeps floor ready last in week 3, with rates after the ADP card', async () => {
  const window = await boot({
    cityCode: 'nyc',
    cityName: 'NYC',
    guideName: 'Jordan Blake',
    tasks: { success: true, track: 'nyc-path1', weeks: NYC_WEEKS, tasks: NYC_TASKS },
    ready: win => win.document.querySelectorAll('.week').length === 5
  });
  const weeks = weekLabels(window);
  assert.deepEqual(weeks.map(week => week.label), [
    'Week 1 · Foundations',
    'Week 2 · Practice',
    'Week 3 · Support Guide',
    'Week 4 · Lead weeks',
    'Week 5 · Floor weeks'
  ]);
  assert.equal(weeks[2].dates, 'Nov 23–29 · Floor ready Dec 1');
  assert.equal(weeks.some(week => week.label === 'Week 6'), false);
  assert.deepEqual(weeks[2].tasks, [
    'Read the NYC payroll guide (ADP)',
    'Review Guide Rates',
    'Team check-in',
    'Floor ready check-in'
  ]);
  window.applyCprContent();
  assert.match(window.document.getElementById('cpr-content').textContent, /required within 30 days of going floor ready/i);
  assert.doesNotMatch(window.document.getElementById('cpr-content').textContent, /before you can work on the floor/i);
  assert.doesNotMatch(window.document.getElementById('cpr-sub').textContent, /week 8/i);
  window.acknowledgeCpr();
  assert.equal(window.document.getElementById('toast').textContent, 'CPR noted — required within 30 days of going floor ready');
  const friends = window.document.getElementById('discord-friends');
  window.updateDiscordPanel();
  assert.equal(friends.hidden, false);
  assert.match(window.document.getElementById('discord-usernames').textContent, /@lead\.nyc/);
});

test('missing week labels and an empty Discord lead list fall back without breaking the page', async () => {
  const window = await boot({
    cityCode: 'nyc',
    cityName: 'NYC',
    guideName: 'Jordan Blake',
    tasks: { success: true, tasks: NYC_TASKS },
    waves: waveBody({ nyc: [], toronto: [] }),
    ready: win => win.document.querySelectorAll('.week').length === 5
  });
  const weeks = weekLabels(window);
  assert.deepEqual(weeks.map(week => week.label), ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5']);
  assert.deepEqual(weeks.map(week => week.dates), ['', '', '', '', '']);
  assert.equal(weeks[2].tasks[weeks[2].tasks.length - 1], 'Floor ready check-in');
  assert.equal(weeks.some(week => week.label === 'Week 6'), false);
  window.updateDiscordPanel();
  assert.equal(window.document.getElementById('discord-friends').hidden, true);
  assert.equal(window.document.getElementById('discord-usernames').textContent, '');
  assert.equal(window.document.getElementById('discord-username-heading').textContent, 'Step 2 — Enter your Discord username');

  const moved = [
    { id: 'w1', label: 'Week 1', dates: '', tasks: [{ name: 'Welcome', floorReadyCard: false }] },
    { id: 'wunset', label: 'No week set', dates: '', tasks: [{ name: 'Floor ready check-in', floorReadyCard: true }] }
  ];
  window.placeFloorReadyLastInWeek6(moved);
  assert.deepEqual(moved.map(week => week.id), ['w1', 'w6']);
  assert.equal(moved[1].tasks[0].name, 'Floor ready check-in');

  const ratesFallback = [{ id: 'w1', label: 'Week 1', dates: '', tasks: [{ id: 'a', name: 'Welcome', floorReadyCard: false }] }];
  window.placeGuideRatesCard(ratesFallback);
  assert.equal(ratesFallback.some(week => week.id === 'w5'), true);
  const week5 = ratesFallback.find(week => week.id === 'w5');
  assert.equal(week5.tasks[0].name, 'Review Guide Rates');
});

test('Discord leads strip @ and a missing field hides the usernames line', async () => {
  const toronto = await boot({
    cityCode: 'toronto',
    cityName: 'Toronto',
    guideName: 'Casey Morgan',
    tasks: { success: true, tasks: TORONTO_TASKS },
    waves: waveBody({ toronto: ['@lead.toronto', '  '] }),
    ready: win => win.document.querySelectorAll('.week').length === 3
  });
  toronto.updateDiscordPanel();
  assert.equal(toronto.document.getElementById('discord-usernames').textContent, '@lead.toronto');
  assert.equal(toronto.document.getElementById('discord-friends').hidden, false);
  assert.equal(toronto.document.getElementById('discord-username-heading').textContent, 'Step 3 — Enter your Discord username');

  const nyc = await boot({
    cityCode: 'nyc',
    cityName: 'NYC',
    guideName: 'Jordan Blake',
    tasks: { success: true, tasks: NYC_TASKS },
    waves: waveBody({}),
    ready: win => win.document.querySelectorAll('.week').length === 5
  });
  nyc.updateDiscordPanel();
  assert.equal(nyc.document.getElementById('discord-friends').hidden, true);
});

function guide(partial) {
  return Object.assign({
    name: 'Casey Morgan',
    pct: 80,
    missing: [],
    status: 'track',
    discord: 'casey.m',
    city: 'Toronto',
    email: 'casey@example.com',
    obs: { ff: 'pass', sg: 'pass' },
    attendance: [true, true, true],
    training: [1, 2, 3, 4, 5, 6].map(week => ({ week, p: 100 })),
    floorReady: false
  }, partial);
}

async function showGuides(window, guides, city) {
  window.sessionStorage.setItem('mgr_city', city);
  window.sessionStorage.setItem('othership_manager_token', 'manager-token');
  window.fetch = (url, opts) => {
    const pathName = new URL(String(url)).pathname;
    window.__lastCall = { path: pathName, body: opts && opts.body };
    if (pathName === '/api/guides') return jsonResponse(200, { success: true, guides });
    if (pathName === '/api/manager/sg-ready') {
      window.__posted = opts && opts.body;
      return jsonResponse(window.__sgStatus || 200, window.__sgBody || { success: true });
    }
    if (pathName === '/api/floor-ready') return jsonResponse(200, { success: true });
    return jsonResponse(200, { success: true });
  };
  await window.loadRealGuides();
  return window.document.getElementById('gcards');
}

test('manager Toronto keeps the four checks, and NYC Path 1 uses eligibility, blockers, and SG Ready', async () => {
  const window = await boot({
    cityCode: 'toronto',
    cityName: 'Toronto',
    guideName: 'Casey Morgan',
    tasks: { success: true, tasks: TORONTO_TASKS },
    guides: [],
    ready: win => win.document.querySelectorAll('.week').length === 3
  });

  const torontoReady = await showGuides(window, [guide({})], 'toronto');
  assert.match(torontoReady.textContent, /Training complete/);
  assert.match(torontoReady.textContent, /CPR valid/);
  assert.match(torontoReady.textContent, /FF observation passed/);
  assert.match(torontoReady.textContent, /SG observation passed/);
  assert.match(torontoReady.textContent, /Mark floor ready/);
  assert.equal(torontoReady.textContent.includes('Approve SG Ready'), false);
  assert.equal(torontoReady.textContent.includes('Eligible for FF Ready'), false);

  const torontoBlocked = await showGuides(window, [guide({
    missing: ['CPR certificate'],
    obs: { ff: 'pass', sg: 'pending' },
    training: [{ week: 6, p: 40 }]
  })], 'toronto');
  assert.equal(torontoBlocked.textContent.includes('Mark floor ready'), false);
  assert.match(torontoBlocked.innerHTML, /floor-check-dot fail/);

  const nyc = await showGuides(window, [
    guide({
      name: 'Jordan Blake',
      city: 'NYC',
      email: 'jordan@example.com',
      discord: 'jordan.b',
      track: 'nyc-path1',
      floorReadyEligible: true,
      floorReadyBlockers: [],
      sgReady: false,
      sgReadyEligible: false,
      missing: ['CPR certificate'],
      obs: { ff: 'pass', sg: 'pending' },
      training: [{ week: 1, p: 100 }, { week: 4, p: 0 }, { week: 5, p: 0 }]
    }),
    guide({
      name: 'Riley Quinn',
      city: 'NYC',
      email: 'riley@example.com',
      discord: 'riley.q',
      track: 'nyc-path1',
      floorReady: true,
      floorReadyEligible: true,
      floorReadyBlockers: [],
      sgReady: false,
      sgReadyEligible: true,
      obs: { ff: 'pass', sg: 'pass' }
    }),
    guide({
      name: 'Avery Cole',
      city: 'NYC',
      email: 'avery@example.com',
      discord: 'avery.c',
      track: 'nyc-path1',
      floorReadyEligible: false,
      floorReadyBlockers: ['Week 2 tasks still open', 'FF Observation is not a pass'],
      obs: { ff: 'pending', sg: 'pending' },
      missing: ['CPR certificate']
    })
  ], 'nyc');
  const cards = [...nyc.querySelectorAll('.gcard')];
  assert.match(cards[0].textContent, /Eligible for FF Ready/);
  assert.match(cards[0].textContent, /Mark floor ready/);
  assert.equal(cards[0].textContent.includes('CPR valid'), false);
  assert.equal(cards[0].textContent.includes('Approve SG Ready'), false);
  assert.match(cards[1].textContent, /Approve SG Ready/);
  assert.equal(cards[1].textContent.includes('Mark floor ready'), false);
  assert.match(cards[2].textContent, /Week 2 tasks still open/);
  assert.match(cards[2].textContent, /FF Observation is not a pass/);
  assert.equal(cards[2].textContent.includes('Mark floor ready'), false);
  assert.equal(cards[2].textContent.includes('CPR valid'), false);

  const legacyNyc = await showGuides(window, [guide({
    name: 'Jordan Blake',
    city: 'NYC',
    email: 'jordan@example.com',
    track: 'nyc-path1',
    missing: ['CPR certificate'],
    obs: { ff: 'pass', sg: 'pass' }
  })], 'nyc');
  assert.match(legacyNyc.textContent, /CPR valid/);
  assert.equal(legacyNyc.textContent.includes('Mark floor ready'), false);

  await showGuides(window, [guide({
    name: 'Riley Quinn',
    city: 'NYC',
    email: 'riley@example.com',
    track: 'nyc-path1',
    floorReady: true,
    sgReady: false
  })], 'nyc');
  window.__sgStatus = 400;
  window.__sgBody = { success: false, error: 'SG observation has not passed.' };
  await window.markSgReady(0);
  assert.equal(window.document.getElementById('toast').textContent, 'SG observation has not passed.');

  window.__sgStatus = 200;
  window.__sgBody = { success: true };
  await window.markSgReady(0);
  assert.deepEqual(JSON.parse(window.__posted), { email: 'riley@example.com', city: 'nyc' });
  assert.equal(window.document.getElementById('toast').textContent, 'Riley Quinn — SG Ready approved.');
});

test('payroll report and CSV use server payroll, including alumni, and day buttons follow training slots', async () => {
  assert.equal(sourceScript.includes('HOURLY_RATE'), false);
  assert.equal(sourceScript.includes('guideTaskMinutes'), false);
  assert.equal(sourceScript.includes('TRAINING_DAY_MINUTES'), false);

  const window = await boot({
    cityCode: 'nyc',
    cityName: 'NYC',
    guideName: 'Jordan Blake',
    tasks: { success: true, tasks: NYC_TASKS },
    ready: win => win.document.querySelectorAll('.week').length === 5
  });

  const calls = [];
  const nycPayroll = {
    success: true,
    city: 'nyc',
    hourlyRate: 16,
    trainingSlots: [{ half: false }, { half: true }],
    totals: { kajabiMinutes: 60, otherMinutes: 30, inPersonMinutes: 0, totalMinutes: 90, hours: 6, pay: 108 },
    guides: [
      {
        name: 'Jordan Blake',
        discord: 'jordan.b',
        city: 'NYC',
        email: 'jordan@example.com',
        status: 'alumni',
        payroll: {
          kajabiMinutes: 60,
          otherMinutes: 0,
          inPersonMinutes: 0,
          totalMinutes: 60,
          hours: 5.5,
          pay: 100,
          hourlyRate: 16,
          daysAttended: 1.5,
          trainingDays: 2,
          attendanceRecorded: true,
          lines: [{ id: 'k1', name: 'Kajabi foundations', minutes: 60, category: 'kajabi' }],
          skippedInPersonCards: [{ id: 'ip1', name: 'Shadow on the floor' }]
        }
      },
      {
        name: 'Riley Quinn',
        discord: 'riley.q',
        city: 'NYC',
        email: 'riley@example.com',
        status: 'track',
        payroll: {
          kajabiMinutes: 0,
          otherMinutes: 30,
          inPersonMinutes: 0,
          totalMinutes: 30,
          hours: 0.5,
          pay: 8,
          daysAttended: 0,
          trainingDays: 2,
          attendanceRecorded: false,
          lines: [{ id: 'o1', name: 'Observation notes', minutes: 30, category: 'other' }],
          skippedInPersonCards: []
        }
      }
    ]
  };
  const torontoPayroll = {
    success: true,
    city: 'toronto',
    hourlyRate: 22,
    totals: { pay: 44, hours: 2, totalMinutes: 30 },
    guides: [
      {
        name: 'Casey Morgan',
        discord: 'casey.m',
        city: 'Toronto',
        email: 'casey@example.com',
        status: 'alumni',
        payroll: {
          kajabiMinutes: 0,
          otherMinutes: 30,
          inPersonMinutes: 0,
          totalMinutes: 30,
          hours: 2,
          pay: 44,
          hourlyRate: 22,
          daysAttended: 1,
          trainingDays: 3,
          attendanceRecorded: true,
          lines: [],
          skippedInPersonCards: []
        }
      }
    ]
  };

  window.fetch = (url, opts) => {
    const parsed = new URL(String(url));
    calls.push({
      path: parsed.pathname,
      search: parsed.search,
      method: (opts && opts.method) || 'GET',
      body: opts && opts.body,
      authorization: opts && opts.headers && opts.headers.Authorization
    });
    if (parsed.pathname === '/api/wave-settings') {
      return jsonResponse(200, {
        success: true,
        waves: [
          { city: 'NYC', waveNumber: '6', season: 'Fall', year: '2026', trainingDays: 2 },
          { city: 'Toronto', waveNumber: '12', season: 'Fall', year: '2026', trainingDays: 3 }
        ]
      });
    }
    if (parsed.pathname === '/api/guides') {
      const city = parsed.searchParams.get('city');
      const guides = city === 'toronto'
        ? [guide({ payroll: { attendanceRecorded: false } })]
        : [guide({
          name: 'Riley Quinn',
          city: 'NYC',
          email: 'riley@example.com',
          discord: 'riley.q',
          attendance: [true, false],
          payroll: { attendanceRecorded: false }
        })];
      return jsonResponse(200, { success: true, guides });
    }
    if (parsed.pathname === '/api/manager/payroll') {
      const city = parsed.searchParams.get('city');
      return jsonResponse(200, city === 'toronto' ? torontoPayroll : nycPayroll);
    }
    if (parsed.pathname === '/api/manager/attendance') return jsonResponse(200, { success: true });
    return jsonResponse(404, { success: false, error: 'missing ' + parsed.pathname });
  };

  window.sessionStorage.setItem('mgr_city', 'nyc');
  window.sessionStorage.setItem('othership_manager_token', 'manager-token');
  await window.loadWaveSettings();
  await window.loadRealGuides();
  let buttons = [...window.document.querySelectorAll('.day-btn')];
  assert.deepEqual(buttons.map(button => button.textContent), ['D1', 'D2']);
  assert.equal(buttons.some(button => button.classList.contains('half')), false);
  assert.match(window.document.getElementById('gcards').textContent, /Attendance not recorded/);

  calls.length = 0;
  await window.openPayrollReport();
  const payrollCalls = calls.filter(call => call.path === '/api/manager/payroll');
  assert.deepEqual(payrollCalls.map(call => call.search), ['?city=nyc']);
  assert.equal(payrollCalls.every(call => call.authorization === 'Bearer manager-token'), true);
  assert.equal(calls.some(call => call.path === '/api/tasks'), false);
  const report = window.document.getElementById('payroll-report-text').textContent;
  assert.equal(window.document.getElementById('modal-payroll-report').classList.contains('open'), true);
  assert.match(report, /Jordan Blake/);
  assert.match(report, /alumni/);
  assert.match(report, /Kajabi foundations/);
  assert.match(report, /Shadow on the floor/);
  assert.match(report, /1\.5\/2 days/);
  assert.match(report, /5\.50 hrs × \$16 = \$100\.00/);
  assert.match(report, /Attendance not recorded/);
  assert.match(report, /Observation notes/);
  assert.match(report, /CITY TOTAL: \$108\.00/);
  assert.doesNotMatch(report, /\$16\.00/);
  assert.doesNotMatch(report, /\$24\.00/);
  assert.match(window.document.getElementById('payroll-report-sub').textContent, /NYC \$108\.00/);

  buttons = [...window.document.querySelectorAll('.day-btn')];
  assert.equal(buttons.length, 2);
  assert.equal(buttons[1].classList.contains('half'), true);
  assert.equal(buttons[1].title, 'Half day · 240 min');
  assert.match(buttons[1].textContent, /½/);

  const files = [];
  window.URL.createObjectURL = blob => {
    files.push(blob);
    return 'blob:payroll';
  };
  window.URL.revokeObjectURL = () => {};
  window.exportPayrollCSV();
  assert.equal(files.length, 1);
  const csv = await new Promise((resolve, reject) => {
    const reader = new window.FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(files[0]);
  });
  assert.match(csv, /Jordan Blake/);
  assert.match(csv, /alumni/);
  assert.match(csv, /Kajabi foundations \(kajabi\) — 60 min/);
  assert.match(csv, /Shadow on the floor/);
  assert.match(csv, /5\.50/);
  assert.match(csv, /\$100\.00/);
  assert.match(csv, /\$108\.00/);
  assert.match(csv, /Attendance not recorded/);
  assert.doesNotMatch(csv, /\$16\.00/);
  assert.equal(calls.some(call => call.path === '/api/tasks'), false);

  buttons[1].click();
  await new Promise(resolve => setTimeout(resolve, 0));
  const posted = calls.filter(call => call.path === '/api/manager/attendance').pop();
  assert.equal(posted.method, 'POST');
  assert.deepEqual(JSON.parse(posted.body), { email: 'riley@example.com', city: 'nyc', days: [true, true] });
  assert.equal(window.document.getElementById('gcards').textContent.includes('Attendance not recorded'), false);
  window.genAttendanceSummary();
  assert.match(window.document.getElementById('attendance-text').textContent, /1\.5\/1\.5 days: Riley Quinn/);

  window.sessionStorage.setItem('mgr_city', 'toronto');
  calls.length = 0;
  await window.loadRealGuides();
  buttons = [...window.document.querySelectorAll('.day-btn')];
  assert.deepEqual(buttons.map(button => button.textContent), ['D1', 'D2', 'D3']);
  assert.equal(buttons.some(button => button.classList.contains('half')), false);
  await window.openPayrollReport();
  assert.deepEqual(calls.filter(call => call.path === '/api/manager/payroll').map(call => call.search), ['?city=toronto']);
  const torontoReport = window.document.getElementById('payroll-report-text').textContent;
  assert.match(torontoReport, /Casey Morgan/);
  assert.match(torontoReport, /alumni/);
  assert.match(torontoReport, /\$22/);
  assert.match(torontoReport, /\$44\.00/);
  assert.doesNotMatch(torontoReport, /\$16/);
  assert.equal(calls.some(call => call.path === '/api/tasks'), false);

  window.sessionStorage.setItem('mgr_city', 'both');
  calls.length = 0;
  await window.openPayrollReport();
  assert.deepEqual(calls.filter(call => call.path === '/api/manager/payroll').map(call => call.search), ['?city=nyc', '?city=toronto']);
  assert.match(window.document.getElementById('payroll-report-text').textContent, /COMBINED PAY/);

  window.closeModal('modal-payroll-report');
  window.fetch = () => jsonResponse(401, { success: false, error: 'Sign in required.' });
  await window.openPayrollReport();
  assert.equal(window.document.getElementById('modal-payroll-report').classList.contains('open'), false);
});

test('a signed-out page stays on the login screen', async () => {
  const scenario = {
    signedIn: false,
    ready: win => win.document.getElementById('login-screen') && !win.document.getElementById('login-screen').classList.contains('hidden')
  };
  const window = await boot(scenario);
  assert.equal(scenario.calls.length, 0);
  assert.equal(window.document.getElementById('login-screen').classList.contains('hidden'), false);
});

test('an unauthenticated API response is handled without throwing', async () => {
  const window = await boot({
    cityCode: 'toronto',
    cityName: 'Toronto',
    guideName: 'Casey Morgan',
    status: 401,
    ready: win => !win.guideToken() && win.document.getElementById('login-screen') && !win.document.getElementById('login-screen').classList.contains('hidden')
  });
  assert.equal(window.document.getElementById('login-screen').classList.contains('hidden'), false);
  assert.match(window.document.getElementById('toast').textContent, /sign in/i);
});

test('the live API rejects unauthenticated calls', async () => {
  const tasks = await fetch('https://othership-onboarding-backend.onrender.com/api/tasks');
  const wave = await fetch('https://othership-onboarding-backend.onrender.com/api/wave-settings');
  assert.equal(tasks.status, 401);
  assert.equal(wave.status, 401);
  const body = await tasks.json();
  assert.equal(body.success, false);
});
