import "dotenv/config";
import { getSql } from "./server/db/supabase";
async function main(){
  const sql = await getSql();
  const rows = await sql.unsafe(`SELECT id, code, jsonb_typeof(services) AS t, services FROM outlets ORDER BY id`);
  let ok = true;
  const need = ["dineIn","takeaway","delivery","pos","onlineOrdering"];
  for (const r of rows as any[]) {
    const keys = r.services && typeof r.services === "object" ? Object.keys(r.services).sort() : [];
    const good = r.t === "object" && need.every(k => r.services[k] === true);
    if (!good) ok = false;
    console.log(`  ${good ? "PASS" : "FAIL"} outlet ${r.id} (${r.code}) type=${r.t} keys=[${keys.join(",")}] all-true=${need.every(k=>r.services?.[k]===true)}`);
  }
  console.log(ok ? "\nBOTH OUTLETS RESTORED TO FULL ORIGINAL FLAG SET" : "\nSTILL WRONG");
  await sql.end();
  process.exit(ok?0:1);
}
main().catch(e=>{console.error(e);process.exit(1);});
