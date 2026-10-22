import { Router } from 'express';
import { loginSchema, registerSchema, validate } from '../validators/schemas.js';

export function createAuthRouter(authClient) {
  const router = Router();

  router.post('/register', validate(registerSchema), async (req, res) => {
    const { email, password, full_name: fullName } = req.body;
    const { data, error } = await authClient.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) {
      return res.status(400).json({ error: { code: 'REGISTRATION_FAILED', message: 'Account could not be created. Check the details and try again.' } });
    }
    return res.status(201).json({ data: {
      session: data.session ? {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      } : null,
      needs_email_confirmation: !data.session,
    } });
  });

  router.post('/login', validate(loginSchema), async (req, res) => {
    const { data, error } = await authClient.auth.signInWithPassword(req.body);
    if (error?.code === 'email_not_confirmed') {
      return res.status(403).json({ error: {
        code: 'EMAIL_NOT_CONFIRMED',
        message: 'Confirm your email address before signing in. Check your inbox for the confirmation link.',
      } });
    }
    if (error || !data.session) {
      return res.status(401).json({ error: { code: 'LOGIN_FAILED', message: 'Email or password is incorrect.' } });
    }
    return res.json({ data: {
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
    } });
  });

  return router;
}