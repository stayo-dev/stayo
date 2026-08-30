import { prisma } from "../lib/db";

const REQUIRED_ACKNOWLEDGEMENTS = [
  "fee_refund_rules",
  "discipline_policies",
  "late_fee_obligations",
  "damage_liabilities",
  "hostel_rules",
] as const;

const NEW_RULE_CONTENT = {
  categories: [
    {
      id: "payments",
      title: "1. Fee Structure & Payment Policy",
      severity: "important",
      icon: "receipt",
      highlights: [
        "Hostel fee is applicable only for the academic year period of 12 months.",
        "Hostel fees once paid are strictly non-refundable and non-adjustable under any circumstances.",
        "If GST becomes applicable as per government regulations, additional GST charges will be added to the hostel fee."
      ],
      rules: [
        "Students are required to pay 3 months hostel fee in advance at the time of joining.",
        "Any delay in fee payment will attract a late fee of ₹50 per day."
      ],
    },
    {
      id: "facilities",
      title: "2. Accommodation & Hostel Facilities",
      severity: "standard",
      icon: "wifi",
      highlights: [
        "The hostel management is responsible only for providing Accommodation, Breakfast, Lunch, and Dinner.",
        "Facilities such as Internet/Wi-Fi, Washing machines, and Hot water are provided free of cost and may face occasional interruptions or maintenance delays.",
        "Hostel premises will remain closed during major college holidays and festival vacations (Semester Holidays, Dussehra, Sankranthi, etc.). Students must vacate during these periods."
      ],
      rules: [
        "Complaints regarding internet or washing machine issues may take up to 10 days for resolution.",
        "Hostel rooms may be reshuffled under unavoidable or operational circumstances. Allocation of the same room throughout the year is not guaranteed.",
        "Visitors who wish to stay in the hostel must pay ₹500 per day, subject to management approval."
      ],
    },
    {
      id: "discipline",
      title: "3. Discipline & Conduct",
      severity: "critical",
      icon: "shield",
      highlights: [
        "Smoking, alcohol consumption, illegal activities, violence, or misconduct inside the hostel premises are strictly prohibited.",
        "Ragging in any form is strictly prohibited. Involved students will be immediately removed without any fee refund."
      ],
      rules: [
        "Students must maintain proper discipline and respectful behavior inside the hostel premises at all times.",
        "Outsiders, friends, parents, or visitors are not allowed inside hostel rooms. Visitors may wait only in the office area or front lobby.",
        "Hostel gate closes strictly at 9:30 PM every day.",
        "Students leaving the hostel premises must inform the management through WhatsApp message as proof and record.",
        "Food is not allowed inside hostel rooms. Students must use the dining hall for meals."
      ],
    },
    {
      id: "safety",
      title: "4. Safety & Responsibility",
      severity: "important",
      icon: "lock",
      highlights: [
        "Students are fully responsible for their personal belongings (Mobile phones, Laptops, Gold, Cash, Certificates, etc.).",
        "Use of electrical appliances such as iron boxes, water heaters, micro-ovens, or inflammable items is strictly prohibited inside rooms."
      ],
      rules: [
        "The hostel management is not responsible for theft, loss, damage, injuries, accidents, personal disputes, or matters occurring outside hostel responsibility.",
        "Students found using prohibited appliances will be charged a fine of ₹1000.",
        "Any damage caused to hostel property (beds, mattresses, lockers, furniture, fittings, etc.) must be repaired or compensated by the student(s) responsible."
      ],
    },
    {
      id: "vacating",
      title: "5. Vacating & Maintenance Charges",
      severity: "important",
      icon: "door-open",
      highlights: [
        "No refund will be provided for early vacating under any circumstances."
      ],
      rules: [
        "If a student vacates the hostel during the academic year, hostel charges will be recalculated at ₹12,000 per month for the occupied duration.",
        "Students vacating the hostel during the academic year must additionally pay ₹1400 as maintenance charges."
      ],
    },
    {
      id: "rights",
      title: "6. Management Rights",
      severity: "standard",
      icon: "shield",
      highlights: [
        "Decisions made by hostel management regarding hostel administration, discipline, and accommodation shall be final and binding."
      ],
      rules: [
        "The hostel management reserves the full right to discontinue hostel accommodation for any student involved in misconduct, indiscipline, rule violations, or behavior affecting hostel operations."
      ],
    }
  ],
  acknowledgements: REQUIRED_ACKNOWLEDGEMENTS,
};

async function main() {
  console.log("Updating active RuleVersions in database...");
  const ruleVersions = await prisma.ruleVersion.findMany({
    where: {
      OR: [{ is_active: true }, { active: true }],
    },
  });

  console.log(`Found ${ruleVersions.length} active RuleVersions.`);

  for (const rv of ruleVersions) {
    console.log(`Updating RuleVersion ID: ${rv.id}, version: ${rv.version}`);
    await prisma.ruleVersion.update({
      where: { id: rv.id },
      data: {
        title: "Sunrise Residency — Rules & Regulations",
        content: NEW_RULE_CONTENT,
        content_snapshot: NEW_RULE_CONTENT,
      },
    });
  }

  console.log("Database update complete!");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
