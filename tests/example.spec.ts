import { test, expect, Page, Locator } from '@playwright/test';
import path from 'path';

test('loggin success' , async({page}) =>

  {

await page.goto('/'); 

await page.getByLabel('emsil').fill("shohamdimri@gmail.com"); 
await page.getByLabel('password').fill('1234567'); 
await page.getByRole('button').click(); 

await expect(page).toHaveURL('/home');  
await expect(page).toHaveTitle('welcome'); 

  });

test('login fail with wrong password' , async({page})=>{

await page.goto('/'); 
await page.getByLabel("email").fill("shohamdimri@gmail.com"); 
await page.getByLabel("password").fill("wrong-pass"); 
await page.getByRole("button" , {name: "login"}).click(); 
await expect(page.getByText('invalid email or password')).toBeVisible(); 

}); 

test ('add item' ,async ({page}) => {

  await page.goto('/'); 

await page.getByLabel("item name").fill("new-item"); 
await page.getByLabel('description').fill("description..."); 
await page.getByRole('button' , {name: "add-item"}).click(); 

const row = page.getByRole("row" , {name: "new-item"}); 
await expect (row).toBeVisible(); 


});

test("settings-page" , async({page})=>{

await page.goto('/'); 
await page.getByRole("link" , {name:"settings"}).click();
await expect(page).toHaveURL('/settings'); 
await expect(page.getByRole('heading' , {name: 'Settings'})).toBeVisible(); 

});

test('loader appear' , async({page}) => {

await page.goto('/');
await page.getByLabel('email').fill("shohamdimri@gmail.com"); 
await page.getByLabel('password').fill('1234567'); 
await page.getByRole('button' , {name:'login'}).click(); 

const loader = page.locator('.login-loading'); 

await expect (loader).toBeVisible(); 
await expect (loader).toBeHidden(); 
await expect(page.getByText('my-childern')).toBeVisible(); 

}); 

test('email is required' , async({page}) => {

await page.goto('/'); 
await page.getByLabel('email').fill(''); 
await page.getByLabel('password').fill("1234567"); 
await page.getByRole('button' , {name:'login'}).click(); 
const massage = page.getByText('email is required'); 
await expect(massage).toBeVisible(); 

}); 

test('login-success' , async({page}) => {

await page.goto('/login'); 
await page.getByLabel('email').fill('shohamdimri@gmail.com'); 
await page.getByLabel('password').fill('1234567');
await page.getByRole('button' , {name:'login'}).click(); 
await expect (page.getByText('welcome')).toBeVisible();   
}); 

test('add user work' , async({page})=>{

await page.goto('/'); 
await page.getByLabel('First name').fill('first'); 
await page.getByLabel('Last name').fill('last'); 
await page.getByLabel('email').fill('shohamdimri@gmail.com'); 
await page.getByRole('button' , {name:'add user'}).click(); 

await expect(page.getByRole('row' , {name:/first name/})).toBeVisible(); 

}); 

test('Email is required' , async({page})=>{

await page.goto('/'); 
await page.getByLabel('email').fill(''); 
await page.getByRole('button' , {name: 'submit'}).click(); 
expect(page.getByText('Email is required')).toBeVisible(); 
}); 

test('' , async({page}) =>{
await page.goto('/menu'); 
await page.getByRole('link' , {name:'Settings'}).click(); 
//expect(page.getByTitle('Settings')).toBeVisible(); 
expect(page.getByRole('heading' , {name:'Settings'})).toBeVisible(); 

}); 


test('delete user' , async({page})=>{
await page.goto('/users'); 
await page.getByRole('button' , {name:/delete shoham huri/}).click(); 
await page.getByRole('button' , {name:'Confirm'}).click(); 
expect(page.getByText('Shoham huri')).toBeHidden(); 

}); 

test('loading hidden' , async({page})=>{

await page.goto('/'); 
await page.getByRole('button' , {name:'Login'}).click(); 
const loader = page.getByText('Loading...'); 
await expect(loader).toBeVisible(); 
await expect(loader).toBeHidden(); 


});

test('choose country' , async({page})=>{
await page.goto('/'); 
await page.getByLabel('Country').selectOption('Israel'); 
await page.getByRole('button' , {name:'contunue'}).click(); 


}); 

test('click on element' , async ({page})=>{

  await page.goto('/'); 
  await page.getByRole('listitem' , {name:'Shoham'}).click(); 

}); 

test('profile' , async({page})=>
{
await page.goto('/profile'); 
await expect(page.getByRole('heading' , {name:'Profile'})).toBeVisible(); 

}); 


test('second-button naamed Edit' , async({page})=>{
await page.goto('/'); 
await page.getByRole('button' , {name:'Edit'}).nth(1).click(); 



}); 

//-----בדיקות על קובץ html שהצאט הביא -----//

