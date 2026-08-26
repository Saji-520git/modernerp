// ─── Scanner input that lands in the wrong field ─────────────────────────────
//
// A barcode scanner is just a very fast keyboard: its digits go to whatever
// input has focus, and it ends the burst with Enter. The POS moves focus around
// as the cashier works, so a scan regularly arrives somewhere that is not the
// barcode box, and every one of those fields will happily accept it:
//
//   - the cart line's qty box, focused right after an item is added. The scan
//     became the quantity - the whole shelf, or, once selling past zero lifted
//     that cap, 4796011470029 units.
//   - a discount box. commit() clamps to 0-100 in percent mode and to the whole
//     subtotal in amount mode, so a barcode reads as a FULL discount; on the
//     cart-total input its Enter then opens the payment dialog on top.
//
// The two are told apart on length alone, with no timing heuristics to tune or
// misfire: a barcode here is EAN-8 or EAN-13, and neither a quantity nor a
// discount is ever eight digits long. Anything this long came from a scanner,
// so the field hands it back to the barcode handler and keeps the value it had.
export function looksLikeScannedCode(raw: string): boolean {
  return /^\d{8,}$/.test(raw.trim());
}
