// Imported once for side effects — each import below registers its handler
// with correctionRegistry as a side effect of module load (see the last line
// of each handler file). Adding a new Phase 2+ handler means: write the
// handler file, add one import line here. No other platform file changes.
import "../payments/corrections/payment-reversal-handler";
import "../payments/corrections/payment-transfer-handler";
import "../payments/corrections/reference-edit-handler";
