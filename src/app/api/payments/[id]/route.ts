import { NextResponse } from 'next/server';
import { router } from '@/server/router';
import { failure, uuid } from '@/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, {params}: {params:Promise<{id:string}>}) {
  try { return NextResponse.json(await router.get(uuid.parse((await params).id)),{headers:{'Cache-Control':'no-store'}}); }
  catch(error) { return failure(error); }
}
