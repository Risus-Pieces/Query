"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { importProspects } from "@/lib/import";
import {
  PITCH_FIELDS,
  addToPipeline,
  getPitch,
  getProspect,
  importConnections,
  parseLinkedInConnections,
  saveEdits,
  savePitch,
  setPurpose,
  templateDrafts,
  transition,
  type Pitch,
} from "@/lib/outreach";

const idOf = (f: FormData) => {
  const id = Number(f.get("id"));
  return Number.isInteger(id) && id > 0 ? id : null;
};
const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v : undefined;
};

function refresh() {
  revalidatePath("/");
  revalidatePath("/outreach");
}

export async function addToOutreach(f: FormData) {
  const id = idOf(f);
  if (id) await addToPipeline(id);
  refresh();
}

export async function saveProspect(f: FormData) {
  const id = idOf(f);
  if (!id) return;
  const r = await saveEdits(id, {
    email: str(f, "email"),
    linkedin_url: str(f, "linkedin_url"),
    warm_path: str(f, "warm_path"),
    subject: str(f, "subject"),
    body: str(f, "body"),
    linkedin_note: str(f, "linkedin_note"),
    intro_request: str(f, "intro_request"),
    followup_1: str(f, "followup_1"),
    followup_2: str(f, "followup_2"),
  });
  refresh();
  if (!r.ok) redirect(`/outreach?err=${encodeURIComponent(r.error ?? "Could not save")}&id=${id}#p-${id}`);
  redirect(`/outreach?saved=${id}#p-${id}`);
}

export async function setPurposeAction(f: FormData) {
  const id = idOf(f);
  const purpose = str(f, "purpose");
  if (!id || !purpose) return;
  await setPurpose(id, purpose);
  refresh();
  redirect(`/outreach#p-${id}`);
}

const ACTIONS = ["mark_sent", "followup_sent", "replied", "meeting", "passed", "close", "reopen"] as const;

export async function outreachAction(f: FormData) {
  const id = idOf(f);
  const action = str(f, "action") as (typeof ACTIONS)[number];
  if (!id || !ACTIONS.includes(action)) return;
  await transition(id, action);
  refresh();
}

/** Fill empty draft fields from the deterministic template (the weekly routine writes richer drafts). */
export async function draftFromTemplate(f: FormData) {
  const id = idOf(f);
  if (!id) return;
  const p = await getProspect(id);
  if (!p || (p.stage !== "prospect" && p.stage !== "drafted")) return;
  const d = templateDrafts(p, await getPitch());
  await saveEdits(id, {
    email: p.email ?? undefined,
    linkedin_url: p.linkedin_url ?? undefined,
    warm_path: p.warm_path ?? undefined,
    subject: p.subject || d.subject,
    body: p.body || d.body,
    linkedin_note: p.linkedin_note || d.linkedin_note,
    intro_request: p.intro_request || d.intro_request || undefined,
    followup_1: p.followup_1 || d.followup_1,
    followup_2: p.followup_2 || d.followup_2,
  }, "template");
  refresh();
  redirect(`/outreach#p-${id}`);
}

export async function savePitchAction(f: FormData) {
  const values: Pitch = {};
  for (const fld of PITCH_FIELDS) values[fld.key] = str(f, fld.key) ?? "";
  await savePitch(values);
  revalidatePath("/settings");
  revalidatePath("/outreach");
  redirect("/settings?saved=pitch");
}

async function fileText(f: FormData, key: string): Promise<string | null> {
  const file = f.get(key);
  if (!file || typeof file === "string" || file.size === 0) return null;
  if (file.size > 3_500_000) return null;
  return await file.text();
}

export async function importConnectionsAction(f: FormData) {
  const text = await fileText(f, "file");
  if (!text) redirect("/settings?err=" + encodeURIComponent("Choose your LinkedIn Connections.csv (under 3.5 MB)."));
  const conns = parseLinkedInConnections(text);
  if (!conns.length) redirect("/settings?err=" + encodeURIComponent("That doesn't look like a LinkedIn Connections.csv export."));
  const n = await importConnections(conns);
  refresh();
  revalidatePath("/settings");
  redirect(`/settings?network=${n}`);
}

export async function importProspectsAction(f: FormData) {
  const text = await fileText(f, "file");
  if (!text) redirect("/settings?err=" + encodeURIComponent("Choose a CSV file (under 3.5 MB)."));
  const r = await importProspects(text);
  refresh();
  revalidatePath("/settings");
  redirect(`/settings?imported=${r.valid}&queued=${r.queued}&received=${r.received}`);
}
