export function printReport(results) {
  for (const r of results) {
    console.log("[" + r.status + "] " + r.name + (r.reason ? " -- " + r.reason : ""));
  }
}
