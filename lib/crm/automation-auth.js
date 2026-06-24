export function isAuthorizedAutomationRequest(request) {
  const secret = process.env.AUTOMATION_SECRET || '';
  if (!secret) return true;
  const header = request.headers.get('authorization') || '';
  return header === `Bearer ${secret}`;
}

export function automationUnauthorizedResponse() {
  return Response.json({ ok: false, error: 'Unauthorized automation request.' }, { status: 401 });
}