test('1' , async({page})=>{
await page.goto('tasks'); 
await expect(page.getByRole('heading' , {name:'Task Manager'})).toBeVisible(); 
await expect(page.getByText('Welcome back, Shoham!')).toBeVisible(); 
}); 

test('2' , async({page})=>{
await page.goto('/tasks'); 
const table = page.getByRole('table' , {name:'Tasks table'}); 
expect(table).toBeVisible(); 
const rows = page.getByTestId('task-row'); 
await expect(rows).toHaveCount(3); 
await expect(rows).toContainText(['Write Playwright tests']); 
}); 

test('3' , async({page})=>{
await page.goto('/'); 
// await page.getByRole('button' , {name:'Add Task'}).click(); 
await page.getByTestId('add-task-button').click(); 
await expect(page.getByRole('dialog' , {name:'Add task dialog'})).toBeVisible(); 
// await expect(page.getByTestId('add-task-dialog')).toBeVisible(); 
await expect(page.getByRole('heading' , {name:'Add new task'})).toBeVisible(); 
}); 

test('4' , async({page})=>{
await page.goto('/tasks'); 
await page.getByTestId('add-task-btn').click(); 
await expect(page.getByTestId('add-task-dialog')).toBeVisible(); 
await page.getByRole('button' , {name:'Save'}).click(); 
await expect(page.getByTestId('task-form-error')).toBeVisible(); 
await expect(page.getByTestId('task-form-error')).toHaveText('Title is required'); 
}); 

test('5' , async({page})=>{
await page.goto('/tasks'); 
await page.getByTestId('add-task-btn').click(); 
const dialog = page.getByTestId('add-task-dialog'); 
await expect(dialog).toBeVisible(); 
await dialog.getByLabel('title').fill('fix login bug'); 
await dialog.getByLabel('assignee').fill('Noam'); 
await dialog.getByLabel('status').selectOption('Open'); 
await dialog.getByRole('button' , {name:'Save'}).click(); 
await expect(dialog).toBeHidden();
const rows = page.getByTestId('task-row'); 
await expect(rows).toContainText(['Fix login bug']); 

}); 

test('6' , async({page})=>{
await page.goto('tasks');
const table = page.getByRole('table' , {name:'tasks-table'}); 
const setup_row = table.getByRole('row' , {name: 'setup CI pipline'}); 
await expect(setup_row).toBeVisible(); 
await setup_row.getByRole('button' , {name:'Delelte'}).click(); 
const delete_dialog = page.getByTestId('delete-dialog'); 
await expect(delete_dialog).toBeVisible(); 
await expect(setup_row).toBeHidden(); 

}); 

test('7' , async({page})=>{
await page.goto('tasks'); 
await page.locator('#show-completed-only').check(); 
const tasks = page.getByTestId('tasks-table');
const rows = tasks.getByRole('row'); 
const non_done_rows = rows.filter({hasNotText:'Done'}); 
await expect(non_done_rows).toHaveCount(0); 
expect(rows).not.toContainText(['Build login page'])
}); 

test('8' , async({page})=>{
await page.goto('/tasks'); 
await expect(page.getByTestId('global-error')).toBeHidden(); 
await page.getByTestId('simulate-error-btn').click(); 
const global_error = page.getByTestId('glbal-error'); 
await expect(global_error).toBeVisible(); 
await expect(global_error).toHaveText('Something went wrong. Please try again'); 
}); 

//-------------השאלות:-----------//
// חלק א' – השאלות (נסי לפתור לבד!)
// 🔹 שאלה 1 – בדיקה בסיסית של טעינת הדף

// כתבי טסט שבודק שכשנכנסים ל־/tasks:

// הכותרת הראשית "Task Manager" מופיעה.

// יש טקסט "Welcome back, Shoham!".

// 🔹 שאלה 2 – בדיקת קיום טבלה ושורות

// כתבי טסט שבודק:

// שטבלת המשימות (Tasks table) קיימת.

// שיש בה לפחות 3 שורות משימה (tr עם data-testid="task-row").

// אחת השורות מכילה את הכותרת "Write Playwright tests".

// 🔹 שאלה 3 – פתיחת מודאל "Add Task"

// כתבי טסט שבודק:

// לחיצה על הכפתור "Add Task" (עם data-testid="add-task-btn") פותחת את המודאל עם role="dialog" ו־aria-label="Add task dialog".

// בתוך המודאל מופיע הכותרת "Add new task".

// 🔹 שאלה 4 – ולידציה בטופס הוספת משימה

// בהתבסס על הטופס במודאל "Add task":

// כתבי טסט שפותח את המודאל.

// לוחץ על "Save" בלי למלא כותרת.

// בודק שהודעת השגיאה "Title is required." (עם data-testid="task-form-error") מופיעה.

// 🔹 שאלה 5 – הוספת משימה חדשה לטבלה

// נניח שהלוגיקה עושה:

// מילוי הטופס ולחיצה על "Save" → מוסיף שורה חדשה לטבלה עם הכותרת החדשה.

