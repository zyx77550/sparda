import { prisma } from '@/lib/prisma';

export async function touchUser(id: string) {
  'use server';
  await prisma.user.update({ where: { id }, data: { email: 'x' } }); // UNGUARDED inline action
}

export function notAnAction() {
  return 1; // not async, no directive — must NOT become an entrypoint
}
