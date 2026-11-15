import { NextResponse } from 'next/server';
import { router, signWebhook } from '@/server/router';
import { body, failure, uuid } from '@/server/http';
import { z } from 'zod';
export const runtime = 'nodejs';
export async function POST(request: Request, {params}: {params:Promise<{id:string;action:string}>}) {
  try {
    const paramsValue = await params;
    const id = uuid.parse(paramsValue.id);
    const action = z.enum(['pay','reconcile','retry','webhook-demo']).parse(paramsValue.action);
    const raw = await body(request);
    if (raw.trim() && raw.trim() !== '{}') throw new SyntaxError('Action does not accept routing overrides');
    if (action === 'webhook-demo') {
      const payment = await router.get(id);
      const attempt = payment.attempts[0];
      if (!attempt) return NextResponse.json({error:'Start the payment first.'},{status:409});
      const event = JSON.stringify({provider:attempt.provider,event_id:`demo:${attempt.id}`,intent_id:id,idempotency_key:attempt.idempotency_key});
      await router.webhook(event,signWebhook(event));
      return NextResponse.json((await router.webhook(event,signWebhook(event))).payment);
    }
    return NextResponse.json(await router.run(id));
  } catch(error) { return failure(error); }
}
