#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const { loadEnv } = require("../datasync/lib/env");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.resolve(__dirname, "../.env.local"));

const SEED_ACTOR = "bao.vo@excelplannings.local";
const SAMPLE_PREFIX = "https://app.followupboss.com/2/people/view/sample-enrollment-";
const MEDICARE_SAMPLE_PREFIX = "https://app.followupboss.com/2/people/view/sample-medicare-";

// ACA — grounded in the real 200-row Slack List crawl (tfw_list_crawler).
const acaRecords = [
  {
    program: "aca",
    client_name: "Tram Nguyen Bao Tran - quote health enrollment",
    fub_link: sampleLink(SAMPLE_PREFIX, 1),
    stage: "1-Need quote",
    carrier: "Oscar HMO",
    platform: "MyMFG",
    consent: "Not Yet",
    payment_status: "Need auto pay",
    aca_status: "Need to create ACA account",
    pcp_2025: "Missing",
    pcp_2026: "Missing",
    caller_email: null,
    responsible_enroll_email: "khanh.chau.sample@excelplannings.local",
    due_date: "2026-07-18",
    created_at: "2026-07-07T09:20:00.000+07:00",
    note: "Need first quote and consent confirmation.",
  },
  {
    program: "aca",
    client_name: "Evie Nguyen - payment info for renewal",
    fub_link: sampleLink(SAMPLE_PREFIX, 2),
    stage: "2-Quoted",
    carrier: "Ambetter EPO",
    platform: "HSP",
    consent: "Yes",
    payment_status: "Need make manually",
    aca_status: "Created - Waiting for verify",
    pcp_2025: "Dr. Tran",
    pcp_2026: "Pending",
    caller_email: "nam.nguyen.sample@excelplannings.local",
    responsible_enroll_email: "dung.ha.sample@excelplannings.local",
    due_date: "2026-07-20",
    created_at: "2026-07-08T11:15:00.000+07:00",
    note: "Quoted. Payment method still needs manual handling.",
  },
  {
    program: "aca",
    client_name: "Justin Nguyen - waiting confirmation",
    fub_link: sampleLink(SAMPLE_PREFIX, 3),
    stage: "3-Waiting for Confirmation",
    carrier: "CHC Select",
    platform: "MyMFG",
    consent: "Yes",
    payment_status: "$0",
    aca_status: "ACA account done",
    pcp_2025: "N/A",
    pcp_2026: "Pending",
    caller_email: "bao.vo@excelplannings.local",
    responsible_enroll_email: "charlotte.sample@excelplannings.local",
    due_date: "2026-07-21",
    created_at: "2026-07-09T10:05:00.000+07:00",
    note: "Client needs to confirm final plan.",
  },
  {
    program: "aca",
    client_name: "Zoe Nguyen - missing documents",
    fub_link: sampleLink(SAMPLE_PREFIX, 4),
    stage: "4-Need documents",
    carrier: "UHC",
    platform: "Other",
    consent: "Not Yet",
    payment_status: "Selfpay",
    aca_status: "Created - Need information to verify",
    pcp_2025: "Unknown",
    pcp_2026: "Unknown",
    caller_email: null,
    responsible_enroll_email: "baovocs04@gmail.com",
    due_date: "2026-07-19",
    created_at: "2026-07-09T13:30:00.000+07:00",
    note: "Need income document before enrollment.",
  },
  {
    program: "aca",
    client_name: "Dung Vo - ready to enroll",
    fub_link: sampleLink(SAMPLE_PREFIX, 5),
    stage: "5-Ready to enroll",
    carrier: "BCBS",
    platform: "MyMFG",
    consent: "Yes",
    payment_status: "Auto pay",
    aca_status: "ACA account done",
    pcp_2025: "Dr. Smith",
    pcp_2026: "Dr. Smith",
    caller_email: "khang.nguyen.sample@excelplannings.local",
    responsible_enroll_email: "quoc.bao.tran.le.sample@excelplannings.local",
    due_date: "2026-07-22",
    created_at: "2026-07-10T08:45:00.000+07:00",
    note: "All inputs ready. Enroll next.",
  },
  {
    program: "aca",
    client_name: "Ngoc Diep Thi Le - enrolled pending payment",
    fub_link: sampleLink(SAMPLE_PREFIX, 6),
    stage: "6-Enrolled",
    carrier: "Molina",
    platform: "HSP",
    consent: "Yes",
    payment_status: "Need make manually",
    aca_status: "ACA account done",
    pcp_2025: "Dr. Nguyen",
    pcp_2026: "Pending",
    caller_email: "no.agent.sample@excelplannings.local",
    responsible_enroll_email: "quan.nguyen.sample@excelplannings.local",
    due_date: "2026-07-23",
    created_at: "2026-07-10T12:10:00.000+07:00",
  },
  {
    program: "aca",
    client_name: "Khanh Ho - first payment done",
    fub_link: sampleLink(SAMPLE_PREFIX, 7),
    stage: "7-1st payment done",
    carrier: "UHC Sanitas",
    platform: "MyMFG",
    consent: "Yes",
    payment_status: "Auto pay",
    aca_status: "ACA account done",
    pcp_2025: "Dr. Le",
    pcp_2026: "Need update",
    caller_email: "baovocs04@gmail.com",
    responsible_enroll_email: "nguyen.ngan.sample@excelplannings.local",
    due_date: "2026-07-24",
    created_at: "2026-07-11T09:00:00.000+07:00",
  },
  {
    program: "aca",
    client_name: "Thanh Le - assign PCP",
    fub_link: sampleLink(SAMPLE_PREFIX, 8),
    stage: "8-Need assign PCP",
    carrier: "Kaiser",
    platform: "Other",
    consent: "Yes",
    payment_status: "$0",
    aca_status: "ACA account done",
    pcp_2025: "No PCP",
    pcp_2026: "Need assign",
    caller_email: "baovocs04@gmail.com",
    responsible_enroll_email: "huy.sample@excelplannings.local",
    due_date: "2026-07-20",
    created_at: "2026-07-12T14:25:00.000+07:00",
    note: "Enrollment is paid. PCP assignment is the blocker.",
  },
  {
    program: "aca",
    client_name: "Le Thi Pham - ID card follow up",
    fub_link: sampleLink(SAMPLE_PREFIX, 9),
    stage: "9-Assigned PCP/Get ID Card",
    carrier: "Christus",
    platform: "HSP",
    consent: "Yes",
    payment_status: "Auto pay",
    aca_status: "ACA account done",
    pcp_2025: "Dr. Hoang",
    pcp_2026: "Dr. Hoang",
    caller_email: null,
    responsible_enroll_email: "huong.giang.sample@excelplannings.local",
    due_date: "2026-07-18",
    created_at: "2026-07-12T15:40:00.000+07:00",
    note: "PCP assigned. Need to get ID card.",
  },
  {
    program: "aca",
    client_name: "Huynh Ngoc Tuyet Nguyen - completed enrollment",
    fub_link: sampleLink(SAMPLE_PREFIX, 10),
    stage: "10-DONE",
    carrier: "Community First",
    platform: "MyMFG",
    consent: "Yes",
    payment_status: "Auto pay",
    aca_status: "ACA account done",
    pcp_2025: "Dr. Pham",
    pcp_2026: "Dr. Pham",
    caller_email: "bao.vo@excelplannings.local",
    responsible_enroll_email: "cs_task@gmail.com",
    due_date: "2026-07-16",
    created_at: "2026-07-13T09:30:00.000+07:00",
    qc_checked_by_email: "bao.vo@excelplannings.local",
    qc_checked_at: "2026-07-17T10:20:00.000+07:00",
    closed_at: "2026-07-17T10:10:00.000+07:00",
    note: "DONE and QC checked.",
  },
  {
    program: "aca",
    client_name: "MyLinh Dang - terminated policy",
    fub_link: sampleLink(SAMPLE_PREFIX, 11),
    stage: "11-Terminated",
    carrier: "Wellpoint",
    platform: "Other",
    consent: "Not Yet",
    payment_status: "Selfpay",
    aca_status: "Need to create ACA account",
    pcp_2025: "N/A",
    pcp_2026: "N/A",
    caller_email: "bao.vo@excelplannings.local",
    responsible_enroll_email: "dung.ha.sample@excelplannings.local",
    due_date: "2026-07-12",
    created_at: "2026-07-05T16:10:00.000+07:00",
    closed_at: "2026-07-14T11:00:00.000+07:00",
    note: "Terminated after client changed direction.",
  },
  {
    program: "aca",
    client_name: "Tuyet Anh Tran - renewal callback",
    fub_link: sampleLink(SAMPLE_PREFIX, 12),
    stage: "Need call to renewal",
    carrier: "Oscar EPO",
    platform: "MyMFG",
    consent: "Not Yet",
    payment_status: "Need auto pay",
    aca_status: "Created - Waiting for verify",
    pcp_2025: "Dr. Lee",
    pcp_2026: "Pending",
    caller_email: "baovocs04@gmail.com",
    responsible_enroll_email: "charlotte.sample@excelplannings.local",
    due_date: "2026-07-25",
    created_at: "2026-07-14T09:20:00.000+07:00",
  },
  {
    program: "aca",
    client_name: "Thu Le - cannot contact",
    fub_link: sampleLink(SAMPLE_PREFIX, 13),
    stage: "Can't Contact",
    carrier: "Sentara",
    platform: "HSP",
    consent: "Not Yet",
    payment_status: "Need make manually",
    aca_status: "Created - Need information to verify",
    pcp_2025: "Unknown",
    pcp_2026: "Unknown",
    caller_email: null,
    responsible_enroll_email: "quoc.bao.tran.le.sample@excelplannings.local",
    due_date: "2026-07-17",
    created_at: "2026-07-12T09:55:00.000+07:00",
    note: "Called twice. No response yet.",
  },
  {
    program: "aca",
    client_name: "Huy Pham - cannot get ID card",
    fub_link: sampleLink(SAMPLE_PREFIX, 14),
    stage: "Can not get ID card",
    carrier: "Providence",
    platform: "Other",
    consent: "Yes",
    payment_status: "$0",
    aca_status: "ACA account done",
    pcp_2025: "Dr. Vu",
    pcp_2026: "Dr. Vu",
    caller_email: "bao.vo@excelplannings.local",
    responsible_enroll_email: "nguyen.ngan.sample@excelplannings.local",
    due_date: "2026-07-18",
    created_at: "2026-07-13T11:40:00.000+07:00",
    note: "Carrier portal does not show ID card yet.",
  },
  {
    program: "aca",
    client_name: "Charlotte Nguyen - confirmation pending",
    fub_link: sampleLink(SAMPLE_PREFIX, 15),
    stage: "3-Waiting for Confirmation",
    carrier: "BCBS Myblue",
    platform: "MyMFG",
    consent: "Yes",
    payment_status: "Selfpay",
    aca_status: "Created - Waiting for verify",
    pcp_2025: "Pending",
    pcp_2026: "Pending",
    caller_email: "bao.vo@excelplannings.local",
    responsible_enroll_email: "huy.sample@excelplannings.local",
    due_date: "2026-07-22",
    created_at: "2026-07-15T08:35:00.000+07:00",
  },
  {
    program: "aca",
    client_name: "On Kim Tran - documents needed",
    fub_link: sampleLink(SAMPLE_PREFIX, 16),
    stage: "4-Need documents",
    carrier: "Ambetter HMO",
    platform: "HSP",
    consent: "Not Yet",
    payment_status: "Need auto pay",
    aca_status: "Created - Need information to verify",
    pcp_2025: "Unknown",
    pcp_2026: "Unknown",
    caller_email: "baovocs04@gmail.com",
    responsible_enroll_email: "huong.giang.sample@excelplannings.local",
    due_date: "2026-07-20",
    created_at: "2026-07-15T10:25:00.000+07:00",
  },
  {
    program: "aca",
    client_name: "Anh Nguyen - ACA verification",
    fub_link: sampleLink(SAMPLE_PREFIX, 17),
    stage: "8-Need assign PCP",
    carrier: "CHC Premier",
    platform: "MyMFG",
    consent: "Yes",
    payment_status: "Auto pay",
    aca_status: "Created - Waiting for verify",
    pcp_2025: "Dr. Park",
    pcp_2026: "Need assign",
    caller_email: null,
    responsible_enroll_email: "khanh.chau.sample@excelplannings.local",
    due_date: "2026-07-21",
    created_at: "2026-07-16T09:10:00.000+07:00",
    note: "ACA verification still pending while PCP needs assignment.",
  },
  {
    program: "aca",
    client_name: "Bao Tran - PCP assigned",
    fub_link: sampleLink(SAMPLE_PREFIX, 18),
    stage: "9-Assigned PCP/Get ID Card",
    carrier: "BCBS Advantage",
    platform: "Other",
    consent: "Yes",
    payment_status: "$0",
    aca_status: "ACA account done",
    pcp_2025: "Dr. Brown",
    pcp_2026: "Dr. Brown",
    caller_email: "bao.vo@excelplannings.local",
    responsible_enroll_email: "quan.nguyen.sample@excelplannings.local",
    due_date: "2026-07-23",
    created_at: "2026-07-16T14:50:00.000+07:00",
  },
  {
    program: "aca",
    client_name: "Mai Vo - done pending QC",
    fub_link: sampleLink(SAMPLE_PREFIX, 19),
    stage: "10-DONE",
    carrier: "Other",
    platform: "HSP",
    consent: "Yes",
    payment_status: "Auto pay",
    aca_status: "ACA account done",
    pcp_2025: "Dr. Mai",
    pcp_2026: "Dr. Mai",
    caller_email: "baovocs04@gmail.com",
    responsible_enroll_email: "cs_task@gmail.com",
    due_date: null,
    created_at: "2026-07-17T10:00:00.000+07:00",
    closed_at: "2026-07-18T09:05:00.000+07:00",
    note: "DONE but intentionally left QC unchecked.",
  },
  {
    program: "aca",
    client_name: "Nam Pham - quoted renewal",
    fub_link: sampleLink(SAMPLE_PREFIX, 20),
    stage: "2-Quoted",
    carrier: "BSW",
    platform: "MyMFG",
    consent: "Yes",
    payment_status: "Need make manually",
    aca_status: "Need to create ACA account",
    pcp_2025: "N/A",
    pcp_2026: "Pending",
    caller_email: "bao.vo@excelplannings.local",
    responsible_enroll_email: "dung.ha.sample@excelplannings.local",
    due_date: "2026-07-18",
    created_at: "2026-07-18T13:15:00.000+07:00",
    note: "Sample overdue quoted renewal.",
  },
];

