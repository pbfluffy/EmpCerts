// Run with: node scripts/seed.js
// Requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN env vars — loaded from a
// local .env file if present (see .env.example).
try { require('dotenv').config(); } catch (e) { /* dotenv not installed: rely on real env vars */ }
const bcrypt = require('bcryptjs');
const { run, get } = require('../lib/db');

const users = [
  { username: 'admin', password: 'Admin@123', full_name: 'System Administrator', department: 'IT', position: 'Administrator', email: 'admin@company.com', role: 'admin' },
  { username: 'hrdirector', password: 'HrDir@123', full_name: 'Jane Director', department: 'Human Resources', position: 'HR Director', email: 'jane.director@company.com', role: 'hr_director' },
  { username: 'hrstaff', password: 'HrStaff@123', full_name: 'Sam Staff', department: 'Human Resources', position: 'HR Officer', email: 'sam.staff@company.com', role: 'hr_staff' },
  { username: 'employee1', password: 'Employee@123', full_name: 'Alex Employee', department: 'Engineering', position: 'Software Engineer', email: 'alex.employee@company.com', role: 'employee' },
];

(async () => {
  for (const u of users) {
    const exists = await get('SELECT 1 FROM employees WHERE username = ?', [u.username]);
    if (exists) {
      console.log(`Skipping existing user: ${u.username}`);
      continue;
    }
    const hash = bcrypt.hashSync(u.password, 10);
    await run(`
      INSERT INTO employees (username, password_hash, full_name, department, position, email, role)
      VALUES (?,?,?,?,?,?,?)
    `, [u.username, hash, u.full_name, u.department, u.position, u.email, u.role]);
    console.log(`Created user: ${u.username} (${u.role}) / password: ${u.password}`);
  }
  console.log('Seeding complete.');
  process.exit(0);
})().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
