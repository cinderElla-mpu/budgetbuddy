# BudgetBuddy

BudgetBuddy is a personal finance tracker for records entered by the account owner. It supports income and expense transactions, category budgets, savings goals, monthly reports, CSV export, profile settings, and private support requests. A displayed balance is calculated from recorded entries; BudgetBuddy does not connect to banks or verify account balances.

## Stack and layout

- `public/`: responsive HTML, CSS, and vanilla JavaScript interface.
- `server/`: Express API, Supabase clients, authentication/authorization middleware, resource controllers, Zod validators, and tests.
- `supabase/migrations/`: PostgreSQL schema, seed categories, triggers, indexes, and RLS policies.
- Supabase Auth handles passwords and sessions. PostgreSQL `NUMERIC(12,2)` stores money.

The frontend obtains a Supabase session through the Express authentication endpoints. It sends the access token on API requests. The API verifies that token with Supabase Auth and passes the same token to the database client. PostgreSQL RLS remains active for each query; the API does not use a service-role key.

## Requirements

- Node.js 20 or later and npm.
- A Supabase project.

## Local setup

1. Install packages:

   ```powershell
   npm install
   ```

2. Copy `.env.example` to `.env`. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `FRONTEND_ORIGIN`. Use the project's public publishable/anon key, never a service-role key. `.env` is ignored by Git.

3. Open `public/config.js` and set `supabaseUrl`, `supabaseAnonKey`, and (if the API is hosted separately) `apiBaseUrl`. These frontend values are public by design; only the publishable/anon key belongs here.

4. In the Supabase dashboard, open **SQL Editor**, paste and run `supabase/migrations/202610210001_initial_schema.sql`. It creates the tables, indexes, constraints, triggers, RLS policies, report function, and default categories. The category seed runs as part of the migration and is safe to rerun.

5. In Supabase **Authentication > URL Configuration**, set the site URL and allowed redirect URLs for local development and the deployed frontend. Configure email confirmation and password policy to suit the project. Email confirmation can mean a new account must confirm its address before signing in.

6. Start the application:

   ```powershell
   npm.cmd run dev
   ```

   Open `http://localhost:3000`. The Express process serves both the frontend and API from the same origin, so this is the recommended setup and needs only one terminal. Keep that terminal running; press `Ctrl+C` to stop the API.

   If you prefer the VS Code Live Server preview, keep Live Server running at `http://localhost:5500` and run `npm.cmd run dev` in a second integrated terminal. The preview is configured to send API requests to `http://localhost:3000`; both `localhost` and `127.0.0.1` on port `5500` are allowed by development CORS. Do not open `public/index.html` as a `file://` URL.

   Use `npm.cmd` in PowerShell to invoke npm without depending on the `npm.ps1` execution policy. Without valid Supabase settings, the API does not start; the frontend displays a configuration notice rather than simulating a successful sign-in.

## Environment variables

- `PORT`: Express port; defaults to `3000`.
- `NODE_ENV`: runtime environment.
- `FRONTEND_ORIGIN`: comma-separated allowed browser origins for CORS.
- `TRUST_PROXY_HOPS`: trusted reverse-proxy hop count; leave at `0` unless the hosting proxy chain is known and configured.
- `SUPABASE_URL`: project URL.
- `SUPABASE_ANON_KEY`: public publishable/anon key.

No service-role key is required or supported by the application. The default does not trust forwarded client IP headers. If hosted behind a reverse proxy, set `TRUST_PROXY_HOPS` only after confirming the number of trusted proxy hops with the host; this also lets rate limiting use the correct client IP.

## Database and authorization

The auth-user insert trigger creates a `profiles` row with role `user`. The browser cannot update `role`: profile grants expose only the permitted profile columns, and the API accepts only display name and budget threshold. Users can access only their own transactions, budgets, goals, profile, and support requests. Every resource query also filters by the verified user's ID. Categories are shared read-only data for regular accounts. Admin routes check the role read from the caller's protected profile; admin category and support policies independently check `public.is_admin()`.

