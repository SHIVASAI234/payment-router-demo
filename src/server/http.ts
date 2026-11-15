import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Conflict, InvalidWebhook, NotFound } from './router';

export const uuid = z.uuid();
export async function body(request: Request) {
  if (Number(request.headers.get('content-length')) > 4096) throw new RangeError('Request too large');
  const raw = await request.text();
  if (raw.length > 4096) throw new RangeError('Request too large');
  return raw;
}
export function failure(error: unknown) {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({error:'Invalid request. Use a valid order ID and scenario; amounts and providers are server-controlled.'},{status:400});
  if (error instanceof InvalidWebhook) return NextResponse.json({error:error.message},{status:401});
  if (error instanceof NotFound) return NextResponse.json({error:error.message},{status:404});
  if (error instanceof Conflict) return NextResponse.json({error:error.message},{status:409});
  if (error instanceof RangeError) return NextResponse.json({error:error.message},{status:413});
  console.error('Payment operation failed', error instanceof Error ? error.name : 'unknown');
  return NextResponse.json({error:'The demo service is temporarily unavailable. Retry the same order; do not start another payment.'},{status:503});
}
