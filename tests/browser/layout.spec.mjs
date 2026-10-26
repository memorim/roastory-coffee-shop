import {test,expect} from '@playwright/test';

for(const width of [1280,1440]){
 test(`story heading stays inside the page at ${width}px and desktop 150%`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.goto('/');await page.evaluate(()=>document.fonts.ready);
  expect(await page.evaluate(()=>getComputedStyle(document.documentElement).zoom)).toBe('1.5');
  const bounds=await page.locator('.story-copy h2').evaluate(heading=>{
   const text=document.createRange();text.selectNodeContents(heading);
   return {right:text.getBoundingClientRect().right,page:innerWidth,scroll:document.documentElement.scrollWidth};
  });
  expect(bounds.right).toBeLessThanOrEqual(bounds.page+1);
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.page+1);
 });
}