// כתבי טסט ש:

// פותח את מודאל "Add task".

// ממלא:

// Title: "Fix login bug"

// Assignee: "Noam"

// Status: "Open"

// לוחץ "Save".

// בודק שהמודאל נסגר.

// בודק שהטבלה מכילה שורה חדשה עם הטקסט "Fix login bug".

// (תניחי ש־JS מוסיף שורה חדשה בסוף הטבלה.)

// 🔹 שאלה 6 – מחיקת משימה

// נניח שהלוגיקה היא:

// לחיצה על כפתור "Delete" בשורה → פותחת מודאל "Delete task".

// לחיצה על "Confirm" → מוחקת את השורה.

// כתבי טסט ש:

// מאתר את השורה שבה מופיע "Setup CI pipeline".

// לוחץ על כפתור "Delete" באותה שורה.

// בודק שמודאל "Delete task" מופיע.

// לוחץ "Confirm".

// בודק שהשורה "Setup CI pipeline" כבר לא קיימת בטבלה.

// 🔹 שאלה 7 – צ'קבוקס "Show completed only"

// נניח שה־checkbox עם id "show-completed-only":

// כשהוא מסומן → הטבלה מציגה רק משימות במצב "Done" (ב־HTML יש data-status="done" על שורות כאלה).

// שאר השורות נעלמות.

// כתבי טסט ש:

// מסמן את ה־checkbox "Show completed only".

// בודק שכל השורות שמוצגות מכילות "Done".

// בודק ש"Build login page" לא מופיעה.

// 🔹 שאלה 8 – הודעת שגיאה כללית

// נניח שבתרחיש כלשהו (לדוגמה כישלון שרת), האלמנט:
// <div role="alert" class="global-error hidden" data-testid="global-error">
//   Something went wrong. Please try again.
// </div>
// מאבד את המחלקה hidden וההודעה מופיעה.

// כתבי טסט לוגי (גם אם אין JS אמיתי):

// וודאי שבהתחלה ההודעה לא נראית.

// נניח שיש כפתור היפותטי "Simulate error" עם data-testid="simulate-error-btn" (תדמייני שהוא קיים).

// לחצי עליו.

// בדקי שהאלמנט עם data-testid="global-error" נראה, ושיש בו את הטקסט "Something went wrong. Please try again.".

// (זה יותר תרגיל הבנה של locators ו-expect מאשר של HTML.)

//---------------הhtml----//
// <!doctype html>
// <html lang="en">
//   <head>
//     <meta charset="utf-8">
//     <title>Task Manager</title>
//   </head>
//   <body>
//     <header>
//       <h1>Task Manager</h1>
//       <p id="welcome-text">Welcome back, Shoham!</p>
//     </header>

//     <section class="filters">
//       <label for="search-input">Search</label>
//       <input
//         id="search-input"
//         name="search"
//         type="text"
//         placeholder="Search by title or assignee"
//       />

//       <label for="status-filter">Status</label>
//       <select id="status-filter" name="status">
//         <option value="">All</option>
//         <option value="open">Open</option>
//         <option value="in_progress">In progress</option>
//         <option value="done">Done</option>
//       </select>

//       <label>
//         <input id="show-completed-only" type="checkbox" />
//         Show completed only
//       </label>
//     </section>

//     <section>
//       <button type="button" id="add-task-btn" data-testid="add-task-btn">
//         Add Task
//       </button>
//     </section>

//     <section>
//       <h2>Tasks</h2>
//       <table aria-label="Tasks table" data-testid="tasks-table">
//         <thead>
//           <tr>
//             <th>Title</th>
//             <th>Assignee</th>
//             <th>Status</th>
//             <th>Actions</th>
//           </tr>
//         </thead>
//         <tbody>
//           <tr data-testid="task-row">
//             <td>Build login page</td>
//             <td>Shoham</td>
//             <td>Open</td>
//             <td>
//               <button type="button" class="view-btn">View</button>
//               <button type="button" class="edit-btn">Edit</button>
//               <button type="button" class="delete-btn">Delete</button>
//             </td>
//           </tr>
//           <tr data-testid="task-row">
//             <td>Write Playwright tests</td>
//             <td>Alex</td>
//             <td>In progress</td>
//             <td>
//               <button type="button" class="view-btn">View</button>
//               <button type="button" class="edit-btn">Edit</button>
//               <button type="button" class="delete-btn">Delete</button>
//             </td>
//           </tr>
//           <tr data-testid="task-row" data-status="done">
//             <td>Setup CI pipeline</td>
//             <td>Sara</td>
//             <td>Done</td>
//             <td>
//               <button type="button" class="view-btn">View</button>
//               <button type="button" class="edit-btn">Edit</button>
//               <button type="button" class="delete-btn">Delete</button>
//             </td>
//           </tr>
//         </tbody>
//       </table>

//       <p
//         id="no-tasks-message"
//         data-testid="no-tasks-message"
//         hidden
//       >
//         No tasks found.
//       </p>
//     </section>

