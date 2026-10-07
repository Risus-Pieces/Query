"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { COOKIE, createSession, passwordOk } from "@/lib/auth";
import { markAllSeen, setNotes, setStatus } from "@/lib/items";
import { SECTIONS, STATUSES, type Section, type Status } from "@/lib/types";

export async function login(_prev: { error?: string } | undefined, formData: FormData) {
  const password = String(formData.get("password") ?? "");
  if (!(await passwordOk(password))) {
    // Small delay blunts brute-forcing without needing shared state.
    await new Promise((r) => setTimeout(r, 600));
    return { error: "Incorrect password" };
  }
  const { value, maxAge } = await createSession();
  (await cookies()).set(COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(COOKIE);
  redirect("/login");
}

export async function updateStatus(formData: FormData) {
  const id = Number(formData.get("id"));
  const status = String(formData.get("status")) as Status;
  if (!Number.isInteger(id) || !STATUSES.includes(status)) return;
  await setStatus(id, status);
  revalidatePath("/");
}

export async function saveNotes(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  await setNotes(id, String(formData.get("notes") ?? ""));
  revalidatePath("/");
}

export async function seeAll(formData: FormData) {
  const section = String(formData.get("section")) as Section;
  if (!SECTIONS.includes(section)) return;
  await markAllSeen(section);
  revalidatePath("/");
}