// Medicare — grounded in the real 7-row Slack List crawl
// (ann_strambler_medicare_2026_crawler). That program has no
// Payment/Consent/Platform/AC concepts and a single Assignee + single PCP
// field (mapped onto pcp_2025; pcp_2026/caller_email are always absent).
const medicareRecords = [
  {
    program: "medicare",
    client_name: "Eric Chi - MAPD move-in",
    fub_link: sampleLink(MEDICARE_SAMPLE_PREFIX, 1),
    stage: "New",
    carrier: "Healthspring/Cigna",
    pcp_2025: "Vi Nguyen - 143 Bella Katy Dr, Katy, TX 77494",
    responsible_enroll_email: "dung.ha.sample@excelplannings.local",
    due_date: "2026-07-24",
    created_at: "2026-07-10T09:04:00.000+07:00",
    note: "Client moved from CA to TX. Waiting on SOA + consent before applying.",
  },
  {
    program: "medicare",
    client_name: "Hoang Dinh Le - Health Spring Preferred HMO",
    fub_link: sampleLink(MEDICARE_SAMPLE_PREFIX, 2),
    stage: "New",
    carrier: "Healthspring/Cigna",
    pcp_2025: "Vinh Q Le - Peachtree Medical",
    responsible_enroll_email: "dung.ha.sample@excelplannings.local",
    due_date: "2026-07-19",
    created_at: "2026-07-11T08:34:00.000+07:00",
    note: "Walk-in consent. Need Medicare Part A+B card and prior address.",
  },
  {
    program: "medicare",
    client_name: "Minh Hoang Pham - PCP out of network",
    fub_link: sampleLink(MEDICARE_SAMPLE_PREFIX, 3),
    stage: "E- ID Card Unavailable",
    carrier: "Healthspring/Cigna",
    pcp_2025: "Hanh Truong (NPI 1912998618)",
    responsible_enroll_email: "quoc.bao.tran.le.sample@excelplannings.local",
    due_date: "2026-07-18",
    created_at: "2026-05-08T13:06:00.000+07:00",
    note: "Requested PCP is out of network — client paying out of pocket, escalated.",
  },
  {
    program: "medicare",
    client_name: "Tai Ly - Devoted enrolled",
    fub_link: sampleLink(MEDICARE_SAMPLE_PREFIX, 4),
    stage: "10 - DONE",
    carrier: "Devoted",
    pcp_2025: "Trung Tran - 605 Beaver Ruin Rd NW, Ste C, Lilburn, GA",
    responsible_enroll_email: "dung.ha.sample@excelplannings.local",
    due_date: "2026-07-15",
    created_at: "2026-06-08T13:09:00.000+07:00",
    qc_checked_by_email: "bao.vo@excelplannings.local",
    qc_checked_at: "2026-07-16T10:00:00.000+07:00",
    closed_at: "2026-07-15T22:07:00.000+07:00",
    note: "Enrolled Devoted Choice 001 GA (PPO), effective Apr 1. QC checked.",
  },
  {
    program: "medicare",
    client_name: "Bich Dang - UHC + Humana Part D",
    fub_link: sampleLink(MEDICARE_SAMPLE_PREFIX, 5),
    stage: "10 - DONE",
    carrier: "UHC",
    pcp_2025: "N/A - Medicare Supplement, no PCP required",
    responsible_enroll_email: "cs_task@gmail.com",
    due_date: null,
    created_at: "2026-06-08T13:06:00.000+07:00",
    closed_at: "2026-07-13T23:03:00.000+07:00",
    note: "Supplement Plan G + Part D through Humana. Priority case (oncology). Pending ID cards.",
  },
  {
    program: "medicare",
    client_name: "Ngoc Le - Health Spring enrolled",
    fub_link: sampleLink(MEDICARE_SAMPLE_PREFIX, 6),
    stage: "10 - DONE",
    carrier: "Healthspring/Cigna",
    pcp_2025: "Vinh Le - 10411 Veterans Memorial Dr D, Houston, TX 77038",
    responsible_enroll_email: "dung.ha.sample@excelplannings.local",
    due_date: null,
    created_at: "2026-07-10T08:33:00.000+07:00",
    closed_at: "2026-07-15T23:25:00.000+07:00",
    note: "Enrolled MAPD, effective Jun 1. Card sent.",
  },
  {
    program: "medicare",
    client_name: "Huy Tran - needs Part D quote",
    fub_link: sampleLink(MEDICARE_SAMPLE_PREFIX, 7),
    stage: "New",
    carrier: "Humana",
    pcp_2025: "Missing",
    responsible_enroll_email: null,
    due_date: "2026-07-17",
    created_at: "2026-07-16T09:30:00.000+07:00",
    note: "Sample overdue, unassigned record for testing the Unassigned/overdue view.",
  },
];