//     <!-- מודאל הוספת משימה -->
//     <div
//       role="dialog"
//       aria-label="Add task dialog"
//       class="modal hidden"
//       data-testid="add-task-dialog"
//     >
//       <h2>Add new task</h2>
//       <form>
//         <label for="task-title-input">Title</label>
//         <input id="task-title-input" name="title" type="text" />

//         <label for="task-assignee-input">Assignee</label>
//         <input id="task-assignee-input" name="assignee" type="text" />

//         <label for="task-status-select">Status</label>
//         <select id="task-status-select" name="status">
//           <option value="open">Open</option>
//           <option value="in_progress">In progress</option>
//           <option value="done">Done</option>
//         </select>

//         <p
//           class="error-message"
//           data-testid="task-form-error"
//           hidden
//         >
//           Title is required.
//         </p>

//         <button type="submit">Save</button>
//         <button type="button" class="cancel-btn">Cancel</button>
//       </form>
//     </div>

//     <!-- מודאל מחיקה -->
//     <div
//       role="dialog"
//       aria-label="Delete task"
//       class="modal hidden"
//       data-testid="delete-dialog"
//     >
//       <p>Are you sure you want to delete this task?</p>
//       <button type="button" class="cancel-delete-btn">Cancel</button>
//       <button type="button" class="confirm-delete-btn">Confirm</button>
//     </div>

//     <!-- הודעת שגיאה כללית -->
//     <div
//       role="alert"
//       class="global-error hidden"
//       data-testid="global-error"
//     >
//       Something went wrong. Please try again.
//     </div>
//   </body>
// </html>
//----------------שאלות של הצאט חלק 2 ---------------//
test('1' , async({page})=>{
await page.goto('/');
await expect(page.getByRole('heading' , {name: 'Users Dashboard'})).toBeVisible(); 
}); 
//**1) כתבי טסט שבודק שדף ה-Users Dashboard נטען נכון.
//עלייך לבדוק שהכותרת הראשית (h1) מוצגת.**
test('2' , async({page})=>{
await page.goto('/'); 
await expect(page.getByRole('button' , {name:'Add User'})).toBeVisible(); 
}); 
//2) בדקי שכפתור “Add User” קיים וגלוי.
test('3' , async({page})=>{
await page.goto('/'); 
await page.getByRole('button' , {name:'Add User'}).click(); 
await expect(page.getByTestId('add-user-dialog')).toBeVisible(); 
}); 
//3) לחצי על כפתור “Add User” ובדקי שהדיאלוג "Add user dialog" נפתח.
test('4' , async({page})=>{
await page.goto('/'); 
await page.getByRole('button' , {name:'Add User'}).click(); 
const add_dialog = page.getByTestId('add-user-dialog'); 
await expect(add_dialog).toBeVisible(); 
await add_dialog.getByLabel('Name').fill(''); 
await add_dialog.getByRole('button' , {name:'Save'}).click(); 
const add_error = add_dialog.getByTestId('user-form-error'); 
await expect(add_error).toBeVisible(); 
await expect(add_error).toHaveText('Name is required.'); 
}); 
//**4) נסי לשמור משתמש חדש בלי למלא שם.
//בדקי שמוצגת הודעת השגיאה המתאימה.**
test('5' , async({page})=>{
await page.goto('/'); 
await page.getByRole('button' , {name:'Add User'}).click(); 
const add_dialog = page.getByTestId('add-user-dialog'); 
await expect(add_dialog).toBeVisible(); 
await add_dialog.getByLabel('Name').fill('Lior Ben David');
await add_dialog.getByLabel('Role').selectOption('User');  
await add_dialog.getByRole('button' , {name:'Save'}).click(); 
await expect(page.getByTestId('user-form-error')).toBeHidden(); 
}); 
//**5) מלאי שם משתמש — “Lior Ben David” — ורול “User”.
//בדקי שהלחיצה על Save לא מציגה שגיאה.**
test('6', async({page})=>{
await page.goto('/'); 
await expect(page.getByTestId('user-row')).toHaveCount(2); 
}); 
//6) בדקי שבטבלה יש 2 שורות של משתמשים (user-row).

test('7', async({page})=>{
await page.goto('/'); 
const shoham_row = page.getByTestId('user-row').filter({hasText: 'Shoham Huri'}); 
await expect(shoham_row).toContainText('Actove'); 
}); 
//7) בדקי ששורת המשתמש Shoham היא Active.
test('8' , async({page})=>{
await page.goto('/'); 
const Dan_row = page.getByTestId('user-row').filter({hasText:'Dan Cohen'}); 
await expect(Dan_row).toContainText('Inactive'); 
}); 
//8) בדקי שעל שורת “Dan Cohen” מופיע הסטטוס Inactive.

