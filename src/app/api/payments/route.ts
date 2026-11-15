import { NextResponse } from 'next/server';
import { z } from 'zod';
import { scenarios, type Scenario } from '@/shared/scenarios';
import { router } from '@/server/router';
import { body, failure, uuid } from '@/server/http';
export const runtime = 'nodejs';
const input = z.object({order_id:uuid,scenario:z.enum(Object.keys(scenarios) as [Scenario,...Scenario[]])}).strict();
export async function POST(request: Request) {
  try {
    const data = input.parse(JSON.parse(await body(request)));
    return NextResponse.json(await router.create(data.order_id,data.scenario),{status:201});
  } catch (error) { return failure(error); }
}
