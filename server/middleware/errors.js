export function notFound(_req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested resource was not found.' } });
}

export function errorHandler(error, _req, res, _next) {
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
  }

  if (error?.code === 'LIMIT_FILE_SIZE' || error?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } });
  }

  console.error('Unhandled request error:', error?.name ?? 'Error');
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
}