The report RPC is `SECURITY INVOKER`, so its aggregates obey the caller's RLS. Monetary values from PostgreSQL are returned as decimal strings. The backend's exact-cent helper uses `BigInt`; display formatting is not used as an authoritative calculation.

### Secure admin setup

1. Register and verify the intended administrator account.
2. In the Supabase SQL Editor (a trusted operator context), find that account's UUID and promote only that row:

   ```sql
   update public.profiles
   set role = 'admin'
   where id = (
     select id from auth.users where email = 'admin@example.com'
   );
   ```

3. Verify one row was updated, then sign out and sign in again. Never place role changes in a browser request or frontend configuration. Do not promote ordinary users.

## Tests and security checks

Run the automated unit/API suite:

```powershell
npm test
```

The suite uses mock Supabase clients and no real credentials. It covers registration/login responses, invalid and missing tokens, admin denial, record ownership, body-supplied ownership rejection, malformed requests, amount validation, not-found responses, report scoping, and exact money arithmetic.

For a real Supabase integration check, use two disposable accounts and a non-production project:

1. Sign up Account A and Account B; verify both receive `user` profiles.
2. Create a transaction as B. Request B's transaction ID using A's bearer token; expect `404`. Try update/delete with A's token; the row must remain unchanged.
3. Call an admin endpoint as A; expect `403`. Promote a disposable admin through the SQL Editor and verify the same route succeeds for that account only.
4. Try missing/expired tokens, malformed JSON, zero/negative amounts, a non-expense budget category, duplicate category-month budgets, and invalid support status; confirm rejection.
5. Confirm the dashboard totals match the disposable records and no rows are visible before signing in.

The SQL migration has only received local structural checks in this workspace. It has not been applied to a Supabase project here, and no live authentication or RLS integration test has been performed.

## Deployment

Deploy the frontend and API separately when using GitHub Pages:

1. Publish the contents of `public/` to GitHub Pages. Update `public/config.js` with the public Supabase URL/key and the deployed API origin, for example `https://budgetbuddy-api.example.com`.
2. Deploy the repository's Node.js service to a Node-compatible host. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `FRONTEND_ORIGIN` (the exact GitHub Pages origin), and `PORT` in the host's secret/environment settings. Use `npm install` and `npm start`.
3. Add the deployed frontend URL to Supabase Auth's allowed redirect URLs. Verify the backend CORS origin and frontend API URL agree.
4. Keep secrets in host environment settings. Do not upload `.env` or any service-role key. GitHub Pages hosts static files only; it does not host this Express API.

The Express server can also host `public/` and `/api` together on a Node host by leaving `apiBaseUrl` empty and setting `FRONTEND_ORIGIN` to that origin.

## Practical activity map

1. **Design a database structure:** `supabase/migrations/202610210001_initial_schema.sql` defines profiles, categories, transactions, budgets, goals, support requests, constraints, indexes, triggers, and RLS.
2. **Create user and request records:** the auth trigger creates profiles; the API creates user-owned finance records and support requests through `server/controllers/resources.js`.
3. **Connect an API to a database:** `server/config/supabase.js` and the controllers use the Supabase client with the request's verified access token.
4. **Registration and login:** `server/routes/auth.js`, `server/validators/schemas.js`, and the auth form in `public/app.js` delegate credentials to Supabase Auth.
5. **Protect routes:** `server/middleware/auth.js` verifies tokens; `server/app.js` applies the middleware to `/api`; RLS enforces ownership again.
6. **Assign role permissions:** `profiles.role`, `requireAdmin`, `public.is_admin()`, and admin RLS policies restrict category and support administration. Admin promotion is manual and trusted.
7. **Validate both sides:** browser required fields and checks in `public/app.js` are backed by Zod schemas in `server/validators/schemas.js` and database constraints in the migration.