test('9' , async({page})=>{
await page.goto('/'); 
const shoham_row = page.getByTestId('user-row').filter({hasText:'Shoham Huri'}); 
await shoham_row.getByRole('button' , {name:'Edit'}).click(); 
})
//**9) לחצי על הכפתור Edit של Shoham בלבד.

test('10' , async({page})=>{
const rows = page.getByTestId('user-row'); 
const count = await rows.count(); 
for(let i = 0 ; i < count ; i++){
  const row = rows.nth(i); 
  await expect(row.getByRole('button' , {name:'Edit'})).toBeVisible(); 
}
});
//10) כתבי בדיקה שמוודאת שכל המשתמשים בטבלה מכילים כפתור Delete.

//----------------------שאלות מתקדמות---------------------//
test('1' , async({page})=>{
await page.goto('/'); 
await page.getByLabel('Search Product').fill('La'); 
await expect(page.locator('#suggestions')).toBeVisible(); 
await expect(page.locator('#suggestion')).toContainText('Laptop Pro 16'); 
}); 
//1) בדקי שה־autosuggest נפתח כאשר מקלידים לפחות 2 תווים, ושמוצג בו פריט “Laptop Pro 16”.
test('2' , async({page})=>{
await page.goto('/'); 
await page.getByLabel('Active').check(); 
const products = page.getByTestId('product-table'); 
const product_row = products.getByTestId('product-row'); 
const texts = await product_row.allTextContents(); 
for (const t of texts){
  expect(t).toContain('Active'); 
}
}); 
//2) בדקי שסימון checkbox של "Active" מציג בטבלה רק שורות עם Active.
test('3' , async({page})=>{
await page.locator('#next-page').click(); 
await expect(page.getByTestId('product-row')).toHaveCount(0); 
await expect(page.getByTestId('product-row').getByText('Laptop pro 16')).toHaveCount(0); 
}); 
//3) לחצי על next page ובדקי שלא מוצגות השורות של עמוד 1.
//(כלומר row count = 0 / או שהטקסטים השתנו)
test('4' , async({page})=>{
await page.goto('/'); 
await page.getByTestId('product-row').nth(0).getByRole('button',{name:'Edit'}).click(); 
await expect(page.getByRole('dialog' , {name:'Edit product dialog'})).toBeVisible(); 
}); 
//4) לחצי על Edit של המוצר הראשון ובדקי שהדיאלוג "Edit product dialog" מופיע.
test('5' , async({page})=>{
await page.goto('/'); 
const dialog = page.getByTestId('edit-dialog'); 
await expect(dialog.getByLabel('Category').selectOption('Phones')); 
}); 
//5) בדקי שניתן לשנות קטגוריה ל”Phones” מתוך ה־select.
test('6' , async({page})=>{
const dialog = page.getByTestId('edit-dialog'); 
await dialog.getByLabel('Product Name').fill(''); 
await dialog.getByRole('button' , {name:'Save'}).click(); 
await expect(dialog.getByTestId('name-error')).toBeVisible(); 
}); 
//6) השאירי שם מוצר ריק ולחצי Save — בדקי שהשגיאה מופיעה.
test('7' , async({page})=>{
const dialog = page.getByTestId('edit-dialog'); 
await dialog.getByTestId('open-nested').click(); 
await expect(page.getByTestId('nested-dialog')).toBeVisible(); 
}); 
//7) פתחי את ה־nested dialog דרך כפתור “Advanced Settings”, ובדקי שהוא מופיע.
test('8' , async({page})=>{
await page.getByTestId('nested-close').click(); 
await expect(page.getByTestId('nested-dialog')).toBeHidden(); 
}); 
//8) סגרי את ה־nested dialog ע"י לחיצה על הכפתור Close ובדקי שהוא נעלם.
test('9' , async({page})=>{
const XZ_row = page.getByTestId('product-row').filter({hasText:'Keyboard ZX'}); 
await XZ_row.getByRole('button' , {name:'Edit'}).click(); 
}); 
//9) בתוך הטבלה — מצאי את השורה שמכילה “Keyboard ZX” ולחצי Edit רק עליה.
test('10' , async({page})=>{
const rows = page.getByTestId('product-row'); 
const count = await rows.count(); 
for(let i = 0; i < count; i++){
  const row = rows.nth(i); 
  await expect(row.getByRole('button' , {name:'Edit'})).toBeVisible(); 
}
}); 
//10) כתבי בדיקה שמוודאת שכל שורה בטבלה מכילה כפתור Edit (פתרון רחב!).

