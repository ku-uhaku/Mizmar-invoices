#!/usr/bin/env bash
# Walks quote -> order -> 2 delivery notes -> invoice -> credit note against a running API
# and asserts stock moved exactly once. Needs a freshly seeded database (pnpm infra:reset && pnpm db:push && pnpm db:seed).
# Walks the sales pipeline against the running API and asserts stock moves once.
set -euo pipefail
API=http://localhost:3001/api/v1
J='Content-Type: application/json'

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
jqr() { jq -r "$1"; }

for i in $(seq 1 60); do curl -fsS "$API/health" >/dev/null 2>&1 && break; sleep 0.5; done

say "1. Login"
LOGIN=$(curl -fsS -X POST "$API/auth/login" -H "$J" \
  -d '{"email":"owner@mizmar.ma","password":"Mizmar2026!"}')
TOKEN=$(echo "$LOGIN" | jqr '.accessToken')
COMPANY=$(echo "$LOGIN" | jqr '.user.companies[] | select(.code=="MZT") | .id')
echo "   user=$(echo "$LOGIN" | jqr '.user.fullName') role=$(echo "$LOGIN" | jqr '.user.role')"
echo "   companies=$(echo "$LOGIN" | jqr '[.user.companies[].code] | join(", ")')"
AUTH=(-H "Authorization: Bearer $TOKEN" -H "x-company-id: $COMPANY" -H "$J")

say "2. Find a variant and its opening stock"
VARIANT=$(curl -fsS "${AUTH[@]}" "$API/catalog/variants/search?q=POLO-ROU-L")
VID=$(echo "$VARIANT" | jqr '.[0].variantId')
echo "   sku=$(echo "$VARIANT" | jqr '.[0].sku')  onHand=$(echo "$VARIANT" | jqr '.[0].onHand')  available=$(echo "$VARIANT" | jqr '.[0].available')"
WH=$(curl -fsS "${AUTH[@]}" "$API/inventory/warehouses" | jqr '.[] | select(.code=="WH-CASA") | .id')
CLIENT=$(curl -fsS "${AUTH[@]}" "$API/contacts?kind=CLIENT&limit=5" | jqr '.items[0].id')

stock() {
  curl -fsS "${AUTH[@]}" -X POST "$API/inventory/stock/availability" \
    -d "{\"variantIds\":[\"$VID\"],\"warehouseId\":\"$WH\"}" \
    | jqr '.[0] | "onHand=\(.onHand) reserved=\(.reserved) available=\(.available)"'
}
echo "   before: $(stock)"

say "3. Create and validate a quote for 10"
QUOTE=$(curl -fsS "${AUTH[@]}" -X POST "$API/documents" -d "{
  \"type\":\"DEVIS\",\"contactId\":\"$CLIENT\",\"warehouseId\":\"$WH\",
  \"lines\":[{\"variantId\":\"$VID\",\"quantity\":\"10\",\"warehouseId\":\"$WH\"}]}")
QID=$(echo "$QUOTE" | jqr '.id')
echo "   draft label=$(echo "$QUOTE" | jqr '.draftLabel')  number=$(echo "$QUOTE" | jqr '.number')  HT=$(echo "$QUOTE" | jqr '.totals.totalHT')  TTC=$(echo "$QUOTE" | jqr '.totals.totalTTC')"
QV=$(curl -fsS "${AUTH[@]}" -X POST "$API/documents/$QID/validate" -d '{"confirmNegativeStock":false}')
echo "   validated as $(echo "$QV" | jqr '.number')  badges=$(echo "$QV" | jqr '[.badges[].key]|join(",")')"
echo "   stock: $(stock)   <- a quote must touch nothing"

say "4. Convert quote -> sales order (reserves)"
ORDER=$(curl -fsS "${AUTH[@]}" -X POST "$API/documents/convert" -d "{
  \"sourceDocumentIds\":[\"$QID\"],\"targetType\":\"SALES_ORDER\",\"validateImmediately\":true}")
OID=$(echo "$ORDER" | jqr '.id')
echo "   order=$(echo "$ORDER" | jqr '.number')"
echo "   stock: $(stock)   <- reserved, NOT shipped"
echo "   quote fulfilment=$(curl -fsS "${AUTH[@]}" "$API/documents/$QID" | jqr '.fulfilment')"

