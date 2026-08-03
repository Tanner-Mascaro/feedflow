/* AI use: Claude Sonnet 5 (Claude Code) — extracted for Sprint 3 CI/CD so the
   business logic is unit-testable with zero dependencies. See README "AI use". */
/* ============================================================
   FeedFlow — pure business logic, no DOM/Supabase dependencies.
   Loaded as a plain <script> in the browser (exposes globals) and
   required directly in Node for tests (module.exports).
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof window !== "undefined" ? window : globalThis, function () {

  const round2 = n => Math.round(n * 100) / 100;

  function nextTicketNo(movements) {
    const max = movements.reduce((m, e) => Math.max(m, e.id || 0), 1041);
    return "FF-" + String(max + 1).padStart(5, "0");
  }

  function validateMovementInput(ingredient, qty) {
    if (!ingredient) return "Pick an ingredient.";
    if (!(qty > 0)) return "Enter an amount greater than zero.";
    return null;
  }

  /* End Balance = Beg + Received − To Mix − Sold (Raw) + Transferred + Adjusted,
     matching the workbook's Monthly Inventory math. */
  function computeBalances(ingredients, movements, openingBalances, location) {
    const ob = {};
    openingBalances.filter(o => o.location === location).forEach(o => { ob[o.ingredient] = Number(o.qty); });
    const rows = {};
    ingredients.forEach(ing => { rows[ing] = { ingredient: ing, beg: ob[ing] || 0, received: 0, toMix: 0, soldRaw: 0, transferred: 0, adjusted: 0 }; });
    movements.filter(m => m.location === location).forEach(m => {
      if (!rows[m.ingredient]) rows[m.ingredient] = { ingredient: m.ingredient, beg: ob[m.ingredient] || 0, received: 0, toMix: 0, soldRaw: 0, transferred: 0, adjusted: 0 };
      const r = rows[m.ingredient];
      if (m.type === "received") r.received += m.qty;
      else if (m.type === "to_mix") r.toMix += m.qty;
      else if (m.type === "sold_raw") r.soldRaw += m.qty;
      else if (m.type === "transferred") r.transferred += m.qty;
      else if (m.type === "adjusted") r.adjusted += m.qty;
    });
    return Object.values(rows).map(r => ({
      ...r,
      end: r.beg + r.received - r.toMix - r.soldRaw + r.transferred + r.adjusted,
    }));
  }

  function combineBalances(...groups) {
    const map = {};
    groups.flat().forEach(r => {
      const m = map[r.ingredient] || (map[r.ingredient] = { ingredient: r.ingredient, beg: 0, received: 0, toMix: 0, soldRaw: 0, transferred: 0, adjusted: 0, end: 0 });
      m.beg += r.beg; m.received += r.received; m.toMix += r.toMix;
      m.soldRaw += r.soldRaw; m.transferred += r.transferred; m.adjusted += r.adjusted; m.end += r.end;
    });
    return Object.values(map);
  }

  return { round2, nextTicketNo, validateMovementInput, computeBalances, combineBalances };
});