const records = [...acaRecords, ...medicareRecords];

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const options = await loadOptions(supabase);
  const existing = await loadExistingSamples(supabase);
  const inserts = records
    .filter((record) => !existing.has(record.fub_link))
    .map((record) => toEnrollmentInsert(record, options));

  if (inserts.length === 0) {
    console.log(`Enrollment samples already exist. Skipped ${records.length} records.`);
    return;
  }

  const { data: inserted, error } = await supabase
    .from("enrollment_records")
    .insert(inserts)
    .select("id,fub_link,stage_id,created_by_email,created_at,qc_checked_by_email,qc_checked_at");
  if (error) throw new Error(`Unable to insert enrollment records: ${error.message}`);

  const insertedRecords = inserted ?? [];
  const sampleByLink = new Map(records.map((record) => [record.fub_link, record]));
  await insertSeedSideEffects(supabase, insertedRecords, sampleByLink, options);

  const acaCount = insertedRecords.filter((row) =>
    sampleByLink.get(row.fub_link)?.program === "aca"
  ).length;
  const medicareCount = insertedRecords.length - acaCount;
  console.log(
    `Inserted ${insertedRecords.length} enrollment sample records (${acaCount} ACA, ${medicareCount} Medicare).`
  );
  console.log(`Skipped ${records.length - insertedRecords.length} existing sample records.`);
}