say "5. Deliver 4 of 10"
OLINE=$(curl -fsS "${AUTH[@]}" "$API/documents/$OID" | jqr '.lines[0].id')
BL1=$(curl -fsS "${AUTH[@]}" -X POST "$API/documents/convert" -d "{
  \"sourceDocumentIds\":[\"$OID\"],\"targetType\":\"DELIVERY_NOTE\",
  \"selections\":[{\"sourceDocumentId\":\"$OID\",\"sourceLineId\":\"$OLINE\",\"quantity\":\"4\"}],
  \"validateImmediately\":true}")
BL1ID=$(echo "$BL1" | jqr '.id')
echo "   BL=$(echo "$BL1" | jqr '.number')  qty=$(echo "$BL1" | jqr '.lines[0].quantity')"
echo "   stock: $(stock)"
echo "   order badges=$(curl -fsS "${AUTH[@]}" "$API/documents/$OID" | jqr '[.badges[].key]|join(",")')"

say "6. Deliver the remaining 6 (quantity defaults to the remainder)"
OPTS=$(curl -fsS "${AUTH[@]}" "$API/documents/$OID/conversion-options?targetType=DELIVERY_NOTE")
echo "   dialog says: ordered=$(echo "$OPTS" | jqr '.lines[0].ordered') drawn=$(echo "$OPTS" | jqr '.lines[0].alreadyDrawn') remaining=$(echo "$OPTS" | jqr '.lines[0].remaining')"
BL2=$(curl -fsS "${AUTH[@]}" -X POST "$API/documents/convert" -d "{
  \"sourceDocumentIds\":[\"$OID\"],\"targetType\":\"DELIVERY_NOTE\",\"validateImmediately\":true}")
BL2ID=$(echo "$BL2" | jqr '.id')
echo "   BL=$(echo "$BL2" | jqr '.number')  qty=$(echo "$BL2" | jqr '.lines[0].quantity')"
echo "   stock: $(stock)"
echo "   order badges=$(curl -fsS "${AUTH[@]}" "$API/documents/$OID" | jqr '[.badges[].key]|join(",")')"

say "7. Invoice BOTH delivery notes as one invoice"
INV=$(curl -fsS "${AUTH[@]}" -X POST "$API/documents/convert" -d "{
  \"sourceDocumentIds\":[\"$BL1ID\",\"$BL2ID\"],\"targetType\":\"SALES_INVOICE\"}")
IID=$(echo "$INV" | jqr '.id')
echo "   invoice draft lines=$(echo "$INV" | jqr '.lines | length')  HT=$(echo "$INV" | jqr '.totals.totalHT')  TTC=$(echo "$INV" | jqr '.totals.totalTTC')"
echo "   line sources: $(echo "$INV" | jqr '[.lines[].sources[0].sourceDocumentNumber]|join(" + ")')"

say "8. Validation preview — what WOULD move"
PREV=$(curl -fsS "${AUTH[@]}" -X POST "$API/documents/$IID/validate/preview" -d '{}')
echo "   next number: $(echo "$PREV" | jqr '.nextNumberPreview')"
echo "   movements planned: $(echo "$PREV" | jqr '.movements | length')   <- must be 0, the BLs already shipped"
echo "   blocked=$(echo "$PREV" | jqr '.blocked')"

say "9. Validate the invoice"
IV=$(curl -fsS "${AUTH[@]}" -X POST "$API/documents/$IID/validate" -d '{"confirmNegativeStock":false}')
echo "   invoice=$(echo "$IV" | jqr '.number')  due=$(echo "$IV" | jqr '.dueDate')  badges=$(echo "$IV" | jqr '[.badges[].key]|join(",")')"
echo "   stock: $(stock)"

say "10. The ledger for this variant"
curl -fsS "${AUTH[@]}" "$API/inventory/stock/movements?variantId=$VID&warehouseId=$WH&limit=10" \
  | jqr '.items[] | "   \(.type)\t\(.quantity)\tbalance=\(.balanceAfter)\t\(.documentNumber // "—")"'

