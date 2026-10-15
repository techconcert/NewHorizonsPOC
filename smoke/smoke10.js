const { boot, shot, text, buttons } = require('./lib');

const inPlanet = async (page) => /Back to galaxy/.test(await text(page));
async function card(page, tag) {
  await page.waitForTimeout(500);
  const lines = (await text(page)).split('\n').filter((l) => l.length > 3);
  console.log(`  [card ${tag}]`, lines.slice(0, 18).join(' / '));
  await shot(page, `09-card-${tag}`);
  await page.keyboard.press('1');
  await page.waitForTimeout(700);
}

(async () => {
  const { page, errors, close } = await boot();
  await page.mouse.click(620, 453);
  await page.waitForTimeout(400);
  await page.click('button:has-text("Launch")');
  await page.waitForTimeout(500);
  await page.click('button:has-text("4x")');
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(1500);
    const t = await text(page);
    if (/Event card pending/i.test(t)) { await card(page, 'transit' + i); continue; }
    if (/\nArrived\n/.test(t)) break;
  }
  await page.click('button:has-text("Pause")');
  await page.click('button:has-text("Open planet")');
  await page.waitForTimeout(800);
  await page.click('button:has-text("Land the expedition")');
  await page.waitForTimeout(800);

  for (let round = 0; round < 3; round++) {
    if (!(await inPlanet(page))) { console.log('LEFT planet view before round', round); await shot(page, '09-left'); break; }
    const seen = await page.$$('button:has-text(", seen")');
    if (!seen.length) { console.log('no seen regions'); break; }
    const label = (await seen[0].textContent()).trim();
    await seen[0].click();
    await page.waitForTimeout(250);
    await page.click('button:has-text("Explore this region")');
    await page.waitForTimeout(250);
    const confirm = await page.$('button:has-text("Confirm: explore")');
    await confirm.click();
    await page.waitForTimeout(300);
    console.log(`round ${round}: exploring "${label}"`);
    await page.click('button:has-text("4x")');
    let done = false;
    for (let i = 0; i < 25; i++) {
      await page.waitForTimeout(800);
      const t = await text(page);
      if (/Event card pending/i.test(t)) { await card(page, `r${round}-${i}`); continue; }
      if (/rounds done/.test(t)) {
        const m = t.match(/(\d+) of \d+ regions explored, (\d+) rounds? done/);
        if (m && Number(m[2]) > round) { done = true; break; }
      }
    }
    await page.click('button:has-text("Pause")');
    await page.waitForTimeout(400);
    const t = await text(page);
    const li = t.search(/LAST ROLL|Last roll|last roll/);
    console.log('  done:', done, '| status:', (t.match(/\d+ of \d+ regions explored[^\n]*/) || [''])[0], '| roll:', li >= 0 ? t.slice(li, li + 420).replace(/\n/g, ' | ') : '(no roll panel)');
    await shot(page, `09-round-${round}`);
  }
  if (await inPlanet(page)) {
    const exploredBtn = await page.$('button:has-text(", explored")');
    console.log('explored region button:', exploredBtn ? (await exploredBtn.textContent()).trim() : null);
    const all = await page.$$('button:has-text("Region")');
    let pick = null;
    for (const b of all) { const tx = (await b.textContent()).trim(); if (/Farmland|explored/.test(tx) && !/seen|unknown/.test(tx)) { pick = b; console.log('picking site:', tx); break; } }
    if (pick) { await pick.click(); await page.waitForTimeout(400); }
    const t = await text(page);
    const fi = t.indexOf('FOUND COLONY');
    console.log('FOUNDING PANEL:', t.slice(fi, fi + 2200).replace(/\n/g, ' | '));
    await shot(page, '09-before-found');
    const found = await page.$('button:has-text("Found colony here")');
    console.log('found button enabled:', found ? await found.isEnabled() : null);
    if (found && (await found.isEnabled())) {
      await found.click();
      await page.waitForTimeout(500);
      const bs = (await buttons(page)).filter((b) => !/^Region/.test(b));
      console.log('buttons after found click:', bs);
      const c = bs.find((b) => /^Confirm/.test(b) && !/course|explore/i.test(b));
      console.log('confirm candidate:', c);
      if (c) { const cb = await page.$(`button:has-text("${c}")`); if (cb && (await cb.isEnabled())) { await cb.click(); await page.waitForTimeout(800); } }
      await page.click('button:has-text("4x")');
      await page.waitForTimeout(3500);
      await page.click('button:has-text("Pause")');
      await shot(page, '09-after-found');
      const t2 = await text(page);
      console.log('AFTER FOUND:', t2.slice(0, 1800).replace(/\n/g, ' | '));
      console.log('HUD:', (t2.match(/Colonies:[^\n]*/) || [''])[0]);
    }
  }
  await close();
  console.log('errors:', errors);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
