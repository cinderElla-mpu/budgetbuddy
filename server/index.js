import 'dotenv/config';
import { createApp } from './app.js';

const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
const missing = required.filter((key) => !process.env[key]);

if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exitCode = 1;
} else {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => console.log(`BudgetBuddy API listening on port ${port}`));
}