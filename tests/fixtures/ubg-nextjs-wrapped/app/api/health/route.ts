import { makeHealth } from '@/lib/makeHealth';

const handler = makeHealth({ cache: false });

export const GET = handler;