//---------------------------שאלות של הצאט---------------------------//
test('1' , async({page})=>{
await page.goto('//');
const loans = page.getByTestId('loans-table'); 
await loans.locator('#select-all').check(); 
const rows = page.getByTestId('loan-row'); 
const rows_count = await rows.count(); 
for (let i = 0; i < rows_count; i++){
  const row = rows.nth(i); 
  await expect(row.locator('.row-select')).toBeChecked(); 
}
await expect(page.getByTestId('bulk-bar')).toBeVisible(); 
await expect(page.getByTestId('bulk-count')).toHaveText('4 selected'); 
}); 
// שאלה 1 – Bulk select
// ברגע שאני מסמן את select-all,
// כל צ’קבוקסי השורות אמורים להיות מסומנים,
// ובר ה־bulk actions צריך להיות גלוי ולהראות את מספר השורות המסומן.
// כתבי טסט שבודק:
// לחיצה על select-all מסמנת את כל השורות.
// data-testid="bulk-bar" מוצג.
// data-testid="bulk-count" מציג טקסט שכולל 4 selected.
async function getLoanRowById(page:Page , loanId:string){
  return page.getByTestId('loan-row').filter({ hasText:loanId}); 
}
test('2' , async({page})=>{
  await page.goto('/'); 
  const loan_row = await getLoanRowById(page , 'LN-1003'); 
  await loan_row.getByTestId('open-details-btn').click(); 
  const dialog = page.getByTestId('load-deatils-dialog'); 
  await expect(dialog).toBeVisible(); 
  await expect(dialog.getByTestId('details-borrower')).toContainText('Shoham Huri'); 
})
// כתבי פונקציית עזר getLoanRowById(page, loanId) שמחזירה Locator של השורה,
// וכתבי טסט ש:
// מוצא את השורה של LN-1003.
// לוחץ על כפתור Details בשורה.
// בודק שהדיאלוג "Loan details dialog" גלוי.
// בודק שבתוך הדיאלוג מופיע borrower = "Shoham Huri".
test('3' , async({page})=>{
  await page.goto('/'); 
  await page.locator('filter-delinquent').check(); 
  const rows = page.getByTestId('loan-row'); 
  const text = await rows.allTextContents(); 
  for(const row of text){
    await expect(row).toContain('Delinquent'); 
  }
})
//שאלה 3 – פילטר "Show only delinquent loans"
// נניח שהמערכת מממשת את הפילטר:
// כשלוחצים על checkbox filter-delinquent,
// השורות בטבלה מתעדכנות כך שרק הלוואות עם סטטוס "Delinquent" נשארות.
// כתבי טסט שבודק:
// מסמנים את #filter-delinquent.
// עוברים על כל השורות שנשארו (loan-row).
// מאמתים שלכל שורה יש טקסט "Delinquent" בעמודת הסטטוס/Badges.

test('4' , async({page})=>{
  await page.goto('/');
  const table = page.getByTestId('loans-table');
  const rows = table.getByTestId('loan-row'); 
  const LN_1002_row  = rows.filter({hasText:'LN-1002'});
  await LN_1002_row.getByTestId('mark-reviewed-btn').click(); 
  await expect(LN_1002_row).toContainText('Reviewed');
})
// שאלה 4 – Mark reviewed
// נניח שברגע שלוחצים על Mark reviewed בשורה,
// מתווספת באותה שורה badge עם טקסט "Reviewed".
// כתבי טסט:
// מוצא את השורה של LN-1002.
// לוחץ על Mark reviewed.
// מאמת שבשורה הזו מופיע הטקסט "Reviewed" (למשל כ־badge נוסף).


test('5' , async({page})=>{
  await page.goto('/');
  await page.locator('#search-borrower').fill('Sho');
  await expect(page.getByTestId('loan-row')).toHaveCount(1); 
  await expect(page.getByTestId('loan-row').nth(0)).toHaveText('Shoham Huri'); 
})
// שאלה 5 – חיפוש Borrower לפי חלק מהשם
// נניח שהשדה #search-borrower מסנן את השורות לפי שם הלווה.
// כתבי טסט שבודק:
// ממלא בשדה החיפוש: "Sho".
// בודק שנשארה רק שורה אחת.
// בודק שהשורה הזאת מכילה "Shoham Huri".

test('6' , async({page})=>
{
await page.goto('/'); 
const row = page.getByTestId('loan-row').filter({hasText:'LN-1002'}); 
await row.getByTestId('open-details-btn').click(); 
const loan_details_dialog = page.getByTestId('loan-details-dialog'); 
await expect(loan_details_dialog).toBeVisible(); 
await loan_details_dialog.getByTestId('open-history-btn').click(); 
const payment_dialog = loan_details_dialog.getByTestId('history-dialog');
await expect(payment_dialog).toBeVisible(); 
await loan_details_dialog.getByTestId('close-details-btn').click(); 
await expect(payment_dialog).toBeHidden(); 
await expect(loan_details_dialog).toBeVisible(); 
})
// שאלה 6 – Nested dialog (Payment history)
// מפתחים ביקשו שתוודאי ש:
// מתוך הדיאלוג הראשי של loan details, אפשר לפתוח דיאלוג של payment history.
// אחרי סגירת ההיסטוריה, דיאלוג ההיסטוריה נעלם אך הדיאלוג הראשי עדיין פתוח.
// כתבי טסט שמדמה את הזרימה הזו (תפתחי לדוגמה את LN-1002 → Details → Open payment history → Close).

