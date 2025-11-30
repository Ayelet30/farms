const { test, expect } = require('@playwright/test');

test('login-parent flow works', async ({ page }) => {
  // 1. ניגשים לדף הלוגין
  await page.goto('/');

  // 2. ממלאים דוא"ל וסיסמה
 // await page.getByLabel('דוא"ל').fill('shohamdimri@gmail.com');
  await page.locator('#email').fill('shohamdimri@gmail.com'); 

  // שימי לב לשורת הסיסמה – שינינו:
 // await page.locator('#password').fill('1234567');
  // או:
  await page.getByRole('textbox', { name: 'סיסמה' }).fill('1234567');

  // 3. לוחצים על כפתור "התחבר"
  await page.getByRole('button', { name: 'התחבר' }).click();

  // 4. מוודאים שהתחברות הצליחה – צריך לשים פה טקסט אמיתי שקיים אחרי לוגין
 // await expect(page.getByText('הילדים שלי')).toBeVisible();
  // או:
  await expect(page).toHaveURL(/parent/);
});
