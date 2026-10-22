export function createAuthMiddleware({ authClient, createUserClient }) {
  return async function authenticate(req, res, next) {
    const authorization = req.get('authorization');
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

    if (!token) {
      return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'A valid access token is required.' } });
    }

    try {
      const { data, error } = await authClient.auth.getUser(token);
      if (error || !data.user) {
        return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'The access token is invalid or expired.' } });
      }

      req.user = data.user;
      req.db = createUserClient(token);
      return next();
    } catch {
      return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'The access token could not be verified.' } });
    }
  };
}

export async function requireAdmin(req, res, next) {
  const { data, error } = await req.db
    .from('profiles')
    .select('role')
    .eq('id', req.user.id)
    .single();

  if (error || data?.role !== 'admin') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Administrator access is required.' } });
  }

  return next();
}