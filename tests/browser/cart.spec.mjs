import {test,expect} from '@playwright/test';
test('catalog, cart bounds, keyboard close and malformed storage recovery',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('roastory-cart','{broken'));
 await page.goto('/');await expect(page.locator('.product')).toHaveCount(6);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
 await page.locator('[data-process="Мытая"]').click();await expect(page.locator('.product')).toHaveCount(2);
 await page.locator('[data-add]').first().click();await expect(page.locator('.cart')).toHaveClass(/open/);
 await page.keyboard.press('Escape');await expect(page.locator('.cart')).not.toHaveClass(/open/);
 await expect(page.locator('[data-add]').first()).toBeFocused();
});
test('network failure preserves cart and retry operation key',async({page})=>{
 const keys=[];let attempts=0;
 await page.route('**/api/orders',async route=>{keys.push(route.request().headers()['idempotency-key']);if(attempts++===0)await route.abort();else await route.fulfill({status:200,contentType:'application/json',body:'{"id":777,"total":1090,"status":"new"}'});});
 await page.goto('/');await page.locator('[data-add]').first().click();await page.locator('[name=customer]').fill('Retry customer');await page.locator('[name=email]').fill('retry@example.test');
 await page.locator('#checkout button').click();await expect(page.locator('.order-success')).toContainText('Не удалось');await expect(page.locator('#cart-count')).toHaveText('1');
 await page.locator('#checkout button').click();await expect(page.locator('.order-success')).toContainText('сохранён');await expect(page.locator('#cart-count')).toHaveText('0');
 expect(keys).toHaveLength(2);expect(keys[0]).toBeTruthy();expect(keys[1]).toBe(keys[0]);
});
test('unavailable catalog has an actionable retry',async({page})=>{
 await page.route('**/api/products*',r=>r.fulfill({status:503,contentType:'application/json',body:'{}'}));await page.goto('/');await expect(page.getByRole('button',{name:'Повторить загрузку'})).toBeVisible();await page.unroute('**/api/products*');await page.getByRole('button',{name:'Повторить загрузку'}).click();await expect(page.locator('.product')).toHaveCount(6);
});

test('saved cart removes unknown products and never exceeds ten of one SKU',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('roastory-cart',JSON.stringify({1:10,2:-1,999:4})));
 await page.goto('/');await expect(page.locator('#cart-count')).toHaveText('10');await page.locator('[data-add="1"]').click();await expect(page.locator('#cart-count')).toHaveText('10');await expect(page.locator('#cart-total')).toHaveText('10 900 ₽');await page.locator('[data-remove="1"]').click();await expect(page.locator('#cart-count')).toHaveText('0');
});