async function openDetailsForLoan(page:Page , loanId:string){
  const row = page.getByTestId('loan-row').filter({hasText: loanId }); 
  await row.getByTestId('open-details-btn').click(); 
 const dialog =  await page.getByTestId('loan-details-dialog'); 
 await expect(dialog).toBeVisible(); 
 return dialog; 
}
test('7' , async({page})=>{
  const dialog = await openDetailsForLoan(page , 'LN-1001'); 
  await expect(dialog.getByTestId('details-loan-id')).toContainText('LN-1001');
})
// שאלה 7 – טסט “מרוכז” שמשתמש בפונקציית עזר
// כתבי פונקציה:
// async function openDetailsForLoan(page, loanId) { ... }
// שמבצעת:
// מוצא שורה לפי loanId
// לוחץ על Details
// מחכה שהדיאלוג יופיע
// ואז כתבי טסט שמשתמש בה כדי:
// לפתוח details ל־LN-1001
// לוודא שבדיאלוג מופיע loan-id הנכון (LN-1001).

//-------------------שאלות chat GPT-----------------//
test('1' , async({page})=>{
  await page.goto('/loans'); 
  await expect(page.getByRole('heading' , {name:'Homeland Loans'})).toBeVisible(); 
  await expect(page.getByTestId('user-role')).toContainText('admin'); 
}); 
// שאלה 1 – ולידציה בסיסית על header + role
// כתבי טסט שבודק ש:
// כותרת האפליקציה (Homeland Loans) מוצגת.
// תפקיד המשתמש (admin) מוצג בתוך data-testid="user-role".
test('2' , async({page})=>{
await page.goto('/'); 
const table = page.getByTestId('loans-table'); 
const rows = table.getByTestId('loan-row'); 
await expect(rows).toHaveCount(3); 
await expect(rows.getByTestId('loan-status').filter({hasText:'approved'})).toHaveCount(1); 
await expect(rows.getByTestId('loan-status').filter({hasText:'pending'})).toHaveCount(1); 
await expect(rows.getByTestId('loan-status').filter({hasText:'rejected'})).toHaveCount(1); 
await expect(page.getByTestId('summary-total-loans'))
    .toHaveText('Total loans: 3');
  await expect(page.getByTestId('summary-approved-loans'))
    .toHaveText(`Approved: 1`);
  await expect(page.getByTestId('summary-pending-loans'))
    .toHaveText(`Pending: 1`);
  await expect(page.getByTestId('summary-rejected-loans'))
    .toHaveText(`Rejected: 1`);
}); 
// שאלה 2 – אימות נתוני summary מול הטבלה
// כתבי טסט שבודק ש:
// מספר השורות בטבלה (loan-row) הוא 3.
// לפי ה־DOM:
// יש הלוואה אחת עם status approved,
// אחת עם pending,
// אחת עם rejected.
// הטקסט ב־summary-* תואם בדיוק למציאות בטבלה.

test('3' , async({page})=>{
  await page.goto('/'); 
  await page.getByTestId('loan-search-input').fill('LN-1002'); 
  await page.getByTestId('search-button').click(); 
  const rows = page.getByTestId('loan-row'); 
  await expect(rows.filter({hasText:'LN-1002'})).toBeVisible(); 
  await expect(rows.filter({hasNot: rows.filter({hasText:'LN-1002'})})).toBeHidden(); 
}); 
// שאלה 3 – חיפוש הלוואה לפי מזהה (Locator חכם)
// בהנחה שהחיפוש עובד בצד־לקוח (מממשים כבר בפיצ’ר), כתבי טסט שבודק ש:
// ממלאים ב־loan-search-input את LN-1002 ולוחצים על כפתור search-button.
// השורה שמכילה את LN-1002 נראית.
// כל שאר שורות ההלוואות לא נראות (או מוסתרות).
// (מותר להניח שהאפליקציה מוסיפה hidden על שורות שלא עומדות בחיפוש.)