say "11. Assertions"
FINAL=$(curl -fsS "${AUTH[@]}" -X POST "$API/inventory/stock/availability" \
  -d "{\"variantIds\":[\"$VID\"],\"warehouseId\":\"$WH\"}")
ON=$(echo "$FINAL" | jqr '.[0].onHand'); RES=$(echo "$FINAL" | jqr '.[0].reserved')
MOVES=$(curl -fsS "${AUTH[@]}" "$API/inventory/stock/movements?variantId=$VID&warehouseId=$WH&type=SALE&limit=50" | jqr '.items | length')
fail=0
[ "$ON" = "50.000000" ] && echo "   PASS onHand 60 -> 50 (10 units, once)" || { echo "   FAIL onHand=$ON expected 50.000000"; fail=1; }
[ "$RES" = "0.000000" ] && echo "   PASS reservations fully released" || { echo "   FAIL reserved=$RES"; fail=1; }
[ "$MOVES" = "2" ] && echo "   PASS exactly 2 SALE movements (the two delivery notes)" || { echo "   FAIL SALE movements=$MOVES expected 2"; fail=1; }

say "12. Over-delivery must be refused"
CODE=$(curl -s -o /tmp/err.json -w '%{http_code}' "${AUTH[@]}" -X POST "$API/documents/convert" -d "{
  \"sourceDocumentIds\":[\"$OID\"],\"targetType\":\"DELIVERY_NOTE\",
  \"selections\":[{\"sourceDocumentId\":\"$OID\",\"sourceLineId\":\"$OLINE\",\"quantity\":\"1\"}]}")
echo "   HTTP $CODE  code=$(jqr '.code' < /tmp/err.json)  message=$(jqr '.message' < /tmp/err.json)"
[ "$CODE" = "422" ] && echo "   PASS refused" || { echo "   FAIL expected 422"; fail=1; }

say "13. Cancelling a drawn-from document must be refused"
CODE=$(curl -s -o /tmp/err2.json -w '%{http_code}' "${AUTH[@]}" -X POST "$API/documents/$BL1ID/cancel" -d '{"reason":"test"}')
echo "   HTTP $CODE  code=$(jqr '.code' < /tmp/err2.json)  message=$(jqr '.message' < /tmp/err2.json)"
[ "$CODE" = "409" ] && echo "   PASS refused" || { echo "   FAIL expected 409"; fail=1; }

say "14. Credit note with restock"
CN=$(curl -fsS "${AUTH[@]}" -X POST "$API/documents/convert" -d "{
  \"sourceDocumentIds\":[\"$IID\"],\"targetType\":\"CREDIT_NOTE\",\"returnToStock\":true,
  \"selections\":[{\"sourceDocumentId\":\"$IID\",\"sourceLineId\":\"$(echo "$IV" | jqr '.lines[0].id')\",\"quantity\":\"3\"}],
  \"validateImmediately\":true}")
echo "   credit note=$(echo "$CN" | jqr '.number')  qty=$(echo "$CN" | jqr '.lines[0].quantity')"
echo "   stock: $(stock)   <- 3 came back"
AFTER=$(curl -fsS "${AUTH[@]}" -X POST "$API/inventory/stock/availability" -d "{\"variantIds\":[\"$VID\"],\"warehouseId\":\"$WH\"}" | jqr '.[0].onHand')
[ "$AFTER" = "53.000000" ] && echo "   PASS onHand 50 -> 53" || { echo "   FAIL onHand=$AFTER expected 53.000000"; fail=1; }

say "15. Company isolation"
MZR=$(echo "$LOGIN" | jqr '.user.companies[] | select(.code=="MZR") | .id')
COUNT=$(curl -fsS -H "Authorization: Bearer $TOKEN" -H "x-company-id: $MZR" "$API/documents?limit=50" | jqr '.items | length')
echo "   documents visible in MZR: $COUNT  <- MZT's documents must not appear"
[ "$COUNT" = "0" ] && echo "   PASS isolated" || { echo "   FAIL saw $COUNT"; fail=1; }

printf '\n'
[ "$fail" = "0" ] && echo "ALL ASSERTIONS PASSED" || { echo "SOME ASSERTIONS FAILED"; exit 1; }
