'use server';
import { prisma } from '@/lib/prisma';

export async function deleteUser(id: string) {
  await prisma.user.delete({ where: { id } }); // UNGUARDED: any client can delete any user
}

export async function listUsers() {
  return prisma.user.findMany(); // read-only — no mutation to flag
}