test('4' , async({page})=>{
await page.goto('/'); 
await page.getByTestId('status-filter-select').selectOption('approved'); 
const rows = page.getByTestId('loan-row'); 
await expect(rows).toHaveCount(1);
await expect(rows.filter({hasText:'LN-1002'})).toBeVisible(); 
await expect(rows.getByTestId('loan-status').filter({hasText:'pending'})).toBeHidden(); 
await expect(rows.getByTestId('loan-status').filter({hasText:'rejected'})).toBeHidden(); 
}); 
// שאלה 4 – פילטר לפי סטטוס Approved
// כתבי טסט שבודק ש:
// בוחרים ב־status-filter-select את הערך approved.
// נשארת נראית רק שורה אחת – עם data-loan-id="LN-1002".
// שורות עם pending ו־rejected לא נראות.
test('5' , async({page})=>{
  await page.goto('/');
  await page.getByTestId('anount-header-button').click(); 
  const rows = page.getByTestId('loan-row');
  const text = rows.getByTestId('loan-amount'); 
  const count = await text.count(); 

  for (let i = 0 ; i < count  - 1; i++){
await expect(text.nth(i) < text.nth(i+1)); 
  }
})
// שאלה 5 – מיון לפי Amount בסדר יורד
// בהנחה שלחיצה על amount-header-button ממיינת את הטבלה:
// כתבי טסט שלוחץ על כפתור המיון.
// מוציא ממחלקת loan-amount את כל הערכים (כמספרים).
// בודק שהם ממוינים בסדר יורד: [200000, 150000, 50000].
test('upload document shows success message', async ({ page }) => {
  await page.goto('/loans');

  const filePath = path.resolve(__dirname, 'fixtures', 'customer-doc.pdf');

  await page.getByTestId('document-file-input').setInputFiles(filePath);
  await page.getByTestId('upload-document-button').click();

  await expect(page.getByTestId('upload-success-message')).toBeVisible();
});


// שאלה 6 – העלאת קובץ מסמך
// בהנחה שהאפליקציה:
// עושה upload לשרת,
// ומגדירה את hidden על upload-success-message ל-false / מורידה את המאפיין.
// כתבי טסט שבודק ש:
// מעלים קובץ (למשל customer-doc.pdf) דרך document-file-input.
// לוחצים על upload-document-button.
// הודעת "Upload succeeded" נראית על המסך.


test('shows session expired modal on 401 and redirects to login', async ({ page }) => {
  await page.route('**/api/loans', async route => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Unauthorized' }),
    });
  });

  await page.goto('/loans');

  const modal = page.getByTestId('session-expired-modal');
  await expect(modal).toBeVisible();

  await page.getByTestId('login-again-button').click();
  await expect(page).toHaveURL(/.*login/);
});

// שאלה 7 – Session expired בעקבות 401
// נניח שהעמוד עושה קריאת GET /api/loans בזמן הטעינה, ואם יש 401, ה־frontend:
// מציג את הסקשן של session-expired-modal (מוריד aria-hidden/hidden),
// המשתמש לוחץ על login-again-button,
// עובר ל־/login.
// כתבי טסט שמשתמש ב־page.route כדי לדמות תשובת 401 ושהמודאל מופיע, ואז ניווט ל־/login.

test('approve LN-1001 updates status', async ({ page }) => {
  await page.route('**/api/loans/LN-1001/approve', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'approved' }),
    });
  });

  await page.goto('/loans');

  const ln1001Row = page
    .getByTestId('loan-row')
    .filter({ has: page.locator('[data-testid="loan-id"]', { hasText: 'LN-1001' }) });

  await ln1001Row.getByTestId('approve-loan-button').click();

  const statusCell = ln1001Row.getByTestId('loan-status');
  await expect(statusCell).toHaveText('approved');
});


// שאלה 8 – לחיצה על Approve עבור LN-1001 + אימות סטטוס
// נניח שב־frontend:
// לחיצה על כפתור approve-loan-button בשורה של LN-1001
// שולחת POST /api/loans/LN-1001/approve
// ומעדכנת את הטקסט ב־loan-status ל־approved.
// כתבי טסט שבודק:
// מנווט לעמוד.
// עושה mock ל־POST הרלוונטי ומחזיר תשובה 200.
// לוחץ על כפתור approve בשורה הנכונה.
// מאמת שהסטטוס בשורה של LN-1001 השתנה ל־approved.

test('new loan button navigates to /loans/new', async ({ page }) => {
  await page.goto('/loans');

  await page.getByTestId('new-loan-button').click();

  await expect(page).toHaveURL(/\/loans\/new$/);
});

// שאלה 9 – ניווט לכפתור New loan

// נניח שהכפתור new-loan-button מפעיל SPA־navigation ל־/loans/new.

// כתבי טסט שבודק:

// לחיצה על הכפתור.

// כתובת הדפדפן (URL) מכילה /loans/new.


function getLoanRow(page: Page, loanId: string): Locator {
  return page
    .getByTestId('loan-row')
    .filter({ has: page.locator('[data-testid="loan-id"]', { hasText: loanId }) });
}

test('LN-1002 has approved status and correct amount', async ({ page }) => {
  await page.goto('/loans');

  const row = getLoanRow(page, 'LN-1002');

  await expect(row.getByTestId('loan-status')).toHaveText('approved');
  await expect(row.getByTestId('loan-amount')).toHaveText('200000');
});

// שאלה 10 – פונקציית עזר למציאת שורת הלוואה
// כתבי פונקציית עזר ב־Playwright:
// function getLoanRow(page, loanId: string): Locator { ... }
// שתחזיר Locator לשורה המתאימה (loan-row) לפי data-loan-id.
// השתמשי בה בטסט שבודק:
// של־LN-1002 הסטטוס הוא approved,
// והסכום הוא 200000.