// Loads every option set + option across both programs. Returns:
//   ids: Map "program:setKey:label(lowercase)" -> option id
//   flags: Map option id -> { is_terminal, triggers_qc }
async function loadOptions(supabase) {
  const { data: sets, error: setError } = await supabase
    .from("enrollment_option_sets")
    .select("id,program,key");
  if (setError) {
    throw new Error(
      `Unable to load enrollment option sets: ${setError.message}. Apply supabase/schema.sql first.`
    );
  }

  const setById = new Map((sets ?? []).map((set) => [set.id, set]));
  const { data: optionRows, error: optionsError } = await supabase
    .from("enrollment_options")
    .select("id,set_id,label,is_terminal,triggers_qc,archived_at")
    .is("archived_at", null);
  if (optionsError) {
    throw new Error(
      `Unable to load enrollment options: ${optionsError.message}. Apply supabase/schema.sql first.`
    );
  }

  const ids = new Map();
  const flags = new Map();
  for (const option of optionRows ?? []) {
    const set = setById.get(option.set_id);
    if (!set) continue;
    ids.set(optionKey(set.program, set.key, option.label), option.id);
    flags.set(option.id, {
      is_terminal: option.is_terminal,
      triggers_qc: option.triggers_qc,
    });
  }

  const missing = [];
  for (const record of records) {
    for (const [field, setKey] of Object.entries(OPTION_FIELDS)) {
      const label = record[field];
      if (!label) continue; // field not used by this program's record shape
      if (!ids.has(optionKey(record.program, setKey, label))) {
        missing.push(`${record.program}:${setKey}:${label}`);
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing enrollment options: ${missing.join(", ")}`);
  }

  return { ids, flags };
}

const OPTION_FIELDS = {
  stage: "stage",
  carrier: "carrier",
  platform: "platform",
  consent: "consent",
  payment_status: "payment_status",
  aca_status: "aca_status",
};

async function loadExistingSamples(supabase) {
  const { data, error } = await supabase
    .from("enrollment_records")
    .select("fub_link")
    .in(
      "fub_link",
      records.map((record) => record.fub_link)
    );
  if (error) throw new Error(`Unable to check existing enrollment samples: ${error.message}`);
  return new Set((data ?? []).map((row) => row.fub_link).filter(Boolean));
}

function toEnrollmentInsert(record, options) {
  const updatedAt = record.closed_at ?? record.qc_checked_at ?? shiftIso(record.created_at, 42);
  const lookup = (setKey) => {
    const label = record[setKey];
    return label ? options.ids.get(optionKey(record.program, setKey, label)) : null;
  };
  return {
    program: record.program,
    client_name: record.client_name,
    fub_link: record.fub_link,
    due_date: record.due_date ?? null,
    stage_id: lookup("stage"),
    carrier_id: lookup("carrier"),
    platform_id: lookup("platform"),
    consent_id: lookup("consent"),
    payment_status_id: lookup("payment_status"),
    aca_status_id: lookup("aca_status"),
    pcp_2025: record.pcp_2025 ?? null,
    pcp_2026: record.pcp_2026 ?? null,
    caller_email: record.caller_email ?? null,
    responsible_enroll_email: record.responsible_enroll_email ?? null,
    qc_checked_by_email: record.qc_checked_by_email ?? null,
    qc_checked_at: record.qc_checked_at ?? null,
    closed_at: record.closed_at ?? null,
    created_by_email: record.created_by_email ?? SEED_ACTOR,
    created_at: record.created_at,
    updated_by_email: record.updated_by_email ?? SEED_ACTOR,
    updated_at: updatedAt,
  };
}

async function insertSeedSideEffects(supabase, insertedRecords, sampleByLink, options) {
  const historyRows = [];
  const activityRows = [];
  const commentRows = [];

  for (const inserted of insertedRecords) {
    const sample = sampleByLink.get(inserted.fub_link);
    if (!sample) continue;
    const stageFlags = inserted.stage_id ? options.flags.get(inserted.stage_id) : null;

    historyRows.push({
      record_id: inserted.id,
      from_option_id: null,
      to_option_id: inserted.stage_id,
      changed_by_email: SEED_ACTOR,
      changed_at: inserted.created_at,
    });

    activityRows.push({
      record_id: inserted.id,
      actor_email: SEED_ACTOR,
      type: "created",
      meta: { source: "sample_seed", program: sample.program, stage: sample.stage },
      created_at: inserted.created_at,
    });

    if (stageFlags?.triggers_qc) {
      activityRows.push({
        record_id: inserted.id,
        actor_email: SEED_ACTOR,
        type: "qc_needed",
        meta: { stage: sample.stage },
        created_at: sample.closed_at ?? shiftIso(sample.created_at, 120),
      });
    }

    if (inserted.qc_checked_by_email && inserted.qc_checked_at) {
      activityRows.push({
        record_id: inserted.id,
        actor_email: inserted.qc_checked_by_email,
        type: "qc_reviewed",
        meta: { stage: sample.stage },
        created_at: inserted.qc_checked_at,
      });
    }

    if (sample.note) {
      commentRows.push({
        record_id: inserted.id,
        parent_id: null,
        author_email: SEED_ACTOR,
        body: `Sample note: ${sample.note}`,
        created_at: shiftIso(sample.created_at, 15),
        updated_at: shiftIso(sample.created_at, 15),
      });
    }
  }

  const operations = [
    historyRows.length > 0
      ? supabase.from("enrollment_stage_history").insert(historyRows)
      : Promise.resolve({ error: null }),
    activityRows.length > 0
      ? supabase.from("enrollment_activity").insert(activityRows)
      : Promise.resolve({ error: null }),
    commentRows.length > 0
      ? supabase.from("enrollment_comments").insert(commentRows)
      : Promise.resolve({ error: null }),
  ];

  const results = await Promise.all(operations);
  const error = results.find((result) => result.error)?.error;
  if (error) throw new Error(`Inserted records, but side effects failed: ${error.message}`);
}

function sampleLink(prefix, index) {
  return `${prefix}${String(index).padStart(3, "0")}`;
}

function optionKey(program, setKey, label) {
  return `${program}:${setKey}:${label.trim().toLowerCase()}`;
}

function shiftIso(iso, minutes) {
  return new Date(new Date(iso).getTime() + minutes * 60 * 1000).toISOString();
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
