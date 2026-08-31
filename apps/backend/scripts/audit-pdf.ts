import { generateReceiptPdf, ReceiptRenderData } from '../lib/pdf/receipt-template-pdf-lib';
import fs from 'fs';
import path from 'path';

async function runTests() {
  console.log("Starting PDF System Audit...\n");

  const outputDir = path.join(__dirname, '..', 'audit-output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const baseData: ReceiptRenderData = {
    hostel_name: "HMS Grand Hostel",
    hostel_address: "123 Main St",
    hostel_city: "Metropolis",
    hostel_state: "State",
    hostel_pincode: "123456",
    hostel_phone: "123-456-7890",
    hostel_gst: "GST123456789",
    hostel_logo_url: null,
    receipt_number: "REC-2026-001",
    issued_at: new Date("2026-05-14T10:00:00Z"),
    tenant_name: "John Doe",
    tenant_phone: "098-765-4321",
    tenant_email: "john@example.com",
    room_no: "101",
    room_floor: "1",
    amount: 15000,
    payment_method: "upi",
    transaction_id: "TXN1234567890",
    reference_number: "REF987654321",
    payment_date: new Date("2026-05-13T10:00:00Z"),
    rent_month: new Date("2026-05-01T00:00:00Z"),
    due_date: new Date("2026-05-05T00:00:00Z"),
    obligation_amount: 15000,
    obligation_status: "PAID",
    settlement_allocations: [
      {
        type: "RENT",
        rent_month: new Date("2026-05-01T00:00:00Z"),
        allocated: 15000,
        label: "Rent - May 2026",
      },
    ],
    future_credit_allocated: 0,
    total_transaction_paid: 15000,
    outstanding_balance_after: 0,
    future_credit_balance_after: 0,
    payment_id: "pay_123456",
    tenant_id: "ten_789012",
    receipt_id: "rec_345678",
    template_version: 5,
    prefs: {
      currency: "INR",
      date_format: "DD/MM/YYYY",
    },
    footer: "Thank you for staying with us.",
  };

  try {
    // 1. Normal Generation
    console.log("1. Testing normal generation...");
    let start = performance.now();
    let pdfBytes = await generateReceiptPdf(baseData);
    let end = performance.now();
    fs.writeFileSync(path.join(outputDir, '1_normal.pdf'), pdfBytes);
    console.log(`   Success. Time: ${(end - start).toFixed(2)}ms. Size: ${(pdfBytes.length / 1024).toFixed(2)} KB\n`);

    // 2. Large Edge Cases
    console.log("2. Testing large data edge cases...");
    const largeData = {
      ...baseData,
      hostel_name: "HMS Grand Hostel With A Very Very Long Name That Might Break The Header Formatting And Cause Issues In The PDF Layout",
      hostel_address: "123 Main St, Apartment 4B, Building Complex C, Near the Very Long Landmark That Takes Up A Lot Of Space, Sector 123, Block A",
      tenant_name: "Mr. Johnathan Bartholomew Doe The Third Esquire With A Very Long Name",
      amount: 9999999999.99, // very large amount
      footer: "This is a very long footer note intended to test the line wrapping logic in the pdf generation. " +
              "It should correctly wrap lines without overflowing the bounds of the page. If the logic is correct, " +
              "this will appear on multiple lines and look neat. We need to keep adding text to ensure it wraps " +
              "more than just one or two lines. Testing testing 1 2 3.",
    };
    start = performance.now();
    pdfBytes = await generateReceiptPdf(largeData);
    end = performance.now();
    fs.writeFileSync(path.join(outputDir, '2_large.pdf'), pdfBytes);
    console.log(`   Success. Time: ${(end - start).toFixed(2)}ms. Size: ${(pdfBytes.length / 1024).toFixed(2)} KB\n`);

    // 3. Unicode/Font Rendering
    console.log("3. Testing unicode/special characters...");
    const unicodeData = {
      ...baseData,
      hostel_name: "HMS 🏨 Grand",
      tenant_name: "José Nuñez ✨",
      prefs: { ...baseData.prefs, currency: "INR" }, // testing if formatting currency works
    };
    start = performance.now();
    try {
      pdfBytes = await generateReceiptPdf(unicodeData);
      end = performance.now();
      fs.writeFileSync(path.join(outputDir, '3_unicode.pdf'), pdfBytes);
      console.log(`   Success (potentially missing glyphs though). Time: ${(end - start).toFixed(2)}ms. Size: ${(pdfBytes.length / 1024).toFixed(2)} KB\n`);
    } catch (err: any) {
      console.error(`   Failed handling Unicode: ${err.message}\n`);
    }

    // 4. Concurrent Generation & Memory Test
    console.log("4. Testing concurrent generation and memory usage (100 parallel requests)...");
    const initialMem = process.memoryUsage().heapUsed;
    start = performance.now();
    const promises = [];
    for (let i = 0; i < 100; i++) {
      promises.push(generateReceiptPdf({ ...baseData, receipt_number: `REC-CONC-${i}` }));
    }
    const results = await Promise.all(promises);
    end = performance.now();
    const finalMem = process.memoryUsage().heapUsed;
    console.log(`   Success. Total Time for 100 docs: ${(end - start).toFixed(2)}ms.`);
    console.log(`   Average Time per doc: ${((end - start) / 100).toFixed(2)}ms.`);
    console.log(`   Memory Delta (Heap Used): ${((finalMem - initialMem) / 1024 / 1024).toFixed(2)} MB`);
    fs.writeFileSync(path.join(outputDir, '4_concurrent_sample.pdf'), results[0]);
    console.log(`   First concurrent sample Size: ${(results[0].length / 1024).toFixed(2)} KB\n`);

    console.log("Audit Complete.");

  } catch (err) {
    console.error("Audit failed:", err);
  }
}

runTests();
