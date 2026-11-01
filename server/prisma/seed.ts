import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;

if (!email || !password) {
  throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD in server/.env");
}

const passwordHash = await bcrypt.hash(password, 12);
const existing = await prisma.admin.findUnique({ where: { email } });

if (existing) {
  // Same email: just change the password.
  await prisma.admin.update({ where: { id: existing.id }, data: { passwordHash } });
  console.log(`Password updated for ${email}`);
} else {
  const all = await prisma.admin.findMany();
  if (all.length === 1) {
    // New email, but only one admin exists: change the login of that SAME account so all quizzes stay.
    await prisma.admin.update({ where: { id: all[0].id }, data: { email, passwordHash } });
    console.log(`Login changed from ${all[0].email} to ${email}. Existing quizzes are kept.`);
  } else {
    await prisma.admin.create({ data: { email, passwordHash } });
    console.log(`New admin created: ${email}`);
  }
}

await prisma.$disconnect();