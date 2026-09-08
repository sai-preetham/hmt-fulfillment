import { createPublicKey, verify } from 'node:crypto';
import { NextResponse } from 'next/server';
import { formatDiscordDailyReport, getPreviousDayOrderReport } from '@/lib/crm/order-exports';

export async function POST(request) {
  const rawBody = await request.text();
  if (!isValidDiscordRequest(request, rawBody)) return new NextResponse('invalid request signature', { status: 401 });
  const interaction = JSON.parse(rawBody);
  if (interaction.type === 1) return NextResponse.json({ type: 1 }); // Discord ping
  if (interaction.type === 2 && interaction.data?.name === 'orders24') {
    try {
      const report = await getPreviousDayOrderReport();
      return NextResponse.json({ type: 4, data: { content: formatDiscordDailyReport(report) } });
    } catch (error) {
      return NextResponse.json({ type: 4, data: { content: `Could not load the order count: ${error.message}`, flags: 64 } });
    }
  }
  return NextResponse.json({ type: 4, data: { content: 'Try `/orders24` for the previous calendar day’s Wix order count.', flags: 64 } });
}

function isValidDiscordRequest(request, rawBody) {
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  const publicKeyHex = process.env.DISCORD_APPLICATION_PUBLIC_KEY;
  if (!signature || !timestamp || !publicKeyHex || !/^[0-9a-f]{64}$/i.test(publicKeyHex)) return false;
  // Discord supplies a raw Ed25519 key; Node expects the RFC 8410 SPKI wrapper.
  const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
  const publicKey = createPublicKey({ key: Buffer.concat([spkiPrefix, Buffer.from(publicKeyHex, 'hex')]), format: 'der', type: 'spki' });
  return verify(null, Buffer.from(`${timestamp}${rawBody}`), publicKey, Buffer.from(signature, 'hex'));
}
