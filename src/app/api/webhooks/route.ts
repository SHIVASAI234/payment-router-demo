import { NextResponse } from 'next/server';
import { router } from '@/server/router';
import { body, failure } from '@/server/http';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try { return NextResponse.json(await router.webhook(await body(request),request.headers.get('x-provider-signature') ?? '')); }
  catch(error) { return failure(error); }
}
