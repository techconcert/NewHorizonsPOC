// M5 check: found colony, build district, save, reload page, load, verify state; then run long and look for end screen.
const { boot, shot, text, buttons, pickStar } = require('./lib');
(async () => {
  const { page, errors, close } = await boot('?seed=' + (process.env.SEED || 42), { width: 1440, height: 900 });
  console.log('picked', await pickStar(page));
  await page.click('button:has-text("Launch")'); await page.waitForTimeout(500);
  await page.click('button:has-text("4x")');
  for (let i = 0; i < 60; i++) { await page.waitForTimeout(1500); const t = await text(page);
    if (/Event card pending/i.test(t)) { await page.waitForTimeout(500); await page.keyboard.press('1'); continue; }
    if (/\nArrived\n/.test(t)) break; }
  await page.click('button:has-text("Pause")'); await page.click('button:has-text("Open planet")'); await page.waitForTimeout(800);
  await page.click('button:has-text("Land the expedition")'); await page.waitForTimeout(800);
  for (let r = 0; r < 2; r++) {
    const seen = await page.$$('button:has-text(", seen")'); if (!seen.length) break;
    await seen[0].click(); await page.waitForTimeout(250);
    await page.click('button:has-text("Explore this region")'); await page.waitForTimeout(250);
    await (await page.$('button:has-text("Confirm: explore")')).click(); await page.waitForTimeout(300);
    await page.click('button:has-text("4x")');
    for (let i = 0; i < 25; i++) { await page.waitForTimeout(800); const t = await text(page);
      if (/Event card pending/i.test(t)) { await page.waitForTimeout(500); await page.keyboard.press('1'); continue; }
      const m = t.match(/(\d+) of \d+ regions explored, (\d+) rounds? done/); if (m && Number(m[2]) > r) break; }
    await page.click('button:has-text("Pause")'); await page.waitForTimeout(300);
  }
  const reg = (await page.$$('button:has-text(", explored")'))[0]; if (reg) await reg.click();
  await page.waitForTimeout(300);
  await page.click('button:has-text("Found colony here")'); await page.waitForTimeout(400);
  const c = (await buttons(page)).find((b) => /^Confirm: found/.test(b)); console.log('confirm:', c);
  await page.click(`button:has-text("${c}")`); await page.waitForTimeout(800);
  console.log('buttons now:', (await buttons(page)).filter((b) => !/^Region/.test(b)));
  const t0 = await text(page); const ci = t0.indexOf('COLONY'); console.log('COLONY PANEL:', t0.slice(ci, ci + 1500).replace(/\n/g, ' | '));
  await shot(page, '11-colony');
  // try building
  const builds = (await buttons(page)).filter((b) => /^Build/.test(b)); console.log('build buttons:', builds);
  if (builds.length) { await page.click(`button:has-text("${builds[0]}")`); await page.waitForTimeout(400); }
  await page.click('button:has-text("4x")'); await page.waitForTimeout(6000); await page.click('button:has-text("Pause")');
  const t1 = await text(page); console.log('AFTER 6s:', t1.slice(0, 200).replace(/\n/g, ' | ')); const c1 = t1.indexOf('COLONY'); console.log(t1.slice(c1, c1 + 900).replace(/\n/g, ' | '));
  const day1 = (t1.match(/Day (\d+)/) || [])[1];
  await page.click('button:has-text("Save game")'); await page.waitForTimeout(1200);
  console.log('after save:', (await text(page)).match(/[^\n]*[Ss]av[^\n]*/g));
  await page.reload(); await page.waitForTimeout(2000);
  console.log('after reload day:', ((await text(page)).match(/Day (\d+)/) || [])[1], 'saved day was', day1);
  const lb = await page.$('button:has-text("Load game")'); console.log('load button', !!lb, lb && await lb.isEnabled());
  if (lb) { await lb.click(); await page.waitForTimeout(2000); }
  const t2 = await text(page); console.log('after load:', t2.slice(0, 260).replace(/\n/g, ' | '));
  await shot(page, '11-loaded');
  const bs = await buttons(page); console.log('LOADED buttons:', bs);
  const full = await text(page); const k = full.indexOf('COLONIES'); console.log('COLONIES PANEL:', full.slice(k, k + 1800).replace(/\n/g, ' | '));
  const site = await page.$('button:has-text("Site 1")'); if (site) { await site.click(); await page.waitForTimeout(300); }
  const bs2 = await buttons(page); console.log('after site pick:', bs2.filter((x) => /Build/.test(x)));
  const b = bs2.find((x) => /^Build Farm/.test(x));
  if (b) { await page.click(`button:has-text("${b}")`); await page.waitForTimeout(500); await page.click('button:has-text("4x")'); await page.waitForTimeout(8000); await page.click('button:has-text("Pause")');
    const t3 = await text(page); const k3 = t3.indexOf('COLONIES'); console.log('AFTER BUILD:', t3.slice(0, 120).replace(/\n/g, ' | '), '||', t3.slice(k3, k3 + 1200).replace(/\n/g, ' | ')); await shot(page, '11-built'); }

  await close(); console.log('errors:', errors);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
